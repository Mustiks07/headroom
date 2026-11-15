/**
 * Round 6 contract — one document import pipeline for first use and saved households.
 *
 * extraction (ExtractedFact) → normalization + semantic check (Claude 2 `checkExtractedFacts`) →
 * target resolution (person / year / period / months / project, by the USER, never from the amount)
 * → conflict review → validate the WHOLE approved group → one atomic revision with one event.
 *
 * Two unidentified W-2s are unresolved targets, not one contradictory field. Same document hash is
 * never a new payment. Replacement documents keep the earlier evidence.
 * Ownership: schema/apply/persistence — Claude 3; meaning — Claude 2; review UI — Claude 1.
 */
import { z } from "zod";
import { CentsSchema, TaxYearSchema } from "./contracts";

const IdSchema = z.string().min(1).max(120);
const DateSchema = z.string().date();

export const FORECAST_FIELDS = ["annualNetProfit", "ytdNetProfit", "remainingReceipts", "remainingExpenses"] as const;
export const WAGE_FIELDS = ["grossWages", "w2Box1", "socialSecurityWages", "medicareWages", "payrollPretaxDeductions"] as const;
export const COVERAGE_FIELDS = ["enrollmentPremium", "benchmarkPremium", "advancePtc"] as const;

/** Where one confirmed fact goes. Every destination is explicit; nothing is guessed from the value. */
export const ImportTargetSchema = z.discriminatedUnion("kind", [
  /** Self-employment profit forecast (YTD needs an as-of date). */
  z.object({ kind: z.literal("forecast"), personId: IdSchema, year: TaxYearSchema, field: z.enum(FORECAST_FIELDS), status: z.enum(["confirmed", "estimated"]), asOfDate: DateSchema.nullable() }),
  /** W-2 / pay stub figures of one person for one year (annual values only). */
  z.object({ kind: z.literal("wages"), personId: IdSchema, year: TaxYearSchema, field: z.enum(WAGE_FIELDS) }),
  /** Interest: taxable and tax-exempt are different destinations. */
  z.object({ kind: z.literal("interest"), personId: IdSchema, year: TaxYearSchema, taxExempt: z.boolean() }),
  /** A monthly coverage amount applied ONLY to the months the user selected. */
  z.object({ kind: z.literal("coverage"), year: TaxYearSchema, field: z.enum(COVERAGE_FIELDS), months: z.array(z.number().int().min(1).max(12)).min(1).max(12) }),
  /** A received payment on a known project line (actual replaces expected). */
  z.object({ kind: z.literal("payment"), projectId: IdSchema, lineId: IdSchema, mode: z.enum(["actual", "correct"]), date: DateSchema, reason: z.string().max(300).nullable() }),
  /** A received payment that is only PART of the expected amount: the remainder stays expected on `remainderDate`. */
  z.object({ kind: z.literal("partial_payment"), projectId: IdSchema, lineId: IdSchema, date: DateSchema, remainderDate: DateSchema }),
  /** A SEP-IRA contribution actually made (explicit person and tax year). */
  z.object({ kind: z.literal("sep"), personId: IdSchema, taxYear: TaxYearSchema, paidDate: DateSchema }),
  /** A new client offer from the document (becomes a proposed project through `add_offered_project`). */
  z.object({ kind: z.literal("new_offer"), title: z.string().min(1).max(200), ownerPersonId: IdSchema, paymentDate: DateSchema }),
  /** Kept as evidence only (prior-year return, bank deposit, reference figure). */
  z.object({ kind: z.literal("reference_only") }),
]);

/** One reviewed fact in an approved group. */
export const ImportDecisionSchema = z.object({
  factId: IdSchema,
  target: ImportTargetSchema,
  /** Required when the fact is in conflict: the fact ids this choice replaces (kept as evidence). */
  resolvesConflictWith: z.array(IdSchema).max(10),
  /** When the user corrected the extracted value during review. */
  correctedAmountCents: CentsSchema.nonnegative().nullable(),
  /** Explicit review answers, never inferred from a document's silence. Additive for existing clients. */
  reviewConfirmations: z.object({
    noAdditionalProjectCosts: z.boolean().optional(),
    singleExpectedPayment: z.boolean().optional(),
    excludesManagedProjects: z.boolean().optional(),
  }).optional(),
});

/** POST-free client call `applyImportGroup(repo, ws, draft, decisions, {userDate})`. */
export type ImportApplyResult =
  | { status: "applied"; revision: number; eventId: string; applied: number; referenceOnly: number }
  | { status: "nothing_new"; reason: string }
  /** Nothing saved: one invalid member blocks the whole group. */
  | { status: "rejected"; issues: Array<{ factId: string; code: string; message: string }> }
  /** The plan changed since review (another tab/device): re-review on the current revision. */
  | { status: "stale"; currentRevision: number };

export type ImportTarget = z.infer<typeof ImportTargetSchema>;
export type ImportDecision = z.infer<typeof ImportDecisionSchema>;
