import { CaseInputSchema, type CaseInput, type MoneyFact } from "@/domain/contracts";

const fact = (valueCents: number, status: "confirmed" | "estimated" = "confirmed"): MoneyFact =>
  ({ valueCents, status, sourceId: "demo-input" });
const zero = () => fact(0);
const income = (personId: string, profit: number) => ({ personId,
  scheduleCProfit: fact(profit), w2Box1: zero(), socialSecurityWages: zero(),
  medicareWages: zero(), grossWages: zero(), payrollPretaxDeductions: zero(),
  taxableInterest: zero(), taxExemptInterest: zero(), existingSepContribution: zero() });
const coverage = (premium: number, benchmark: number, advance: number) =>
  Array.from({ length: 12 }, (_, i) => ({ month: i + 1, enrollmentPremium: fact(premium),
    benchmarkPremium: fact(benchmark), advancePtc: fact(advance),
    ptcEligibilityConfirmed: true, sehiEligibilityConfirmed: true }));

export const familyCase: CaseInput = CaseInputSchema.parse({
  contractVersion: "1.0", id: "family-cliff", title: "A new project and your family's subsidy", isSynthetic: true,
  state: "TN", countyFips: "47037", filingStatus: "mfj",
  people: [{ id: "primary", role: "primary", ageAt2026Start: 38, qualifyingChildForCtc: false },
    { id: "spouse", role: "spouse", ageAt2026Start: 38, qualifyingChildForCtc: false },
    { id: "child", role: "dependent", ageAt2026Start: 5, qualifyingChildForCtc: true }],
  years: [
    { year: 2026, taxFamilySize: 3, coveredPersonIds: ["primary", "spouse", "child"],
      incomes: [income("primary", 11800000), income("spouse", 0)],
      coverage: coverage(191775, 191775, 111775), benchmarkStatus: "county_candidate", unsupportedFacts: [], scopeConfirmed: true },
    { year: 2027, taxFamilySize: 3, coveredPersonIds: ["primary", "spouse", "child"],
      incomes: [income("primary", 11800000), income("spouse", 0)],
      coverage: coverage(234357, 231578, 0), benchmarkStatus: "county_candidate", unsupportedFacts: [], scopeConfirmed: true },
  ],
  opportunity: { title: "December design project", ownerPersonId: "primary", grossRevenueCents: 1200000,
    incrementalExpensesCents: 0, expensePaymentDate: "2026-12-10", plannedReceiptDate: "2026-12-20", cashAccountingConfirmed: true,
    timingArrangementConfirmed: true },
  constraints: { maxAdditionalSepCents: 550000, minimumDesiredCashGainCents: 0,
    canSplitPayment: true, canRenegotiatePrice: true, nextYearPaymentLatestDate: "2027-01-31", objective: "spendable_cash" },
  evidence: [{ id: "demo-input", kind: "synthetic", label: "Illustrative household. County plan candidates; address and eligibility assumed." }],
});

export const ordinaryCase: CaseInput = CaseInputSchema.parse({
  ...structuredClone(familyCase), id: "ordinary-gig", title: "A project with no subsidy cliff", state: "TX", countyFips: null,
  filingStatus: "single", people: [{ id: "primary", role: "primary", ageAt2026Start: 28, qualifyingChildForCtc: false }],
  years: [2026, 2027].map(year => ({ year, taxFamilySize: 1, coveredPersonIds: ["primary"],
    incomes: [income("primary", 4600000)], coverage: coverage(55000, 55000, 20000),
    benchmarkStatus: "illustrative", unsupportedFacts: [], scopeConfirmed: true })),
  opportunity: { ...familyCase.opportunity, title: "New freelance assignment", grossRevenueCents: 600000 },
  constraints: { ...familyCase.constraints, maxAdditionalSepCents: 0, canSplitPayment: false, canRenegotiatePrice: false },
  evidence: [{ id: "demo-input", kind: "synthetic", label: "Illustrative household and insurance premiums; no claim about a local plan price." }],
});

const uncertain = structuredClone(familyCase);
uncertain.id = "missing-spouse-income";
uncertain.title = "One missing number can change the answer";
const spouse = uncertain.years[0].incomes.find(p => p.personId === "spouse")!;
for (const key of ["w2Box1", "socialSecurityWages", "medicareWages", "grossWages"] as const) {
  spouse[key] = { valueCents: null, status: "unknown", sourceId: "demo-input", range: { lowCents: 0, highCents: 600000 } };
}
export const missingDataCase: CaseInput = CaseInputSchema.parse(uncertain);
export const demoCases = [familyCase, ordinaryCase, missingDataCase];
export function getDemoCase(id: string): CaseInput | undefined {
  const found = demoCases.find(c => c.id === id);
  return found ? structuredClone(found) : undefined;
}
