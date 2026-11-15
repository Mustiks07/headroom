import type { ExtractedFact, ImportDraft } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { ImportDecisionSchema, type ImportDecision, type ImportTarget } from "@/domain/imports";
import { centsToInput, parseDollarsToCents } from "@/features/format";

export type ReviewChoice = {
  mode: "use" | "reference" | "skip";
  personId: string; year: string; period: string; asOfDate: string;
  status: "" | "confirmed" | "estimated"; months: number[]; monthsConfirmed: boolean;
  projectId: string; lineId: string; date: string; remainderDate: string;
  receiptMode: "" | "actual" | "partial" | "correct"; reason: string;
  title: string; correction: string; correcting: boolean; monthlyCorrection: boolean;
  noAdditionalProjectCosts: boolean; singleExpectedPayment: boolean; excludesManagedProjects: boolean;
  resolves: string[];
};

/** This is the deterministic extractor's prior-year-only warning, not arbitrary model prose. */
export function isPriorYearOnlyWarning(warning: string): boolean {
  const matched = /^This document appears to be for ((?:19|20)\d{2})\./.exec(warning);
  return !!matched && Number(matched[1]) < 2026;
}

const moneyFields = new Set(["income.scheduleCProfit", "income.w2Box1", "income.socialSecurityWages", "income.medicareWages", "income.grossWages", "income.payrollPretaxDeductions", "income.taxableInterest", "income.taxExemptInterest", "income.existingSepContribution", "coverage.enrollmentPremium", "coverage.benchmarkPremium", "coverage.advancePtc", "opportunity.grossRevenueCents", "project.paymentReceived"]);
export function initialChoice(f: ExtractedFact, draft: ImportDraft): ReviewChoice {
  const dateField = f.field === "project.paymentReceived" ? "project.paymentReceivedDate" : "opportunity.plannedReceiptDate";
  const paired = draft.facts.find(x => x.documentId === f.documentId && x.field === dateField && x.value.kind === "date");
  const title = draft.facts.find(x => x.documentId === f.documentId && x.field === "opportunity.title" && x.value.kind === "text");
  return { mode: moneyFields.has(f.field) && f.documentKind !== "prior_year_tax_return" ? "use" : "reference",
    personId: f.personCandidate ?? "", year: f.taxYear ? String(f.taxYear) : "",
    period: f.value.kind === "money" ? f.documentKind === "w2" ? "annual" : f.value.period : "",
    asOfDate: f.asOfDate ?? "", status: "", months: [], monthsConfirmed: false,
    projectId: "", lineId: "", date: paired?.value.kind === "date" ? paired.value.date : "", remainderDate: "", receiptMode: "", reason: "",
    title: title?.value.kind === "text" ? title.value.text : "", correction: f.value.kind === "money" ? centsToInput(f.value.amountCents) : "",
    correcting: false, monthlyCorrection: false, noAdditionalProjectCosts: false, singleExpectedPayment: false, excludesManagedProjects: false, resolves: [] };
}

export function reviewChoice(f: ExtractedFact, draft: ImportDraft, saved: ReviewChoice | undefined, referenceOnlyDocuments: Record<string, string>): ReviewChoice {
  const c = { ...initialChoice(f, draft), ...saved };
  return referenceOnlyDocuments[f.documentId] && c.mode === "use" ? { ...c, mode: "reference" } : c;
}

export function targetFor(f: ExtractedFact, c: ReviewChoice): ImportTarget | null {
  if (c.mode === "skip") return null;
  if (c.mode === "reference") return { kind: "reference_only" };
  if (f.value.kind !== "money" || f.documentKind === "prior_year_tax_return") return null;
  const year = c.year === "2026" ? 2026 : c.year === "2027" ? 2027 : null;
  const period = c.monthlyCorrection && c.correcting ? "monthly" : c.period;
  if (f.field === "income.scheduleCProfit" && year && c.personId && c.status && ["annual", "year_to_date"].includes(period)) {
    if (period === "year_to_date" && !c.asOfDate) return null;
    return { kind: "forecast", personId: c.personId, year, field: period === "annual" ? "annualNetProfit" : "ytdNetProfit", status: c.status, asOfDate: period === "year_to_date" ? c.asOfDate : null };
  }
  const wage = f.field.replace("income.", "");
  if (["w2Box1", "socialSecurityWages", "medicareWages", "grossWages", "payrollPretaxDeductions"].includes(wage) && year && c.personId && period === "annual") {
    return { kind: "wages", personId: c.personId, year, field: wage as Extract<ImportTarget, { kind: "wages" }>["field"] };
  }
  if (["income.taxableInterest", "income.taxExemptInterest"].includes(f.field) && year && c.personId && period === "annual") {
    return { kind: "interest", personId: c.personId, year, taxExempt: f.field === "income.taxExemptInterest" };
  }
  if (f.field.startsWith("coverage.") && year && c.months.length && c.monthsConfirmed && period === "monthly") {
    return { kind: "coverage", year, field: f.field.replace("coverage.", "") as Extract<ImportTarget, { kind: "coverage" }>["field"], months: c.months };
  }
  if (f.field === "income.existingSepContribution" && year && c.personId && c.date) return { kind: "sep", personId: c.personId, taxYear: year, paidDate: c.date };
  if (f.field === "opportunity.grossRevenueCents" && c.personId && c.date && c.title.trim() && c.noAdditionalProjectCosts && c.singleExpectedPayment) return { kind: "new_offer", ownerPersonId: c.personId, paymentDate: c.date, title: c.title.trim() };
  if (f.field === "project.paymentReceived" && c.projectId && c.lineId && c.date) {
    if (c.receiptMode === "partial" && c.remainderDate) return { kind: "partial_payment", projectId: c.projectId, lineId: c.lineId, date: c.date, remainderDate: c.remainderDate };
    if (c.receiptMode === "correct" && c.reason.trim()) return { kind: "payment", projectId: c.projectId, lineId: c.lineId, date: c.date, mode: "correct", reason: c.reason.trim() };
    if (c.receiptMode === "actual") return { kind: "payment", projectId: c.projectId, lineId: c.lineId, date: c.date, mode: "actual", reason: null };
  }
  return null;
}

export function decisionFor(f: ExtractedFact, c: ReviewChoice, ws?: HouseholdWorkspace): ImportDecision | null {
  const target = targetFor(f, c);
  if (!target) return null;
  const amount = c.correcting ? parseDollarsToCents(c.correction) : null;
  if (c.correcting && (amount === null || amount === "invalid")) return null;
  // A lower final settlement is a separate explicit command, never a consequence of importing a receipt.
  if (target.kind === "payment" && target.mode === "actual" && ws) {
    const line = ws.projects.find(p => p.id === target.projectId)?.receipts.find(l => l.id === target.lineId);
    const proposed = typeof amount === "number" ? amount : f.value.kind === "money" ? f.value.amountCents : null;
    if (line?.expected && proposed !== null && proposed !== line.expected.amountCents) return null;
  }
  const parsed = ImportDecisionSchema.safeParse({ factId: f.id, target, resolvesConflictWith: c.resolves, correctedAmountCents: amount,
    reviewConfirmations: { noAdditionalProjectCosts: c.noAdditionalProjectCosts, singleExpectedPayment: c.singleExpectedPayment, excludesManagedProjects: c.excludesManagedProjects } });
  return parsed.success ? parsed.data : null;
}

/** UI destination identity only. Tax, eligibility and amount semantics remain in the engine. */
function slots(t: ImportTarget): string[] {
  switch (t.kind) {
    case "forecast": return [`forecast:${t.personId}:${t.year}`]; // Annual and YTD are alternative forecast methods.
    case "wages": return [`wages:${t.personId}:${t.year}:${t.field}`];
    case "interest": return [`interest:${t.personId}:${t.year}:${t.taxExempt}`];
    case "coverage": return t.months.map(m => `coverage:${t.year}:${t.field}:${m}`);
    case "payment": case "partial_payment": return [`payment:${t.projectId}:${t.lineId}`];
    case "sep": return [`sep:${t.personId}:${t.taxYear}:${t.paidDate}`];
    default: return [];
  }
}

export interface SourceConflict { ids: string[]; message: string }
export function sourceConflicts(draft: ImportDraft, choices: Record<string, ReviewChoice>): SourceConflict[] {
  const groups = new Map<string, string[]>();
  for (const f of draft.facts) {
    const c = choices[f.id];
    if (!c || c.mode !== "use") continue;
    const t = targetFor(f, c);
    if (t) for (const slot of slots(t)) groups.set(slot, [...(groups.get(slot) ?? []), f.id]);
  }
  const seen = new Set<string>();
  return [...groups.values()].filter(ids => ids.length > 1).flatMap(ids => {
    const key = [...ids].sort().join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ids, message: "These sources point to the same place in your plan. Choose the source to use; the other stays in this review." }];
  });
}

/** Explicit review answers are layered onto the draft; the source excerpt/value stays visible in the UI. */
export function reviewedDraft(draft: ImportDraft, choices: Record<string, ReviewChoice>): ImportDraft {
  return { ...draft, facts: draft.facts.map(f => {
    const c = choices[f.id];
    if (!c || c.mode === "skip") return { ...f, review: "rejected" as const, conflictsWith: [] };
    const year = f.taxYear ?? (c.year === "2026" ? 2026 : c.year === "2027" ? 2027 : null);
    return { ...f, review: "confirmed" as const, conflictsWith: [], personCandidate: c.personId || f.personCandidate, taxYear: year,
      asOfDate: c.asOfDate || f.asOfDate,
      value: f.value.kind === "money" && ((f.value.period === "unknown" && c.period) || (c.correcting && c.monthlyCorrection))
        ? { ...f.value, period: (c.correcting && c.monthlyCorrection ? "monthly" : c.period) as typeof f.value.period } : f.value };
  }) };
}

export function existingValue(ws: HouseholdWorkspace, target: ImportTarget | null): number | null {
  if (!target) return null;
  if (target.kind === "forecast") {
    const forecast = ws.forecasts.find(f => f.personId === target.personId && f.year === target.year);
    if (forecast?.method === "annual_total" && target.field === "annualNetProfit") return forecast.annualNetProfit.valueCents;
    if (forecast?.method === "year_to_date_plus_remaining" && target.field !== "annualNetProfit") return forecast[target.field].valueCents;
  }
  if (target.kind === "wages" || target.kind === "interest") {
    const income = ws.household.years.find(y => y.year === target.year)?.otherIncomes.find(i => i.personId === target.personId);
    return income?.[target.kind === "interest" ? target.taxExempt ? "taxExemptInterest" : "taxableInterest" : target.field].valueCents ?? null;
  }
  if (target.kind === "payment" || target.kind === "partial_payment") return ws.projects.find(p => p.id === target.projectId)?.receipts.find(l => l.id === target.lineId)?.actual?.amountCents ?? null;
  return null;
}
