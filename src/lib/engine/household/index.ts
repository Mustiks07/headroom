/**
 * Household entry points (round 3). Same guards, rules, rounding and year calculations as v1;
 * the v1 entry points are unchanged.
 *
 *  buildHouseholdProjection   — where each year's business profit and SEP total come from
 *  evaluateHouseholdWorkspace — the plan as agreed now (fixed commitments, not re-optimized)
 *  compareWorkspaceOpportunity — one candidate project evaluated on top of every other commitment
 */
import type { BlockedComparison, CaseInput, ReadyComparison, ScenarioResult, TaxYear, TraceItem, YearResult } from "@/domain/contracts";
import { CONTRACT_VERSION } from "@/domain/contracts";
import { canonical, modelWarnings, sha256Hex, stopToBlocked } from "../common";
import { compare, makeCtx, run, scenarioFromPlan, YEARS as V1_YEARS, type Plan } from "../comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "../guard";
import { formatUsd } from "../money";
import { EngineStop, NO_VARIATION, type YearModel } from "../model";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";
import { profitHeadroomDollars } from "../search";
import { evaluateYear, solveCredit, toYearResult } from "../year";
import { projectHousehold, projectionTrace, type HouseholdProjection, type ProjectionOptions, type YearProjection } from "./projection";
import { HouseholdEngineInputSchema, type HouseholdEngineInput } from "./types";

export * from "./types";
export type { HouseholdProjection, ProfitComponent, YearProjection, YearSep } from "./projection";

/** Version of the household aggregation layer; v1 results keep ENGINE_VERSION unchanged. */
export const HOUSEHOLD_ENGINE_VERSION = "headroom-household-1.0.0";

const YEARS: TaxYear[] = [2026, 2027];

interface Versions { engineVersion: string; householdEngineVersion: string; rulesVersion: string; calculationFingerprint: string }

/** Order-insensitive fingerprint: records are sorted by id, so reordering without a change in meaning keeps it. */
export async function householdFingerprint(input: HouseholdEngineInput, extra: Record<string, unknown> = {}): Promise<string> {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  const normalized = {
    ...input,
    forecasts: [...input.forecasts].sort((a, b) => `${a.personId}.${a.year}`.localeCompare(`${b.personId}.${b.year}`)),
    projects: byId(input.projects).map(p => ({ ...p, items: byId(p.items) })),
    sepContributions: byId(input.sepContributions),
    sepTargets: [...input.sepTargets].sort((a, b) => `${a.personId}.${a.taxYear}`.localeCompare(`${b.personId}.${b.taxYear}`)),
  };
  return sha256Hex(JSON.stringify({ input: canonical(normalized), extra: canonical(extra), engineVersion: ENGINE_VERSION,
    householdEngineVersion: HOUSEHOLD_ENGINE_VERSION, rulesVersion: RULES_VERSION }));
}

function parseHousehold(raw: unknown, issues: Issues): HouseholdEngineInput | null {
  const parsed = HouseholdEngineInputSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.need("INVALID_INPUT", i.path.map(String).join(".") || "(root)", i.message);
    return null;
  }
  return parsed.data;
}

const yearsWithForecast = (input: HouseholdEngineInput): Array<0 | 1> =>
  ([0, 1] as const).filter(yi => yi === 0 || input.forecasts.some(f => f.year === YEARS[yi] && f.personId === input.household.opportunity.ownerPersonId));

async function versions(input: HouseholdEngineInput, extra: Record<string, unknown>): Promise<Versions> {
  return { engineVersion: ENGINE_VERSION, householdEngineVersion: HOUSEHOLD_ENGINE_VERSION, rulesVersion: RULES_VERSION,
    calculationFingerprint: await householdFingerprint(input, extra) };
}

// --------------------------------------------------------------- projection --
export type HouseholdProjectionResult = BlockedComparison | (Versions & {
  status: "ready";
  projection: Omit<HouseholdProjection, "derivedInput">;
  trace: TraceItem[];
  warnings: string[];
});

export async function buildHouseholdProjection(raw: HouseholdEngineInput): Promise<HouseholdProjectionResult> {
  const issues = new Issues();
  const input = parseHousehold(raw, issues);
  const p = input ? projectHousehold(input, issues, { years: yearsWithForecast(input) }) : null;
  const blocked = issues.toBlocked();
  if (blocked || !input || !p) return blocked!;
  const { derivedInput: _d, ...projection } = p;
  void _d;
  return { status: "ready", ...(await versions(input, { kind: "projection" })), projection,
    trace: p.years.flatMap(y => projectionTrace(p, y.year)), warnings: p.warnings };
}

// ------------------------------------------------------------ fixed plan --
export interface WorkspaceYearOutcome {
  year: TaxYear;
  /** Full year result for the plan as agreed; null when it cannot be calculated (see problems). */
  result: YearResult | null;
  risk: { magiCents: number; thresholdMagiCents: number; ptcCents: number; settlementCents: number;
    state: "below_cliff" | "at_risk" | "over_cliff" | "no_credit"; additionalProfitHeadroomCents: number | null } | null;
  problems: string[];
}

export interface FixedPlanOutcome {
  /** The agreed commitments are possible and allowed as recorded. */
  feasible: boolean;
  reasons: string[];
  /** Checks that could not be made because an input is missing (not a failure). */
  notChecked: string[];
  years: WorkspaceYearOutcome[];
  /** Spendable cash of both years after settlement, when both years were calculated. */
  twoYearSpendableCents: number | null;
  /** Years not calculated because next-year facts are missing (not an error for the current-year check). */
  pendingYears: Array<{ year: TaxYear; fields: BlockedComparison["fields"] }>;
}

export type HouseholdWorkspaceEvaluation = BlockedComparison | (Versions & {
  status: "ready";
  projection: Omit<HouseholdProjection, "derivedInput">;
  fixedPlan: FixedPlanOutcome;
  warnings: string[];
});

function riskOf(model: YearModel) {
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
function fixedPlan(input: HouseholdEngineInput, p: HouseholdProjection, issues: Issues): { outcome: FixedPlanOutcome; models: YearModel[] } | null {
  const derived = parseCase(p.derivedInput, issues);
  if (!derived) return null;
  const reasons: string[] = [];
  const years: WorkspaceYearOutcome[] = [];
  const models: YearModel[] = [];
  const pendingYears: FixedPlanOutcome["pendingYears"] = [];
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
          ? `${yp.year}: SEP-IRA contributions already paid (${formatUsd(sep.paidCents)}) exceed the legal limit for the current profit forecast. ${e.message} An excess contribution has to be corrected with your plan provider; Headroom does not change a paid amount.`
          : `${yp.year}: the agreed SEP-IRA target (${formatUsd(sep.plannedTotalCents)}) is no longer allowed for the current profit forecast. ${e.message} Lower the target before contributing the rest (${formatUsd(sep.remainingCents)} still to pay).`);
      } else problems.push(`${yp.year}: ${e.message}`);
    }
    reasons.push(...problems);
    years.push({ year: yp.year, result, risk, problems });
  }
  const { budgetCents, reservedCents, availableCents } = p.sepBudget;
  if (budgetCents !== null && availableCents !== null && availableCents < 0) {
    reasons.push(`Agreed SEP-IRA contributions still to be paid (${formatUsd(reservedCents)}) exceed the money set aside for future contributions (${formatUsd(budgetCents)}). Lower a target or add to the set-aside amount; Headroom does not reduce an agreed contribution on its own.`);
  }
  const notChecked: string[] = [];
  if (budgetCents === null && reservedCents > 0) {
    notChecked.push(`Not checked: whether money is set aside for the ${formatUsd(reservedCents)} of agreed SEP-IRA contributions still to be paid. Enter the set-aside amount to check it.`);
  }
  const both = years.length === 2 && years.every(y => y.result);
  return { outcome: { feasible: reasons.length === 0, reasons, notChecked, years,
    twoYearSpendableCents: both ? years.reduce((a, y) => a + y.result!.spendableAfterSettlementCents, 0) : null, pendingYears }, models };
}

export async function evaluateHouseholdWorkspace(raw: HouseholdEngineInput): Promise<HouseholdWorkspaceEvaluation> {
  const issues = new Issues();
  const input = parseHousehold(raw, issues);
  const p = input ? projectHousehold(input, issues, { years: yearsWithForecast(input) }) : null;
  const fixed = input && p ? fixedPlan(input, p, issues) : null;
  const blocked = issues.toBlocked();
  if (blocked || !input || !p || !fixed) return blocked!;
  const { derivedInput: _d, ...projection } = p;
  void _d;
  return { status: "ready", ...(await versions(input, { kind: "workspace" })), projection, fixedPlan: fixed.outcome,
    warnings: [...modelWarnings(fixed.models, p.derivedInput), ...p.warnings] };
}

// ------------------------------------------------------- candidate comparison --
export type WorkspaceOpportunityComparison = BlockedComparison | (Versions & {
  status: "ready";
  candidateProjectId: string;
  /** Baseline: every other commitment plus the candidate's amounts already received/paid. */
  baseline: Omit<HouseholdProjection, "derivedInput">;
  /** The plan as currently agreed (includes the candidate if it is an agreed project being edited). */
  fixedPlan: FixedPlanOutcome | null;
  /** Options for the candidate only, relative to the baseline. Uses the v1 comparison and its scenario kinds. */
  comparison: ReadyComparison;
  warnings: string[];
});

/**
 * Evaluate ONLY the increment of one project on top of all other commitments. Editing an agreed
 * project first removes its not-yet-received items from the baseline; its actual receipts stay.
 * Declining the candidate never cancels another project.
 */
export async function compareWorkspaceOpportunity(raw: HouseholdEngineInput, candidateProjectId: string): Promise<WorkspaceOpportunityComparison> {
  const issues = new Issues();
  const input = parseHousehold(raw, issues);
  if (!input) return issues.toBlocked()!;
  const candidate = input.projects.find(p => p.id === candidateProjectId);
  if (!candidate) return { status: "needs_data", code: "CANDIDATE_MISSING", message: "Choose the project to evaluate.", fields: [{ path: "projects", reason: `No project with id "${candidateProjectId}".` }] };
  if (candidate.status === "cancelled") {
    return { status: "needs_data", code: "CANDIDATE_CANCELLED", message: `"${candidate.title}" is cancelled; reopen it before evaluating new terms.`, fields: [{ path: `projects[${input.projects.indexOf(candidate)}].status`, reason: "Cancelled project." }] };
  }
  const opts: ProjectionOptions = { years: [0, 1], excludeProjectId: candidate.id };
  const baseline = projectHousehold(input, issues, opts);
  const current = projectHousehold(input, new Issues(), { years: yearsWithForecast(input) });
  const blocked = issues.toBlocked();
  if (blocked || !baseline) return blocked!;
  const fixedIssues = new Issues();
  const fixed = current ? fixedPlan(input, current, fixedIssues) : null;

  // Only the candidate's items that have not happened can be decided; received money is a fact in the baseline.
  const open = candidate.items.filter(i => !i.actual && !i.cancelled && i.expected);
  const receipts = open.filter(i => i.kind === "receipt").map(i => ({ id: i.id, ...i.expected! }));
  const expenses = open.filter(i => i.kind === "expense").map(i => ({ id: i.id, ...i.expected! }));
  const warnings = [...baseline.warnings];
  const received = candidate.items.filter(i => i.actual);
  if (received.length) warnings.push(`${received.length} payment${received.length === 1 ? "" : "s"} of "${candidate.title}" already happened; they stay in the baseline and are not moved or re-priced.`);
  if (!receipts.length && !expenses.length) {
    return { status: "needs_data", code: "NOTHING_TO_DECIDE", message: `"${candidate.title}" has no expected payments left to decide.`, fields: [{ path: `projects[${input.projects.indexOf(candidate)}].items`, reason: "All items are received, paid or cancelled." }] };
  }

  const derived: CaseInput = structuredClone(baseline.derivedInput);
  const budgetLeft = baseline.sepBudget.availableCents;
  if (budgetLeft !== null) {
    const userMax = derived.constraints.maxAdditionalSepCents;
    derived.constraints.maxAdditionalSepCents = Math.max(0, Math.min(userMax, budgetLeft));
    if (budgetLeft < userMax) {
      warnings.push(`New SEP-IRA contributions are limited to ${formatUsd(Math.max(0, budgetLeft))}: the money set aside (${formatUsd(baseline.sepBudget.budgetCents!)}) minus agreed contributions not yet paid (${formatUsd(baseline.sepBudget.reservedCents)}).`);
    }
  }
  for (const yp of baseline.years) {
    if (yp.sep.plannedTotalCents > 0) {
      warnings.push(`SEP-IRA amounts in these options are additions to your ${yp.year} total of ${formatUsd(yp.sep.plannedTotalCents)} (paid ${formatUsd(yp.sep.paidCents)}, still to pay ${formatUsd(yp.sep.remainingCents)}); the legal limit is checked on the year's whole business profit.`);
    }
  }

  let comparison: ReadyComparison;
  const byDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date));
  const expenseYears = new Set(expenses.map(e => e.date.slice(0, 4)));
  // Re-negotiating an AGREED project: its remaining amount is treated as one offer on its first date, so the
  // usual options (SEP, split, counteroffer) can be searched; the agreed schedule itself stays in fixedPlan.
  const regroup = candidate.status === "agreed" && receipts.length > 1 && expenseYears.size <= 1;
  const single = (receipts.length === 1 && expenses.length <= 1) || regroup;
  if (single) {
    const first = byDate(receipts)[0];
    const gross = receipts.reduce((a, r) => a + r.amountCents, 0);
    derived.opportunity = { ...derived.opportunity, title: candidate.title, ownerPersonId: candidate.ownerPersonId,
      grossRevenueCents: gross, plannedReceiptDate: first.date,
      incrementalExpensesCents: expenses.reduce((a, e) => a + e.amountCents, 0), expensePaymentDate: byDate(expenses)[0]?.date ?? first.date };
    if (regroup) warnings.push(`Options treat the ${formatUsd(gross)} still to be received from "${candidate.title}" as one payment on ${first.date}; the schedule you agreed is evaluated separately under the plan as agreed.`);
  }
  const v1Issues = new Issues();
  const parsed = parseCase(derived, v1Issues);
  const m0 = parsed ? buildYearModel(parsed, 0, v1Issues) : null;
  const m1 = parsed ? buildYearModel(parsed, 1, v1Issues) : null;
  if (parsed && single) checkOpportunity(parsed, v1Issues);
  const v1Blocked = v1Issues.toBlocked();
  if (v1Blocked || !parsed || !m0 || !m1) return v1Blocked!;
  try {
    const ver = await versions(input, { kind: "candidate", candidateProjectId });
    if (single) {
      const out = compare(parsed, [m0, m1]);
      comparison = { status: "ready", contractVersion: CONTRACT_VERSION, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
        calculationFingerprint: ver.calculationFingerprint, caseId: parsed.id, baselineScenarioId: out.baselineScenarioId,
        recommendedScenarioId: out.recommendedScenarioId, scenarios: out.scenarios, warnings: out.warnings };
    } else {
      // Several payments: evaluate the offered schedule exactly; options are only searched for single-payment offers.
      const ctx = makeCtx(parsed, [m0, m1]);
      const plan: Plan = { kind: "accept_now", label: `Accept "${candidate.title}" on its payment schedule`,
        revenue: receipts.reduce((a, r) => a + r.amountCents, 0),
        receipts: receipts.map(r => ({ date: r.date, amount: r.amountCents })),
        expenses: expenses.map(e => ({ yearIndex: V1_YEARS.indexOf(Number(e.date.slice(0, 4)) as TaxYear) as 0 | 1, amount: e.amountCents })),
        sep: [0, 0], reasons: [], assumptions: [...ctx.common, "Each scheduled payment is counted in the year of its date."], actions: [] };
      const scenarios: ScenarioResult[] = [scenarioFromPlan(ctx, ctx.decline, run([m0, m1], ctx.decline))];
      try { scenarios.push(scenarioFromPlan(ctx, plan, run([m0, m1], plan))); }
      catch (e) { if (!(e instanceof EngineStop)) throw e; warnings.push(`${plan.label}: not calculated — ${e.message}`); }
      const best = scenarios.filter(s => s.feasible && (s.kind === "decline" ? ctx.target === 0 : s.twoYearCashDeltaCents >= ctx.target))
        .sort((a, b) => b.twoYearCashDeltaCents - a.twoYearCashDeltaCents)[0];
      comparison = { status: "ready", contractVersion: CONTRACT_VERSION, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
        calculationFingerprint: ver.calculationFingerprint, caseId: parsed.id, baselineScenarioId: "decline", recommendedScenarioId: best?.id ?? null,
        scenarios, warnings: ["SEP-IRA, split and counteroffer options are calculated for offers with one payment; this offer has several."] };
    }
    comparison.warnings = [...modelWarnings([m0, m1], parsed), ...comparison.warnings];
    for (const s of comparison.scenarios) for (const [yi, y] of s.years.entries()) y.trace = [...projectionTrace(baseline, YEARS[yi]), ...y.trace];
    const { derivedInput: _d, ...base } = baseline;
    void _d;
    return { status: "ready", ...ver, candidateProjectId, baseline: base, fixedPlan: fixed?.outcome ?? null, comparison,
      warnings: [...warnings, ...(fixed ? [] : ["The plan as currently agreed could not be evaluated; see the household check for the missing information."])] };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e, "years");
    throw e;
  }
}

export type { YearProjection as HouseholdYearProjection };
