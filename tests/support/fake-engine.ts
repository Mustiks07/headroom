// TEST DOUBLE for integration tests of storage/export plumbing only. It is NOT a financial
// engine and its numbers are meaningless; the real engine (Claude 2) is exercised separately.
import { createHash } from "node:crypto";
import type { CaseInput, ComparisonResult, ReadyComparison, ScenarioResult, YearResult } from "@/domain/contracts";

const year = (y: 2026 | 2027, extra: number): YearResult => ({
  year: y, magiCents: 10_000_000 + extra, ptcCents: 500_000, aptcCents: 450_000, aptcSettlementCents: -50_000,
  federalIncomeTaxCents: 900_000, selfEmploymentTaxCents: 1_500_000, employeeFicaCents: 0, sehiDeductionCents: 120_000,
  spendableAfterSettlementCents: 7_000_000 + extra, additionalRetirementCents: y === 2026 ? 300_000 : 0,
  trace: [{ id: `magi-${y}`, label: "ACA MAGI", amountCents: 10_000_000 + extra, inputPaths: ["years.0.incomes"], sourceIds: ["demo-input"], explanation: "Test trace item." }],
});

const scenario = (id: string, kind: ScenarioResult["kind"], label: string, delta: number, feasible = true): ScenarioResult => ({
  id, kind, label, feasible, infeasibilityReasons: feasible ? [] : ["Not allowed by your constraints."],
  decisions: { grossRevenueCents: 1_200_000, receipts: [{ date: "2026-12-20", amountCents: 1_200_000 }], expenses: [],
    additionalSep: kind === "sep_minimum" ? [{ year: 2026, personId: "primary", amountCents: 300_000 }] : [] },
  years: [year(2026, delta), year(2027, 0)], twoYearCashDeltaCents: delta, grossAdditionalRetirementCents: kind === "sep_minimum" ? 300_000 : 0,
  assumptions: ["Test assumption."], actions: [{ id: `${id}-act`, title: "Make the SEP contribution before filing", dueDate: "2027-04-15", sourceIds: ["demo-input"] }],
  stress: { status: "not_tested", worstCashDeltaCents: null, checkedDescription: "Not tested in the test double." },
});

export async function fakeCalculateComparison(input: CaseInput): Promise<ComparisonResult> {
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const result: ReadyComparison = {
    status: "ready", contractVersion: "1.0", engineVersion: "test-double", rulesVersion: "test-rules",
    calculationFingerprint: fingerprint, caseId: input.id, baselineScenarioId: "decline", recommendedScenarioId: "sep",
    scenarios: [scenario("decline", "decline", "Without this project", 0), scenario("accept", "accept_now", "Accept as offered", 250_000),
      scenario("sep", "sep_minimum", "Accept and contribute to a SEP-IRA", 410_000), scenario("split", "split_payment", "Split payment", 0, false)],
    warnings: ["Synthetic test data."],
  };
  return result;
}
