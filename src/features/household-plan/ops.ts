import type { CaseInput, MoneyFact, ScenarioResult, TaxYear } from "@/domain/contracts";
import {
  HouseholdWorkspaceSchema, WORKSPACE_VERSION, captureSepBudgetContributions, sepPosition, withEvent,
  type HouseholdWorkspace, type ProfitForecast, type Project, type ProjectLine, type WorkspaceEvent, type WorkspaceEventKind,
} from "@/domain/household-workspace";
import { emptyDealPlanning, type CashContext, type DealGoal, type DealTermsSpace } from "@/domain/deal-planning";

/**
 * Pure edits of a household workspace document (no tax math). Each edit returns a new document
 * and appends one history event with a stable id, so repeating the same edit never duplicates it.
 */
export const now = () => new Date().toISOString();
export function newId(prefix: string) {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

function clone(w: HouseholdWorkspace): HouseholdWorkspace { return structuredClone(w); }

function addEvidence(w: HouseholdWorkspace, label: string, kind: "manual" | "document" = "manual", taxYear?: TaxYear): string {
  const id = newId("ev");
  w.evidence.push({ id, kind, label: label.trim() || "Entered by you in Headroom", ...(taxYear ? { taxYear } : {}) });
  return id;
}

export function ensureManualEvidence(w: HouseholdWorkspace): string {
  if (!w.evidence.some(e => e.id === "manual-entry")) w.evidence.push({ id: "manual-entry", kind: "manual", label: "Entered by you in Headroom" });
  return "manual-entry";
}

function log(w: HouseholdWorkspace, id: string, kind: WorkspaceEventKind, description: string, refs: WorkspaceEvent["refs"] = {}): HouseholdWorkspace {
  const at = now();
  return { ...withEvent(w, { id, at, kind, description, refs, previousFingerprint: w.calculation?.fingerprint ?? null, nextFingerprint: null }), updatedAt: at };
}

const dollars = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(c / 100);

/* ---------- forecasts ---------- */

export function blankForecast(personId: string, year: TaxYear, sourceId = "manual-entry"): ProfitForecast {
  return { method: "annual_total", personId, year, excludesManagedProjects: null, annualNetProfit: { valueCents: null, status: "unknown", sourceId } };
}

export function setForecast(w0: HouseholdWorkspace, f: ProfitForecast, description = "Updated the profit forecast"): HouseholdWorkspace {
  const w = clone(w0);
  ensureManualEvidence(w);
  const i = w.forecasts.findIndex(x => x.personId === f.personId && x.year === f.year);
  if (i >= 0) w.forecasts[i] = f; else w.forecasts.push(f);
  return log(w, newId("evt-forecast"), "forecast_updated", `${description} (${f.year}).`);
}

/** Replaces one person's non-business income for a year (wages, interest). */
export function setOtherIncome(w0: HouseholdWorkspace, year: TaxYear, row: HouseholdWorkspace["household"]["years"][number]["otherIncomes"][number]): HouseholdWorkspace {
  const w = clone(w0);
  ensureManualEvidence(w);
  const y = w.household.years.find(x => x.year === year);
  const i = y?.otherIncomes.findIndex(r => r.personId === row.personId) ?? -1;
  if (!y || i < 0) throw new Error("This person has no income row for that year.");
  y.otherIncomes[i] = row;
  return log(w, newId("evt-income"), "forecast_updated", `Updated wages or interest for ${year}.`);
}

/* ---------- projects and payments ---------- */

export interface NewLine { label?: string; amountCents: number; date: string }
export interface NewProject {
  title: string; ownerPersonId: string; receipts: NewLine[]; expenses: NewLine[];
  terms: Project["terms"]; cashAccountingConfirmed: boolean | null; timingArrangementConfirmed: boolean | null; sourceLabel: string;
}

export function addProject(w0: HouseholdWorkspace, p: NewProject): { workspace: HouseholdWorkspace; projectId: string } {
  const w = clone(w0);
  const sourceId = addEvidence(w, p.sourceLabel || `Offer for ${p.title}`);
  const at = now();
  const line = (l: NewLine): ProjectLine => ({ id: newId("line"), ...(l.label ? { label: l.label } : {}), expected: { amountCents: l.amountCents, date: l.date },
    actual: null, cancelledAt: null, sourceId, corrections: [] });
  const id = newId("proj");
  w.projects.push({ id, title: p.title, ownerPersonId: p.ownerPersonId, status: "proposed", createdAt: at, statusChangedAt: at,
    cashAccountingConfirmed: p.cashAccountingConfirmed, timingArrangementConfirmed: p.timingArrangementConfirmed, terms: p.terms,
    receipts: p.receipts.map(line), expenses: p.expenses.map(line), agreedDecision: null });
  return { workspace: log(w, `evt-add-${id}`, "project_added", `Added the proposal “${p.title}”.`, { projectId: id }), projectId: id };
}

function findLine(w: HouseholdWorkspace, projectId: string, lineId: string) {
  const project = w.projects.find(p => p.id === projectId);
  const line = project && [...project.receipts, ...project.expenses].find(l => l.id === lineId);
  if (!project || !line) throw new Error("This payment is no longer in the plan.");
  return { project, line, isExpense: project.expenses.includes(line) };
}

/** An actual amount REPLACES the expected one for the same line. Same line + same values = same event (idempotent). */
export function recordActual(w0: HouseholdWorkspace, projectId: string, lineId: string, a: { amountCents: number; date: string; sourceLabel: string }): HouseholdWorkspace {
  const w = clone(w0);
  const { project, line, isExpense } = findLine(w, projectId, lineId);
  if (line.actual) throw new Error("This payment is already recorded. Use “Correct” to change it.");
  const sourceId = addEvidence(w, a.sourceLabel || `${isExpense ? "Payment" : "Receipt"} recorded for ${project.title}`, "manual", Number(a.date.slice(0, 4)) as TaxYear);
  line.actual = { amountCents: a.amountCents, date: a.date, recordedAt: now(), sourceId };
  line.cancelledAt = null;
  return log(w, `evt-pay-${lineId}-${a.date}-${a.amountCents}`, "payment_recorded",
    `${isExpense ? "Paid" : "Received"} ${dollars(a.amountCents)} on ${a.date} for “${project.title}”${line.expected ? ` (expected ${dollars(line.expected.amountCents)} on ${line.expected.date})` : ""}.`,
    { projectId, lineId });
}

/** Fix a wrong record; the previous actual stays in the line's correction history. */
export function correctActual(w0: HouseholdWorkspace, projectId: string, lineId: string, a: { amountCents: number; date: string; reason: string }): HouseholdWorkspace {
  const w = clone(w0);
  const { project, line } = findLine(w, projectId, lineId);
  if (!line.actual) throw new Error("There is no recorded payment to correct.");
  const { amountCents, date } = line.actual;
  line.corrections.push({ at: now(), previousActual: { amountCents, date }, reason: a.reason });
  line.actual = { ...line.actual, amountCents: a.amountCents, date: a.date, recordedAt: now() };
  return log(w, newId("evt-fix"), "payment_corrected", `Corrected “${project.title}”: ${dollars(amountCents)} on ${date} → ${dollars(a.amountCents)} on ${a.date}. ${a.reason}`, { projectId, lineId });
}

export function cancelExpected(w0: HouseholdWorkspace, projectId: string, lineId: string): HouseholdWorkspace {
  const w = clone(w0);
  const { project, line } = findLine(w, projectId, lineId);
  if (line.actual) throw new Error("A received payment can't be cancelled; correct it instead.");
  line.cancelledAt = now();
  return log(w, `evt-cancel-${lineId}`, "project_updated", `Cancelled the expected ${line.expected ? dollars(line.expected.amountCents) : ""} payment of “${project.title}”.`, { projectId, lineId });
}

export function setProjectStatus(w0: HouseholdWorkspace, projectId: string, status: Project["status"]): HouseholdWorkspace {
  const w = clone(w0);
  const p = w.projects.find(x => x.id === projectId);
  if (!p) throw new Error("This project is no longer in the plan.");
  p.status = status; p.statusChangedAt = now();
  const text = status === "cancelled" ? `Cancelled “${p.title}”. Payments already received stay in the forecast.` : status === "agreed" ? `Agreed to “${p.title}” as offered.` : `Moved “${p.title}” back to proposals.`;
  if (status === "agreed" && !p.agreedDecision) p.agreedDecision = { kind: "accept_now", label: "Accept as offered", chosenAt: now(), fingerprint: null };
  return log(w, newId("evt-status"), "project_status_changed", text, { projectId });
}

/**
 * Agree to a compared option for a proposed project. Its not-yet-received payments are replaced by
 * the option's payments; an extra SEP amount RAISES the annual goal from max(goal, paid) by the
 * engine's increment — it is never a second full contribution on top of the first.
 */
export function agreeToOption(w0: HouseholdWorkspace, projectId: string, s: ScenarioResult, fingerprint: string | null): HouseholdWorkspace {
  const w = clone(w0);
  const p = w.projects.find(x => x.id === projectId);
  if (!p) throw new Error("This project is no longer in the plan.");
  if (!s.feasible || s.kind === "decline") throw new Error("Choose an available agreement before saving it.");
  if (fingerprint && p.agreedDecision?.fingerprint === fingerprint && p.agreedDecision.kind === s.kind) return w0;
  const paid = p.receipts.filter(l => l.actual);
  const sourceId = p.receipts[0]?.sourceId ?? ensureManualEvidence(w);
  p.receipts = [...paid, ...s.decisions.receipts.map((r, i) => ({ id: newId("line"), label: s.decisions.receipts.length > 1 ? `Payment ${i + 1} of ${s.decisions.receipts.length}` : "Payment",
    expected: { amountCents: r.amountCents, date: r.date }, actual: null, cancelledAt: null, sourceId, corrections: [] }))];
  p.status = "agreed"; p.statusChangedAt = now();
  p.agreedDecision = { kind: s.kind, label: s.label, chosenAt: now(), fingerprint };
  for (const sep of s.decisions.additionalSep) {
    if (sep.amountCents <= 0) continue;
    const pos = sepPosition(w, sep.personId, sep.year);
    const base = Math.max(pos.targetCents ?? 0, pos.paidCents);
    const i = w.retirement.targets.findIndex(t => t.personId === sep.personId && t.year === sep.year);
    const target = { id: i >= 0 ? w.retirement.targets[i].id : newId("sep-goal"), personId: sep.personId, year: sep.year, targetCents: base + sep.amountCents,
      acceptedAt: now(), origin: { projectId, scenarioKind: s.kind, fingerprint } };
    if (i >= 0) w.retirement.targets[i] = target; else w.retirement.targets.push(target);
  }
  return log(w, `evt-agree-${projectId}-${fingerprint ?? s.id}`, "project_status_changed", `Agreed to “${p.title}”: ${s.label}.`, { projectId });
}

export function setProjectConditions(w0: HouseholdWorkspace, projectId: string, c: Pick<Project, "cashAccountingConfirmed" | "timingArrangementConfirmed" | "terms">): HouseholdWorkspace {
  const w = clone(w0);
  const p = w.projects.find(x => x.id === projectId);
  if (!p) throw new Error("This project is no longer in the plan.");
  p.cashAccountingConfirmed = c.cashAccountingConfirmed; p.timingArrangementConfirmed = c.timingArrangementConfirmed; p.terms = c.terms;
  return log(w, newId("evt-terms"), "project_updated", `Updated the conditions for “${p.title}”.`, { projectId });
}

/* ---------- deal planning (goal, allowed terms, cash context) ---------- */

/** Saves the goal and allowed terms for one project (and the cash context, if given) with the plan. */
export function saveDealGoal(w0: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): HouseholdWorkspace {
  const w = clone(w0);
  ensureManualEvidence(w);
  const dp = w.dealPlanning ?? emptyDealPlanning();
  dp.goals = [...dp.goals.filter(g => g.id !== goal.id), goal];
  dp.termSpaces = [...dp.termSpaces.filter(t => t.projectId !== space.projectId), space];
  if (cash) dp.cashContext = cash;
  w.dealPlanning = dp;
  const title = w.projects.find(p => p.id === goal.projectId)?.title ?? "the project";
  return log(w, newId("evt-goal"), "project_updated", `Set the goal and allowed terms for “${title}”.`, { projectId: goal.projectId });
}

/* ---------- SEP ---------- */

export function recordContribution(w0: HouseholdWorkspace, c: { personId: string; taxYear: TaxYear; amountCents: number; paidDate: string; sourceLabel: string }): HouseholdWorkspace {
  const w = clone(w0);
  captureSepBudgetContributions(w);
  const sourceId = addEvidence(w, c.sourceLabel || "SEP-IRA contribution entered by you", "manual", c.taxYear);
  const id = newId("sep-paid");
  if (w.retirement.futureContributionBudget.asOfDate && c.paidDate < w.retirement.futureContributionBudget.asOfDate)
    w.retirement.futureContributionBudget.includedContributionIds!.push(id);
  w.retirement.contributions.push({ id, personId: c.personId, taxYear: c.taxYear, amountCents: c.amountCents, paidDate: c.paidDate, sourceId, recordedAt: now() });
  return log(w, `evt-${id}`, "sep_contribution_recorded", `Recorded a ${c.taxYear} SEP-IRA contribution of ${dollars(c.amountCents)} paid ${c.paidDate}.`, { contributionId: id });
}

export function setSepTarget(w0: HouseholdWorkspace, personId: string, year: TaxYear, targetCents: number): HouseholdWorkspace {
  const w = clone(w0);
  const i = w.retirement.targets.findIndex(t => t.personId === personId && t.year === year);
  const t = { id: i >= 0 ? w.retirement.targets[i].id : newId("sep-goal"), personId, year, targetCents, acceptedAt: now(), origin: { projectId: null, scenarioKind: null, fingerprint: null } };
  if (i >= 0) w.retirement.targets[i] = t; else w.retirement.targets.push(t);
  return log(w, newId("evt-goal"), "sep_target_changed", `Set the ${year} SEP-IRA goal to ${dollars(targetCents)}.`, { targetId: t.id });
}

export function setFutureBudget(w0: HouseholdWorkspace, amountCents: number | null, asOfDate: string): HouseholdWorkspace {
  const w = clone(w0);
  w.retirement.futureContributionBudget = { amountCents, asOfDate, sourceId: ensureManualEvidence(w),
    includedContributionIds: w.retirement.contributions.filter(c => c.paidDate <= asOfDate).map(c => c.id) };
  return log(w, newId("evt-budget"), "sep_target_changed", amountCents === null ? "Cleared the budget for future SEP contributions." : `Set the money available for future SEP contributions to ${dollars(amountCents)} as of ${asOfDate}.`);
}

/* ---------- create ---------- */

/**
 * Builds a new workspace from a checked v1 CaseInput (own data from /check). Business profit
 * becomes the forecast record; "SEP already planned" becomes an annual GOAL, never a paid amount.
 */
export function workspaceFromCase(input: CaseInput, forecasts: ProfitForecast[], projectFromOpportunity: boolean): HouseholdWorkspace {
  const at = now();
  const evidence = [...input.evidence];
  if (!evidence.some(e => e.id === "manual-entry")) evidence.push({ id: "manual-entry", kind: "manual", label: "Entered by you in Headroom" });
  const fc: ProfitForecast[] = [];
  for (const y of input.years) for (const row of y.incomes) {
    const given = forecasts.find(f => f.personId === row.personId && f.year === y.year);
    if (given) fc.push(given);
    else if (row.scheduleCProfit.status !== "unknown" || y.year === 2026) fc.push({ method: "annual_total", personId: row.personId, year: y.year,
      excludesManagedProjects: projectFromOpportunity ? null : true, annualNetProfit: row.scheduleCProfit });
  }
  const targets = input.years.flatMap(y => y.incomes.filter(r => (r.existingSepContribution.valueCents ?? 0) > 0).map(r => ({
    id: newId("sep-goal"), personId: r.personId, year: y.year, targetCents: r.existingSepContribution.valueCents!, acceptedAt: at,
    origin: { projectId: null, scenarioKind: null, fingerprint: null } })));
  const o = input.opportunity;
  const projects: Project[] = projectFromOpportunity && o.grossRevenueCents > 0 ? [{ id: newId("proj"), title: o.title, ownerPersonId: o.ownerPersonId,
    status: "proposed", createdAt: at, statusChangedAt: at, cashAccountingConfirmed: o.cashAccountingConfirmed, timingArrangementConfirmed: o.timingArrangementConfirmed,
    terms: { canSplitPayment: input.constraints.canSplitPayment, canRenegotiatePrice: input.constraints.canRenegotiatePrice, nextYearPaymentLatestDate: input.constraints.nextYearPaymentLatestDate },
    receipts: [{ id: newId("line"), expected: { amountCents: o.grossRevenueCents, date: o.plannedReceiptDate }, actual: null, cancelledAt: null, sourceId: "manual-entry", corrections: [] }],
    expenses: o.incrementalExpensesCents > 0 ? [{ id: newId("line"), expected: { amountCents: o.incrementalExpensesCents, date: o.expensePaymentDate }, actual: null, cancelledAt: null, sourceId: "manual-entry", corrections: [] }] : [],
    agreedDecision: null }] : [];
  const draft: HouseholdWorkspace = {
    workspaceVersion: WORKSPACE_VERSION, id: newId("ws"), revision: 0, createdAt: at, updatedAt: at,
    household: { caseId: input.id, title: input.isSynthetic ? input.title : "Our household plan", isSynthetic: input.isSynthetic, state: input.state,
      countyFips: input.countyFips, filingStatus: input.filingStatus, people: input.people,
      years: input.years.map(y => ({ year: y.year, taxFamilySize: y.taxFamilySize, coveredPersonIds: y.coveredPersonIds,
        otherIncomes: y.incomes.map(({ scheduleCProfit: _p, existingSepContribution: _s, ...rest }) => { void _p; void _s; return rest; }),
        coverage: y.coverage, benchmarkStatus: y.benchmarkStatus, unsupportedFacts: y.unsupportedFacts, scopeConfirmed: y.scopeConfirmed })) as HouseholdWorkspace["household"]["years"] },
    forecasts: fc, projects,
    retirement: { targets, contributions: [], futureContributionBudget: { amountCents: projectFromOpportunity ? input.constraints.maxAdditionalSepCents : null, asOfDate: at.slice(0, 10), sourceId: "manual-entry" } },
    planning: { objective: input.constraints.objective, minimumDesiredCashGainCents: input.constraints.minimumDesiredCashGainCents },
    evidence, events: [{ id: newId("evt-created"), at, kind: "workspace_created", description: "Created the household plan from your figures.", refs: {}, previousFingerprint: null, nextFingerprint: null }],
    calculation: null, origin: { kind: "new" },
  };
  return HouseholdWorkspaceSchema.parse(draft);
}

export function factText(f: MoneyFact): string {
  return f.valueCents === null ? "Unknown" : dollars(f.valueCents);
}
