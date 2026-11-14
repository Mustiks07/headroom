/**
 * Deal-term search request/result (round 4).
 *
 * ENGINE-SIDE TYPES until Claude 3's shared `src/domain/deal-planning.ts` lands; the semantics follow
 * docs/tasks/ROUND4_SHARED.md so the shared schema can map 1:1 (see docs/handoffs/claude2-round4.md).
 * Money is integer USD cents; dates are ISO dates; unknown is null, never 0.
 */
import { z } from "zod";
import { CentsSchema, type BlockedComparison, type ScenarioKind, type ScenarioResult, type TaxYear } from "@/domain/contracts";

const IsoDate = z.string().date();
const Bps = z.number().int().min(0).max(10000);

/** A window in which the client may pay part of the remaining price. A window crossing January 1 is split into its two tax years. */
export const PaymentWindowSchema = z.object({
  id: z.string().min(1).max(100),
  earliestDate: IsoDate,
  latestDate: IsoDate,
  /** Share of the asked price paid in this window, basis points (10000 = 100%). */
  minShareBps: Bps.default(0),
  maxShareBps: Bps.default(10000),
}).refine(w => w.earliestDate <= w.latestDate && w.minShareBps <= w.maxShareBps, { message: "Window dates and shares must be ordered." });

/** Terms the household may propose for the NOT-yet-received part of the project. */
export const DealTermsSpaceSchema = z.object({
  /** Asked price for the remaining (unpaid) receipts; already received money is a fact and not re-priced. */
  minPriceCents: CentsSchema.nonnegative(),
  maxPriceCents: CentsSchema.nonnegative(),
  windows: z.array(PaymentWindowSchema).min(1).max(3),
  maxPayments: z.number().int().min(1).max(3),
  /** The client has said new price/schedule terms can be discussed. false → only the offered terms are evaluated. */
  newTermsConfirmed: z.boolean(),
}).refine(t => t.minPriceCents <= t.maxPriceCents, { message: "Minimum price must not exceed maximum price." });

export const DATE_TARGET_KINDS = ["project_receipts", "project_available_cash", "household_balance"] as const;
/**
 * project_receipts       — money received from this project by the date (gross, not profit);
 * project_available_cash — the project's receipts minus its expenses, SEP paid and the planning reserve for its
 *                          extra tax and lost subsidy, by the date;
 * household_balance      — the household's bank balance by the date; needs a complete CashContext.
 */
export const DateTargetSchema = z.object({ id: z.string().min(1).max(100), kind: z.enum(DATE_TARGET_KINDS), byDate: IsoDate, minCents: CentsSchema });

export const DealGoalSchema = z.object({
  projectId: z.string().min(1),
  /** Minimum change in spendable cash after both 2026 and 2027 returns settle, vs the plan without this project's unpaid terms. */
  minTwoYearCashDeltaCents: CentsSchema,
  /** Cap on ADDITIONAL SEP-IRA contributions (on top of agreed goals); also limited by cash set aside and the legal limit. */
  maxAdditionalSepCents: CentsSchema.nonnegative(),
  dateTargets: z.array(DateTargetSchema).max(3),
});

export const CashContextSchema = z.object({
  snapshot: z.object({ date: IsoDate, balanceCents: CentsSchema, sourceId: z.string(),
    /** Stable ids of project lines and SEP contributions already reflected in this balance. */
    includedFactIds: z.array(z.string()) }),
  /** Other money in/out after the snapshot that Headroom does not manage (rent, wages, other taxes …). Must NOT repeat project lines or SEP. */
  knownFlows: z.array(z.object({ id: z.string(), date: IsoDate, amountCents: CentsSchema, label: z.string().max(200), sourceId: z.string() })).max(200),
  protectedReserveCents: CentsSchema.nonnegative(),
  /** The user confirmed knownFlows list every material flow from the snapshot through this date. */
  completeThrough: IsoDate.nullable(),
});

export const DealSearchRequestSchema = z.object({
  goal: DealGoalSchema,
  terms: DealTermsSpaceSchema,
  cash: CashContextSchema.nullable(),
});

export type PaymentWindow = z.infer<typeof PaymentWindowSchema>;
export type DealTermsSpace = z.infer<typeof DealTermsSpaceSchema>;
export type DateTarget = z.infer<typeof DateTargetSchema>;
export type DealGoal = z.infer<typeof DealGoalSchema>;
export type CashContext = z.infer<typeof CashContextSchema>;
export type DealSearchRequest = z.input<typeof DealSearchRequestSchema>;

export interface DealTerms {
  /** Asked price for the remaining receipts. */
  priceCents: number;
  payments: Array<{ windowId: string; date: string; amountCents: number }>;
  /** Additional SEP-IRA contribution on top of agreed goals, by tax year. */
  additionalSep: Array<{ year: TaxYear; amountCents: number }>;
}

export interface DatedFlow { date: string; amountCents: number; label: string; kind: "project_receipt" | "project_expense" | "sep_contribution" | "tax_settlement" | "known_flow" | "snapshot" }

export interface DateTargetResult {
  targetId: string;
  kind: DateTarget["kind"];
  byDate: string;
  requiredCents: number;
  /** null when it cannot be evaluated (e.g. household balance without a complete cash context). */
  valueCents: number | null;
  met: boolean | null;
  explanation: string;
}

export interface ConstraintCheck { constraint: string; satisfied: boolean; detail: string }

export interface SensitivityItem {
  year: TaxYear;
  fact: string;
  kind: "credit_lost" | "goal_not_met";
  /** Additional amount of that fact at which the outcome changes; null when no change was found in the checked range. */
  thresholdCents: number | null;
  checked: string;
}
export interface DecisionSensitivity { items: SensitivityItem[]; uncertainty: ScenarioResult["stress"]; unconfirmedFacts: string[] }

export interface DealVariant {
  id: string;
  role: "simplest" | "most_cash" | "lowest_price" | "no_additional_sep" | "most_by_date" | "offered";
  label: string;
  kind: ScenarioKind;
  terms: DealTerms;
  twoYearCashDeltaCents: number;
  retirementCents: number;
  goalMet: boolean | null;
  dateTargets: DateTargetResult[];
  aca: Array<{ year: TaxYear; magiCents: number; ptcCents: number; creditKept: boolean }>;
  checks: ConstraintCheck[];
  /** Project-only dated flows (receipts, expenses, SEP, the project's settlement at each return due date). */
  flows: DatedFlow[];
  /** Exact v1 scenario re-calculated with the existing engine. */
  scenario: ScenarioResult;
  /** When a simpler variant is within the materiality threshold of this one. */
  marginalGainOverSimplestCents: number | null;
  clientTermsDraft: string;
  reminders: Array<{ date: string; title: string }>;
  sensitivity: DecisionSensitivity;
}

export interface Violation { constraint: string; requiredCents: number; bestAchievableCents: number | null; explanation: string }
export interface Relaxation { constraint: string; value: string; explanation: string }

export interface DealSearchSpaceReport {
  priceRange: [number, number];
  priceStepCents: number;
  splitStepCents: number;
  sepCandidates: string;
  windows: Array<{ id: string; year: TaxYear; date: string }>;
  evaluatedTermCombinations: number;
  exactRefinement: string;
  materialityCents: number;
  /** Additional SEP-IRA searched: min(your cap, cash set aside after agreed unpaid goals and payments since the snapshot). */
  additionalSepLimitCents: number;
}

export interface ReadyDealSearch {
  status: "ready" | "no_feasible_terms";
  engineVersion: string;
  rulesVersion: string;
  dealSearchVersion: string;
  /** SHA-256 of the workspace content + request + versions. */
  fingerprint: string;
  projectId: string;
  baseline: { label: string; description: string; horizon: string };
  variants: DealVariant[];
  /** The client's offered price and dates (no new terms), with the cheapest SEP choice: what it gives and which goals it misses. */
  offeredTerms: { twoYearCashDeltaCents: number; retirementCents: number; unmetGoals: string[] } | null;
  violations: Violation[];
  relaxations: Relaxation[];
  search: DealSearchSpaceReport;
  warnings: string[];
}
export type DealSearchResult = ReadyDealSearch | BlockedComparison;
