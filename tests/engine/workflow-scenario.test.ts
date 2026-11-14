// Reproducible competitor-comparison workflow (docs/research/competitor-workflow.md). Synthetic household.
import { expect, it } from "vitest";
import type { HouseholdWorkspace, Project, ProjectLine } from "@/domain/household-workspace";
import { workspaceFixture } from "@/fixtures/workspace";
import { compareWorkspaceOpportunity, evaluateHouseholdWorkspace } from "@/lib/engine";
import { fact, usd } from "./helpers";

const T = "2026-11-15T12:00:00.000Z";
const annual = (personId: string, year: 2026 | 2027, dollars: number) =>
  ({ method: "annual_total" as const, personId, year, excludesManagedProjects: true, annualNetProfit: fact(usd(dollars)) });
const line = (id: string, dollars: number, date: string): ProjectLine =>
  ({ id, expected: { amountCents: usd(dollars), date }, actual: null, cancelledAt: null, sourceId: "demo-input", corrections: [] });
const project = (id: string, title: string, status: Project["status"], receipts: ProjectLine[]): Project => ({
  id, title, ownerPersonId: "primary", status, createdAt: T, statusChangedAt: T, cashAccountingConfirmed: true, timingArrangementConfirmed: true,
  terms: { canSplitPayment: true, canRenegotiatePrice: false, nextYearPaymentLatestDate: "2027-01-31" }, receipts, expenses: [], agreedDecision: null });
const dollars = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-US")}`);

it("A agreed, B offered, limited SEP; then SEP paid, A paid and income corrected", async () => {
  const ws: HouseholdWorkspace = structuredClone(workspaceFixture);
  ws.forecasts = [annual("primary", 2026, 118000), annual("spouse", 2026, 0), annual("primary", 2027, 118000), annual("spouse", 2027, 0)];
  ws.projects = [project("A", "Website A", "agreed", [line("a1", 6000, "2026-11-20")]), project("B", "Branding B", "proposed", [line("b1", 6000, "2026-12-20")])];
  ws.retirement = { targets: [], contributions: [], futureContributionBudget: { amountCents: usd(4000), asOfDate: "2026-11-15", sourceId: "demo-input" } };

  // Step 1: evaluate B on top of A.
  const step1 = await compareWorkspaceOpportunity(ws, "B");
  if (step1.status !== "ready") throw new Error(JSON.stringify(step1));
  const rows = step1.comparison.scenarios.map(s => `${s.kind}: ${s.label} | cash ${dollars(s.twoYearCashDeltaCents)} | retirement ${dollars(s.grossAdditionalRetirementCents)} | feasible ${s.feasible}`);
  console.info(["STEP 1", step1.baseline.label, ...rows, `recommended ${step1.comparison.recommendedScenarioId}`].join("\n"));
  const sep = step1.comparison.scenarios.find(s => s.kind === "sep_minimum")!;
  expect(sep.feasible).toBe(true);
  expect(sep.grossAdditionalRetirementCents).toBeLessThanOrEqual(usd(4000));

  // Step 2: accept B with the minimum SEP as the 2026 goal; A is paid; part of the SEP is paid.
  const target = sep.grossAdditionalRetirementCents;
  ws.projects[1].status = "agreed";
  ws.projects[0].receipts[0].actual = { amountCents: usd(6000), date: "2026-11-21", recordedAt: T, sourceId: "demo-input" };
  ws.retirement.targets = [{ id: "sep-2026", personId: "primary", year: 2026, targetCents: target, acceptedAt: T, origin: { projectId: "B", scenarioKind: "sep_minimum", fingerprint: null } }];
  ws.retirement.contributions = [{ id: "sep-paid-1", personId: "primary", taxYear: 2026, amountCents: usd(1000), paidDate: "2026-12-15", sourceId: "demo-input", recordedAt: T }];
  const step2 = await evaluateHouseholdWorkspace(ws);
  if (step2.status !== "ready") throw new Error(JSON.stringify(step2));
  console.info(`STEP 2 feasible ${step2.agreed.stillFeasible}; SEP ${JSON.stringify(step2.sep[0])}; budget left ${dollars(step2.futureContributionBudgetRemainingCents)}; 2026 PTC ${dollars(step2.fixedPlan.years[0].risk?.ptcCents)}`);
  expect(step2.agreed.stillFeasible).toBe(true);
  expect(step2.sep[0]).toMatchObject({ targetCents: target, paidCents: usd(1000), remainingCents: target - usd(1000) });
  expect(step2.fixedPlan.years[0].risk!.ptcCents).toBeGreaterThan(0);

  // Step 3: the base forecast is corrected upward; the agreed plan is evaluated as agreed, then B is re-evaluated.
  ws.forecasts[0] = annual("primary", 2026, 121000);
  const step3 = await evaluateHouseholdWorkspace(ws);
  if (step3.status !== "ready") throw new Error(JSON.stringify(step3));
  const redo = await compareWorkspaceOpportunity(ws, "B");
  if (redo.status !== "ready") throw new Error(JSON.stringify(redo));
  console.info([`STEP 3 credit lost ${JSON.stringify(step3.agreed.creditLostYears)}; 2026 state ${step3.fixedPlan.years[0].risk?.state}; agreed cash ${dollars(step3.agreed.result?.twoYearCashDeltaCents)}`,
    ...redo.comparison.scenarios.map(s => `${s.kind}: ${s.label} | cash ${dollars(s.twoYearCashDeltaCents)} | retirement ${dollars(s.grossAdditionalRetirementCents)} | feasible ${s.feasible}`),
    `recommended ${redo.comparison.recommendedScenarioId}`, ...redo.warnings].join("\n"));
  expect(step3.agreed.creditLostYears).toEqual([2026]);
  expect(step3.sep[0].paidCents).toBe(usd(1000));                                       // paid money stays paid
  expect(redo.comparison.scenarios.some(s => s.feasible && s.kind !== "decline" && s.years[0].ptcCents > 0)).toBe(true);
});
