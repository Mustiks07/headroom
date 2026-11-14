// Synthetic round 4 household: A agreed with a deposit received, B offered, a partly funded SEP goal.
import type { CashContext, DateTarget, DealGoal, DealTermsSpace } from "@/domain/deal-planning";
import type { HouseholdWorkspace, Project, ProjectLine } from "@/domain/household-workspace";
import { workspaceFixture } from "@/fixtures/workspace";
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

export interface DealOpts { projectId: string; minCash: number; targets: DateTarget[]; maxSep: number | null; minPrice: number; maxPrice: number; step: number;
  maxPayments: number; newTerms: boolean | null; allowSep: boolean; baseline: DealGoal["baseline"] }

/** "Keep at least $4,000 after both returns, get $10,000 from B by January 10, at most $1,000 more into the SEP." */
export function deal(o: Partial<DealOpts> = {}): { goal: DealGoal; space: DealTermsSpace } {
  const projectId = o.projectId ?? "B";
  return {
    goal: { id: "g", projectId, minimumTwoYearCashDeltaCents: usd(o.minCash ?? 4000), baseline: o.baseline ?? "decline_unpaid_terms",
      maxAdditionalSepCents: o.maxSep === null ? null : usd(o.maxSep ?? 1000),
      dateTargets: o.targets ?? [{ id: "jan10", kind: "project_receipts", byDate: "2027-01-10", minimumCents: usd(10000) }], createdAt: T, updatedAt: T },
    space: { projectId, price: { minCents: usd(o.minPrice ?? 12000), maxCents: usd(o.maxPrice ?? 15000), stepCents: usd(o.step ?? 250) },
      paymentWindows: [{ id: "dec", earliest: "2026-12-15", latest: "2026-12-31", maxShareBps: 10000 }, { id: "jan", earliest: "2027-01-04", latest: "2027-01-10", maxShareBps: 10000 }],
      maxPayments: o.maxPayments ?? 2, newTermsConfirmed: o.newTerms === undefined ? true : o.newTerms, allowAdditionalSep: o.allowSep ?? true },
  };
}

/** A complete household cash context: $20,000 on Nov 20 (a1 already in it), rent −$3,000 Dec 1 and Jan 1, reserve $5,000. */
export const completeCash = (): CashContext => ({
  id: "cash", snapshot: { date: "2026-11-20", balanceCents: usd(20000), sourceId: "demo-input" }, includedFactIds: ["a1"],
  flows: [{ id: "rent-dec", date: "2026-12-01", amountCents: -usd(3000), kind: "expense", status: "confirmed", label: "Rent", sourceId: "demo-input" },
    { id: "rent-jan", date: "2027-01-01", amountCents: -usd(3000), kind: "expense", status: "confirmed", label: "Rent", sourceId: "demo-input" }],
  reserveCents: usd(5000), completeness: { confirmed: true, from: "2026-11-20", through: "2027-04-30" },
});
