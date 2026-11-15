/**
 * Round 6 contract — first-offer intake, typed answers and the incomplete onboarding draft.
 * ADDITIVE: nothing here changes v1 plans, v2 workspaces or round 4/5 data.
 *
 * Flow: ordinary pasted email / document text → IntakeResult (offers AS WRITTEN + typed questions +
 * unsupported parts) → OnboardingDraft kept in the browser across reloads (before a valid
 * HouseholdWorkspace exists) → TypedAnswer per question, bound to the same draft/offer/payment →
 * explicit confirmed conversion (`onboardingToWorkspace`, Claude 3) that creates the project through
 * the shared `add_offered_project` command, capturing the original offer.
 *
 * Values are copied as written; Headroom's code parses cents/dates. Never: inferred costs as 0, an
 * invented tax year, a quoted invoice treated as paid, two projects merged by amount.
 * Money: integer USD cents. Dates: YYYY-MM-DD. Unknown is null, never 0.
 * Ownership: schema/API/persistence — Claude 3; readiness meaning — Claude 2; UI — Claude 1.
 */
import { z } from "zod";
import { CentsSchema, TaxYearSchema } from "./contracts";
import { ExtractedFactSchema } from "./assistance";

export const INTAKE_VERSION = "1.0" as const;
export const ONBOARDING_DRAFT_VERSION = "1.0" as const;

const IdSchema = z.string().min(1).max(120);
const DateSchema = z.string().date();
const DateTimeSchema = z.string().datetime({ offset: true });
const Excerpt = z.string().max(300);

/* ------------------------------------------------------------------ request */

export const INTAKE_PURPOSES = ["first_offer", "counteroffer"] as const;

/**
 * POST /api/assist/intake. `projectId` only for a counteroffer: then that ONE project's title and
 * open payments are the only plan context sent to a provider (never other projects or income).
 */
export const IntakeRequestSchema = z.object({
  purpose: z.enum(INTAKE_PURPOSES),
  text: z.string().min(1).max(8_000),
  userDate: DateSchema,
  timeZone: z.string().min(1).max(64),
  consentToProvider: z.boolean(),
  /** Counteroffer only: the project it answers and its open payments (ids/amounts/dates). */
  project: z.object({
    projectId: IdSchema, title: z.string().max(200),
    openPayments: z.array(z.object({ lineId: IdSchema, amountCents: CentsSchema.nonnegative(), date: DateSchema })).max(10),
  }).nullable(),
});

/* ------------------------------------------------------------------ result */

/** A money figure as written (amount parsed by code; null if the text has no usable amount). */
export const WrittenMoneySchema = z.object({ amountCents: CentsSchema.nonnegative().nullable(), asWritten: z.string().max(80), excerpt: Excerpt });

export const ProposedPaymentSchema = z.object({
  id: IdSchema,
  amountCents: CentsSchema.positive().nullable(),
  amountAsWritten: z.string().max(80).nullable(),
  /** Parsed date (null = not stated or not resolvable, e.g. "on delivery"). */
  date: DateSchema.nullable(),
  dateAsWritten: z.string().max(80).nullable(),
  /** Condition instead of / in addition to a date ("on delivery", "net 30"). */
  condition: z.string().max(200).nullable(),
  /** expected = still to be paid; said_received = the text says it was paid (needs the user's confirmation); unknown. A quoted invoice is "expected". */
  status: z.enum(["expected", "said_received", "unknown"]),
  excerpt: Excerpt,
});

export const ProposedOfferSchema = z.object({
  id: IdSchema,
  title: z.string().max(200).nullable(),
  /** "USD" when written in dollars; "other" stops the calculation (unsupported). */
  currency: z.enum(["USD", "other"]).nullable(),
  /** Total price as written, including any deposit. */
  totalPrice: WrittenMoneySchema.nullable(),
  payments: z.array(ProposedPaymentSchema).max(8),
  /** Costs only when the text states them; `costsStated: false` means unknown, NOT zero. */
  costs: z.array(z.object({ id: IdSchema, amountCents: CentsSchema.positive(), asWritten: z.string().max(80), date: DateSchema.nullable(), excerpt: Excerpt })).max(6),
  costsStated: z.boolean(),
  /** A tax year only when the text states one; never inferred from dates. */
  taxYearStated: z.number().int().min(2020).max(2030).nullable(),
  negotiable: z.object({ price: z.boolean().nullable(), schedule: z.boolean().nullable() }),
});

export const UNRESOLVED_KINDS = ["date", "amount", "person", "project", "tax_year", "months", "choice"] as const;

/** A typed question bound to the exact draft item it resolves. */
export const UnresolvedFieldSchema = z.object({
  id: IdSchema,
  kind: z.enum(UNRESOLVED_KINDS),
  /** What it resolves: an offer, one of its payments/costs, or an extracted document fact. */
  subject: z.object({ kind: z.enum(["offer", "payment", "cost", "fact"]), ref: IdSchema, field: z.string().max(60) }),
  question: z.string().max(300),
  reason: z.string().max(300),
  options: z.array(z.object({ value: z.string().max(120), label: z.string().max(200) })).max(12),
  /** Blocking = the selected decision can't be calculated without it; otherwise it only refines. */
  blocking: z.boolean(),
  source: z.object({ draftKind: z.enum(["intake", "import", "proposal"]), draftId: IdSchema, excerpt: Excerpt.nullable() }),
});

/** Answers are typed values — never text appended to the message and re-parsed. */
export const TypedAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), fieldId: IdSchema, date: DateSchema }),
  z.object({ kind: z.literal("amount"), fieldId: IdSchema, amountCents: CentsSchema.nonnegative() }),
  z.object({ kind: z.literal("person"), fieldId: IdSchema, personId: IdSchema }),
  z.object({ kind: z.literal("project"), fieldId: IdSchema, projectId: IdSchema, lineId: IdSchema.nullable() }),
  z.object({ kind: z.literal("tax_year"), fieldId: IdSchema, taxYear: TaxYearSchema }),
  z.object({ kind: z.literal("months"), fieldId: IdSchema, months: z.array(z.number().int().min(1).max(12)).min(1).max(12) }),
  z.object({ kind: z.literal("choice"), fieldId: IdSchema, value: z.string().max(120) }),
  /** The user does not know: the item stays unknown and the result states the limitation. */
  z.object({ kind: z.literal("unknown"), fieldId: IdSchema }),
]);

/** Why a provider was or wasn't used — lets the UI tell an outage from unsupported input. */
export const PROVIDER_STATUSES = ["used", "not_consented", "disabled", "quota", "timeout", "refused", "invalid_output", "unavailable"] as const;

export interface IntakeResult {
  intakeVersion: typeof INTAKE_VERSION;
  draftId: string;
  /** proposed = at least one offer; nothing_found = no offer terms in the text; unsupported_input = e.g. another currency / not an offer. */
  outcome: "proposed" | "nothing_found" | "unsupported_input";
  /** Distinct projects stay distinct (≤ 3); never merged by amount. */
  offers: Array<z.infer<typeof ProposedOfferSchema>>;
  questions: Array<z.infer<typeof UnresolvedFieldSchema>>;
  /** Parts of the text Headroom did not use, with the reason (e.g. "hourly rate", "another currency"). */
  unsupported: Array<{ excerpt: string; reason: string }>;
  provenance: "ai_model" | "pattern";
  providerStatus: (typeof PROVIDER_STATUSES)[number];
  notes: string[];
}

/* ------------------------------------------------------------------ onboarding draft (browser, before a workspace exists) */

/**
 * Saved in the browser (localStorage key `headroom.onboarding.v1`) on every change, so a reload keeps
 * the pasted text (only if the user keeps it), offers, document facts, questions and answers.
 * `profileDraft` is the existing /check household form draft (Claude 1), stored opaquely.
 */
export const OnboardingDraftSchema = z.object({
  draftVersion: z.literal(ONBOARDING_DRAFT_VERSION),
  id: IdSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  /** Kept locally only; null after the user clears it. Never sent to analytics/logs. */
  text: z.string().max(8_000).nullable(),
  intake: z.object({ provenance: z.enum(["ai_model", "pattern", "manual"]), providerStatus: z.enum(PROVIDER_STATUSES) }).nullable(),
  offers: z.array(ProposedOfferSchema).max(3),
  selectedOfferId: IdSchema.nullable(),
  /** Facts proposed from documents before the household exists (never confirmed facts until conversion). */
  facts: z.array(ExtractedFactSchema).max(200),
  questions: z.array(UnresolvedFieldSchema).max(40),
  answers: z.array(TypedAnswerSchema).max(40),
  profileDraft: z.unknown().nullable(),
  status: z.enum(["collecting", "converted"]),
  convertedWorkspaceId: IdSchema.nullable(),
});

/** Result of the explicit conversion (Claude 3: `onboardingToWorkspace`). */
export type OnboardingConversion =
  | { status: "converted"; workspaceId: string; projectId: string | null }
  | { status: "needs_answers"; questions: Array<z.infer<typeof UnresolvedFieldSchema>> }
  | { status: "invalid"; message: string; fields: Array<{ path: string; reason: string }> };

export type IntakeRequest = z.infer<typeof IntakeRequestSchema>;
export type ProposedOffer = z.infer<typeof ProposedOfferSchema>;
export type ProposedPayment = z.infer<typeof ProposedPaymentSchema>;
export type UnresolvedField = z.infer<typeof UnresolvedFieldSchema>;
export type TypedAnswer = z.infer<typeof TypedAnswerSchema>;
export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
