/**
 * Decision context — round 5 additive contract (follow-up to 97b608c). Optional fields only:
 * v1 plans, v2 workspaces, round 4 packages and round 5 records without them stay valid.
 *
 * - OriginalOffer: the client's offer as first entered. Agreed terms, chosen variants and the
 *   highest price searched NEVER overwrite it, so "versus the original offer" stays an honest
 *   counterfactual. Informational: excluded from workspace fingerprints.
 * - DecisionContext: what a chosen variant was compared with (baseline, horizon, the other calculated
 *   options with their engine comparisons, the recommendation and its reasons). Copied from the
 *   ready search into the action package and from the package into the historical record.
 *
 * Money: integer USD cents. Dates: YYYY-MM-DD. Unknown is null, never 0. Ownership: schema —
 * Claude 3; every figure — Claude 2's engine (copied, never recomputed here); UI — Claude 1.
 */
import { z } from "zod";
import { CentsSchema } from "./contracts";

const IdSchema = z.string().min(1).max(120);
const DateSchema = z.string().date();
const DateTimeSchema = z.string().datetime({ offset: true });

export const OriginalOfferSchema = z.object({
  /** Total price as offered (including any deposit). */
  priceCents: CentsSchema.nonnegative(),
  /** Payment schedule as offered; a date may be unknown. */
  payments: z.array(z.object({ amountCents: CentsSchema.positive(), date: DateSchema.nullable() })).max(10),
  /** Where the offer came from. existing_project = captured from the project lines at the first agreement (pre-round-5 data). */
  source: z.object({ kind: z.enum(["user_entered", "document", "assistant_text", "existing_project"]), sourceId: IdSchema.nullable() }),
  /** user_confirmed = the user confirmed this offer (form or confirmed proposal); captured = read from saved lines, not re-confirmed. */
  confirmation: z.enum(["user_confirmed", "captured"]),
  recordedAt: DateTimeSchema,
});

/**
 * Round 6 (additive): versions of a project's terms. The original offer stays immutable in
 * `Project.originalOffer`; every later state (client counteroffer, terms the user shared, accepted
 * terms) is appended here with a status. Informational history: excluded from fingerprints — the
 * project lines remain the financial truth.
 */
export const OfferVersionSchema = z.object({
  version: z.number().int().min(1),
  kind: z.enum(["original", "client_counteroffer", "terms_shared", "accepted_terms"]),
  recordedAt: DateTimeSchema,
  priceCents: CentsSchema.nonnegative(),
  payments: z.array(z.object({ amountCents: CentsSchema.positive(), date: DateSchema.nullable(), received: z.boolean() })).max(12),
  status: z.enum(["open", "accepted", "rejected", "superseded"]),
  source: z.object({ kind: z.enum(["user_entered", "document", "assistant_text", "package", "existing_project"]), sourceId: IdSchema.nullable() }),
  note: z.string().max(300).nullable(),
});

export const VariantComparisonsSchema = z.object({ versusDeclineCents: CentsSchema.nullable(), versusOfferedCents: CentsSchema.nullable() });
export const VariantRobustnessSchema = z.object({
  holds: z.boolean(), basis: z.enum(["declared_ranges", "room_policy"]), roomCents: CentsSchema.nullable(), worstCashInRangesCents: CentsSchema.nullable(),
});

export const DecisionContextSchema = z.object({
  baseline: z.object({ kind: z.enum(["decline_unpaid_terms", "accept_as_offered"]), label: z.string().max(200), description: z.string().max(600) }),
  horizon: z.object({ from: DateSchema, through: DateSchema, settlementThrough: DateSchema }),
  /** The calculated options shown with the chosen one (≤ 3), as the engine returned them. */
  alternatives: z.array(z.object({
    variantId: IdSchema,
    label: z.string().max(200),
    purpose: z.string().max(40),
    priceCents: CentsSchema.nonnegative(),
    twoYearCashDeltaCents: CentsSchema,
    comparisons: VariantComparisonsSchema.nullable(),
    holds: z.boolean().nullable(),
    chosen: z.boolean(),
    recommended: z.boolean(),
  })).max(3),
  recommendedVariantId: IdSchema.nullable(),
  /** Deterministic reasons (engine purpose + engine warnings); never model text. */
  recommendationReasons: z.array(z.string().max(400)).max(8),
  /** Copy of the project's original offer at decision time (null if not known). */
  originalOffer: OriginalOfferSchema.nullable(),
});

export type OriginalOffer = z.infer<typeof OriginalOfferSchema>;
export type DecisionContext = z.infer<typeof DecisionContextSchema>;
export type OfferVersion = z.infer<typeof OfferVersionSchema>;
