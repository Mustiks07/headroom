/**
 * Assistance contract v1.0 (round 5). ADDITIVE: no existing v1/v2/round-4 field changes.
 *
 * Documents/text → extracted facts (proposals, never facts until the user confirms) → input
 * readiness → typed change proposals → preview → confirmed atomic apply → explanation of a
 * verified result. A provider (LLM) may extract or propose; deterministic code validates; preview
 * changes nothing; only a confirmed command is saved, together with its event.
 *
 * Money: integer USD cents. Dates: YYYY-MM-DD. Unknown is null, never 0.
 * Ownership: schemas/transport/persistence — Claude 3; readiness, preview, explanation packets
 * (all financial meaning) — Claude 2; UI — Claude 1.
 */
import { z } from "zod";
import { CentsSchema, TaxYearSchema, type BlockedComparison } from "./contracts";
import type { HouseholdWorkspace } from "./household-workspace";
import { DecisionContextSchema } from "./decision-context";

export const ASSISTANCE_VERSION = "1.0" as const;

const IdSchema = z.string().min(1).max(120);
const DateSchema = z.string().date();
const DateTimeSchema = z.string().datetime({ offset: true });
const PlanDate = DateSchema.refine(d => d >= "2026-01-01" && d <= "2028-10-16", "Dates must fall between 2026-01-01 and 2028-10-16.");

/* ------------------------------------------------------------------ request */

export const ASSISTANCE_INTENTS = ["start", "offer", "update", "explain"] as const;

/**
 * Minimal context a provider may see: opaque ids, names/titles, statuses and the dated EXPECTED
 * payments needed to resolve "the remaining payment". No income, SEP, premiums or documents.
 */
export const AssistanceContextSchema = z.object({
  people: z.array(z.object({ id: IdSchema, role: z.enum(["primary", "spouse", "dependent"]) })).max(10),
  projects: z.array(z.object({
    id: IdSchema, title: z.string().max(200), status: z.enum(["proposed", "agreed", "cancelled"]),
    lines: z.array(z.object({ id: IdSchema, kind: z.enum(["receipt", "expense"]), label: z.string().max(200).nullable(),
      expectedAmountCents: CentsSchema.nullable(), expectedDate: DateSchema.nullable(), received: z.boolean(), cancelled: z.boolean() })).max(20),
  })).max(30),
  forecasts: z.array(z.object({ personId: IdSchema, year: TaxYearSchema, method: z.enum(["annual_total", "year_to_date_plus_remaining"]) })).max(20),
  goals: z.array(z.object({ id: IdSchema, projectId: IdSchema })).max(20),
});

export const AssistanceRequestSchema = z.object({
  intent: z.enum(ASSISTANCE_INTENTS),
  /** The user's own words (untrusted data; never executed as instructions). */
  text: z.string().min(1).max(4000),
  /** The user's calendar date and IANA time zone; relative dates resolve against these, not the server clock. */
  userDate: DateSchema,
  timeZone: z.string().min(1).max(60),
  base: z.object({ workspaceId: IdSchema, revision: z.number().int().nonnegative(), fingerprint: z.string().max(200) }).nullable(),
  context: AssistanceContextSchema,
});

/* ------------------------------------------------------------------ extracted facts */

export const DOCUMENT_KINDS = ["profit_and_loss", "pay_stub", "marketplace_statement", "client_offer", "invoice", "payment_confirmation",
  "sep_confirmation", "bank_statement", "prior_year_tax_return", "w2", "other", "unknown"] as const;

export const ExtractedValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amountCents: CentsSchema, period: z.enum(["annual", "year_to_date", "monthly", "one_time", "unknown"]) }),
  z.object({ kind: z.literal("date"), date: DateSchema }),
  z.object({ kind: z.literal("text"), text: z.string().max(300) }),
]);

/**
 * One figure read from a document or pasted text. A PROPOSAL until `review` is "confirmed".
 * Stable id = documentId + field + locator, so re-reading the same document gives the same ids.
 */
export const ExtractedFactSchema = z.object({
  id: IdSchema,
  documentId: z.string().min(1).max(64),
  documentKind: z.enum(DOCUMENT_KINDS),
  /** Whitelisted field (see EXTRACTION_FIELDS in src/lib/client/extraction-fields.ts). */
  field: z.string().min(1).max(80),
  value: ExtractedValueSchema,
  /** Exactly as printed; cents/dates are parsed deterministically from it. */
  valueAsPrinted: z.string().max(120),
  /** Person the figure seems to belong to; null = unknown (ask). Never guessed from a similar amount. */
  personCandidate: IdSchema.nullable(),
  taxYear: TaxYearSchema.nullable(),
  /** End of the period the figure covers (e.g. P&L "through" date, pay stub period end). */
  asOfDate: DateSchema.nullable(),
  source: z.object({ label: z.string().max(200), page: z.number().int().positive().nullable(), excerpt: z.string().max(200).nullable() }),
  provenance: z.enum(["deterministic_text", "ai_model", "user_entered"]),
  /** extracted → shown for review; confirmed → user accepted (then applied as a workspace fact). */
  review: z.enum(["extracted", "confirmed", "rejected", "conflict"]),
  /** Ids of other facts with the same field/period/target but a different value. */
  conflictsWith: z.array(IdSchema).max(10),
});

/** Several documents/texts accumulate into one review draft (held by the client until applied). */
export const ImportDraftSchema = z.object({
  id: IdSchema,
  documents: z.array(z.object({ documentId: z.string().max(64), kind: z.enum(DOCUMENT_KINDS), label: z.string().max(200), addedAt: DateTimeSchema,
    provenance: z.enum(["deterministic_text", "ai_model", "user_entered"]) })).max(20),
  facts: z.array(ExtractedFactSchema).max(300),
});

/* ------------------------------------------------------------------ readiness (implemented by Claude 2) */

export type ReadinessIntent = "current_year_subsidy" | "new_offer" | "two_year_terms" | "agreed_plan_review";

export interface ReadinessQuestion {
  id: string;
  /** Workspace contract path the answer fills (machine use; not shown as primary text). */
  path: string;
  question: string;
  reason: string;
  answer: { kind: "money" | "date" | "choice" | "boolean" | "person" | "year"; choices?: Array<{ id: string; label: string }> };
  /** "I don't know yet" is allowed; it stays unknown (never 0). */
  allowUnknown: boolean;
  sourceRef: string | null;
}

export interface InputReadiness {
  status: "ready" | "needs_data" | "unsupported";
  intent: ReadinessIntent;
  /** Short, prioritised question set (UI shows 1–3 at a time). */
  questions: ReadinessQuestion[];
  unsupported: Array<{ code: string; reason: string }>;
}

/* ------------------------------------------------------------------ change commands (whitelist) */

const PaymentSchema = z.object({ amountCents: CentsSchema.positive(), date: PlanDate });

/** The ONLY operations a proposal may contain. No patches, SQL, URLs, code or outbound actions. */
export const ChangeCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_offered_project"), title: z.string().min(1).max(200), ownerPersonId: IdSchema.nullable(),
    /** Total price incl. any deposit already received. */
    totalPriceCents: CentsSchema.positive().nullable(),
    received: z.array(PaymentSchema).max(4), unpaid: z.array(PaymentSchema).max(6), expenses: z.array(PaymentSchema).max(6),
    priceNegotiable: z.boolean().nullable(), scheduleNegotiable: z.boolean().nullable() }),
  z.object({ type: z.literal("update_expected_payment"), projectId: IdSchema, lineId: IdSchema,
    newAmountCents: CentsSchema.positive().nullable(), newDate: PlanDate.nullable() }),
  z.object({ type: z.literal("record_receipt"), projectId: IdSchema, lineId: IdSchema, amountCents: CentsSchema.positive(), date: PlanDate }),
  z.object({ type: z.literal("correct_fact"), target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("payment"), projectId: IdSchema, lineId: IdSchema }),
    z.object({ kind: z.literal("forecast"), personId: IdSchema, year: TaxYearSchema, field: z.enum(["annualNetProfit", "ytdNetProfit", "remainingReceipts", "remainingExpenses"]) }),
  ]), amountCents: CentsSchema.nonnegative(), date: PlanDate.nullable(), reason: z.string().min(1).max(300) }),
  z.object({ type: z.literal("record_sep_contribution"), personId: IdSchema, taxYear: TaxYearSchema, amountCents: CentsSchema.positive(), paidDate: PlanDate }),
  z.object({ type: z.literal("update_forecast"), personId: IdSchema, year: TaxYearSchema,
    field: z.enum(["annualNetProfit", "ytdNetProfit", "remainingReceipts", "remainingExpenses"]),
    amountCents: CentsSchema.nonnegative(), status: z.enum(["confirmed", "estimated"]), asOfDate: DateSchema.nullable() }),
  z.object({ type: z.literal("change_goal"), projectId: IdSchema, minimumTwoYearCashDeltaCents: CentsSchema.nullable(),
    maxAdditionalSepCents: CentsSchema.nonnegative().nullable(), dateTarget: z.object({ byDate: PlanDate, minimumCents: CentsSchema.nonnegative(),
      kind: z.enum(["project_receipts", "project_available_cash", "household_balance"]) }).nullable() }),
  z.object({ type: z.literal("change_terms"), projectId: IdSchema, priceMinCents: CentsSchema.nonnegative().nullable(), priceMaxCents: CentsSchema.nonnegative().nullable(),
    latestPaymentDate: PlanDate.nullable(), maxPayments: z.number().int().min(1).max(4).nullable(), newTermsConfirmed: z.boolean().nullable() }),
  /* Round 6 (additive): payment and negotiation lifecycle. */
  /** Part of an expected payment arrived: the received part is recorded on the line, the remainder stays expected on `remainderDate`. */
  z.object({ type: z.literal("record_partial_receipt"), projectId: IdSchema, lineId: IdSchema, amountCents: CentsSchema.positive(), date: PlanDate, remainderDate: PlanDate }),
  /** The client paid LESS and the project is settled: an explicit choice, never inferred from a smaller receipt. */
  z.object({ type: z.literal("settle_lower_total"), projectId: IdSchema, lineId: IdSchema, amountCents: CentsSchema.positive(), date: PlanDate, reason: z.string().min(1).max(300) }),
  /**
   * The client's answer. accepted → project agreed; rejected → unpaid expected payments cancelled, received money kept;
   * countered → a new offer version replaces the UNPAID terms (received money kept, original offer unchanged).
   */
  z.object({ type: z.literal("record_client_response"), projectId: IdSchema, response: z.enum(["accepted", "rejected", "countered"]), respondedOn: PlanDate,
    packageId: IdSchema.nullable(),
    counter: z.object({ totalPriceCents: CentsSchema.positive().nullable(), unpaid: z.array(PaymentSchema).min(1).max(6), note: z.string().max(300).nullable() }).nullable() }),
]);

export const ChangeProposalSchema = z.object({
  id: IdSchema,
  createdAt: DateTimeSchema,
  /** The workspace state the proposal was made against; confirmation requires the same revision/fingerprint. */
  base: z.object({ workspaceId: IdSchema, revision: z.number().int().nonnegative(), fingerprint: z.string().max(200) }),
  intent: z.enum(ASSISTANCE_INTENTS),
  commands: z.array(ChangeCommandSchema).max(5),
  /** Open questions (several matching payments, unknown person/year/date). Must be resolved before confirm. */
  ambiguities: z.array(z.object({ id: IdSchema, question: z.string().max(300), options: z.array(z.object({ id: IdSchema, label: z.string().max(200) })).max(10) })).max(5),
  /** Relative phrases resolved against the user's date/time zone, shown on confirmation. */
  resolvedDates: z.array(z.object({ phrase: z.string().max(80), date: DateSchema })).max(5),
  evidence: z.array(z.object({ documentId: z.string().max(64).nullable(), excerpt: z.string().max(200) })).max(5),
  provenance: z.enum(["pattern", "ai_model", "manual"]),
  status: z.enum(["proposed", "confirmed", "applied", "rejected", "stale"]),
});

/* ------------------------------------------------------------------ preview (implemented by Claude 2) */

export interface ChangePreviewSummary {
  /** Labelled, verified figures from the current engine (cents); null = not computable with current data. */
  currentYearSubsidyCents: number | null;
  currentYearSettlementCents: number | null;
  agreedTermsStillMeetGoal: boolean | null;
  cashDeltaCents: number | null;
  baselineLabel: string | null;
}
export interface ChangePreview {
  status: "ready" | "needs_data" | "unsupported";
  proposalId: string;
  changes: Array<{ commandIndex: number; path: string; label: string; before: string | null; after: string }>;
  before: ChangePreviewSummary | null;
  after: ChangePreviewSummary | null;
  /** Saved packages/actions/goals that this change makes stale. */
  staleDependencies: Array<{ kind: "package" | "action" | "goal"; id: string; reason: string }>;
  blockers: Array<{ path: string; reason: string }>;
}

/* ------------------------------------------------------------------ explanation */

/** Built by Claude 2 from a verified result: every allowed number/date has a reference. */
export interface ExplanationPacket {
  id: string;
  subject: string;
  /** Fingerprint of the result the packet explains. */
  fingerprint: string;
  facts: Array<{ ref: string; label: string; kind: "money" | "date" | "text" | "percent"; valueCents?: number; date?: string; text?: string; percent?: number }>;
  /** Deterministic sentences with {ref} placeholders (the default explanation). */
  statements: string[];
  limitations: string[];
}
export const ExplanationSchema = z.object({
  packetId: IdSchema,
  text: z.string().max(4000),
  references: z.array(z.string().max(120)).max(60),
  source: z.enum(["deterministic", "ai_model"]),
  unanswered: z.array(z.string().max(300)).max(10),
});

/* ------------------------------------------------------------------ decision lifecycle (stored in dealPlanning) */

/**
 * Historical record created when the user records the client's agreement (or that terms were
 * shared). Keeps the decision's own snapshot and figures; later facts never rewrite it, and its
 * fingerprint is never replaced by a new one.
 */
export const DecisionRecordSchema = z.object({
  id: IdSchema,
  packageId: IdSchema,
  projectId: IdSchema,
  status: z.enum(["terms_shared_by_user", "client_agreed"]),
  recordedAt: DateTimeSchema,
  /** Revision of the workspace the decision was calculated on (before the agreement edit). */
  workspaceRevision: z.number().int().nonnegative(),
  searchFingerprint: z.string().max(200),
  engineVersion: z.string().max(100),
  rulesVersion: z.string().max(100),
  /** Workspace at decision time WITHOUT dealPlanning (validated with HouseholdWorkspaceSchema on use). */
  workspaceSnapshot: z.record(z.string(), z.unknown()),
  goal: z.record(z.string(), z.unknown()),
  termSpace: z.record(z.string(), z.unknown()),
  cashContext: z.record(z.string(), z.unknown()).nullable(),
  /** The chosen DealVariant exactly as calculated then. */
  variant: z.record(z.string(), z.unknown()),
  /** Round 5 (additive): what the choice was compared with and why it was recommended (copied from the package). */
  decisionContext: DecisionContextSchema.optional(),
});

/** Calendar events already handed to the user, so a later export can UPDATE or CANCEL them. */
export const IssuedCalendarEventSchema = z.object({
  uid: z.string().min(1).max(200), sequence: z.number().int().nonnegative(), date: DateSchema, title: z.string().max(300),
  status: z.enum(["active", "cancelled"]), issuedAt: DateTimeSchema,
});

/* ------------------------------------------------------------------ API */

/** Error codes returned as { error: { code, message, fields? } }. */
export const ASSIST_ERROR_CODES = ["INVALID_REQUEST", "PAYLOAD_TOO_LARGE", "AI_UNAVAILABLE", "AI_QUOTA_REACHED", "AI_BUDGET_REACHED",
  "SESSION_REQUIRED", "PROVIDER_TIMEOUT", "PROVIDER_REFUSED", "PROVIDER_INVALID_OUTPUT", "CROSS_ORIGIN", "STALE_RESULT", "PROPOSAL_STALE"] as const;

/** POST /api/assist/propose body / response. */
export const ProposeBodySchema = z.object({ request: AssistanceRequestSchema, consentToProvider: z.boolean() });
export interface ProposeResponse { proposal: z.infer<typeof ChangeProposalSchema>; providerUsed: boolean; notes: string[] }

/**
 * POST /api/assist/explain. Preferred body: { workspace, subject, refId?, consentToProvider } — the
 * server rebuilds the packet with the engine from that workspace revision (origin "server_recomputed").
 * Legacy body: { packet, consentToProvider } — the packet is only schema-checked, so the response says
 * "client_packet_unverified" and must not be presented as checked by the server.
 */
export const EXPLAIN_SUBJECTS = ["current_year", "deal_choice", "agreed_plan"] as const;
export const ExplainWorkspaceBodySchema = z.object({
  workspace: z.unknown(), subject: z.enum(EXPLAIN_SUBJECTS), refId: IdSchema.optional(), consentToProvider: z.boolean(),
});
export interface ExplanationVerification {
  origin: "server_recomputed" | "client_packet_unverified";
  /** Revision / workspace the packet was rebuilt from (null for a client packet). */
  workspaceId: string | null;
  workspaceRevision: number | null;
  fingerprint: string;
  engineVersion: string | null;
  rulesVersion: string | null;
  /** Plain-English statement of what was and was not checked. */
  note: string;
}
export interface ExplainResponse {
  explanation: z.infer<typeof ExplanationSchema>;
  providerUsed: boolean;
  /** Round 5 follow-up (additive). */
  verification?: ExplanationVerification;
}

export type AssistanceContext = z.infer<typeof AssistanceContextSchema>;
export type AssistanceRequest = z.infer<typeof AssistanceRequestSchema>;
export type ExtractedValue = z.infer<typeof ExtractedValueSchema>;
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;
export type ImportDraft = z.infer<typeof ImportDraftSchema>;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type ChangeCommand = z.infer<typeof ChangeCommandSchema>;
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;
export type Explanation = z.infer<typeof ExplanationSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
export type IssuedCalendarEvent = z.infer<typeof IssuedCalendarEventSchema>;

/** Engine entry points Claude 2 implements (pure, deterministic). */
export interface AssistanceEngine {
  assessInputReadiness(ws: HouseholdWorkspace | null, intent: ReadinessIntent, draft?: ImportDraft | null): InputReadiness;
  previewChange(ws: HouseholdWorkspace, proposal: ChangeProposal): Promise<ChangePreview | BlockedComparison>;
  buildExplanationPacket(ws: HouseholdWorkspace, subject: "current_year" | "deal_choice" | "agreed_plan", refId?: string): Promise<ExplanationPacket | BlockedComparison>;
}
