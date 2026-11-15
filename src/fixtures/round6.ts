/** Round 6 contract fixtures (synthetic). Shapes for Claude 1/2; not financial results. */
import type { ChangeCommand } from "@/domain/assistance";
import type { CurrentAction } from "@/domain/actions";
import type { ImportDecision } from "@/domain/imports";
import type { IntakeResult, OnboardingDraft, TypedAnswer } from "@/domain/intake";

export const sampleOfferEmail = `Hi Alex,

Thanks for the call. We'd like you to redesign our booking site. Budget is $12,000 for the whole project:
$4,000 when we sign and the remaining $8,000 on delivery, which we expect around January 15.

Let me know if that works.
Maria`;

export const intakeResultFixture: IntakeResult = {
  intakeVersion: "1.0", draftId: "draft-1", outcome: "proposed", provenance: "pattern", providerStatus: "not_consented", notes: [],
  offers: [{
    id: "offer-1", title: "Booking site redesign", currency: "USD",
    totalPrice: { amountCents: 1_200_000, asWritten: "$12,000", excerpt: "Budget is $12,000 for the whole project" },
    payments: [
      { id: "offer-1-p1", amountCents: 400_000, amountAsWritten: "$4,000", date: null, dateAsWritten: null, condition: "when we sign", status: "expected", excerpt: "$4,000 when we sign" },
      { id: "offer-1-p2", amountCents: 800_000, amountAsWritten: "$8,000", date: "2027-01-15", dateAsWritten: "around January 15", condition: "on delivery", status: "expected", excerpt: "the remaining $8,000 on delivery, which we expect around January 15" },
    ],
    costs: [], costsStated: false, taxYearStated: null, negotiable: { price: null, schedule: null },
  }],
  questions: [{ id: "q-offer-1-p1-date", kind: "date", subject: { kind: "payment", ref: "offer-1-p1", field: "date" },
    question: "When do you expect the $4,000 payment (\"when we sign\")?", reason: "The tax year of a payment depends on when it is received.",
    options: [], blocking: true, source: { draftKind: "intake", draftId: "draft-1", excerpt: "$4,000 when we sign" } }],
  unsupported: [],
};

export const typedAnswersFixture: TypedAnswer[] = [{ kind: "date", fieldId: "q-offer-1-p1-date", date: "2026-12-01" }];

export const onboardingDraftFixture: OnboardingDraft = {
  draftVersion: "1.0", id: "draft-1", createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:02:00Z",
  text: sampleOfferEmail, intake: { provenance: "pattern", providerStatus: "not_consented" },
  offers: intakeResultFixture.offers, selectedOfferId: "offer-1", facts: [], questions: intakeResultFixture.questions,
  answers: typedAnswersFixture, profileDraft: null, status: "collecting", convertedWorkspaceId: null,
};

/** Two W-2s whose owner the documents don't name: two targets chosen by the user, not one conflict. */
export const importDecisionsFixture: ImportDecision[] = [
  { factId: "w2-a-box1", target: { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" }, resolvesConflictWith: [], correctedAmountCents: null },
  { factId: "w2-b-box1", target: { kind: "wages", personId: "spouse", year: 2026, field: "w2Box1" }, resolvesConflictWith: [], correctedAmountCents: null },
  { factId: "int-1", target: { kind: "interest", personId: "primary", year: 2026, taxExempt: true }, resolvesConflictWith: [], correctedAmountCents: null },
  { factId: "prem-1", target: { kind: "coverage", year: 2026, field: "enrollmentPremium", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, resolvesConflictWith: [], correctedAmountCents: null },
];

export const lifecycleCommandsFixture: ChangeCommand[] = [
  { type: "record_client_response", projectId: "proj-b", response: "countered", respondedOn: "2026-11-20", packageId: null,
    counter: { totalPriceCents: 1_300_000, unpaid: [{ amountCents: 500_000, date: "2026-12-15" }, { amountCents: 800_000, date: "2027-01-06" }], note: "Client asked to keep the first part in December." } },
  { type: "record_partial_receipt", projectId: "proj-b", lineId: "b-pay-1", amountCents: 300_000, date: "2026-12-15", remainderDate: "2027-01-10" },
  { type: "settle_lower_total", projectId: "proj-a", lineId: "a-pay-2", amountCents: 250_000, date: "2026-12-20", reason: "Client and I agreed on a lower final amount." },
];

export const currentActionFixture: CurrentAction = {
  id: "act.ws-1.proj-b.b-pay-1-rest.expected", kind: "partial_remainder", title: "Expect the remaining $2,000 from “December design project”",
  dueDate: "2027-01-10", condition: null, status: "pending", completedOn: null, overdue: false,
  refs: { projectId: "proj-b", lineId: "b-pay-1-rest" }, source: { kind: "expected_payment", id: "b-pay-1-rest" },
};
