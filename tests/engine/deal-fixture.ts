// Synthetic round 4 household: A agreed with a deposit received, B offered, a partly funded SEP goal.
import type { HouseholdWorkspace, Project, ProjectLine } from "@/domain/household-workspace";
import { workspaceFixture } from "@/fixtures/workspace";
import type { DealSearchRequest } from "@/lib/engine";
import { fact, usd } from "./helpers";

export const T = "2026-11-15T12:00:00.000Z";
export const annual = (personId: string, year: 2026 | 2027, d: number) =>
  ({ method: "annual_total" as const, personId, year, excludesManagedProjects: true, annualNetProfit: fact(usd(d)) });
export const line = (id: string, d: number, date: string, actual?: [number, string]): ProjectLine => ({ id, expected: { amountCents: usd(d), date },
  actual: actual ? { amountCents: usd(actual[0]), date: actual[1], recordedAt: T, sourceId: "demo-input" } : null, cancelledAt: null, sourceId: "demo-input", corrections: [] });
export const project = (id: string, status: Project["status"], receipts: ProjectLine[]): Project => ({ id, title: `Project ${id}`, ownerPersonId: "primary", status,
  createdAt: T, statusChangedAt: T, cashAccountingConfirmed: true, timingArrangementConfirmed: true,
  terms: { canSplitPayment: true, canRenegotiatePrice: true, nextYearPaymentLatestDate: "2027-01-31" }, receipts, expenses: [], agreedDecision: null });

/** Base 2026 profit $112,000 (projects excluded); A: $3,000 received + $3,000 expected; B offered $12,000 on Dec 20; SEP goal $1,000 with $2,500 set aside. */
export function dealWorkspace(profit2026 = 112000): HouseholdWorkspace {
  const ws: HouseholdWorkspace = structuredClone(workspaceFixture);
  ws.forecasts = [annual("primary", 2026, profit2026), annual("spouse", 2026, 0), annual("primary", 2027, 118000), annual("spouse", 2027, 0)];
  ws.projects = [project("A", "agreed", [line("a1", 3000, "2026-10-01", [3000, "2026-10-02"]), line("a2", 3000, "2026-12-01")]),
    project("B", "proposed", [line("b1", 12000, "2026-12-20")])];
  ws.retirement = { targets: [{ id: "t26", personId: "primary", year: 2026, targetCents: usd(1000), acceptedAt: T, origin: { projectId: null, scenarioKind: null, fingerprint: null } }],
    contributions: [], futureContributionBudget: { amountCents: usd(2500), asOfDate: "2026-11-15", sourceId: "demo-input", includedContributionIds: [] } };
  return ws;
}

/** "Keep at least $4,000 after both returns, get $10,000 by January 10, at most $1,000 more into the SEP." */
export function dealRequest(overrides: Partial<{ minCash: number; byJan10: number; maxSep: number; maxPrice: number; minPrice: number }> = {}): DealSearchRequest {
  return {
    goal: { projectId: "B", minTwoYearCashDeltaCents: usd(overrides.minCash ?? 4000), maxAdditionalSepCents: usd(overrides.maxSep ?? 1000),
      dateTargets: [{ id: "jan10", kind: "project_receipts", byDate: "2027-01-10", minCents: usd(overrides.byJan10 ?? 10000) }] },
    terms: { minPriceCents: usd(overrides.minPrice ?? 12000), maxPriceCents: usd(overrides.maxPrice ?? 15000), maxPayments: 2, newTermsConfirmed: true,
      windows: [{ id: "dec", earliestDate: "2026-12-15", latestDate: "2026-12-31" }, { id: "jan", earliestDate: "2027-01-04", latestDate: "2027-01-10" }] },
    cash: null,
  };
}
