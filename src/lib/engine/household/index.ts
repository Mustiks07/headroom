/**
 * Household entry points (round 3) on the shared `HouseholdWorkspace` contract v2.0
 * (src/domain/household-workspace.ts, commit ecbdd18). Same guards, rules, rounding and year
 * calculations as v1; the v1 entry points are unchanged.
 *
 *  buildHouseholdProjection    — where each year's business profit and SEP total come from + current risk
 *  evaluateHouseholdWorkspace  — the plan as agreed now (fixed commitments, not re-optimized)
 *  compareWorkspaceOpportunity — one candidate project evaluated on top of every other commitment
 */
import type { BlockedComparison, CaseInput, ReadyComparison, ScenarioResult, TaxYear, YearResult } from "@/domain/contracts";
import { CONTRACT_VERSION } from "@/domain/contracts";
import {
  canonicalWorkspaceContent, combineFacts, forecastFacts, HouseholdWorkspaceSchema, type HouseholdWorkspace, type ProjectedPersonYear,
  type ProjectionComponent, type ReadyHouseholdProjection, type ReadyWorkspaceComparison, type ReadyWorkspaceEvaluation, type SepYearStatus,
} from "@/domain/household-workspace";
import { canonical, modelWarnings, sha256Hex, stopToBlocked } from "../common";
import { compare, makeCtx, run, scenarioFromPlan, YEARS as V1_YEARS, type Plan } from "../comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "../guard";
import { formatUsd } from "../money";
import { EngineStop, NO_VARIATION, type YearModel } from "../model";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";
import { assessRisk } from "../risk";
import { profitHeadroomDollars } from "../search";
import { evaluateYear, solveCredit, toYearResult } from "../year";
import { workspaceToEngineInput, type AdaptedWorkspace } from "./adapter";
import { countedBasis, projectHousehold, projectionTrace, type HouseholdProjection } from "./projection";

/** Label of the household aggregation layer (informational; fingerprints use ENGINE_VERSION per the contract). */
export const HOUSEHOLD_ENGINE_VERSION = "headroom-household-1.0.1";
const YEARS: TaxYear[] = [2026, 2027];

/**
 * Same formula as the contract's reference `workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION)`
 * (Claude 3 follow-up 8ab1984): SHA-256 of key-sorted {content: canonicalWorkspaceContent(ws),
 * engineVersion, rulesVersion}. Record order, timestamps and history do not change it, so the
 * export's stale check matches. A change in household results is released with a new ENGINE_VERSION.
 */
export async function engineWorkspaceFingerprint(ws: HouseholdWorkspace): Promise<string> {
  return sha256Hex(JSON.stringify(canonical({ content: canonicalWorkspaceContent(ws), engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION })));
}

type Prepared = { ws: HouseholdWorkspace; adapted: AdaptedWorkspace };
function prepare(raw: HouseholdWorkspace, candidateProjectId?: string): Prepared | BlockedComparison {
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "needs_data", code: "INVALID_WORKSPACE", message: "Part of the household plan needs review before it can be calculated.",
      fields: parsed.error.issues.map(i => ({ path: i.path.map(String).join(".") || "(root)", reason: i.message })) };
  }
  return { ws: parsed.data, adapted: workspaceToEngineInput(parsed.data, candidateProjectId) };
}
const isBlocked = (x: Prepared | BlockedComparison): x is BlockedComparison => "status" in x;
function blocked(issues: Issues, a: AdaptedWorkspace): BlockedComparison | null {
  const b = issues.toBlocked();
  return b && { ...b, fields: b.fields.map(f => ({ ...f, path: a.translatePath(f.path) })) };
}
const yearsWithForecast = (ws: HouseholdWorkspace, owner: string): Array<0 | 1> =>
  ([0, 1] as const).filter(yi => yi === 0 || ws.forecasts.some(f => f.year === YEARS[yi] && f.personId === owner));

// --------------------------------------------------------------- projection --
const FORECAST_KIND = { annualNetProfit: "annual_total", ytdNetProfit: "ytd_net_profit", remainingReceipts: "remaining_receipts", remainingExpenses: "remaining_expenses" } as const;

function peopleYears(ws: HouseholdWorkspace, p: HouseholdProjection): ReadyHouseholdProjection["years"] {
  return p.years.map(yp => {
    const yi = YEARS.indexOf(yp.year);
    const ownerRow = p.derivedInput.years[yi].incomes.find(r => r.personId === p.ownerPersonId)!;
    const owner: ProjectedPersonYear = {
      personId: p.ownerPersonId, year: yp.year, method: yp.method,
      components: yp.components.map((c): ProjectionComponent => ({
        kind: c.source, label: c.label, amountCents: c.cents, status: c.status,
        ...(c.basis === "forecast" ? {} : { basis: c.basis }), sourceIds: c.sourceIds,
        ...(c.projectId ? { refs: { projectId: c.projectId, lineId: c.itemId ?? undefined } } : {}),
      })),
      total: ownerRow.scheduleCProfit,
    };
    const others = ws.household.years[yi].otherIncomes.filter(o => o.personId !== p.ownerPersonId).map((o): ProjectedPersonYear => {
      const f = ws.forecasts.find(x => x.personId === o.personId && x.year === yp.year);
      return { personId: o.personId, year: yp.year, method: f?.method ?? null,
        components: f ? forecastFacts(f).map(x => ({ kind: FORECAST_KIND[x.key as keyof typeof FORECAST_KIND], label: x.key,
          amountCents: x.fact.valueCents === null ? null : x.sign * x.fact.valueCents, status: x.fact.status, sourceIds: [x.fact.sourceId] })) : [],
        total: p.derivedInput.years[yi].incomes.find(r => r.personId === o.personId)?.scheduleCProfit ?? combineFacts([], "derived-other-profit") };
    });
    return { year: yp.year, people: [owner, ...others] };
  });
}

const ASSUMPTIONS = [
  "One business profit forecast per owner and year; it leaves out the projects managed in this plan, whose payments are added once.",
  "An actual payment replaces the expected one; agreed projects count, proposed ones only when evaluated; cancelled projects keep money already received.",
  "SEP-IRA contributions belong to the owner and tax year: the total used is the larger of the agreed target and what was actually paid.",
];

export type HouseholdProjectionDetails = { sepBudget: HouseholdProjection["sepBudget"]; profitSources: HouseholdProjection["years"] };
async function projectionResult(ws: HouseholdWorkspace, p: HouseholdProjection, fingerprint: string): Promise<ReadyHouseholdProjection & HouseholdProjectionDetails> {
  const risk = await assessRisk(p.derivedInput);
  const warnings = [...p.warnings];
  if (risk.status !== "ready") warnings.push(`Current-year subsidy position not available: ${risk.message}`);
  return { status: "ready", workspaceId: ws.id, workspaceRevision: ws.revision, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, fingerprint,
    years: peopleYears(ws, p), currentRisk: risk.status === "ready" ? risk.risk : null,
    assumptions: [...ASSUMPTIONS, ...(risk.status === "ready" ? risk.risk.headroomAssumptions : [])],
    warnings: [...new Set([...warnings, ...(risk.status === "ready" ? risk.warnings : [])])], sepBudget: p.sepBudget, profitSources: p.years };
}

export async function buildHouseholdProjection(raw: HouseholdWorkspace): Promise<(ReadyHouseholdProjection & HouseholdProjectionDetails) | BlockedComparison> {
  const prep = prepare(raw);
  if (isBlocked(prep)) return prep;
  const { ws, adapted } = prep;
  const issues = new Issues();
  const p = projectHousehold(adapted.input, issues, { years: yearsWithForecast(ws, adapted.ownerPersonId) });
  const b = blocked(issues, adapted);
  if (b || !p) return b!;
  return projectionResult(ws, p, await engineWorkspaceFingerprint(ws));
}

// ------------------------------------------------------------ fixed plan --
export interface WorkspaceYearOutcome {
  year: TaxYear;
  /** Full year result for the plan as agreed; null when it cannot be calculated (see problems). */
  result: YearResult | null;
  risk: { magiCents: number; thresholdMagiCents: number; ptcCents: number; settlementCents: number;
    state: "below_cliff" | "at_risk" | "over_cliff" | "no_credit"; additionalProfitHeadroomCents: number | null } | null;
  legalSepLimitCents: number | null;
  problems: string[];
}
export interface FixedPlanDetails {
  /** Checks that could not be made because an input is missing (not a failure). */
  notChecked: string[];
  years: WorkspaceYearOutcome[];
  /** Years not calculated because next-year facts are missing (not an error for the current-year check). */
  pendingYears: Array<{ year: TaxYear; fields: BlockedComparison["fields"] }>;
}

function riskOf(model: YearModel): WorkspaceYearOutcome["risk"] {
  const c = solveCredit(model, NO_VARIATION);
  const threshold = 400 * c.fplDollars;
  const headroom = c.ptc.ptc > 0 ? profitHeadroomDollars(model, NO_VARIATION) : null;
  const state = !model.ptcEligible || (c.ptc.ptc === 0 && c.ptc.line5 <= 400) ? "no_credit" as const
    : c.ptc.line5 > 400 ? "over_cliff" as const
      : headroom !== null && headroom * 100 < threshold * 0.1 ? "at_risk" as const : "below_cliff" as const;
  return { magiCents: c.magi, thresholdMagiCents: threshold, ptcCents: c.ptc.ptc, settlementCents: c.aptcTotal - c.ptc.ptc, state,
    additionalProfitHeadroomCents: headroom === null ? null : headroom * 100 };
}

/** Evaluate the commitments as recorded: no optimization, no silent change of an agreed amount. */
function fixedPlan(p: HouseholdProjection, issues: Issues): { reasons: string[]; details: FixedPlanDetails; models: YearModel[] } | null {
  const derived = parseCase(p.derivedInput, issues);
  if (!derived) return null;
  const reasons: string[] = [];
  const years: WorkspaceYearOutcome[] = [];
  const models: YearModel[] = [];
  const pendingYears: FixedPlanDetails["pendingYears"] = [];
  for (const yp of p.years) {
    const yi = YEARS.indexOf(yp.year) as 0 | 1;
    const yearIssues = new Issues();
    const model = buildYearModel(derived, yi, yearIssues);
    if (!model) {
      if (yi === 0) { for (const x of yearIssues.unsupported) issues.bad(x.code, x.path, x.reason); for (const x of yearIssues.needsData) issues.need(x.code, x.path, x.reason); return null; }
      pendingYears.push({ year: yp.year, fields: yearIssues.toBlocked()!.fields });
      continue;
    }
    models.push(model);
    const problems: string[] = [];
    let result: YearResult | null = null, risk: WorkspaceYearOutcome["risk"] = null;
    const legalSepLimitCents = solveCredit(model, NO_VARIATION, false).sepMax;
    try {
      risk = riskOf(model);
      const yc = evaluateYear(model, NO_VARIATION);
      result = toYearResult(model, yc);
      result.trace = [...projectionTrace(p, yp.year), ...result.trace];
    } catch (e) {
      if (!(e instanceof EngineStop)) throw e;
      if (e.code === "SEP_OVER_LIMIT") {
        const sep = yp.sep;
        problems.push(sep.paidCents > 0 && sep.paidCents >= sep.plannedTotalCents
          ? `${yp.year}: SEP-IRA contributions already paid (${formatUsd(sep.paidCents)}) exceed the legal limit of ${formatUsd(legalSepLimitCents)} for the current profit forecast. An excess contribution has to be corrected with your plan provider; Headroom does not change a paid amount.`
          : `${yp.year}: the agreed SEP-IRA target of ${formatUsd(sep.plannedTotalCents)} is no longer allowed: the limit for the current profit forecast is ${formatUsd(legalSepLimitCents)}. Lower the target before paying the rest (${formatUsd(sep.remainingCents)} still to pay).`);
      } else problems.push(`${yp.year}: ${e.message}`);
    }
    reasons.push(...problems);
    years.push({ year: yp.year, result, risk, legalSepLimitCents, problems });
  }
  const { budgetCents, reservedCents, availableCents } = p.sepBudget;
  if (budgetCents !== null && availableCents !== null && availableCents < 0) {
    reasons.push(`Agreed SEP-IRA contributions still to be paid (${formatUsd(reservedCents)}) exceed the money set aside for future contributions (${formatUsd(budgetCents)}). Lower a target or add to the set-aside amount; Headroom does not reduce an agreed contribution on its own.`);
  }
  const notChecked: string[] = [];
  if (budgetCents === null && reservedCents > 0) {
    notChecked.push(`Not checked: whether money is set aside for the ${formatUsd(reservedCents)} of agreed SEP-IRA contributions still to be paid. Enter the set-aside amount to check it.`);
  }
  return { reasons, details: { notChecked, years, pendingYears }, models };
}

/** The open commitments (agreed, not yet received/paid) as one fixed scenario on top of what already happened. */
function agreedScenario(input: AdaptedWorkspace["input"], current: HouseholdProjection, reasons: string[]): { result: ScenarioResult | null; creditLostYears: TaxYear[] } {
  if (current.years.length < 2) return { result: null, creditLostYears: [] };
  const factsIssues = new Issues();
  const facts = projectHousehold(input, factsIssues, { years: [0, 1], factsOnly: true });
  const parsed = facts ? parseCase(facts.derivedInput, factsIssues) : null;
  const m0 = parsed ? buildYearModel(parsed, 0, factsIssues) : null, m1 = parsed ? buildYearModel(parsed, 1, factsIssues) : null;
  if (!parsed || !m0 || !m1) return { result: null, creditLostYears: [] };
  const plan: Plan = { kind: "accept_now", label: "Your plan as agreed: open project payments and SEP-IRA contributions still to make",
    revenue: 0, receipts: [], expenses: [], sep: [current.years[0].sep.remainingCents, current.years[1].sep.remainingCents], reasons: [...reasons], actions: [],
    assumptions: ["Fixed agreements on the current facts; amounts and dates are not re-optimized.",
      "Compared with only what has already happened (payments received or paid, SEP-IRA contributions made)."] };
  for (const pr of input.projects) for (const item of pr.items) {
    if (countedBasis(pr, item, {}) !== "expected") continue;
    if (item.kind === "receipt") { plan.receipts.push({ date: item.expected!.date, amount: item.expected!.amountCents }); plan.revenue += item.expected!.amountCents; }
    else plan.expenses.push({ yearIndex: V1_YEARS.indexOf(Number(item.expected!.date.slice(0, 4)) as TaxYear) as 0 | 1, amount: item.expected!.amountCents });
  }
  plan.receipts.sort((a, b) => a.date.localeCompare(b.date));
  try {
    const ctx = makeCtx(parsed, [m0, m1]);
    const factYcs = run([m0, m1], ctx.decline);
    const ycs = run([m0, m1], plan);
    const creditLostYears = YEARS.filter((_y, i) => factYcs[i].credit.ptc.ptc > 0 && ycs[i].credit.ptc.ptc === 0);
    return { result: scenarioFromPlan(ctx, plan, ycs, "agreed-plan"), creditLostYears };
  } catch (e) {
    if (!(e instanceof EngineStop)) throw e;
    return { result: null, creditLostYears: [] };
  }
}

export type WorkspaceEvaluationDetails = { fixedPlan: FixedPlanDetails };
export async function evaluateHouseholdWorkspace(raw: HouseholdWorkspace): Promise<(ReadyWorkspaceEvaluation & WorkspaceEvaluationDetails) | BlockedComparison> {
  const prep = prepare(raw);
  if (isBlocked(prep)) return prep;
  const { ws, adapted } = prep;
  const issues = new Issues();
  const p = projectHousehold(adapted.input, issues, { years: yearsWithForecast(ws, adapted.ownerPersonId) });
  const fixed = p ? fixedPlan(p, issues) : null;
  const b = blocked(issues, adapted);
  if (b || !p || !fixed) return b!;
  const fingerprint = await engineWorkspaceFingerprint(ws);
  const projection = await projectionResult(ws, p, fingerprint);
  const agreed = agreedScenario(adapted.input, p, fixed.reasons);
  const warnings = [...modelWarnings(fixed.models, p.derivedInput), ...p.warnings, ...fixed.details.notChecked];
  for (const y of fixed.details.pendingYears) warnings.push(`${y.year} is not calculated yet: ${y.fields[0]?.reason ?? "facts are missing"}`);
  for (const y of agreed.creditLostYears) warnings.push(`The open agreements push ${y} household income above the premium tax credit limit: the ${y} credit is lost.`);
  const sep: SepYearStatus[] = p.years.map(yp => ({ personId: p.ownerPersonId, year: yp.year, targetCents: yp.sep.targetCents, paidCents: yp.sep.paidCents,
    remainingCents: yp.sep.remainingCents, legalLimitCents: fixed.details.years.find(y => y.year === yp.year)?.legalSepLimitCents ?? null }));
  return { status: "ready", projection,
    agreed: { result: agreed.result, stillFeasible: fixed.reasons.length === 0, reasons: fixed.reasons, creditLostYears: agreed.creditLostYears },
    sep, futureContributionBudgetRemainingCents: p.sepBudget.availableCents, fingerprint, warnings: [...new Set(warnings)], fixedPlan: fixed.details };
}

// ------------------------------------------------------- candidate comparison --
export type WorkspaceComparisonDetails = { baselineProjection: HouseholdProjection["years"]; warnings: string[] };

/**
 * Evaluate ONLY the increment of one project on top of all other commitments. Editing an agreed
 * project first removes its not-yet-received items from the baseline; its actual receipts stay.
 * Declining the candidate never cancels another project.
 */
export async function compareWorkspaceOpportunity(raw: HouseholdWorkspace, candidateProjectId: string): Promise<(ReadyWorkspaceComparison & WorkspaceComparisonDetails) | BlockedComparison> {
  const prep = prepare(raw, candidateProjectId);
  if (isBlocked(prep)) return prep;
  const { ws, adapted } = prep;
  const ci = ws.projects.findIndex(p => p.id === candidateProjectId);
  const candidate = ws.projects[ci];
  if (!candidate) return { status: "needs_data", code: "CANDIDATE_MISSING", message: "Choose the project to evaluate.", fields: [{ path: "projects", reason: `No project with id "${candidateProjectId}".` }] };
  if (candidate.status === "cancelled") {
    return { status: "needs_data", code: "CANDIDATE_CANCELLED", message: `"${candidate.title}" is cancelled; reopen it before evaluating new terms.`, fields: [{ path: `projects[${ci}].status`, reason: "Cancelled project." }] };
  }
  const issues = new Issues();
  const baseline = projectHousehold(adapted.input, issues, { years: [0, 1], excludeProjectId: candidate.id });
  const b = blocked(issues, adapted);
  if (b || !baseline) return b!;

  // Only lines that have not happened can be decided; received money is a fact in the baseline.
  const open = (lines: typeof candidate.receipts) => lines.filter(l => !l.actual && !l.cancelledAt && l.expected).map(l => ({ id: l.id, ...l.expected! }));
  const receipts = open(candidate.receipts), expenses = open(candidate.expenses);
  const warnings = [...baseline.warnings];
  const received = [...candidate.receipts, ...candidate.expenses].filter(l => l.actual);
  if (received.length) warnings.push(`${received.length} payment${received.length === 1 ? "" : "s"} of "${candidate.title}" already happened; they stay in the baseline and are not moved or re-priced.`);
  if (!receipts.length) {
    return { status: "needs_data", code: "NOTHING_TO_DECIDE", message: `"${candidate.title}" has no expected receipts left to decide.`, fields: [{ path: `projects[${ci}].receipts`, reason: "All receipts are received or cancelled." }] };
  }

  const derived: CaseInput = structuredClone(baseline.derivedInput);
  derived.constraints = { ...derived.constraints, canSplitPayment: candidate.terms.canSplitPayment,
    canRenegotiatePrice: candidate.terms.canRenegotiatePrice, nextYearPaymentLatestDate: candidate.terms.nextYearPaymentLatestDate };
  const budgetLeft = baseline.sepBudget.availableCents;
  if (budgetLeft !== null && budgetLeft < 0) return {
    status: "needs_data", code: "AGREED_SEP_BUDGET_SHORTFALL",
    message: "Your existing SEP commitments exceed the cash still available. Review the budget or those commitments before choosing another plan.",
    fields: [{ path: "retirement.futureContributionBudget", reason: `Existing commitments need ${formatUsd(-budgetLeft)} more than the remaining cash budget.` }],
  };
  if (budgetLeft === null) warnings.push("No money set aside for future SEP-IRA contributions was entered, so no additional contribution is assumed possible.");
  else {
    derived.constraints.maxAdditionalSepCents = Math.max(0, budgetLeft);
    if (baseline.sepBudget.reservedCents > 0) {
      warnings.push(`New SEP-IRA contributions are limited to ${formatUsd(Math.max(0, budgetLeft))}: the money set aside (${formatUsd(baseline.sepBudget.budgetCents!)}) minus agreed contributions not yet paid (${formatUsd(baseline.sepBudget.reservedCents)}).`);
    }
  }
  for (const yp of baseline.years) {
    if (yp.sep.plannedTotalCents > 0) {
      warnings.push(`SEP-IRA amounts in these options are additions to your ${yp.year} total of ${formatUsd(yp.sep.plannedTotalCents)} (paid ${formatUsd(yp.sep.paidCents)}, still to pay ${formatUsd(yp.sep.remainingCents)}); the legal limit is checked on the year's whole business profit.`);
    }
  }

  const byDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date));
  const expenseYears = new Set(expenses.map(e => e.date.slice(0, 4)));
  // Re-negotiating an AGREED project: the remaining amount is one offer on its first date so the usual options
  // can be searched; the agreed schedule itself is evaluated by evaluateHouseholdWorkspace.
  const regroup = candidate.status === "agreed" && receipts.length > 1 && expenseYears.size <= 1;
  const single = (receipts.length === 1 && expenses.length <= 1) || regroup;
  const first = byDate(receipts)[0];
  derived.opportunity = { title: candidate.title, ownerPersonId: candidate.ownerPersonId,
    grossRevenueCents: receipts.reduce((a, r) => a + r.amountCents, 0), plannedReceiptDate: first.date,
    incrementalExpensesCents: expenses.reduce((a, e) => a + e.amountCents, 0), expensePaymentDate: byDate(expenses)[0]?.date ?? first.date,
    cashAccountingConfirmed: candidate.cashAccountingConfirmed, timingArrangementConfirmed: candidate.timingArrangementConfirmed };
  if (regroup) warnings.push(`Options treat the ${formatUsd(derived.opportunity.grossRevenueCents)} still to be received from "${candidate.title}" as one payment on ${first.date}; the schedule you agreed is evaluated separately as your plan as agreed.`);

  const v1Issues = new Issues();
  const parsed = parseCase(derived, v1Issues);
  const m0 = parsed ? buildYearModel(parsed, 0, v1Issues) : null;
  const m1 = parsed ? buildYearModel(parsed, 1, v1Issues) : null;
  if (parsed) checkOpportunity(parsed, v1Issues);
  const v1Blocked = blocked(v1Issues, adapted);
  if (v1Blocked || !parsed || !m0 || !m1) return v1Blocked!;
  try {
    const fingerprint = await engineWorkspaceFingerprint(ws);
    let comparison: ReadyComparison;
    if (single) {
      const out = compare(parsed, [m0, m1]);
      comparison = { status: "ready", contractVersion: CONTRACT_VERSION, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
        calculationFingerprint: fingerprint, caseId: parsed.id, baselineScenarioId: out.baselineScenarioId,
        recommendedScenarioId: out.recommendedScenarioId, scenarios: out.scenarios, warnings: out.warnings };
    } else {
      // Several payments on a proposed offer: evaluate the offered schedule exactly; options are searched for one-payment offers.
      const ctx = makeCtx(parsed, [m0, m1]);
      const plan: Plan = { kind: "accept_now", label: `Accept "${candidate.title}" on its payment schedule`,
        revenue: receipts.reduce((a, r) => a + r.amountCents, 0), receipts: byDate(receipts).map(r => ({ date: r.date, amount: r.amountCents })),
        expenses: expenses.map(e => ({ yearIndex: V1_YEARS.indexOf(Number(e.date.slice(0, 4)) as TaxYear) as 0 | 1, amount: e.amountCents })),
        sep: [0, 0], reasons: [], assumptions: [...ctx.common, "Each scheduled payment is counted in the year of its date."], actions: [] };
      const scenarios: ScenarioResult[] = [scenarioFromPlan(ctx, ctx.decline, run([m0, m1], ctx.decline))];
      try { scenarios.push(scenarioFromPlan(ctx, plan, run([m0, m1], plan))); }
      catch (e) { if (!(e instanceof EngineStop)) throw e; warnings.push(`${plan.label}: not calculated — ${e.message}`); }
      const best = scenarios.filter(s => s.feasible && (s.kind === "decline" ? ctx.target === 0 : s.twoYearCashDeltaCents >= ctx.target))
        .sort((a, b) => b.twoYearCashDeltaCents - a.twoYearCashDeltaCents)[0];
      comparison = { status: "ready", contractVersion: CONTRACT_VERSION, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
        calculationFingerprint: fingerprint, caseId: parsed.id, baselineScenarioId: "decline", recommendedScenarioId: best?.id ?? null,
        scenarios, warnings: ["SEP-IRA, split and counteroffer options are calculated for offers with one payment; this offer has several."] };
    }
    comparison.warnings = [...modelWarnings([m0, m1], parsed), ...comparison.warnings];
    for (const s of comparison.scenarios) for (const [yi, y] of s.years.entries()) y.trace = [...projectionTrace(baseline, YEARS[yi]), ...y.trace];
    const others = ws.projects.filter(p => p.id !== candidate.id && p.status === "agreed").map(p => `"${p.title}"`);
    const receivedCents = candidate.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0);
    return { status: "ready", candidateProjectId, fingerprint, comparison,
      baseline: { label: `Your plan without "${candidate.title}"`,
        description: `Your profit forecast${others.length ? ` plus agreed ${others.join(", ")}` : ""}` +
          (receivedCents ? `, plus ${formatUsd(receivedCents)} already received from "${candidate.title}"` : "") +
          `, and SEP-IRA contributions already agreed. Declining "${candidate.title}" does not change any other project.` },
      baselineProjection: baseline.years, warnings };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e, "projects");
    throw e;
  }
}
