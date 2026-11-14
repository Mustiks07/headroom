import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import type { MoneyFact } from "@/domain/contracts";
import { familyCase } from "./cases";

/**
 * SYNTHETIC round 3 fixture: the family-cliff household with a YTD-based forecast, an agreed
 * project A (one payment received, one expected), a proposed project B and a partially paid SEP.
 * Inputs only — never use it as a fabricated result.
 */
const fact = (valueCents: number, status: "confirmed" | "estimated", sourceId = "demo-input",
  range?: { lowCents: number; highCents: number }): MoneyFact =>
  range ? { valueCents, status, sourceId, range } : { valueCents, status, sourceId };
const T = "2026-10-20T15:00:00.000Z";

function other(personId: string) {
  const src = familyCase.years[0].incomes.find(i => i.personId === personId)!;
  const copy: Record<string, unknown> = { ...src };
  delete copy.scheduleCProfit;
  delete copy.existingSepContribution;
  return copy;
}

function year(yi: 0 | 1) {
  const y = familyCase.years[yi];
  return { year: y.year, taxFamilySize: y.taxFamilySize, coveredPersonIds: y.coveredPersonIds, otherIncomes: [other("primary"), other("spouse")],
    coverage: y.coverage, benchmarkStatus: y.benchmarkStatus, unsupportedFacts: y.unsupportedFacts, scopeConfirmed: y.scopeConfirmed };
}

export const workspaceFixture: HouseholdWorkspace = HouseholdWorkspaceSchema.parse({
  workspaceVersion: "2.0",
  id: "ws-family-demo",
  revision: 0,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: T,
  household: { caseId: "family-cliff-ws", title: "Our 2026-2027 household plan", isSynthetic: true, state: "TN", countyFips: "47037",
    filingStatus: "mfj", people: familyCase.people, years: [year(0), year(1)] },
  forecasts: [
    { method: "year_to_date_plus_remaining", personId: "primary", year: 2026, excludesManagedProjects: true,
      asOfDate: "2026-09-30", asOfConfirmed: true,
      ytdNetProfit: fact(8_800_000, "confirmed", "doc-ytd-pl"),
      remainingReceipts: fact(3_400_000, "estimated", "demo-input", { lowCents: 2_900_000, highCents: 3_900_000 }),
      remainingExpenses: fact(400_000, "estimated", "demo-input", { lowCents: 300_000, highCents: 600_000 }) },
    { method: "annual_total", personId: "spouse", year: 2026, excludesManagedProjects: true, annualNetProfit: fact(0, "confirmed") },
    { method: "annual_total", personId: "primary", year: 2027, excludesManagedProjects: true, annualNetProfit: fact(11_800_000, "estimated") },
    { method: "annual_total", personId: "spouse", year: 2027, excludesManagedProjects: true, annualNetProfit: fact(0, "confirmed") },
  ],
  projects: [
    { id: "proj-a", title: "Bakery website redesign", ownerPersonId: "primary", status: "agreed",
      createdAt: "2026-09-15T10:00:00.000Z", statusChangedAt: "2026-09-20T10:00:00.000Z",
      cashAccountingConfirmed: true, timingArrangementConfirmed: true,
      terms: { canSplitPayment: false, canRenegotiatePrice: false, nextYearPaymentLatestDate: null },
      receipts: [
        { id: "a-pay-1", label: "Deposit", expected: { amountCents: 400_000, date: "2026-10-15" },
          actual: { amountCents: 400_000, date: "2026-10-17", recordedAt: T, sourceId: "doc-bank-deposit" },
          cancelledAt: null, sourceId: "doc-offer-a", corrections: [] },
        { id: "a-pay-2", label: "Final payment", expected: { amountCents: 300_000, date: "2026-12-15" },
          actual: null, cancelledAt: null, sourceId: "doc-offer-a", corrections: [] },
      ],
      expenses: [],
      agreedDecision: { kind: "accept_now", label: "Accept as offered", chosenAt: "2026-09-20T10:00:00.000Z", fingerprint: null } },
    { id: "proj-b", title: "December design project", ownerPersonId: "primary", status: "proposed",
      createdAt: T, statusChangedAt: T, cashAccountingConfirmed: true, timingArrangementConfirmed: true,
      terms: { canSplitPayment: true, canRenegotiatePrice: true, nextYearPaymentLatestDate: "2027-01-31" },
      receipts: [{ id: "b-pay-1", expected: { amountCents: 1_200_000, date: "2026-12-20" }, actual: null, cancelledAt: null,
        sourceId: "demo-input", corrections: [] }],
      expenses: [], agreedDecision: null },
  ],
  retirement: {
    targets: [{ id: "sep-2026-primary", personId: "primary", year: 2026, targetCents: 500_000, acceptedAt: "2026-09-20T10:00:00.000Z",
      origin: { projectId: "proj-a", scenarioKind: "sep_minimum", fingerprint: null } }],
    contributions: [{ id: "sep-paid-1", personId: "primary", taxYear: 2026, amountCents: 200_000, paidDate: "2026-10-20",
      sourceId: "doc-sep-receipt", recordedAt: T }],
    futureContributionBudget: { amountCents: 350_000, asOfDate: "2026-10-20", sourceId: "demo-input" },
  },
  planning: { objective: "spendable_cash", minimumDesiredCashGainCents: 0 },
  evidence: [
    ...familyCase.evidence,
    { id: "doc-ytd-pl", kind: "document", label: "Profit and loss statement through Sep 30, 2026 (synthetic)", taxYear: 2026 },
    { id: "doc-offer-a", kind: "document", label: "Signed offer for project A (synthetic)", taxYear: 2026 },
    { id: "doc-bank-deposit", kind: "document", label: "Bank deposit confirmation for the project A deposit (synthetic)", taxYear: 2026 },
    { id: "doc-sep-receipt", kind: "document", label: "SEP-IRA contribution confirmation (synthetic)", taxYear: 2026 },
  ],
  events: [{ id: "evt-created", at: "2026-10-01T12:00:00.000Z", kind: "workspace_created", description: "Created the household plan.",
    refs: {}, previousFingerprint: null, nextFingerprint: null }],
  calculation: null,
  origin: { kind: "new" },
});
