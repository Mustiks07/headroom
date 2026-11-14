/**
 * Deal planning — shared contract v1.0 (round 4). ADDITIVE to household workspace v2.0:
 * stored under the optional `workspace.dealPlanning` field, so v1 JSON, v2 workspaces without it
 * and round 3 fingerprints stay valid.
 *
 * Goals, allowed deal terms, dated cash context, search results, decision sensitivity and the
 * action package. Money: integer USD cents. Dates: YYYY-MM-DD. Unknown is `null`, never 0.
 *
 * Ownership: schemas, validation, storage, exports — Claude 3. `searchDealTerms` and
 * `evaluateDecisionSensitivity` (all money, tax, constraint checks and ranking) — Claude 2.
 * UI — Claude 1. Change through small announced Claude 3 contract commits only.
 */
import { z } from "zod";
import { CentsSchema, TaxYearSchema, type BlockedComparison, type TaxYear } from "./contracts";
import type { HouseholdWorkspace } from "./household-workspace";
import { DecisionRecordSchema, IssuedCalendarEventSchema } from "./assistance";

export const DEAL_PLANNING_VERSION = "1.0" as const;

const IdSchema = z.string().min(1).max(100);
const DateSchema = z.string().date();
const DateTimeSchema = z.string().datetime({ offset: true });
const inPlanYears = (d: string) => d >= "2026-01-01" && d <= "2027-12-31";
/** Planning dates may reach the 2027 return deadline (settlement, SEP by the extended due date). */
const inHorizon = (d: string) => d >= "2026-01-01" && d <= "2028-10-16";

/* ------------------------------------------------------------------ goal */

/**
 * What a date target measures — never mixed:
 *  - project_receipts: gross money received from THIS project by the date (no taxes);
 *  - project_available_cash: this project's contribution to money available by the date
 *    (receipts − project expenses − its SEP contributions − the documented tax reserve rule);
 *  - household_balance: the household's bank balance on the date — requires a complete CashContext.
 */
export const DATE_TARGET_KINDS = ["project_receipts", "project_available_cash", "household_balance"] as const;

export const DateTargetSchema = z.object({
  id: IdSchema,
  kind: z.enum(DATE_TARGET_KINDS),
  byDate: DateSchema.refine(inHorizon, "Date targets must fall between 2026-01-01 and 2028-10-16."),
  minimumCents: CentsSchema,
  label: z.string().max(200).optional(),
});

export const DealGoalSchema = z.object({
  id: IdSchema,
  /** The project whose NOT-yet-executed terms may change (proposed, or agreed with unpaid lines). */
  projectId: IdSchema,
  /**
   * Minimum change in spendable cash after final settlement of BOTH tax years (2026 + 2027),
   * relative to `baseline`. Retirement dollars never count toward it.
   */
  minimumTwoYearCashDeltaCents: CentsSchema,
  /**
   * decline_unpaid_terms: the household plan with every other project, this project's facts
   * (received amounts, recorded SEP) and existing SEP goals, but WITHOUT the project's unpaid terms.
   * accept_as_offered: the same plus the unpaid terms exactly as currently offered/agreed.
   */
  baseline: z.enum(["decline_unpaid_terms", "accept_as_offered"]),
  /** Extra SEP the household is willing to add for this deal; null = limited only by remaining SEP cash and law. */
  maxAdditionalSepCents: CentsSchema.nonnegative().nullable(),
  dateTargets: z.array(DateTargetSchema).max(3),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

/* ------------------------------------------------------------------ allowed terms */

export const PaymentWindowSchema = z.object({
  id: IdSchema,
  earliest: DateSchema.refine(inPlanYears, "Payment windows must be in 2026 or 2027."),
  latest: DateSchema.refine(inPlanYears, "Payment windows must be in 2026 or 2027."),
  /** Largest share of the remaining price that may fall in this window, basis points (10000 = 100%). */
  maxShareBps: z.number().int().min(0).max(10_000),
}).refine(w => w.earliest <= w.latest, { message: "A payment window must start on or before its end.", path: ["latest"] });

/**
 * The space a search may explore. Prices are what the household would ASK, never assumed agreed.
 * There is always an explicit upper price bound — no unbounded price growth.
 */
export const DealTermsSpaceSchema = z.object({
  projectId: IdSchema,
  /** Bounds of the TOTAL asked price (including amounts already received). */
  price: z.object({
    minCents: CentsSchema.nonnegative(),
    maxCents: CentsSchema.nonnegative(),
    /** Granularity of asked prices (≥ $1). */
    stepCents: CentsSchema.min(100),
  }).refine(p => p.minCents <= p.maxCents, { message: "The lowest price must not exceed the highest price.", path: ["maxCents"] }),
  paymentWindows: z.array(PaymentWindowSchema).min(1).max(4),
  /** Most payments the client would accept for the remaining amount. */
  maxPayments: z.number().int().min(1).max(4),
  /** The client is open to new terms (price/schedule). null = not yet known → only "as offered" is ready. */
  newTermsConfirmed: z.boolean().nullable(),
  allowAdditionalSep: z.boolean(),
}).superRefine((s, ctx) => {
  if (s.paymentWindows.reduce((t, w) => t + w.maxShareBps, 0) < 10_000) {
    ctx.addIssue({ code: "custom", path: ["paymentWindows"], message: "The payment windows together must allow 100% of the remaining price." });
  }
});

/* ------------------------------------------------------------------ dated cash */

export const CashFlowSchema = z.object({
  id: IdSchema,
  date: DateSchema.refine(inHorizon, "Cash flows must fall between 2026-01-01 and 2028-10-16."),
  /** Signed: + money in, − money out. */
  amountCents: CentsSchema,
  kind: z.enum(["income", "expense", "tax_payment", "transfer", "other"]),
  status: z.enum(["confirmed", "expected"]),
  label: z.string().min(1).max(200),
  sourceId: IdSchema,
});

/**
 * A dated household cash snapshot plus known future flows. Project-only targets need none of it.
 * A household balance target is answered only when `completeness.confirmed` covers the target date.
 */
export const CashContextSchema = z.object({
  id: IdSchema,
  snapshot: z.object({ date: DateSchema.refine(inHorizon, "Snapshot date out of range."), balanceCents: CentsSchema, sourceId: IdSchema }).nullable(),
  /**
   * Stable ids of workspace facts ALREADY reflected in the snapshot balance (project line ids with
   * actuals, SEP contribution ids). Those are never added again; facts after the snapshot are.
   */
  includedFactIds: z.array(IdSchema).max(500),
  flows: z.array(CashFlowSchema).max(200),
  /** Money that must stay untouched (emergency reserve). */
  reserveCents: CentsSchema.nonnegative(),
  /** The user confirmed that every significant in/out flow between `from` and `through` is listed. */
  completeness: z.object({ confirmed: z.boolean(), from: DateSchema.nullable(), through: DateSchema.nullable() }),
}).superRefine((c, ctx) => {
  if (new Set(c.flows.map(f => f.id)).size !== c.flows.length) ctx.addIssue({ code: "custom", path: ["flows"], message: "Cash flow ids must be unique." });
  if (c.completeness.confirmed && (!c.completeness.from || !c.completeness.through || c.completeness.from > c.completeness.through || !c.snapshot)) {
    ctx.addIssue({ code: "custom", path: ["completeness"], message: "A complete cash context needs a snapshot and an ordered from/through interval." });
  }
});

/* ------------------------------------------------------------------ results (engine output, also stored in packages) */

const ConstraintIdSchema = z.enum(["minimum_cash", "date_target", "price_bounds", "payment_windows", "max_payments",
  "additional_sep_limit", "sep_legal_limit", "sep_cash", "timing_confirmation", "new_terms_confirmation", "fixed_facts"]);

export const TermsPaymentSchema = z.object({ id: IdSchema, date: DateSchema.refine(inPlanYears, "Payment dates must be in 2026 or 2027."), amountCents: CentsSchema.positive() });

export const DatedFlowSchema = z.object({
  date: DateSchema,
  amountCents: CentsSchema,
  kind: z.enum(["project_receipt", "project_expense", "sep_contribution", "tax_reserve", "tax_settlement", "household_flow"]),
  /** fixed = already happened (actual); proposed = from these terms; estimated = model estimate (e.g. settlement). */
  basis: z.enum(["fixed", "proposed", "estimated"]),
  label: z.string().max(200),
});

export const DealVariantSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(200),
  /** Why this variant is shown (distinct trade-offs, not renamed duplicates). */
  purpose: z.enum(["simplest", "most_cash", "earliest_money", "most_retirement", "lowest_risk", "as_offered"]),
  terms: z.object({
    /**
     * TOTAL price asked for the project, including amounts already received.
     * Invariant (checked by the engine and exports): Σ payments = priceCents − already received.
     */
    priceCents: CentsSchema.nonnegative(),
    /** Only NOT-yet-received payments; already received amounts are fixed and listed in datedFlows. */
    payments: z.array(TermsPaymentSchema).max(4),
    additionalSep: z.object({ year: TaxYearSchema, personId: IdSchema, amountCents: CentsSchema.positive() }).nullable(),
  }),
  /** vs the result's baseline, after final settlement of both years; excludes retirement dollars. */
  twoYearCashDeltaCents: CentsSchema,
  retirementAddedCents: CentsSchema.nonnegative(),
  datedFlows: z.array(DatedFlowSchema).max(100),
  dateTargets: z.array(z.object({ targetId: IdSchema, achievedCents: CentsSchema.nullable(), met: z.boolean().nullable(), explanation: z.string().max(400) })).max(3),
  aca: z.array(z.object({ year: TaxYearSchema, magiCents: CentsSchema, ptcCents: CentsSchema.nonnegative(), creditLost: z.boolean() })).max(2),
  constraints: z.array(z.object({ id: ConstraintIdSchema, satisfied: z.boolean(), detail: z.string().max(400) })).max(20),
  /** New executable steps only (nothing already done). dueDate null → dueCondition explains when. */
  actions: z.array(z.object({ id: IdSchema, title: z.string().min(1).max(300), dueDate: DateSchema.nullable(), dueCondition: z.string().max(300).nullable(),
    kind: z.enum(["send_terms", "invoice", "receive_payment", "sep_contribution", "marketplace_update", "tax_payment", "review"]), sourceIds: z.array(IdSchema).max(10) })).max(15),
  /** Cash difference to the best variant shown (0 for the best); documents the "simpler, nearly equal" choice. */
  differenceFromBestCents: CentsSchema,
  /** The variant was re-checked with the existing exact year calculation. */
  verifiedExact: z.boolean(),
});

export interface DealSearchMeta {
  goalId: string;
  projectId: string;
  /** engineWorkspaceFingerprint / workspaceFingerprint of the workspace searched. */
  workspaceFingerprint: string;
  /** dealSearchFingerprint(ws, goal, space, cash, engine, rules) — stale check for packages/exports. */
  searchFingerprint: string;
  engineVersion: string;
  rulesVersion: string;
  baseline: { kind: z.infer<typeof DealGoalSchema>["baseline"]; label: string; description: string };
  horizon: { from: string; through: string; settlementThrough: string };
  /** What was searched and how finely — approximate search is never presented as a global optimum. */
  search: { priceStepCents: number; paymentDateCandidates: number; sepStepCents: number | null; evaluated: number; exhaustiveWithinSpace: boolean; note: string };
  cashCompleteness: "project_only" | "household_complete" | "household_incomplete";
  /** Materiality used to prefer a simpler, nearly equal variant (documented, never changes amounts). */
  simplerVariantThresholdCents: number;
  warnings: string[];
}

export type DealVariant = z.infer<typeof DealVariantSchema>;
export interface ReadyDealSearch extends DealSearchMeta { status: "ready"; variants: DealVariant[]; recommendedVariantId: string | null }
export interface NoFeasibleTerms extends DealSearchMeta {
  status: "no_feasible_terms";
  /** Constraints that could not all be met inside the searched space. */
  violated: Array<{ id: z.infer<typeof ConstraintIdSchema>; detail: string }>;
  /** Computed minimal relaxation of exactly ONE constraint, when one exists. */
  relaxations: Array<{ constraint: "price_max" | "latest_payment_date" | "additional_sep" | "minimum_cash" | "date_target";
    requiredCents: number | null; requiredDate: string | null; explanation: string }>;
}
/** needs_data / unsupported / unavailable keep the v1 BlockedComparison shape (incomplete data ≠ no solution). */
export type DealSearchResult = ReadyDealSearch | NoFeasibleTerms | BlockedComparison;

export interface SensitivityItem {
  id: string;
  factKind: "household_income" | "project_expense" | "payment_date" | "premium" | "unconfirmed_fact" | "sep_cash";
  /** Workspace contract path of the fact (e.g. forecasts[0].remainingReceipts). */
  path: string;
  description: string;
  currentCents: number | null;
  /** Value at which the outcome changes (null when only a qualitative condition is known). */
  thresholdCents: number | null;
  direction: "increase" | "decrease" | null;
  outcomeChange: string;
  /** exact_threshold = solved boundary; interval_checked = verified across an interval; condition = depends on an unconfirmed fact. */
  checked: "exact_threshold" | "interval_checked" | "condition";
}
export interface ReadyDecisionSensitivity { status: "ready"; variantId: string; searchFingerprint: string; items: SensitivityItem[]; firstChange: string | null }
export type DecisionSensitivityResult = ReadyDecisionSensitivity | BlockedComparison;

/** Entry points Claude 2 implements in src/lib/engine (pure, deterministic). */
export interface DealPlanningEngine {
  searchDealTerms(ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): Promise<DealSearchResult>;
  evaluateDecisionSensitivity(ws: HouseholdWorkspace, goal: DealGoal, variant: DealVariant, searchFingerprint: string): Promise<DecisionSensitivityResult>;
}

/* ------------------------------------------------------------------ action package (stored) */

export const ReminderSchema = z.object({
  /** Stable calendar UID (same action → same UID across exports). */
  uid: z.string().min(1).max(200),
  actionId: IdSchema,
  title: z.string().min(1).max(300),
  date: DateSchema.nullable(),
  /** When no date is known: the condition (e.g. "When the client confirms the new dates"). */
  condition: z.string().max(300).nullable(),
  /** Incremented when the action's date/title changes (iCalendar SEQUENCE). */
  sequence: z.number().int().nonnegative(),
  status: z.enum(["open", "done", "cancelled"]),
  sourceIds: z.array(IdSchema).max(10),
});

export const ActionPackageSchema = z.object({
  id: IdSchema,
  createdAt: DateTimeSchema,
  /** Revision the package was built from (informational: saving the package itself creates a new revision; staleness uses the fingerprint). */
  workspaceRevision: z.number().int().nonnegative(),
  searchFingerprint: z.string().min(1).max(200),
  engineVersion: z.string().max(100),
  rulesVersion: z.string().max(100),
  goalId: IdSchema,
  projectId: IdSchema,
  /** Snapshot of the chosen variant exactly as calculated. */
  variant: DealVariantSchema,
  /** Message draft for the client. The app never sends it; choosing terms is not the client's agreement. */
  clientDraft: z.object({ subject: z.string().max(200), body: z.string().max(5000), includesHouseholdDetails: z.boolean(), generatedAt: DateTimeSchema }).nullable(),
  reminders: z.array(ReminderSchema).max(30),
  specialistNote: z.string().max(5000).nullable(),
  /** Only the user moves this forward; "client_agreed" requires the user's explicit confirmation. */
  status: z.enum(["draft", "terms_shared_by_user", "client_agreed", "superseded"]),
});

export const DealPlanningStateSchema = z.object({
  version: z.literal(DEAL_PLANNING_VERSION),
  goals: z.array(DealGoalSchema).max(20),
  termSpaces: z.array(DealTermsSpaceSchema).max(20),
  cashContext: CashContextSchema.nullable(),
  packages: z.array(ActionPackageSchema).max(30),
  /** Round 5 (additive): historical decision records (see assistance.ts). */
  decisionRecords: z.array(DecisionRecordSchema).max(30).optional(),
  /** Round 5 (additive): calendar events already exported, so later exports can update or cancel them. */
  calendar: z.object({ issued: z.array(IssuedCalendarEventSchema).max(300) }).optional(),
}).superRefine((s, ctx) => {
  const unique = (ids: string[], path: string, what: string) => { if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [path], message: `${what} must be unique.` }); };
  unique(s.goals.map(g => g.id), "goals", "Goal ids");
  unique(s.termSpaces.map(t => t.projectId), "termSpaces", "Term spaces per project");
  unique(s.packages.map(p => p.id), "packages", "Package ids");
  unique(s.packages.flatMap(p => p.reminders.map(r => `${p.id}:${r.uid}`)), "packages", "Reminder UIDs within a package");
  unique((s.decisionRecords ?? []).map(r => r.id), "decisionRecords", "Decision record ids");
  unique((s.calendar?.issued ?? []).map(e => e.uid), "calendar", "Issued calendar UIDs");
});

export type DateTarget = z.infer<typeof DateTargetSchema>;
export type DealGoal = z.infer<typeof DealGoalSchema>;
export type PaymentWindow = z.infer<typeof PaymentWindowSchema>;
export type DealTermsSpace = z.infer<typeof DealTermsSpaceSchema>;
export type CashFlow = z.infer<typeof CashFlowSchema>;
export type CashContext = z.infer<typeof CashContextSchema>;
export type DatedFlow = z.infer<typeof DatedFlowSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type ActionPackage = z.infer<typeof ActionPackageSchema>;
export type DealPlanningState = z.infer<typeof DealPlanningStateSchema>;
export type { TaxYear };

/* ------------------------------------------------------------------ helpers (no money math) */

export const emptyDealPlanning = (): DealPlanningState => ({ version: DEAL_PLANNING_VERSION, goals: [], termSpaces: [], cashContext: null, packages: [] });

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/**
 * Reference search fingerprint: SHA-256 of key-sorted {workspace fingerprint, goal (without
 * timestamps), terms space, cash context (flows sorted by id, inclusions sorted), versions}.
 * Any change to the facts, goal, allowed terms or cash context makes stored results stale.
 */
export async function dealSearchFingerprint(workspaceFp: string, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null,
  engineVersion: string, rulesVersion: string): Promise<string> {
  const g = { ...goal, createdAt: undefined, updatedAt: undefined, dateTargets: [...goal.dateTargets].sort((a, b) => a.id.localeCompare(b.id)) };
  const c = cash && { ...cash, flows: [...cash.flows].sort((a, b) => a.id.localeCompare(b.id)), includedFactIds: [...cash.includedFactIds].sort() };
  const s = { ...space, paymentWindows: [...space.paymentWindows].sort((a, b) => a.id.localeCompare(b.id)) };
  const text = JSON.stringify(sortKeys({ workspaceFp, goal: g, space: s, cash: c, engineVersion, rulesVersion }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Which kind of cash answer a goal can get with this context (no promise about the whole household without completeness). */
export function cashCompletenessFor(goal: DealGoal, cash: CashContext | null): DealSearchMeta["cashCompleteness"] {
  const balanceTargets = goal.dateTargets.filter(t => t.kind === "household_balance");
  if (!balanceTargets.length) return "project_only";
  const ok = cash?.completeness.confirmed && cash.snapshot && balanceTargets.every(t =>
    cash.completeness.from! <= cash.snapshot!.date && t.byDate <= cash.completeness.through!);
  return ok ? "household_complete" : "household_incomplete";
}

/**
 * A package is current only while a fresh search over the same facts, goal, terms space and cash
 * context gives the same fingerprint (workspace history/timestamps don't matter).
 */
export function isPackageCurrent(pkg: ActionPackage, freshSearchFingerprint: string): boolean {
  return pkg.searchFingerprint === freshSearchFingerprint && pkg.status !== "superseded";
}
