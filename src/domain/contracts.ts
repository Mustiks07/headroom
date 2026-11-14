import { z } from "zod";

/** Shared contract v1. All serialized money is integer USD cents. */
export const CONTRACT_VERSION = "1.0" as const;
export const CentsSchema = z.number().int().safe();
export const TaxYearSchema = z.union([z.literal(2026), z.literal(2027)]);
export const FactSchema = z.object({
  valueCents: CentsSchema.nullable(),
  status: z.enum(["confirmed", "estimated", "unknown"]),
  sourceId: z.string(),
  range: z.object({ lowCents: CentsSchema, highCents: CentsSchema }).optional(),
}).superRefine((fact, ctx) => {
  if ((fact.status === "unknown") !== (fact.valueCents === null)) {
    ctx.addIssue({ code: "custom", message: "Unknown amounts must be null; known amounts need a value." });
  }
  if (fact.range && (fact.range.lowCents > fact.range.highCents ||
    (fact.valueCents !== null && (fact.valueCents < fact.range.lowCents || fact.valueCents > fact.range.highCents)))) {
    ctx.addIssue({ code: "custom", message: "Amount must be within an ordered range." });
  }
});
export const EvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["manual", "document", "cms", "irs", "synthetic"]),
  label: z.string(),
  taxYear: TaxYearSchema.optional(),
  documentId: z.string().optional(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
  url: z.string().url().optional(),
});
export const PersonSchema = z.object({
  id: z.string(),
  role: z.enum(["primary", "spouse", "dependent"]),
  ageAt2026Start: z.number().int().min(0).max(100),
  qualifyingChildForCtc: z.boolean().nullable(),
});
export const PersonIncomeSchema = z.object({
  personId: z.string(),
  scheduleCProfit: FactSchema,
  w2Box1: FactSchema,
  socialSecurityWages: FactSchema,
  medicareWages: FactSchema,
  grossWages: FactSchema,
  payrollPretaxDeductions: FactSchema,
  taxableInterest: FactSchema,
  taxExemptInterest: FactSchema,
  existingSepContribution: FactSchema,
});
export const CoverageMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  enrollmentPremium: FactSchema,
  benchmarkPremium: FactSchema,
  advancePtc: FactSchema,
  ptcEligibilityConfirmed: z.boolean().nullable(),
  sehiEligibilityConfirmed: z.boolean().nullable(),
});
export const YearInputSchema = z.object({
  year: TaxYearSchema,
  taxFamilySize: z.number().int().min(1).max(10),
  coveredPersonIds: z.array(z.string()).min(1),
  incomes: z.array(PersonIncomeSchema).min(1),
  coverage: z.array(CoverageMonthSchema).length(12),
  benchmarkStatus: z.enum(["marketplace_confirmed", "county_candidate", "illustrative", "unknown"]),
  unsupportedFacts: z.array(z.string()),
  scopeConfirmed: z.boolean().nullable(),
}).superRefine((year, ctx) => {
  if (new Set(year.coverage.map(m => m.month)).size !== 12) {
    ctx.addIssue({ code: "custom", message: "Coverage requires each month exactly once." });
  }
});
export const OpportunitySchema = z.object({
  title: z.string().min(1).max(200),
  ownerPersonId: z.string(),
  grossRevenueCents: CentsSchema.nonnegative(),
  incrementalExpensesCents: CentsSchema.nonnegative(),
  expensePaymentDate: z.string().date(),
  plannedReceiptDate: z.string().date(),
  cashAccountingConfirmed: z.boolean().nullable(),
  timingArrangementConfirmed: z.boolean().nullable(),
});
export const ConstraintsSchema = z.object({
  maxAdditionalSepCents: CentsSchema.nonnegative(),
  minimumDesiredCashGainCents: CentsSchema.nonnegative(),
  canSplitPayment: z.boolean(),
  canRenegotiatePrice: z.boolean(),
  nextYearPaymentLatestDate: z.string().date().nullable(),
  objective: z.enum(["spendable_cash", "retirement_and_cash"]),
});
export const CaseInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  id: z.string(),
  title: z.string(),
  isSynthetic: z.boolean(),
  state: z.string().length(2),
  countyFips: z.string().regex(/^\d{5}$/).nullable(),
  filingStatus: z.enum(["single", "mfj", "other"]),
  people: z.array(PersonSchema).min(1),
  years: z.tuple([YearInputSchema, YearInputSchema]),
  opportunity: OpportunitySchema,
  constraints: ConstraintsSchema,
  evidence: z.array(EvidenceSchema),
}).superRefine((input, ctx) => {
  if (input.years[0].year !== 2026 || input.years[1].year !== 2027) {
    ctx.addIssue({ code: "custom", message: "Supply 2026 then 2027." });
  }
  const ids = new Set(input.people.map(p => p.id));
  if (ids.size !== input.people.length || !ids.has(input.opportunity.ownerPersonId)) {
    ctx.addIssue({ code: "custom", message: "People must be unique and include the opportunity owner." });
  }
  for (const year of input.years) {
    if (year.coveredPersonIds.some(id => !ids.has(id)) || year.incomes.some(p => !ids.has(p.personId)) ||
      new Set(year.incomes.map(p => p.personId)).size !== year.incomes.length) {
      ctx.addIssue({ code: "custom", message: "Income and coverage must reference unique household people." });
    }
  }
});

export type MoneyFact = z.infer<typeof FactSchema>;
export type CaseInput = z.infer<typeof CaseInputSchema>;
export type TaxYear = z.infer<typeof TaxYearSchema>;
export type ScenarioKind = "decline" | "accept_now" | "sep_minimum" | "sep_buffer" | "split_payment" | "renegotiate";
export interface TraceItem {
  id: string;
  label: string;
  amountCents: number | null;
  inputPaths: string[];
  sourceIds: string[];
  explanation: string;
}
export interface YearResult {
  year: TaxYear;
  magiCents: number;
  ptcCents: number;
  aptcCents: number;
  /** Positive means repay; negative means additional credit. Not deducted twice. */
  aptcSettlementCents: number;
  federalIncomeTaxCents: number;
  selfEmploymentTaxCents: number;
  employeeFicaCents: number;
  sehiDeductionCents: number;
  spendableAfterSettlementCents: number;
  additionalRetirementCents: number;
  trace: TraceItem[];
}
export interface ScenarioResult {
  id: string;
  kind: ScenarioKind;
  label: string;
  feasible: boolean;
  infeasibilityReasons: string[];
  decisions: {
    grossRevenueCents: number;
    receipts: Array<{ date: string; amountCents: number }>;
    expenses: Array<{ year: TaxYear; amountCents: number }>;
    additionalSep: Array<{ year: TaxYear; personId: string; amountCents: number }>;
  };
  years: [YearResult, YearResult];
  twoYearCashDeltaCents: number;
  grossAdditionalRetirementCents: number;
  assumptions: string[];
  actions: Array<{ id: string; title: string; dueDate: string | null; sourceIds: string[] }>;
  stress: {
    status: "not_tested" | "within_declared_range" | "fails_within_range";
    worstCashDeltaCents: number | null;
    checkedDescription: string;
  };
}
export interface ReadyComparison {
  status: "ready";
  contractVersion: typeof CONTRACT_VERSION;
  engineVersion: string;
  rulesVersion: string;
  /** SHA-256 of canonical input, engine version and rule version. */
  calculationFingerprint: string;
  caseId: string;
  baselineScenarioId: string;
  recommendedScenarioId: string | null;
  scenarios: ScenarioResult[];
  warnings: string[];
}
export interface CurrentRisk {
  year: TaxYear;
  state: "below_cliff" | "at_risk" | "over_cliff" | "no_credit";
  forecastMagiCents: number;
  thresholdMagiCents: number;
  subsidyCents: number;
  advanceSettlementCents: number;
  /** Additional Schedule C PROFIT, under listed assumptions; not gross revenue. */
  additionalProfitHeadroomCents: number | null;
  headroomAssumptions: string[];
  trace: TraceItem[];
}
export interface ReadyRiskAssessment {
  status: "ready";
  engineVersion: string;
  rulesVersion: string;
  calculationFingerprint: string;
  risk: CurrentRisk;
  warnings: string[];
}
export interface BlockedComparison {
  status: "needs_data" | "unsupported" | "unavailable";
  code: string;
  message: string;
  fields: Array<{ path: string; reason: string }>;
}
export type ComparisonResult = ReadyComparison | BlockedComparison;
export type RiskAssessment = ReadyRiskAssessment | BlockedComparison;
export interface SavedPlan {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  input: CaseInput;
  comparison: ReadyComparison;
  chosenScenarioId: string;
  completedActionIds: string[];
}
export interface PlanEvent {
  id: string;
  planId: string;
  occurredAt: string;
  kind: "income_changed" | "coverage_changed" | "opportunity_changed" | "action_confirmed";
  description: string;
  previousFingerprint: string;
  nextFingerprint: string | null;
}
export interface ExtractionResult {
  status: "review_required" | "unavailable";
  fields: Array<{ path: string; proposedValue: unknown; evidence: z.infer<typeof EvidenceSchema> }>;
  warnings: string[];
}
export interface PlanRepository {
  list(): Promise<SavedPlan[]>;
  get(id: string): Promise<SavedPlan | null>;
  save(plan: SavedPlan, expectedRevision: number | null): Promise<SavedPlan>;
  remove(id: string): Promise<void>;
  appendEvent(event: PlanEvent): Promise<void>;
  listEvents(planId: string): Promise<PlanEvent[]>;
  clear(): Promise<void>;
}
