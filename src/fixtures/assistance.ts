import { ChangeProposalSchema, ExtractedFactSchema, ImportDraftSchema, type ChangeProposal, type ExplanationPacket, type ExtractedFact, type ImportDraft } from "@/domain/assistance";

/**
 * SYNTHETIC round 5 fixtures (inputs/shapes only; never engine results). They refer to the round 3
 * workspace fixture (`ws-family-demo`, project A `proj-a` with line `a-pay-2`).
 */

/** Synthetic source documents (plain text), as a user might paste or upload them. */
export const sampleDocuments = {
  profitAndLoss: "Northwind Design Studio\nProfit and Loss\nJanuary 1 - September 30, 2026\nTotal income: $96,500.00\nTotal expenses: $8,500.00\nNet profit YTD: $88,000.00\n",
  clientOffer: "Hi! We'd love you to design our December campaign.\nProject fee: $12,000.00\nPayment date: 2026-12-20\nPlease confirm by Friday.\n",
  paymentConfirmation: "Payment advice\nPayment received: $3,000.00\nDate received: 2026-12-16\nReference: Bakery website - final payment\n",
} as const;

export const extractedFactsFixture: ExtractedFact[] = [
  { id: "doc-pl-2026q3:income.scheduleCProfit:l6", documentId: "doc-pl-2026q3", documentKind: "profit_and_loss", field: "income.scheduleCProfit",
    value: { kind: "money", amountCents: 8_800_000, period: "year_to_date" }, valueAsPrinted: "$88,000.00", personCandidate: null, taxYear: 2026,
    asOfDate: "2026-09-30", source: { label: "Uploaded text file (looks like a profit and loss statement), line 6", page: null, excerpt: "Net profit YTD: $88,000.00" },
    provenance: "deterministic_text", review: "extracted", conflictsWith: [] },
  { id: "doc-offer-b:opportunity.grossRevenueCents:l2", documentId: "doc-offer-b", documentKind: "client_offer", field: "opportunity.grossRevenueCents",
    value: { kind: "money", amountCents: 1_200_000, period: "one_time" }, valueAsPrinted: "$12,000.00", personCandidate: null, taxYear: 2026,
    asOfDate: null, source: { label: "Pasted text (looks like a project offer), line 2", page: null, excerpt: "Project fee: $12,000.00" },
    provenance: "deterministic_text", review: "extracted", conflictsWith: [] },
].map(f => ExtractedFactSchema.parse(f));

export const importDraftFixture: ImportDraft = ImportDraftSchema.parse({
  id: "draft-1",
  documents: [
    { documentId: "doc-pl-2026q3", kind: "profit_and_loss", label: "Profit and loss through Sep 30, 2026", addedAt: "2026-11-16T10:00:00.000Z", provenance: "deterministic_text" },
    { documentId: "doc-offer-b", kind: "client_offer", label: "Offer for the December campaign", addedAt: "2026-11-16T10:02:00.000Z", provenance: "deterministic_text" },
  ],
  facts: extractedFactsFixture,
});

/** "The remaining payment moved to January 8, 2027." on the workspace fixture. */
export const changeProposalFixture: ChangeProposal = ChangeProposalSchema.parse({
  id: "prop-1", createdAt: "2026-11-16T10:05:00.000Z",
  base: { workspaceId: "ws-family-demo", revision: 3, fingerprint: "example-fingerprint" },
  intent: "update",
  commands: [{ type: "update_expected_payment", projectId: "proj-a", lineId: "a-pay-2", newAmountCents: null, newDate: "2027-01-08" }],
  ambiguities: [], resolvedDates: [], evidence: [{ documentId: null, excerpt: "The remaining payment moved to January 8, 2027" }],
  provenance: "pattern", status: "proposed",
});

/** Shape example only (Claude 2 builds real packets from verified results). */
export const explanationPacketFixture: ExplanationPacket = {
  id: "pkt-1", subject: "current_year", fingerprint: "example-fingerprint",
  facts: [
    { ref: "magi_2026", label: "Household income for the subsidy (2026)", kind: "money", valueCents: 10_110_000 },
    { ref: "limit_2026", label: "Income limit for the credit (2026)", kind: "money", valueCents: 10_660_000 },
  ],
  statements: ["Your 2026 household income for the subsidy is {magi_2026}, below the {limit_2026} limit."],
  limitations: ["Planning estimate; not a Marketplace eligibility decision."],
};
