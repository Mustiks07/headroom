/** Internal engine types (not part of the shared contract). */
import type { TaxYear } from "@/domain/contracts";
import type { Filing, RulePack } from "./rules";

export const INCOME_FIELDS = ["scheduleCProfit", "w2Box1", "socialSecurityWages", "medicareWages", "grossWages",
  "payrollPretaxDeductions", "taxableInterest", "taxExemptInterest", "existingSepContribution"] as const;
export type IncomeField = typeof INCOME_FIELDS[number];

export const FIELD_LABELS: Record<IncomeField, string> = {
  scheduleCProfit: "business profit (Schedule C)",
  w2Box1: "W-2 taxable wages (box 1)",
  socialSecurityWages: "Social Security wages (W-2 box 3)",
  medicareWages: "Medicare wages (W-2 box 5)",
  grossWages: "gross pay",
  payrollPretaxDeductions: "pre-tax payroll deductions",
  taxableInterest: "taxable interest",
  taxExemptInterest: "tax-exempt interest",
  existingSepContribution: "SEP-IRA contribution already planned",
};
export const COVERAGE_LABELS = {
  enrollmentPremium: "plan premium",
  benchmarkPremium: "benchmark (second-lowest-cost Silver) premium",
  advancePtc: "advance premium tax credit",
} as const;

export interface PersonYear {
  id: string;
  role: "primary" | "spouse" | "dependent";
  /** Plain-English name for user-facing text ("You", "Your spouse", "Dependent 1"). */
  label: string;
  /** Possessive form ("Your", "Your spouse's", "Dependent 1's"). */
  possessive: string;
  /** Index of the income row in `years[i].incomes`, or -1 when no row (dependents only). */
  row: number;
  amounts: Record<IncomeField, number>;
  /** Declared uncertainty ranges (cents), by field. */
  ranges: Partial<Record<IncomeField, { low: number; high: number }>>;
}

export interface YearModel {
  year: TaxYear;
  yearIndex: 0 | 1;
  rules: RulePack;
  filing: Filing;
  familySize: number;
  ownerId: string;
  persons: PersonYear[];
  qualifyingChildren: number;
  otherDependents: number;
  /** Dependents counted for the conservative EITC refusal boundary (max 3). */
  eitcChildren: number;
  premium: number[];
  benchmark: number[];
  aptc: number[];
  uniformCoverage: boolean;
  ptcEligible: boolean;
  sehiEligible: boolean;
  benchmarkStatus: string;
  evidenceIds: string[];
}

export interface Variation {
  /** Change in the owner's Schedule C profit (receipts − expenses), cents. */
  profitDelta: number;
  /** Additional SEP contribution for this year, cents. */
  additionalSep: number;
}
export const NO_VARIATION: Variation = { profitDelta: 0, additionalSep: 0 };

/** Raised when a calculation would leave the supported or permitted region. */
export class EngineStop extends Error {
  constructor(public kind: "unsupported" | "infeasible" | "needs_data", public code: string, message: string,
    public path = "") { super(message); }
}
