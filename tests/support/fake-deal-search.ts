// TEST DOUBLE for Claude 3's storage/export plumbing only. NOT a financial engine: its numbers are
// arbitrary placeholders. Claude 2's real `searchDealTerms` replaces it at integration.
import { dealSearchFingerprint, type CashContext, type DealGoal, type DealSearchResult, type DealTermsSpace, type DealVariant } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { engineWorkspaceFingerprint, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";

export const fakeState = { enabled: true, cashDeltaOffset: 0 };

const variant = (id: string, purpose: DealVariant["purpose"], price: number, payments: Array<[string, number]>, sep: number | null, delta: number): DealVariant => ({
  id, label: `${purpose.replace(/_/g, " ")} terms (test double)`, purpose,
  terms: { priceCents: price, payments: payments.map(([date, amountCents], i) => ({ id: `${id}-p${i + 1}`, date, amountCents })),
    additionalSep: sep ? { year: 2026, personId: "primary", amountCents: sep } : null },
  twoYearCashDeltaCents: delta + fakeState.cashDeltaOffset, retirementAddedCents: sep ?? 0,
  datedFlows: [
    ...payments.map(([date, amountCents]) => ({ date, amountCents, kind: "project_receipt" as const, basis: "proposed" as const, label: "Project B payment" })),
    { date: "2027-04-15", amountCents: -150_000, kind: "tax_settlement" as const, basis: "estimated" as const, label: "Estimated 2026 settlement" },
  ],
  dateTargets: [{ targetId: "t-jan10", achievedCents: payments.filter(([d]) => d <= "2027-01-10").reduce((t, [, a]) => t + a, 0), met: true, explanation: "Test double." }],
  aca: [{ year: 2026, magiCents: 10_400_000, ptcCents: 1_100_000, creditLost: false }, { year: 2027, magiCents: 10_300_000, ptcCents: 1_500_000, creditLost: false }],
  constraints: [{ id: "minimum_cash", satisfied: true, detail: "Test double." }, { id: "price_bounds", satisfied: true, detail: "Within $12,000–$14,000." }],
  actions: [
    { id: "send-terms", title: "Send the proposed terms to the client, if you agree with them", dueDate: "2026-11-20", dueCondition: null, kind: "send_terms", sourceIds: [] },
    { id: "invoice-1", title: "Invoice the first payment; ask for payment by Dec 20, 2026", dueDate: "2026-12-01", dueCondition: null, kind: "invoice", sourceIds: [] },
    { id: "receive-2", title: "Confirm the second payment arrived on or after Jan 4, 2027", dueDate: payments.at(-1)![0], dueCondition: null, kind: "receive_payment", sourceIds: [] },
    { id: "marketplace", title: "Update your Marketplace income estimate", dueDate: null, dueCondition: "When the client confirms the new dates", kind: "marketplace_update", sourceIds: ["healthcare-gov-report-changes"] },
  ],
  differenceFromBestCents: 0, verifiedExact: true,
});

export async function fakeSearchDealTerms(ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): Promise<DealSearchResult> {
  const workspaceFingerprint = await engineWorkspaceFingerprint(ws);
  const searchFingerprint = await dealSearchFingerprint(workspaceFingerprint, goal, space, cash, ENGINE_VERSION, RULES_VERSION);
  const best = variant("v-cash", "most_cash", 1_300_000, [["2026-12-15", 500_000], ["2027-01-06", 800_000]], 100_000, 512_300);
  const simple = { ...variant("v-simple", "simplest", 1_250_000, [["2027-01-05", 1_250_000]], null, 498_000), differenceFromBestCents: -14_300 };
  return {
    status: "ready", goalId: goal.id, projectId: goal.projectId, workspaceFingerprint, searchFingerprint, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
    baseline: { kind: goal.baseline, label: "Your plan without project B", description: "Project A, its received deposit and your SEP goal stay as they are." },
    horizon: { from: "2026-11-15", through: "2027-12-31", settlementThrough: "2028-04-17" },
    search: { priceStepCents: space.price.stepCents, paymentDateCandidates: 6, sepStepCents: 10_000, evaluated: 420, exhaustiveWithinSpace: false, note: "Test double search." },
    cashCompleteness: "project_only", simplerVariantThresholdCents: 25_000, warnings: ["Synthetic example household."],
    variants: [simple, best], recommendedVariantId: "v-simple",
  };
}
