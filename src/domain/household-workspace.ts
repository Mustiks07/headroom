/**
 * Household workspace — shared contract v2.0 (round 3). ADDITIVE: the v1 `CaseInput`,
 * `SavedPlan` and API stay unchanged and supported.
 *
 * One household plan that keeps facts (forecasts, projects, actual payments, SEP contributions)
 * across events. Money is integer USD cents. Unknown is `null`, never 0.
 *
 * Ownership: schema, runtime validation, data-semantic helpers and the v1 adapter — Claude 3.
 * Financial results (`buildHouseholdProjection`, `evaluateHouseholdWorkspace`,
 * `compareWorkspaceOpportunity`) — Claude 2, using the result types declared at the bottom.
 * UI — Claude 1. Change this file only through a small, announced Claude 3 contract commit.
 */
import { z } from "zod";
import {
  CentsSchema, CONTRACT_VERSION, CoverageMonthSchema, EvidenceSchema, FactSchema, PersonIncomeSchema, PersonSchema, TaxYearSchema,
  type BlockedComparison, type CaseInput, type CurrentRisk, type MoneyFact, type ReadyComparison, type ScenarioKind, type ScenarioResult, type TaxYear,
} from "./contracts";
import { DealPlanningStateSchema } from "./deal-planning";

export const WORKSPACE_VERSION = "2.0" as const;
export const WORKSPACE_FILE_KIND = "headroom.workspace" as const;

const IdSchema = z.string().min(1).max(100);
const DateSchema = z.string().date();
const DateTimeSchema = z.string().datetime({ offset: true });
const ScenarioKindSchema = z.enum(["decline", "accept_now", "sep_minimum", "sep_buffer", "split_payment", "renegotiate"]);
const YEARS: TaxYear[] = [2026, 2027];

/* ------------------------------------------------------------------ household profile */

/**
 * Non-Schedule-C facts per person/year: the verified v1 income facts WITHOUT `scheduleCProfit`
 * (derived from forecasts + agreed projects) and WITHOUT `existingSepContribution` (derived from
 * the owner/year SEP records). This keeps exactly one source for each amount.
 */
export const OtherIncomeSchema = PersonIncomeSchema.omit({ scheduleCProfit: true, existingSepContribution: true });

export const HouseholdYearSchema = z.object({
  year: TaxYearSchema,
  taxFamilySize: z.number().int().min(1).max(10),
  coveredPersonIds: z.array(IdSchema).min(1),
  otherIncomes: z.array(OtherIncomeSchema).min(1),
  coverage: z.array(CoverageMonthSchema).length(12),
  benchmarkStatus: z.enum(["marketplace_confirmed", "county_candidate", "illustrative", "unknown"]),
  unsupportedFacts: z.array(z.string()),
  scopeConfirmed: z.boolean().nullable(),
}).superRefine((year, ctx) => {
  if (new Set(year.coverage.map(m => m.month)).size !== 12) ctx.addIssue({ code: "custom", path: ["coverage"], message: "Coverage requires each month exactly once." });
});

export const HouseholdProfileSchema = z.object({
  /** Stable case id used for the derived v1 `CaseInput.id`. */
  caseId: IdSchema,
  title: z.string().max(200),
  isSynthetic: z.boolean(),
  state: z.string().length(2),
  countyFips: z.string().regex(/^\d{5}$/).nullable(),
  filingStatus: z.enum(["single", "mfj", "other"]),
  people: z.array(PersonSchema).min(1),
  years: z.tuple([HouseholdYearSchema, HouseholdYearSchema]),
});

/* ------------------------------------------------------------------ annual profit forecast */

const ForecastBase = {
  personId: IdSchema,
  year: TaxYearSchema,
  /**
   * The entered amounts EXCLUDE receipts/expenses of projects managed in this workspace.
   * `null` = not yet confirmed → no ready result while a managed project has lines for this owner/year.
   */
  excludesManagedProjects: z.boolean().nullable(),
};

/** Exactly one active method per person/year. Switching methods replaces the record (with confirmation in the UI). */
export const ProfitForecastSchema = z.discriminatedUnion("method", [
  z.object({ ...ForecastBase, method: z.literal("annual_total"),
    /** Full-year net Schedule C profit, excluding managed projects. */
    annualNetProfit: FactSchema }),
  z.object({ ...ForecastBase, method: z.literal("year_to_date_plus_remaining"),
    asOfDate: DateSchema,
    /** The user confirmed the as-of date the YTD figure refers to. */
    asOfConfirmed: z.boolean(),
    /** Actual net profit through asOfDate (already after YTD expenses — never subtract those again). */
    ytdNetProfit: FactSchema,
    /** Expected gross receipts after asOfDate through Dec 31, excluding managed projects. */
    remainingReceipts: FactSchema,
    /** Expected deductible expenses after asOfDate through Dec 31, excluding managed projects. */
    remainingExpenses: FactSchema }),
]).superRefine((f, ctx) => {
  if (f.method === "year_to_date_plus_remaining" && (!f.asOfDate.startsWith(`${f.year}-`) || f.asOfDate.endsWith("-12-31"))) {
    ctx.addIssue({ code: "custom", path: ["asOfDate"], message: "The as-of date must fall inside the forecast year, before December 31." });
  }
});

/* ------------------------------------------------------------------ projects and payments */

const MoneyAtDateSchema = z.object({ amountCents: CentsSchema.nonnegative(), date: DateSchema });

/**
 * One receipt or expense of a managed project. `actual` REPLACES `expected` (never added).
 * `cancelledAt` drops a not-yet-received expected amount; a received amount cannot be cancelled —
 * fix a wrong record with a correction (history kept in `corrections`).
 */
export const ProjectLineSchema = z.object({
  id: IdSchema,
  label: z.string().max(200).optional(),
  expected: MoneyAtDateSchema.nullable(),
  actual: MoneyAtDateSchema.extend({ recordedAt: DateTimeSchema, sourceId: IdSchema }).nullable(),
  cancelledAt: DateTimeSchema.nullable(),
  /** Evidence for the expectation (offer, invoice, manual entry). */
  sourceId: IdSchema,
  corrections: z.array(z.object({ at: DateTimeSchema, previousActual: MoneyAtDateSchema, reason: z.string().min(1).max(300) })).max(50),
}).superRefine((line, ctx) => {
  if (!line.expected && !line.actual) ctx.addIssue({ code: "custom", message: "A payment needs an expected or an actual amount." });
  if (line.actual && line.cancelledAt) ctx.addIssue({ code: "custom", path: ["cancelledAt"], message: "A received amount can't be cancelled; record a correction instead." });
  for (const v of [line.expected, line.actual]) if (v && !YEARS.some(y => v.date.startsWith(`${y}-`))) {
    ctx.addIssue({ code: "custom", message: "Payment dates must be in 2026 or 2027." });
  }
});

export const ProjectSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  ownerPersonId: IdSchema,
  /** Unpaid proposed lines are what-if only; agreed expected lines and actuals of every status enter the forecast. */
  status: z.enum(["proposed", "agreed", "cancelled"]),
  createdAt: DateTimeSchema,
  statusChangedAt: DateTimeSchema,
  cashAccountingConfirmed: z.boolean().nullable(),
  timingArrangementConfirmed: z.boolean().nullable(),
  terms: z.object({
    canSplitPayment: z.boolean(),
    canRenegotiatePrice: z.boolean(),
    nextYearPaymentLatestDate: DateSchema.nullable(),
  }),
  receipts: z.array(ProjectLineSchema).max(50),
  expenses: z.array(ProjectLineSchema).max(50),
  /** The option the household agreed to for this project (labels/history), if any. */
  agreedDecision: z.object({ kind: ScenarioKindSchema, label: z.string().max(300), chosenAt: DateTimeSchema, fingerprint: z.string().max(200).nullable() }).nullable(),
});

/* ------------------------------------------------------------------ SEP: owner + tax year */

/** One active annual SEP goal per owner/year. Lowering it never "refunds" money already paid. */
export const SepTargetSchema = z.object({
  id: IdSchema,
  personId: IdSchema,
  year: TaxYearSchema,
  targetCents: CentsSchema.nonnegative(),
  acceptedAt: DateTimeSchema,
  origin: z.object({ projectId: IdSchema.nullable(), scenarioKind: ScenarioKindSchema.nullable(), fingerprint: z.string().max(200).nullable() }),
});

/** A contribution actually made (amount + date + evidence). Different ids add up; the same id is the same payment. */
export const SepContributionSchema = z.object({
  id: IdSchema,
  personId: IdSchema,
  taxYear: TaxYearSchema,
  amountCents: CentsSchema.positive(),
  paidDate: DateSchema,
  sourceId: IdSchema,
  recordedAt: DateTimeSchema,
}).superRefine((c, ctx) => {
  // Employer SEP contributions for a year can be made until the return due date incl. extensions.
  if (c.paidDate < `${c.taxYear}-01-01` || c.paidDate > `${c.taxYear + 1}-10-15`) {
    ctx.addIssue({ code: "custom", path: ["paidDate"], message: `A ${c.taxYear} SEP contribution must be paid between ${c.taxYear}-01-01 and ${c.taxYear + 1}-10-15.` });
  }
});

export const RetirementSchema = z.object({
  targets: z.array(SepTargetSchema).max(20),
  contributions: z.array(SepContributionSchema).max(200),
  /**
   * Money explicitly available for FUTURE contributions in the period considered (entered once,
   * as of a date). Unpaid accepted targets reduce it; contributions paid before `asOfDate` are not
   * subtracted again. `amountCents: null` = unknown (not zero).
   */
  futureContributionBudget: z.object({ amountCents: CentsSchema.nonnegative().nullable(), asOfDate: DateSchema.nullable(), sourceId: IdSchema,
    /** Contributions already reflected in this cash snapshot; explicit ids also disambiguate same-day payments. */
    includedContributionIds: z.array(IdSchema).optional() }),
});

/* ------------------------------------------------------------------ events, calculation, origin */

export const WORKSPACE_EVENT_KINDS = [
  "workspace_created", "migrated_from_v1", "forecast_updated", "project_added", "project_updated", "project_status_changed",
  "payment_recorded", "payment_corrected", "sep_target_changed", "sep_contribution_recorded", "document_imported", "rules_updated",
] as const;

/**
 * History entry stored INSIDE the workspace document, so a revision and its event are written in
 * one atomic save. `id` is stable: retrying the same event never duplicates it.
 */
export const WorkspaceEventSchema = z.object({
  id: IdSchema,
  at: DateTimeSchema,
  kind: z.enum(WORKSPACE_EVENT_KINDS),
  description: z.string().min(1).max(500),
  refs: z.object({ projectId: IdSchema.optional(), lineId: IdSchema.optional(), contributionId: IdSchema.optional(), targetId: IdSchema.optional(), documentId: IdSchema.optional() }),
  previousFingerprint: z.string().max(200).nullable(),
  nextFingerprint: z.string().max(200).nullable(),
});

export const WorkspaceOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({
    kind: z.literal("migrated_v1"),
    planId: IdSchema, planRevision: z.number().int().nonnegative(), planFingerprint: z.string().max(200),
    engineVersion: z.string().max(100), rulesVersion: z.string().max(100),
    source: z.enum(["browser", "cloud", "json"]), migratedAt: DateTimeSchema,
    /** What the user still has to confirm (e.g. old "done" checkboxes, v1 existing SEP). Never auto-converted to payments. */
    unconfirmed: z.array(z.string().max(300)).max(50),
  }),
]);

export const HouseholdWorkspaceSchema = z.object({
  workspaceVersion: z.literal(WORKSPACE_VERSION),
  id: IdSchema,
  /** 0 for an unsaved draft; the repository assigns 1, 2, … */
  revision: z.number().int().nonnegative(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  household: HouseholdProfileSchema,
  forecasts: z.array(ProfitForecastSchema).max(20),
  projects: z.array(ProjectSchema).max(30),
  retirement: RetirementSchema,
  planning: z.object({ objective: z.enum(["spendable_cash", "retirement_and_cash"]), minimumDesiredCashGainCents: CentsSchema.nonnegative() }),
  evidence: z.array(EvidenceSchema).max(500),
  events: z.array(WorkspaceEventSchema).max(500),
  /** Version stamp of the last calculation shown/saved; numbers are always recomputed, never stored. */
  calculation: z.object({ engineVersion: z.string().max(100), rulesVersion: z.string().max(100), fingerprint: z.string().max(200), evaluatedAt: DateTimeSchema }).nullable(),
  origin: WorkspaceOriginSchema,
  /** Round 4 (additive, optional): goals, allowed terms, cash context and action packages. See deal-planning.ts. */
  dealPlanning: DealPlanningStateSchema.optional(),
}).superRefine((ws, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const people = new Set(ws.household.people.map(p => p.id));
  const evidence = new Set(ws.evidence.map(e => e.id));
  if (people.size !== ws.household.people.length) issue(["household", "people"], "People must have unique ids.");
  if (evidence.size !== ws.evidence.length) issue(["evidence"], "Evidence ids must be unique.");
  if (ws.household.years[0].year !== 2026 || ws.household.years[1].year !== 2027) issue(["household", "years"], "Supply 2026 then 2027.");
  const needSource = (id: string, path: (string | number)[]) => { if (!evidence.has(id)) issue(path, `Source "${id}" is not in evidence.`); };

  ws.household.years.forEach((year, yi) => {
    if (year.coveredPersonIds.some(id => !people.has(id))) issue(["household", "years", yi, "coveredPersonIds"], "Covered people must be household members.");
    const ids = year.otherIncomes.map(i => i.personId);
    if (ids.some(id => !people.has(id)) || new Set(ids).size !== ids.length) issue(["household", "years", yi, "otherIncomes"], "Income rows must reference unique household people.");
  });

  const forecastKeys = new Set<string>();
  ws.forecasts.forEach((f, i) => {
    const key = `${f.personId}:${f.year}`;
    if (forecastKeys.has(key)) issue(["forecasts", i], "Only one profit forecast method per person and year.");
    forecastKeys.add(key);
    if (!people.has(f.personId)) issue(["forecasts", i, "personId"], "Unknown person.");
    for (const fact of forecastFacts(f)) needSource(fact.fact.sourceId, ["forecasts", i, fact.key, "sourceId"]);
  });

  const projectIds = new Set<string>(); const lineIds = new Set<string>();
  ws.projects.forEach((p, pi) => {
    if (projectIds.has(p.id)) issue(["projects", pi, "id"], "Project ids must be unique.");
    projectIds.add(p.id);
    if (!people.has(p.ownerPersonId)) issue(["projects", pi, "ownerPersonId"], "Unknown project owner.");
    (["receipts", "expenses"] as const).forEach(kind => p[kind].forEach((line, li) => {
      if (lineIds.has(line.id)) issue(["projects", pi, kind, li, "id"], "Payment ids must be unique across projects.");
      lineIds.add(line.id);
      needSource(line.sourceId, ["projects", pi, kind, li, "sourceId"]);
      if (line.actual) needSource(line.actual.sourceId, ["projects", pi, kind, li, "actual", "sourceId"]);
    }));
  });

  const targetKeys = new Set<string>(); const targetIds = new Set<string>();
  ws.retirement.targets.forEach((t, i) => {
    if (targetKeys.has(`${t.personId}:${t.year}`)) issue(["retirement", "targets", i], "One SEP goal per owner and tax year.");
    targetKeys.add(`${t.personId}:${t.year}`);
    if (targetIds.has(t.id)) issue(["retirement", "targets", i, "id"], "Duplicate SEP goal id.");
    targetIds.add(t.id);
    if (!people.has(t.personId)) issue(["retirement", "targets", i, "personId"], "Unknown person.");
  });
  const contributionIds = new Set<string>();
  ws.retirement.contributions.forEach((c, i) => {
    if (contributionIds.has(c.id)) issue(["retirement", "contributions", i, "id"], "The same contribution is recorded twice.");
    contributionIds.add(c.id);
    if (!people.has(c.personId)) issue(["retirement", "contributions", i, "personId"], "Unknown person.");
    needSource(c.sourceId, ["retirement", "contributions", i, "sourceId"]);
  });
  needSource(ws.retirement.futureContributionBudget.sourceId, ["retirement", "futureContributionBudget", "sourceId"]);
  if (new Set(ws.events.map(e => e.id)).size !== ws.events.length) issue(["events"], "Event ids must be unique.");
  if (ws.dealPlanning) {
    const dp = ws.dealPlanning;
    const factIds = new Set([...lineIds, ...contributionIds]);
    dp.goals.forEach((g, i) => { if (!projectIds.has(g.projectId)) issue(["dealPlanning", "goals", i, "projectId"], "Goal refers to a project that is not in this plan."); });
    dp.termSpaces.forEach((t, i) => { if (!projectIds.has(t.projectId)) issue(["dealPlanning", "termSpaces", i, "projectId"], "Terms refer to a project that is not in this plan."); });
    dp.packages.forEach((p, i) => {
      if (!projectIds.has(p.projectId)) issue(["dealPlanning", "packages", i, "projectId"], "Package refers to a project that is not in this plan.");
      if (!dp.goals.some(g => g.id === p.goalId)) issue(["dealPlanning", "packages", i, "goalId"], "Package refers to a goal that is not in this plan.");
    });
    dp.cashContext?.includedFactIds.forEach((id, i) => { if (!factIds.has(id)) issue(["dealPlanning", "cashContext", "includedFactIds", i], `Fact "${id}" is not in this plan.`); });
    dp.cashContext?.flows.forEach((f, i) => needSource(f.sourceId, ["dealPlanning", "cashContext", "flows", i, "sourceId"]));
    if (dp.cashContext?.snapshot) needSource(dp.cashContext.snapshot.sourceId, ["dealPlanning", "cashContext", "snapshot", "sourceId"]);
  }
});

export type OtherIncome = z.infer<typeof OtherIncomeSchema>;
export type HouseholdYear = z.infer<typeof HouseholdYearSchema>;
export type HouseholdProfile = z.infer<typeof HouseholdProfileSchema>;
export type ProfitForecast = z.infer<typeof ProfitForecastSchema>;
export type ProjectLine = z.infer<typeof ProjectLineSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type SepTarget = z.infer<typeof SepTargetSchema>;
export type SepContribution = z.infer<typeof SepContributionSchema>;
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
export type WorkspaceEventKind = (typeof WORKSPACE_EVENT_KINDS)[number];
export type WorkspaceOrigin = z.infer<typeof WorkspaceOriginSchema>;
export type HouseholdWorkspace = z.infer<typeof HouseholdWorkspaceSchema>;

/* ------------------------------------------------------------------ data-semantic helpers (no tax math) */

export function forecastFacts(f: ProfitForecast): Array<{ key: string; fact: MoneyFact; sign: 1 | -1 }> {
  return f.method === "annual_total" ? [{ key: "annualNetProfit", fact: f.annualNetProfit, sign: 1 }]
    : [{ key: "ytdNetProfit", fact: f.ytdNetProfit, sign: 1 }, { key: "remainingReceipts", fact: f.remainingReceipts, sign: 1 },
      { key: "remainingExpenses", fact: f.remainingExpenses, sign: -1 }];
}

/**
 * Combine signed facts: unknown if any part is unknown; confirmed only if all parts are confirmed;
 * range with correct signs (low = Σ low of + parts − Σ high of − parts, and vice versa).
 */
export function combineFacts(parts: Array<{ fact: MoneyFact; sign: 1 | -1 }>, sourceId: string): MoneyFact {
  if (parts.some(p => p.fact.status === "unknown" || p.fact.valueCents === null)) return { valueCents: null, status: "unknown", sourceId };
  let value = 0, low = 0, high = 0, ranged = false;
  for (const { fact, sign } of parts) {
    const v = fact.valueCents!;
    const lo = fact.range?.lowCents ?? v, hi = fact.range?.highCents ?? v;
    if (fact.range) ranged = true;
    value += sign * v;
    low += sign === 1 ? lo : -hi;
    high += sign === 1 ? hi : -lo;
  }
  const status = parts.every(p => p.fact.status === "confirmed") ? "confirmed" : "estimated";
  return ranged ? { valueCents: value, status, sourceId, range: { lowCents: low, highCents: high } } : { valueCents: value, status, sourceId };
}

/** Annual net profit implied by one forecast record (still excluding managed projects). */
export function forecastTotal(f: ProfitForecast, sourceId = `derived:forecast:${f.personId}:${f.year}`): MoneyFact {
  return combineFacts(forecastFacts(f), sourceId);
}

export type LineBasis = "actual" | "expected" | "cancelled";

/** Actual replaces expected; a cancelled, not-received line contributes nothing. */
export function effectiveLine(line: ProjectLine): { basis: LineBasis; amountCents: number; date: string | null } {
  if (line.actual) return { basis: "actual", amountCents: line.actual.amountCents, date: line.actual.date };
  if (line.cancelledAt || !line.expected) return { basis: "cancelled", amountCents: 0, date: line.expected?.date ?? null };
  return { basis: "expected", amountCents: line.expected.amountCents, date: line.expected.date };
}

/**
 * What a project contributes to the CURRENT forecast for a year: agreed → actual or expected
 * lines; cancelled/proposed → actual lines only. Facts survive any project status.
 */
export function projectYearAmounts(project: Project, year: TaxYear): { receiptsCents: number; expensesCents: number; allActual: boolean } {
  let receiptsCents = 0, expensesCents = 0, allActual = true;
  for (const [kind, lines] of [["receipts", project.receipts], ["expenses", project.expenses]] as const) {
    for (const line of lines) {
      const e = effectiveLine(line);
      if (e.basis === "cancelled" || !e.date?.startsWith(`${year}-`)) continue;
      if (project.status !== "agreed" && e.basis !== "actual") continue;
      if (e.basis !== "actual") allActual = false;
      if (kind === "receipts") receiptsCents += e.amountCents; else expensesCents += e.amountCents;
    }
  }
  return { receiptsCents, expensesCents, allActual };
}

/** Annual SEP position for one owner/year: remaining = max(0, target − actually paid). */
export function sepPosition(ws: HouseholdWorkspace, personId: string, year: TaxYear): { targetCents: number | null; paidCents: number; remainingCents: number } {
  const paidCents = ws.retirement.contributions.filter(c => c.personId === personId && c.taxYear === year).reduce((s, c) => s + c.amountCents, 0);
  const target = ws.retirement.targets.find(t => t.personId === personId && t.year === year);
  return { targetCents: target?.targetCents ?? null, paidCents, remainingCents: target ? Math.max(0, target.targetCents - paidCents) : 0 };
}

/** Legacy snapshots include payments through the as-of day. Freeze that set before recording a new payment. */
export function captureSepBudgetContributions(ws: HouseholdWorkspace): void {
  const budget = ws.retirement.futureContributionBudget;
  budget.includedContributionIds ??= ws.retirement.contributions
    .filter(c => budget.asOfDate === null || c.paidDate <= budget.asOfDate).map(c => c.id);
}

/** Actual payments made since the cash snapshot consume cash, as well as satisfying a target. */
export function remainingSepCash(ws: HouseholdWorkspace): number | null {
  const budget = ws.retirement.futureContributionBudget;
  if (budget.amountCents === null) return null;
  const included = budget.includedContributionIds && new Set(budget.includedContributionIds);
  const spent = ws.retirement.contributions.filter(c => included ? !included.has(c.id)
    : budget.asOfDate !== null && c.paidDate > budget.asOfDate).reduce((s, c) => s + c.amountCents, 0);
  return Math.max(0, budget.amountCents - spent);
}

/** Canonical, order-independent content for fingerprints (no ids of history, timestamps, revision or stamps). */
export function canonicalWorkspaceContent(ws: HouseholdWorkspace): unknown {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    household: ws.household,
    forecasts: [...ws.forecasts].sort((a, b) => `${a.personId}:${a.year}`.localeCompare(`${b.personId}:${b.year}`)),
    projects: byId(ws.projects).map(p => ({ ...p, createdAt: undefined, statusChangedAt: undefined,
      receipts: byId(p.receipts).map(l => ({ ...l, actual: l.actual && { ...l.actual, recordedAt: undefined }, corrections: undefined })),
      expenses: byId(p.expenses).map(l => ({ ...l, actual: l.actual && { ...l.actual, recordedAt: undefined }, corrections: undefined })) })),
    retirement: { ...ws.retirement,
      futureContributionBudget: { ...ws.retirement.futureContributionBudget,
        includedContributionIds: ws.retirement.futureContributionBudget.includedContributionIds?.slice().sort() },
      targets: byId(ws.retirement.targets).map(t => ({ ...t, acceptedAt: undefined })),
      contributions: byId(ws.retirement.contributions).map(c => ({ ...c, recordedAt: undefined })) },
    planning: ws.planning,
    evidence: byId(ws.evidence),
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/**
 * Reference workspace fingerprint: SHA-256 of key-sorted {content: canonicalWorkspaceContent,
 * engineVersion, rulesVersion}. Record order, timestamps and history do not change it.
 */
export async function workspaceFingerprint(ws: HouseholdWorkspace, engineVersion: string, rulesVersion: string): Promise<string> {
  const text = JSON.stringify(sortKeys({ content: canonicalWorkspaceContent(ws), engineVersion, rulesVersion }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Append an event once: the same event id is never added twice (safe retries). */
export function withEvent(ws: HouseholdWorkspace, event: WorkspaceEvent): HouseholdWorkspace {
  return ws.events.some(e => e.id === event.id) ? ws : { ...ws, events: [...ws.events, event].slice(-500) };
}

/* ------------------------------------------------------------------ v1 adapter */

const centsText = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const DERIVED_PROFIT_SOURCE = "derived-profit";
export const DERIVED_SEP_SOURCE = "derived-sep";
export const CURRENT_FORECAST_TITLE = "Current forecast (no new project)";

export interface CaseInputAdapterResult {
  input: CaseInput;
  /** Facts the user still has to supply/confirm before a ready result may be shown (contract-style paths). */
  missing: Array<{ path: string; reason: string }>;
  /** Plain-English description of how each derived amount was built. */
  notes: string[];
}

/**
 * Build the v1 `CaseInput` the existing engine understands. `scheduleCProfit` = forecast total +
 * agreed expected and all actual project amounts of that owner and year (only the candidate's unpaid lines excluded);
 * `existingSepContribution` = max(annual SEP goal, actually paid). With `candidateProjectId`, that
 * project's unpaid lines become the v1 opportunity; otherwise a zero "current forecast"
 * opportunity is used. Financial conclusions stay with the engine.
 */
export function workspaceToCaseInput(ws: HouseholdWorkspace, options: { candidateProjectId?: string | null } = {}): CaseInputAdapterResult {
  const missing: CaseInputAdapterResult["missing"] = [];
  const notes: string[] = [];
  const candidate = options.candidateProjectId ? ws.projects.find(p => p.id === options.candidateProjectId) ?? null : null;
  if (options.candidateProjectId && !candidate) missing.push({ path: "projects", reason: "The selected project is not in this plan." });
  const managed = ws.projects.map(p => p.id === candidate?.id ? { ...p, status: "proposed" as const } : p);

  const years = ws.household.years.map(hy => ({
    year: hy.year, taxFamilySize: hy.taxFamilySize, coveredPersonIds: hy.coveredPersonIds, coverage: hy.coverage,
    benchmarkStatus: hy.benchmarkStatus, unsupportedFacts: hy.unsupportedFacts, scopeConfirmed: hy.scopeConfirmed,
    incomes: hy.otherIncomes.map(other => {
      const forecastIndex = ws.forecasts.findIndex(f => f.personId === other.personId && f.year === hy.year);
      const forecast = ws.forecasts[forecastIndex];
      const own = managed.filter(p => p.ownerPersonId === other.personId);
      const sum = own.reduce((acc, p) => {
        const a = projectYearAmounts(p, hy.year);
        return { r: acc.r + a.receiptsCents, e: acc.e + a.expensesCents, actual: acc.actual && a.allActual };
      }, { r: 0, e: 0, actual: true });
      let profit: MoneyFact;
      if (!forecast) {
        const dependent = ws.household.people.find(p => p.id === other.personId)?.role === "dependent";
        profit = { valueCents: dependent ? 0 : null, status: dependent ? "confirmed" : "unknown", sourceId: DERIVED_PROFIT_SOURCE };
        if (!dependent) missing.push({ path: `forecasts[${other.personId}:${hy.year}]`, reason: `Business profit forecast for ${hy.year} is missing (enter 0 if this person has no business).` });
      } else {
        if (own.some(p => [...p.receipts, ...p.expenses].some(l => [l.actual?.date, l.expected?.date].some(d => d?.startsWith(`${hy.year}-`)))) && forecast.excludesManagedProjects !== true) {
          missing.push({ path: `forecasts[${forecastIndex}].excludesManagedProjects`, reason: "Confirm that the forecast does not already include the projects listed in this plan." });
        }
        if (forecast.method === "year_to_date_plus_remaining" && !forecast.asOfConfirmed) {
          missing.push({ path: `forecasts[${forecastIndex}].asOfDate`, reason: "Confirm the date your year-to-date profit refers to." });
        }
        if (forecast.method === "year_to_date_plus_remaining") own.filter(p => p.status === "agreed").forEach(p => {
          for (const kind of ["receipts", "expenses"] as const) p[kind].forEach((l, li) => {
            if (!l.actual && !l.cancelledAt && l.expected?.date.startsWith(`${hy.year}-`) && l.expected.date <= forecast.asOfDate)
              missing.push({ path: `projects[${ws.projects.findIndex(x => x.id === p.id)}].${kind}[${li}].actual`, reason: `Confirm the actual status of the payment expected on ${l.expected.date}.` });
          });
        });
        const base = forecastFacts(forecast);
        const projectPart: MoneyFact = { valueCents: sum.r - sum.e, status: sum.actual ? "confirmed" : "estimated", sourceId: DERIVED_PROFIT_SOURCE };
        profit = combineFacts(own.length ? [...base, { fact: projectPart, sign: 1 }] : base, DERIVED_PROFIT_SOURCE);
        if (own.length) notes.push(`${hy.year} profit for ${other.personId}: forecast plus ${own.length} managed project(s), net ${centsText(sum.r - sum.e)}.`);
      }
      const sep = sepPosition(ws, other.personId, hy.year);
      const sepCents = Math.max(sep.targetCents ?? 0, sep.paidCents);
      const existingSepContribution: MoneyFact = { valueCents: sepCents,
        status: sep.paidCents >= sepCents ? "confirmed" : "estimated", sourceId: DERIVED_SEP_SOURCE };
      return { ...other, scheduleCProfit: profit, existingSepContribution };
    }),
  })) as CaseInput["years"];

  const owner = candidate?.ownerPersonId ?? ws.projects[0]?.ownerPersonId
    ?? ws.forecasts.find(f => forecastFacts(f).some(x => x.fact.valueCents !== 0))?.personId
    ?? ws.household.people.find(p => p.role === "primary")?.id ?? ws.household.people[0].id;
  const expectedOf = (lines: ProjectLine[]) => lines.filter(l => !l.actual).map(effectiveLine).filter(e => e.basis === "expected" && e.date);
  const receipts = candidate ? expectedOf(candidate.receipts) : [];
  const expenses = candidate ? expectedOf(candidate.expenses) : [];
  const firstDate = (xs: Array<{ date: string | null }>, fallback: string) => xs.map(x => x.date!).sort()[0] ?? fallback;
  const opportunity: CaseInput["opportunity"] = candidate ? {
    title: candidate.title, ownerPersonId: owner,
    grossRevenueCents: receipts.reduce((s, r) => s + r.amountCents, 0),
    incrementalExpensesCents: expenses.reduce((s, r) => s + r.amountCents, 0),
    plannedReceiptDate: firstDate(receipts, "2026-12-31"), expensePaymentDate: firstDate(expenses, firstDate(receipts, "2026-12-31")),
    cashAccountingConfirmed: candidate.cashAccountingConfirmed, timingArrangementConfirmed: candidate.timingArrangementConfirmed,
  } : { title: CURRENT_FORECAST_TITLE, ownerPersonId: owner, grossRevenueCents: 0, incrementalExpensesCents: 0,
    plannedReceiptDate: "2026-12-31", expensePaymentDate: "2026-12-31", cashAccountingConfirmed: true, timingArrangementConfirmed: true };
  if (candidate && [...candidate.receipts, ...candidate.expenses].some(l => l.actual)) {
    notes.push("Some of this project's payments were already received; those amounts and dates are fixed and are not candidates for re-timing.");
  }

  const budget = remainingSepCash(ws);
  const reserved = ws.retirement.targets.reduce((sum, t) => sum + sepPosition(ws, t.personId, t.year).remainingCents, 0);
  if (budget === null) notes.push("No budget for future SEP contributions was entered, so no additional contribution is assumed possible.");
  const constraints: CaseInput["constraints"] = {
    maxAdditionalSepCents: Math.max(0, (budget ?? 0) - reserved),
    minimumDesiredCashGainCents: ws.planning.minimumDesiredCashGainCents,
    canSplitPayment: candidate?.terms.canSplitPayment ?? false,
    canRenegotiatePrice: candidate?.terms.canRenegotiatePrice ?? false,
    nextYearPaymentLatestDate: candidate?.terms.nextYearPaymentLatestDate ?? null,
    objective: ws.planning.objective,
  };
  const derivedEvidence = [
    { id: DERIVED_PROFIT_SOURCE, kind: "manual" as const, label: "Business profit derived from your forecast and the projects in this plan" },
    { id: DERIVED_SEP_SOURCE, kind: "manual" as const, label: "SEP amount derived from your annual goal and recorded contributions" },
  ].filter(d => !ws.evidence.some(e => e.id === d.id));

  const input: CaseInput = {
    contractVersion: CONTRACT_VERSION, id: ws.household.caseId, title: ws.household.title, isSynthetic: ws.household.isSynthetic,
    state: ws.household.state, countyFips: ws.household.countyFips, filingStatus: ws.household.filingStatus, people: ws.household.people,
    years, opportunity, constraints, evidence: [...ws.evidence, ...derivedEvidence],
  };
  return { input, missing, notes };
}

/* ------------------------------------------------------------------ result types (implemented by Claude 2) */

export interface ProjectionComponent {
  kind: "annual_total" | "ytd_net_profit" | "remaining_receipts" | "remaining_expenses" | "project_receipt" | "project_expense";
  label: string;
  /** Signed contribution to the year's profit (expenses negative). Null when unknown. */
  amountCents: number | null;
  status: MoneyFact["status"];
  basis?: LineBasis;
  sourceIds: string[];
  refs?: { projectId?: string; lineId?: string };
}

export interface ProjectedPersonYear {
  personId: string;
  year: TaxYear;
  method: ProfitForecast["method"] | null;
  components: ProjectionComponent[];
  /** The derived Schedule C profit used by the engine (same value as the adapter's). */
  total: MoneyFact;
}

export interface ReadyHouseholdProjection {
  status: "ready";
  workspaceId: string;
  workspaceRevision: number;
  engineVersion: string;
  rulesVersion: string;
  /** SHA-256 of canonicalWorkspaceContent + engine + rules version. */
  fingerprint: string;
  years: Array<{ year: TaxYear; people: ProjectedPersonYear[] }>;
  /** Current-year subsidy position on the projected facts (v1 CurrentRisk shape). */
  currentRisk: CurrentRisk | null;
  assumptions: string[];
  warnings: string[];
}
export type HouseholdProjectionResult = ReadyHouseholdProjection | BlockedComparison;

export interface SepYearStatus {
  personId: string; year: TaxYear;
  targetCents: number | null; paidCents: number; remainingCents: number;
  /** Legal maximum on the household's combined profit for that owner/year, when computable. */
  legalLimitCents: number | null;
}

export interface ReadyWorkspaceEvaluation {
  status: "ready";
  projection: ReadyHouseholdProjection;
  /** Existing agreements on current facts, NOT re-optimized. */
  agreed: { result: ScenarioResult | null; stillFeasible: boolean; reasons: string[]; creditLostYears: TaxYear[] };
  sep: SepYearStatus[];
  /** Future-contribution budget minus unpaid accepted goals; null when the budget is unknown. */
  futureContributionBudgetRemainingCents: number | null;
  fingerprint: string;
  warnings: string[];
}
export type WorkspaceEvaluationResult = ReadyWorkspaceEvaluation | BlockedComparison;

export interface ReadyWorkspaceComparison {
  status: "ready";
  candidateProjectId: string;
  /** Always shown: e.g. "Your plan without <B>" — A and other commitments included. */
  baseline: { label: string; description: string };
  /** Scenarios change ONLY the candidate; deltas are relative to the baseline above. */
  comparison: ReadyComparison;
  fingerprint: string;
}
export type WorkspaceComparisonResult = ReadyWorkspaceComparison | BlockedComparison;

/** Entry points Claude 2 implements (pure, deterministic, browser-compatible). */
export interface HouseholdWorkspaceEngine {
  buildHouseholdProjection(ws: HouseholdWorkspace): Promise<HouseholdProjectionResult>;
  evaluateHouseholdWorkspace(ws: HouseholdWorkspace): Promise<WorkspaceEvaluationResult>;
  compareWorkspaceOpportunity(ws: HouseholdWorkspace, candidateProjectId: string): Promise<WorkspaceComparisonResult>;
}

/** Narrow chosen-scenario info used when a project is agreed (kept for history/labels). */
export type AgreedDecision = NonNullable<Project["agreedDecision"]>;
export type { ScenarioKind };
