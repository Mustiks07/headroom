/**
 * Document fact semantics and cross-checks (round 5). Pure, deterministic; no AI.
 *
 * An extracted number is a CANDIDATE fact. These checks decide what it may become, never by a
 * similar amount: person, tax year, period (annual / year to date / month / one payment), as-of date,
 * gross vs net, expected vs received and the document kind must be known or answered by the user.
 *
 *  - A P&L "net profit through D" is year-to-date profit; it is never annualized. The year is
 *    year-to-date + remaining receipts − remaining expenses (entered separately).
 *  - A prior-year return/Schedule C/1095-A is reference only: it does not confirm current income or
 *    a future benchmark.
 *  - An invoice or offer is an EXPECTED amount; only a payment confirmation (or a deposit the user
 *    matched) records money received.
 *  - Bank deposits are not profit: transfers, loans, refunds and personal money are not revenue.
 *  - Premium, benchmark premium and advance credit are different fields; coverage months are not
 *    extended to months the document does not show.
 *  - The same document line twice is a no-op; two different values for the same fact are a conflict
 *    to resolve, never "last one wins".
 */
import type { DocumentKind, ExtractedFact } from "@/domain/assistance";
import type { MoneyFact, TaxYear } from "@/domain/contracts";
import type { HouseholdWorkspace } from "@/domain/household-workspace";

export type FactField =
  | "business_net_profit" | "business_gross_receipts" | "business_expenses"
  | "wages_gross" | "wages_box1" | "wages_ss" | "wages_medicare" | "wages_pretax_deductions" | "interest_taxable" | "interest_tax_exempt"
  | "premium_monthly" | "benchmark_monthly" | "advance_ptc_monthly"
  | "offer_total_price" | "offer_payment" | "invoice_amount" | "payment_received" | "sep_contribution" | "bank_deposit";

export interface ImportedFact {
  /** Deterministic: document content hash + locator + field + period. Same id = same document line. */
  id: string;
  documentId: string;
  documentKind: DocumentKind;
  field: FactField;
  valueCents: number | null;
  /** Date of the payment/contribution (one-time facts). */
  date: string | null;
  /** Household person id, or null when the document does not say whose it is. */
  personId: string | null;
  /** The tax year the amount belongs to (null = not stated); a prior year is a number like 2025. */
  taxYear: number | null;
  /** months = months the amount applies to; monthsConfirmed = the user confirmed it applies to exactly those months. */
  period: { kind: "annual" | "year_to_date" | "monthly" | "one_time" | "unknown"; through: string | null; months: number[] | null; monthsConfirmed?: boolean };
  basis: "gross" | "net" | "unknown";
  /** For payments: received money vs an amount still expected. */
  money: "received" | "expected" | "unknown";
  review: "extracted" | "user_confirmed";
  excerpt: string | null;
  /** The user's explicit link to a project line (never inferred from the amount). */
  link: { projectId: string; lineId: string | null } | null;
}

export type FactNeed = "person" | "tax_year" | "months" | "period" | "as_of_date" | "date" | "project_line" | "managed_inclusion" | "same_payment";
const NEED_OF: Record<string, FactNeed> = { PERSON_UNKNOWN: "person", YEAR_UNKNOWN: "tax_year", MONTHS_UNKNOWN: "months", MONTHS_UNCONFIRMED: "months",
  PERIOD_UNKNOWN: "period", NOT_ANNUAL_WAGES: "period", NOT_ANNUAL: "period", THROUGH_UNKNOWN: "as_of_date", DATE_UNKNOWN: "date", LINE_UNKNOWN: "project_line",
  MANAGED_PAYMENT_INSIDE: "managed_inclusion", POSSIBLE_SAME_PAYMENT: "same_payment" };

export type FactVerdict = "usable" | "needs_confirmation" | "needs_resolution" | "reference_only" | "not_income" | "duplicate";

export interface FactCheck {
  factId: string;
  verdict: FactVerdict;
  issues: Array<{ code: string; message: string }>;
  /** Where it can go once confirmed, if fully determined by its metadata (not by its amount). */
  destination: string | null;
  /** What the user must supply before it can be applied (derived from the issues). */
  needs: FactNeed[];
}

export interface FactCheckReport {
  checks: FactCheck[];
  conflicts: Array<{ factIds: string[]; message: string }>;
  /** Facts that may be confirmed together in one step (consistent, all metadata known). */
  confirmableTogether: string[];
}

/** Metadata that must come from the document or the user, never from matching an amount. */
export const METADATA_NEVER_FROM_AMOUNT = [
  "person (whose income or contribution)", "tax year", "period (year to date, full year, month, one payment)", "as-of / through date",
  "project and payment line a receipt belongs to", "received vs expected", "gross vs net", "coverage months", "whether two records are the same payment",
] as const;

const TRANSFER = /\b(transfer|xfer|between (my |your )?accounts|from savings|to savings|own account|loan|refund|reimburse|reversal|owner contribution|personal deposit)\b/i;
const PERSONAL: FactField[] = ["business_net_profit", "business_gross_receipts", "business_expenses", "wages_gross", "wages_box1", "wages_ss", "wages_medicare",
  "wages_pretax_deductions", "interest_taxable", "interest_tax_exempt", "sep_contribution"];
/** Wage boxes and interest kinds keep their own identity: they enter the calculation differently (W-2 box 1 vs gross pay; MAGI adds tax-exempt interest). */
const OTHER_INCOME_DEST: Partial<Record<FactField, string>> = { wages_gross: "grossWages", wages_box1: "w2Box1", wages_ss: "socialSecurityWages", wages_medicare: "medicareWages",
  wages_pretax_deductions: "payrollPretaxDeductions", interest_taxable: "taxableInterest", interest_tax_exempt: "taxExemptInterest" };
const YEARLY: FactField[] = [...PERSONAL, "premium_monthly", "benchmark_monthly", "advance_ptc_monthly"];
const COVERAGE: FactField[] = ["premium_monthly", "benchmark_monthly", "advance_ptc_monthly"];

const FIELD_MAP: Record<string, FactField> = { "income.scheduleCProfit": "business_net_profit", "income.grossWages": "wages_gross", "income.w2Box1": "wages_box1",
  "income.payrollPretaxDeductions": "wages_pretax_deductions", "income.taxableInterest": "interest_taxable", "income.taxExemptInterest": "interest_tax_exempt",
  "income.socialSecurityWages": "wages_ss", "income.medicareWages": "wages_medicare",
  "income.existingSepContribution": "sep_contribution", "coverage.enrollmentPremium": "premium_monthly", "coverage.benchmarkPremium": "benchmark_monthly",
  "coverage.advancePtc": "advance_ptc_monthly", "opportunity.grossRevenueCents": "offer_total_price", "opportunity.incrementalExpensesCents": "business_expenses",
  "project.paymentReceived": "payment_received" };

/** What the USER said about a figure during review (never derived from its amount). */
export interface FactReviewHints {
  /** Project payment a received amount belongs to. */
  links?: Record<string, { projectId: string; lineId: string | null }>;
  /** Coverage months an amount applies to. */
  months?: Record<string, number[]>;
  /** The user confirmed the amount applies to exactly those months. */
  monthsConfirmed?: Record<string, boolean>;
  /** Whose figure it is, when the document did not say. */
  persons?: Record<string, string>;
  /** Classification of a bank deposit by the user. */
  basis?: Record<string, "gross" | "net">;
}

/**
 * Normalize contract `ExtractedFact`s (src/domain/assistance.ts). Dates printed next to a received
 * payment or a SEP payment in the same document are paired by document, not by amount.
 */
export function normalizeExtractedFacts(facts: ExtractedFact[], hints: FactReviewHints = {}): ImportedFact[] {
  const dateIn = (documentId: string, field: string) => facts.find(x => x.documentId === documentId && x.field === field && x.value.kind === "date");
  const out: ImportedFact[] = [];
  for (const f of facts) {
    if (f.review === "rejected") continue;
    const field = f.documentKind === "bank_statement" && f.field === "project.paymentReceived" ? "bank_deposit" : FIELD_MAP[f.field];
    if (!field || f.value.kind !== "money") continue;
    const paired = field === "payment_received" ? dateIn(f.documentId, "project.paymentReceivedDate")
      : field === "offer_total_price" ? dateIn(f.documentId, "opportunity.plannedReceiptDate") : undefined;
    const date = paired && paired.value.kind === "date" ? paired.value.date : null;
    out.push({ id: f.id, documentId: f.documentId, documentKind: f.documentKind, field, valueCents: f.value.amountCents, date,
      personId: hints.persons?.[f.id] ?? f.personCandidate, taxYear: f.taxYear,
      // The document's own period is kept (a W-2 is a full year by definition); coverage is never forced to monthly.
      period: { kind: f.documentKind === "w2" ? "annual" : f.value.period, through: f.asOfDate, months: hints.months?.[f.id] ?? null, monthsConfirmed: hints.monthsConfirmed?.[f.id] ?? false },
      basis: field === "business_net_profit" ? (/gross|total income|revenue/i.test(f.source.excerpt ?? "") ? "gross" : "net") : hints.basis?.[f.id] ?? "unknown",
      money: field === "payment_received" || field === "sep_contribution" ? "received" : field === "offer_total_price" ? "expected" : "unknown",
      review: f.review === "confirmed" ? "user_confirmed" : "extracted", excerpt: f.source.excerpt, link: hints.links?.[f.id] ?? null });
  }
  return out;
}

/** Contract entry: check a review draft's facts against each other and the workspace. */
export function checkExtractedFacts(ws: HouseholdWorkspace, facts: ExtractedFact[], today: string, hints: FactReviewHints = {}): FactCheckReport {
  const report = checkImportedFacts(ws, normalizeExtractedFacts(facts, hints), today);
  // A conflict flagged by the draft merge (same slot, different value) stays a conflict here too.
  for (const f of facts) if (f.review === "conflict" || f.conflictsWith.length) {
    const c = report.checks.find(x => x.factId === f.id);
    if (c && c.verdict !== "duplicate") { c.verdict = "needs_resolution"; c.issues.push({ code: "CONFLICT", message: "Another document gives a different value for the same figure." }); }
  }
  report.confirmableTogether = report.confirmableTogether.filter(id => report.checks.find(c => c.factId === id)?.verdict !== "needs_resolution");
  return report;
}

const sameSlot = (a: ImportedFact, b: ImportedFact) => a.field === b.field && a.personId === b.personId && a.taxYear === b.taxYear
  && a.period.kind === b.period.kind && a.period.through === b.period.through && JSON.stringify(a.period.months) === JSON.stringify(b.period.months)
  && (a.period.kind !== "one_time" || (a.date === b.date && JSON.stringify(a.link) === JSON.stringify(b.link)));

/** Check imported facts against each other and the workspace. `today` is the user's local date (YYYY-MM-DD). */
export function checkImportedFacts(ws: HouseholdWorkspace, facts: ImportedFact[], today: string): FactCheckReport {
  const checks: FactCheck[] = [];
  const conflicts: FactCheckReport["conflicts"] = [];
  const seen = new Map<string, ImportedFact>();
  const people = new Set(ws.household.people.map(p => p.id));
  const owner = ws.projects[0]?.ownerPersonId ?? ws.household.people.find(p => p.role === "primary")?.id;

  for (const f of facts) {
    const issues: FactCheck["issues"] = [];
    const add = (code: string, message: string) => issues.push({ code, message });
    let verdict: FactVerdict = f.review === "user_confirmed" ? "usable" : "needs_confirmation";
    const worst = (v: FactVerdict) => {
      const rank: FactVerdict[] = ["usable", "needs_confirmation", "needs_resolution", "reference_only", "not_income", "duplicate"];
      if (rank.indexOf(v) > rank.indexOf(verdict)) verdict = v;
    };
    let destination: string | null = null;

    // Same document line again: no-op.
    const prev = seen.get(f.id);
    if (prev) {
      if (prev.valueCents === f.valueCents && prev.date === f.date) { checks.push({ factId: f.id, verdict: "duplicate", issues: [{ code: "SAME_LINE", message: "The same document line was imported twice; it is counted once." }], destination: null, needs: [] }); continue; }
      add("SAME_ID_DIFFERENT_VALUE", "Two different values were read from the same document line; check the document."); worst("needs_resolution");
    }
    seen.set(f.id, f);
    if (alreadyApplied(ws, f)) { checks.push({ factId: f.id, verdict: "duplicate", issues: [{ code: "ALREADY_APPLIED", message: "This document figure is already part of your plan." }], destination: null, needs: [] }); continue; }

    if (f.valueCents === null) { add("NO_VALUE", "No amount was read; nothing is assumed."); worst("needs_resolution"); }
    if (f.valueCents !== null && f.valueCents < 0 && f.field !== "business_net_profit") { add("NEGATIVE", "A negative amount here is not supported."); worst("needs_resolution"); }
    if (PERSONAL.includes(f.field) && (f.personId === null || !people.has(f.personId))) { add("PERSON_UNKNOWN", "Whose amount is this? It is not assigned to a person from the amount."); worst("needs_resolution"); }
    if (YEARLY.includes(f.field)) {
      if (f.taxYear === null) { add("YEAR_UNKNOWN", "Which tax year does this amount belong to?"); worst("needs_resolution"); }
      else if (f.taxYear < 2026) {
        add("PRIOR_YEAR", COVERAGE.includes(f.field)
          ? `A ${f.taxYear} insurance document shows last year's amounts; it does not give the ${f.taxYear + 1} premium, benchmark or advance credit.`
          : `A ${f.taxYear} document shows last year's income; it can guide your estimate but does not confirm 2026 or 2027.`);
        worst("reference_only");
      } else if (f.taxYear > 2027) { add("YEAR_OUT_OF_RANGE", "Only 2026 and 2027 are calculated."); worst("reference_only"); }
    }
    if (f.documentKind === "prior_year_tax_return") { add("PRIOR_YEAR_RETURN", "A filed return is a past year: reference only, not this year's forecast."); worst("reference_only"); }

    switch (f.field) {
      case "business_net_profit":
        if (f.basis === "gross") { add("GROSS_NOT_PROFIT", "Gross receipts are not net profit; expenses have to be subtracted."); worst("needs_resolution"); }
        if (f.period.kind === "unknown") { add("PERIOD_UNKNOWN", "Is this the year so far or the full year? A partial period is never treated as a full year."); worst("needs_resolution"); }
        else if (f.period.kind === "year_to_date") {
          if (!f.period.through) { add("THROUGH_UNKNOWN", "Through which date does this year-to-date profit run?"); worst("needs_resolution"); }
          else {
            destination = "forecast.ytdNetProfit";
            add("NOT_ANNUAL", "Year-to-date profit is used as profit so far; the rest of the year is entered separately (never multiplied out).");
            for (const p of ws.projects) for (const l of p.receipts) if (l.actual && l.actual.date <= f.period.through && f.taxYear !== null && l.actual.date.startsWith(`${f.taxYear}-`)) {
              add("MANAGED_PAYMENT_INSIDE", `"${p.title}" received ${(l.actual.amountCents / 100).toFixed(2)} USD on ${l.actual.date}, inside this statement period. Headroom adds managed projects separately: confirm the profit figure leaves it out, or reduce it, so it is not counted twice.`);
              worst("needs_confirmation");
            }
          }
        } else if (f.period.kind === "annual") destination = "forecast.annualNetProfit";
        else { add("PARTIAL_PERIOD", "A monthly or one-payment profit figure is not an annual forecast."); worst("needs_resolution"); }
        break;
      case "business_gross_receipts": case "business_expenses":
        add("COMPONENT_ONLY", "Receipts and expenses are used only as the rest-of-year parts of a year-to-date forecast, not as profit."); worst("needs_resolution");
        break;
      case "wages_gross": case "wages_box1": case "wages_ss": case "wages_medicare": case "wages_pretax_deductions":
        if (f.period.kind !== "annual") { add("NOT_ANNUAL_WAGES", "A pay stub shows one pay period or the year so far; enter the expected full-year pay. Pay is not multiplied out automatically."); worst("needs_resolution"); }
        else destination = `otherIncomes.${OTHER_INCOME_DEST[f.field]}`;
        break;
      case "interest_taxable": case "interest_tax_exempt":
        if (f.period.kind !== "annual") { add("NOT_ANNUAL", "Enter the expected full-year interest."); worst("needs_resolution"); } else destination = `otherIncomes.${OTHER_INCOME_DEST[f.field]}`;
        break;
      case "premium_monthly": case "benchmark_monthly": case "advance_ptc_monthly": {
        const target = f.field === "premium_monthly" ? "enrollmentPremium" : f.field === "benchmark_monthly" ? "benchmarkPremium" : "advancePtc";
        if (!f.period.months?.length) { add("MONTHS_UNKNOWN", "Which months does this amount apply to? Months the document does not show are not filled in."); worst("needs_resolution"); }
        else if (!f.period.monthsConfirmed) { add("MONTHS_UNCONFIRMED", `Confirm that this amount applies to exactly months ${f.period.months.join(", ")}.`); worst("needs_confirmation"); }
        if (f.period.kind === "annual") {
          add("ANNUAL_AMOUNT", "This is an amount for the whole year or several months; the plan stores monthly amounts. It is divided evenly only over the months you confirm, and only if it was the same each month.");
          if (!f.period.monthsConfirmed) worst("needs_resolution");
        } else if (f.period.kind !== "monthly") { add("PERIOD_UNKNOWN", "Is this a monthly amount or a total for several months?"); worst("needs_resolution"); }
        if (f.period.months?.length && f.period.monthsConfirmed) destination = `coverage[${f.period.months.join(",")}].${target}${f.period.kind === "annual" ? ` (÷${f.period.months.length})` : ""}`;
        
        break;
      }
      case "offer_total_price": case "offer_payment": case "invoice_amount":
        destination = "project.expected";
        if (f.money === "received" || f.documentKind === "invoice") add("EXPECTED_ONLY", "An invoice or offer is money expected; record a payment as received only from a payment confirmation.");
        if (f.field !== "offer_total_price" && !f.date) { add("DATE_UNKNOWN", "When is this payment due?"); worst("needs_resolution"); }
        break;
      case "payment_received":
        if (f.documentKind === "invoice" || f.documentKind === "client_offer") { add("INVOICE_NOT_RECEIPT", "An invoice or offer does not show that money arrived."); worst("needs_resolution"); }
        if (!f.date) { add("DATE_UNKNOWN", "On which date did the money arrive? The tax year depends on it."); worst("needs_resolution"); }
        else if (f.date > today) { add("FUTURE_RECEIPT", `A received payment cannot be dated after today (${today}).`); worst("needs_resolution"); }
        if (!f.link) { add("LINE_UNKNOWN", "Which project payment is this? It is not matched by amount."); worst("needs_resolution"); }
        else {
          const p = ws.projects.find(x => x.id === f.link!.projectId);
          const l = p?.receipts.find(x => x.id === f.link!.lineId);
          if (!p || !l) { add("LINE_MISSING", "The chosen project payment is not in this plan."); worst("needs_resolution"); }
          else if (l.actual && (l.actual.amountCents !== f.valueCents || l.actual.date !== f.date)) {
            add("ALREADY_RECEIVED", `This payment is already recorded as ${(l.actual.amountCents / 100).toFixed(2)} USD on ${l.actual.date}; changing it is a correction with a reason.`); worst("needs_resolution");
          } else destination = `projects.${p.id}.receipts.${l.id}.actual`;
        }
        if (TRANSFER.test(f.excerpt ?? "")) { add("TRANSFER", "This looks like a transfer, loan, refund or personal money, which is not business income."); worst("not_income"); }
        break;
      case "sep_contribution":
        if (!f.date) { add("DATE_UNKNOWN", "On which date was the contribution paid?"); worst("needs_resolution"); }
        else if (f.date > today) { add("FUTURE_PAYMENT", "A paid contribution cannot be dated in the future; a planned one is a SEP goal."); worst("needs_resolution"); }
        if (f.personId && f.personId !== owner) { add("SEP_NON_OWNER", "Only the business owner's SEP-IRA is modeled."); worst("needs_resolution"); }
        if (ws.retirement.contributions.some(c => c.amountCents === f.valueCents && c.paidDate === f.date && c.sourceId !== f.id))
          { add("POSSIBLE_SAME_PAYMENT", "A contribution with the same amount and date is already recorded from another source. Is this the same payment? It is not merged automatically."); worst("needs_confirmation"); }
        add("NOT_NEW_MONEY", "A paid contribution is retirement money already spent: it uses SEP cash and never adds to it.");
        destination = "retirement.contributions";
        break;
      case "bank_deposit":
        if (TRANSFER.test(f.excerpt ?? "")) { add("TRANSFER", "Transfers, loans, refunds and personal deposits are not business income."); worst("not_income"); }
        else { add("DEPOSIT_NOT_PROFIT", "A bank deposit is not profit. Match it to a project payment yourself, or leave it out."); worst("needs_resolution"); }
        break;
    }
    const final = verdict as FactVerdict;
    checks.push({ factId: f.id, verdict: final, issues, destination: final === "reference_only" || final === "not_income" ? null : destination,
      needs: [...new Set(issues.map(i => NEED_OF[i.code]).filter((x): x is FactNeed => !!x))] });
  }

  // Cross-checks between facts.
  const live = facts.filter(f => { const c = checks.find(x => x.factId === f.id); return c && !["duplicate", "reference_only", "not_income"].includes(c.verdict); });
  const uniq = [...new Map(live.map(f => [f.id, f])).values()];
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    const a = uniq[i], b = uniq[j];
    if (!sameSlot(a, b) || a.personId === null || a.taxYear === null) continue;
    if (a.valueCents === b.valueCents) continue; // two documents agree (not merged: one is applied, the other corroborates)
    conflicts.push({ factIds: [a.id, b.id], message: `Two documents give different ${a.field.replace(/_/g, " ")} for the same person and period (${((a.valueCents ?? 0) / 100).toFixed(2)} vs ${((b.valueCents ?? 0) / 100).toFixed(2)} USD). Choose one; the later one does not win automatically.` });
  }
  for (const a of uniq) for (const b of uniq) {
    if (a.field !== "business_net_profit" || b.field !== "business_net_profit" || a.personId !== b.personId || a.taxYear !== b.taxYear) continue;
    if (a.period.kind === "annual" && b.period.kind === "year_to_date" && a.valueCents !== null && b.valueCents !== null && a.valueCents < b.valueCents)
      conflicts.push({ factIds: [a.id, b.id], message: `The full-year profit (${(a.valueCents / 100).toFixed(2)} USD) is lower than the profit already earned this year (${(b.valueCents / 100).toFixed(2)} USD). Is a loss expected for the rest of the year?` });
    if (a.period.kind === "annual" && b.period.kind === "year_to_date" && a.id < b.id)
      conflicts.push({ factIds: [a.id, b.id], message: "There is both a full-year profit and a year-to-date profit for the same year. The plan uses one method; they are never added." });
  }
  // W-2 boxes for the same person/year: taxable wages (box 1) = gross pay − pre-tax deductions in the supported payroll model.
  const w2 = (field: FactField, a: ImportedFact) => uniq.find(x => x.field === field && x.personId === a.personId && x.taxYear === a.taxYear && x.period.kind === "annual");
  for (const g of uniq.filter(x => x.field === "wages_gross" && x.personId && x.taxYear !== null && x.period.kind === "annual")) {
    const b1 = w2("wages_box1", g), pre = w2("wages_pretax_deductions", g);
    if (b1 && pre && g.valueCents !== null && b1.valueCents !== null && pre.valueCents !== null && Math.abs(g.valueCents - pre.valueCents - b1.valueCents) > 100)
      conflicts.push({ factIds: [g.id, b1.id, pre.id], message: "W-2 box 1 does not equal gross pay minus pre-tax deductions. They are kept as separate figures; check which line each came from." });
  }
  for (const f of uniq) for (const g of uniq) {
    if (f.field !== "advance_ptc_monthly" || g.field !== "premium_monthly" || f.taxYear !== g.taxYear || f.valueCents === null || g.valueCents === null) continue;
    if ((f.period.months ?? []).some(m => (g.period.months ?? []).includes(m)) && f.valueCents > g.valueCents)
      conflicts.push({ factIds: [f.id, g.id], message: "The advance credit is larger than the premium for the same month; one of them was read from the wrong line." });
  }
  const inConflict = new Set(conflicts.flatMap(c => c.factIds));
  for (const c of checks) if (inConflict.has(c.factId) && (c.verdict === "usable" || c.verdict === "needs_confirmation")) {
    c.verdict = "needs_resolution"; c.issues.push({ code: "CONFLICT", message: "Conflicts with another document figure (see conflicts)." });
  }
  const confirmableTogether = checks.filter(c => (c.verdict === "needs_confirmation" || c.verdict === "usable") && c.destination && !c.issues.some(i => i.code === "MANAGED_PAYMENT_INSIDE" || i.code === "POSSIBLE_SAME_PAYMENT")).map(c => c.factId);
  return { checks, conflicts, confirmableTogether };
}

function alreadyApplied(ws: HouseholdWorkspace, f: ImportedFact): boolean {
  for (const p of ws.projects) for (const l of [...p.receipts, ...p.expenses]) if (l.actual?.sourceId === f.id) return true;
  for (const fc of ws.forecasts) for (const v of Object.values(fc)) if (v && typeof v === "object" && (v as MoneyFact).sourceId === f.id && (v as MoneyFact).valueCents === f.valueCents) return true;
  return ws.retirement.contributions.some(c => c.sourceId === f.id);
}
