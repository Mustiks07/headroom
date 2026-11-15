/**
 * One document import path for first use and saved households (round 6):
 * ExtractedFact draft → user's targets (person / year / months / project) → Claude 2's semantic check
 * on the WHOLE approved group → one atomic revision with one event, or nothing.
 *
 * Targets come from the user's choices, never from an amount. Two unnamed W-2s are two targets, not a
 * conflict. Same document line again = already recorded. A different saved value is replaced only when
 * the decision says so (`resolvesConflictWith` includes "workspace"); earlier evidence stays.
 */
import type { ExtractedFact, ImportDraft } from "@/domain/assistance";
import type { MoneyFact, TaxYear } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, withEvent, type HouseholdWorkspace, type WorkspaceEvent } from "@/domain/household-workspace";
import type { ImportApplyResult, ImportDecision, ImportTarget } from "@/domain/imports";
import { checkImportedFacts, normalizeExtractedFacts } from "@/lib/engine";
import { applyCommand, CommandError } from "./workspace-commands";
import { applyDocumentFact, type FactTarget } from "./workspace-facts";

/** Which targets a document field may go to (anything may be kept as reference only). */
const ALLOWED: Record<string, ImportTarget["kind"][]> = {
  "income.scheduleCProfit": ["forecast"], "income.grossWages": ["wages"], "income.w2Box1": ["wages"], "income.socialSecurityWages": ["wages"],
  "income.medicareWages": ["wages"], "income.payrollPretaxDeductions": ["wages"], "income.taxableInterest": ["interest"], "income.taxExemptInterest": ["interest"],
  "income.existingSepContribution": ["sep"], "coverage.enrollmentPremium": ["coverage"], "coverage.benchmarkPremium": ["coverage"], "coverage.advancePtc": ["coverage"],
  "project.paymentReceived": ["payment", "partial_payment"], "opportunity.grossRevenueCents": ["new_offer"],
};
const WAGE_FIELD: Record<string, string> = { "income.grossWages": "grossWages", "income.w2Box1": "w2Box1", "income.socialSecurityWages": "socialSecurityWages",
  "income.medicareWages": "medicareWages", "income.payrollPretaxDeductions": "payrollPretaxDeductions" };
const COVERAGE_FIELD: Record<string, string> = { "coverage.enrollmentPremium": "enrollmentPremium", "coverage.benchmarkPremium": "benchmarkPremium", "coverage.advancePtc": "advancePtc" };

const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function shortHash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519); }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0");
}
const evidenceIdOf = (f: ExtractedFact) => `doc-${f.documentId.slice(0, 16)}-${shortHash(f.id)}`.slice(0, 100);
const yearOfTarget = (t: ImportTarget): number | null => "year" in t ? t.year : "taxYear" in t ? t.taxYear : null;
const personOfTarget = (t: ImportTarget): string | null => "personId" in t ? t.personId : t.kind === "new_offer" ? t.ownerPersonId : null;

/** The approved group's facts as the semantic checker sees them: the user's person/year/months/link/date/correction applied. */
function reviewed(draft: ImportDraft, decisions: ImportDecision[]) {
  const chosen = decisions.map(d => ({ d, fact: draft.facts.find(f => f.id === d.factId) ?? null }));
  const facts = chosen.flatMap(({ d, fact }) => fact ? [{ ...fact, review: "confirmed" as const,
    personCandidate: personOfTarget(d.target) ?? fact.personCandidate,
    taxYear: (fact.taxYear ?? (yearOfTarget(d.target) as TaxYear | null)),
    value: fact.value.kind === "money" && d.correctedAmountCents !== null ? { ...fact.value, amountCents: d.correctedAmountCents } : fact.value }] : []);
  const hints = {
    persons: Object.fromEntries(decisions.flatMap(d => { const p = personOfTarget(d.target); return p ? [[d.factId, p]] : []; })),
    months: Object.fromEntries(decisions.flatMap(d => d.target.kind === "coverage" ? [[d.factId, d.target.months]] : [])),
    links: Object.fromEntries(decisions.flatMap(d => d.target.kind === "payment" || d.target.kind === "partial_payment" ? [[d.factId, { projectId: d.target.projectId, lineId: d.target.lineId }]] : [])),
  };
  const normalized = normalizeExtractedFacts(facts, hints).map(n => {
    const d = decisions.find(x => x.factId === n.id)!;
    const date = d.target.kind === "payment" || d.target.kind === "partial_payment" ? d.target.date : d.target.kind === "sep" ? d.target.paidDate : n.date;
    return { ...n, date };
  });
  return { chosen, normalized };
}

/**
 * Validate and apply a reviewed group to a COPY of the workspace. All-or-nothing: the first invalid
 * member rejects the whole group. Pure; `commitImportGroup` saves the result.
 */
export function applyImportGroup(ws: HouseholdWorkspace, draft: ImportDraft, decisions: ImportDecision[], opts: { userDate: string; at?: string }):
  { result: ImportApplyResult; workspace: HouseholdWorkspace | null; event: WorkspaceEvent | null } {
  const at = opts.at ?? new Date().toISOString();
  const issues: Array<{ factId: string; code: string; message: string }> = [];
  const issue = (factId: string, code: string, message: string) => issues.push({ factId, code, message });
  if (!decisions.length) return { result: { status: "nothing_new", reason: "No figures were chosen." }, workspace: null, event: null };
  const eventId = `evt-import-${shortHash(JSON.stringify(decisions.map(d => [d.factId, d.target, d.correctedAmountCents]).sort()))}`;
  if (ws.events.some(e => e.id === eventId)) return { result: { status: "nothing_new", reason: "These figures are already applied." }, workspace: null, event: null };

  const { chosen, normalized } = reviewed(draft, decisions);
  const chosenIds = new Set(decisions.map(d => d.factId));
  for (const { d, fact } of chosen) {
    if (!fact) { issue(d.factId, "NOT_IN_DRAFT", "This figure is no longer in the review list."); continue; }
    if (fact.review === "rejected") issue(d.factId, "REJECTED", "This figure was rejected.");
    if (d.target.kind !== "reference_only" && !(ALLOWED[fact.field] ?? []).includes(d.target.kind))
      issue(d.factId, "TARGET_MISMATCH", `A “${fact.source.label}” figure can't be used as ${d.target.kind.replace("_", " ")}.`);
    if (d.target.kind === "interest" && (fact.field === "income.taxExemptInterest") !== d.target.taxExempt)
      issue(d.factId, "INTEREST_TYPE", "Taxable and tax-exempt interest are different figures; keep the type the document shows.");
    const year = yearOfTarget(d.target);
    if (year !== null && fact.taxYear !== null && fact.taxYear !== year)
      issue(d.factId, "YEAR_MISMATCH", `This document shows ${fact.taxYear}; it can't be entered as a ${year} figure.`);
    const unresolved = fact.conflictsWith.filter(id => !d.resolvesConflictWith.includes(id));
    if (unresolved.length) issue(d.factId, "CONFLICT", "Another document shows a different value for this figure. Choose which one is right.");
    if (fact.conflictsWith.some(id => chosenIds.has(id))) issue(d.factId, "BOTH_CHOSEN", "Two different values for the same figure can't both be applied.");
  }
  // Claude 2's semantic check on the whole group with the user's resolutions.
  const report = checkImportedFacts(ws, normalized, opts.userDate);
  const resolvedPairs = (ids: string[]) => ids.every(id => decisions.some(d => d.resolvesConflictWith.includes(id)) || !chosenIds.has(id));
  for (const c of report.checks) {
    const d = decisions.find(x => x.factId === c.factId)!;
    if (c.verdict === "duplicate") continue;
    if (d.target.kind === "reference_only") continue;
    if (c.verdict === "reference_only" || c.verdict === "not_income") { issue(c.factId, c.issues[0]?.code ?? "REFERENCE_ONLY", c.issues[0]?.message ?? "This figure can only be kept as a reference."); continue; }
    if (c.verdict === "needs_resolution") for (const i of c.issues.filter(x => x.code !== "CONFLICT")) issue(c.factId, i.code, i.message);
  }
  for (const k of report.conflicts) if (!resolvedPairs(k.factIds)) for (const id of k.factIds.filter(x => chosenIds.has(x))) issue(id, "CONFLICT", k.message);
  const duplicates = new Set(report.checks.filter(c => c.verdict === "duplicate").map(c => c.factId));
  if (issues.length) return { result: { status: "rejected", issues: dedupe(issues) }, workspace: null, event: null };

  let next: HouseholdWorkspace = structuredClone(ws);
  let applied = 0, referenceOnly = 0;
  const docs = new Set<string>();
  for (const { d, fact } of chosen) {
    if (!fact || duplicates.has(fact.id)) continue;
    const amount = fact.value.kind === "money" ? (d.correctedAmountCents ?? fact.value.amountCents) : null;
    const evidenceId = evidenceIdOf(fact);
    const evidence = { id: evidenceId, kind: "document" as const, label: fact.source.label, documentId: fact.documentId,
      ...(fact.taxYear === 2026 || fact.taxYear === 2027 ? { taxYear: fact.taxYear } : {}), ...(fact.source.page ? { page: fact.source.page } : {}), ...(fact.source.excerpt ? { excerpt: fact.source.excerpt } : {}) };
    if (!next.evidence.some(e => e.id === evidenceId)) next.evidence.push(evidence);
    docs.add(fact.documentId);
    if (d.target.kind === "reference_only") { referenceOnly++; continue; }
    if (amount === null) { issue(fact.id, "NOT_AN_AMOUNT", "This figure isn't an amount."); continue; }
    const r = applyOne(next, fact, d, amount, evidence, { at, userDate: opts.userDate });
    if (r === "duplicate") continue;
    if (typeof r === "object") { issue(fact.id, r.code, r.message); continue; }
    applied++;
  }
  if (issues.length) return { result: { status: "rejected", issues: dedupe(issues) }, workspace: null, event: null };
  if (!applied && !referenceOnly) return { result: { status: "nothing_new", reason: "These figures are already part of your plan." }, workspace: null, event: null };
  const event: WorkspaceEvent = { id: eventId, at, kind: "document_imported", refs: { documentId: [...docs][0] }, previousFingerprint: null, nextFingerprint: null,
    description: `Applied ${applied} confirmed figure${applied === 1 ? "" : "s"}${referenceOnly ? ` and kept ${referenceOnly} as reference` : ""} from ${docs.size} document${docs.size === 1 ? "" : "s"}.` };
  next = withEvent(next, event);
  const parsed = HouseholdWorkspaceSchema.safeParse(next);
  if (!parsed.success) return { result: { status: "rejected", issues: [{ factId: decisions[0].factId, code: "INVALID_RESULT", message: parsed.error.issues[0]?.message ?? "These figures don't fit the plan." }] }, workspace: null, event: null };
  return { result: { status: "applied", revision: ws.revision + 1, eventId, applied, referenceOnly }, workspace: parsed.data, event };
}

const dedupe = <T extends { factId: string; code: string }>(xs: T[]) => [...new Map(xs.map(x => [`${x.factId}|${x.code}`, x])).values()];

type Evidence = HouseholdWorkspace["evidence"][number];
function applyOne(ws: HouseholdWorkspace, fact: ExtractedFact, d: ImportDecision, amount: number, evidence: Evidence, ctx: { at: string; userDate: string }):
  "applied" | "duplicate" | { code: string; message: string } {
  const t = d.target;
  const replaceSaved = d.resolvesConflictWith.includes("workspace");
  const setFact = (holder: Record<string, unknown>, key: string, label: string) => {
    const current = holder[key] as MoneyFact | undefined;
    if (current?.sourceId === evidence.id && current.valueCents === amount) return "duplicate" as const;
    if (current && current.status === "confirmed" && current.valueCents !== null && current.valueCents !== amount && current.sourceId !== evidence.id && !replaceSaved)
      return { code: "SAVED_VALUE_DIFFERS", message: `Your plan already has ${label} of ${dollars(current.valueCents)} from another source. Choose to replace it (the earlier source stays in the history) or keep it.` };
    holder[key] = { valueCents: amount, status: "confirmed", sourceId: evidence.id } satisfies MoneyFact;
    return "applied" as const;
  };
  const year = (y: TaxYear) => ws.household.years[y === 2026 ? 0 : 1];
  switch (t.kind) {
    case "wages": case "interest": {
      const row = year(t.year).otherIncomes.find(r => r.personId === t.personId);
      if (!row) return { code: "UNKNOWN_PERSON", message: "That person isn't in this household's income for that year." };
      const key = t.kind === "wages" ? t.field : t.taxExempt ? "taxExemptInterest" : "taxableInterest";
      if (t.kind === "wages" && WAGE_FIELD[fact.field] !== t.field) return { code: "WAGE_FIELD", message: "W-2 boxes are different figures; keep the box the document shows." };
      return setFact(row as unknown as Record<string, unknown>, key, t.kind === "wages" ? "this wage figure" : "this interest");
    }
    case "coverage": {
      if (COVERAGE_FIELD[fact.field] !== t.field) return { code: "COVERAGE_FIELD", message: "Premium, benchmark and advance credit are different figures." };
      if (fact.value.kind === "money" && fact.value.period !== "monthly" && fact.value.period !== "unknown") return { code: "NOT_MONTHLY", message: "Only a monthly amount can fill coverage months." };
      let any = false;
      for (const m of t.months) {
        const month = year(t.year).coverage.find(c => c.month === m);
        if (!month) return { code: "MONTH_MISSING", message: `Month ${m} isn't in this plan's coverage.` };
        const r = setFact(month as unknown as Record<string, unknown>, t.field, `a month-${m} amount`);
        if (typeof r === "object") return r;
        if (r === "applied") any = true;
      }
      return any ? "applied" : "duplicate";
    }
    case "partial_payment": case "new_offer": {
      try {
        applyCommand(ws, t.kind === "partial_payment"
          ? { type: "record_partial_receipt", projectId: t.projectId, lineId: t.lineId, amountCents: amount, date: t.date, remainderDate: t.remainderDate }
          : { type: "add_offered_project", title: t.title, ownerPersonId: t.ownerPersonId, totalPriceCents: amount, received: [], unpaid: [{ amountCents: amount, date: t.paymentDate }], expenses: [], priceNegotiable: null, scheduleNegotiable: null },
          { idBase: shortHash(fact.id), sourceId: evidence.id, at: ctx.at, userDate: ctx.userDate, origin: "document" });
        return "applied";
      } catch (e) {
        if (e instanceof CommandError) return e.code === "ALREADY_RECORDED" ? "duplicate" : { code: e.code, message: e.message };
        throw e;
      }
    }
    case "forecast": case "payment": case "sep": {
      const target: FactTarget = t.kind === "forecast" ? { kind: "forecast", personId: t.personId, year: t.year, field: t.field, status: t.status, ...(t.asOfDate ? { asOfDate: t.asOfDate } : {}) }
        : t.kind === "payment" ? { kind: "payment_received", projectId: t.projectId, lineId: t.lineId, date: t.date, ...(t.mode === "correct" && t.reason ? { correctionReason: t.reason } : {}) }
        : { kind: "sep_contribution", personId: t.personId, taxYear: t.taxYear, paidDate: t.paidDate };
      const field = { path: fact.field, proposedValue: { kind: "money", amountCents: amount, period: fact.value.kind === "money" ? fact.value.period : "unknown" }, evidence } as unknown as Parameters<typeof applyDocumentFact>[1];
      const r = applyDocumentFact(ws, field, target, new Date(ctx.at));
      if (r.status === "duplicate") return "duplicate";
      if (r.status !== "applied") return { code: r.status === "needs_resolution" ? "SAVED_VALUE_DIFFERS" : "INVALID", message: r.message };
      Object.assign(ws, r.workspace);
      return "applied";
    }
    case "reference_only": return "applied";
  }
}

/**
 * Apply + save atomically. If the stored plan moved past the reviewed revision (another tab/device),
 * nothing is saved and `stale` is returned so the user can re-review on the current plan.
 */
export async function commitImportGroup(repo: import("./workspace-repository").WorkspaceRepository, ws: HouseholdWorkspace, draft: ImportDraft,
  decisions: ImportDecision[], opts: { userDate: string }): Promise<{ result: ImportApplyResult; saved: HouseholdWorkspace | null }> {
  const stored = await repo.get(ws.id);
  if (stored && stored.revision !== ws.revision) return { result: { status: "stale", currentRevision: stored.revision }, saved: null };
  const { result, workspace, event } = applyImportGroup(ws, draft, decisions, opts);
  if (result.status !== "applied" || !workspace || !event) return { result, saved: null };
  const { commitWorkspaceChange } = await import("./workspace-repository");
  try {
    const { saved } = await commitWorkspaceChange(repo, ws, workspace, event);
    return { result: { ...result, revision: saved.revision }, saved };
  } catch (e) {
    const latest = await repo.get(ws.id).catch(() => null);
    if (latest && latest.revision !== ws.revision) return { result: { status: "stale", currentRevision: latest.revision }, saved: null };
    throw e;
  }
}
