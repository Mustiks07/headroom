import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { DEAL_PLANNING_VERSION, type DealGoal, type DealTermsSpace, type CashContext } from "@/domain/deal-planning";
import { workspaceFixture } from "./workspace";

/**
 * SYNTHETIC round 4 fixture (inputs only, never a computed result): the round 3 family with agreed
 * project A (deposit received) and offer B. Goal for B: keep at least $4,000 more cash after both
 * years' settlement than declining B, receive at least $3,000 from B by 2027-01-10, add at most
 * $1,000 extra SEP. The client is open to asking $12,000–$14,000 in up to two payments
 * (December 2026 and/or January 2027). Cash context: project-only (no household balance claim).
 */
export const dealGoalFixture: DealGoal = {
  id: "goal-b", projectId: "proj-b", minimumTwoYearCashDeltaCents: 400_000, baseline: "decline_unpaid_terms",
  maxAdditionalSepCents: 100_000,
  dateTargets: [{ id: "t-jan10", kind: "project_receipts", byDate: "2027-01-10", minimumCents: 300_000, label: "Money from project B by January 10" }],
  createdAt: "2026-11-15T10:00:00.000Z", updatedAt: "2026-11-15T10:00:00.000Z",
};

export const dealTermsFixture: DealTermsSpace = {
  projectId: "proj-b",
  price: { minCents: 1_200_000, maxCents: 1_400_000, stepCents: 25_000 },
  paymentWindows: [
    { id: "w-dec", earliest: "2026-12-01", latest: "2026-12-31", maxShareBps: 10_000 },
    { id: "w-jan", earliest: "2027-01-04", latest: "2027-01-31", maxShareBps: 10_000 },
  ],
  maxPayments: 2,
  newTermsConfirmed: true,
  allowAdditionalSep: true,
};

/** Project-only context: no snapshot, so no household balance can be promised. */
export const dealCashFixture: CashContext = {
  id: "cash-1", snapshot: null, includedFactIds: [], flows: [], reserveCents: 0,
  completeness: { confirmed: false, from: null, through: null },
};

export const dealWorkspaceFixture: HouseholdWorkspace = HouseholdWorkspaceSchema.parse({
  ...structuredClone(workspaceFixture),
  dealPlanning: { version: DEAL_PLANNING_VERSION, goals: [dealGoalFixture], termSpaces: [dealTermsFixture], cashContext: dealCashFixture, packages: [] },
});
