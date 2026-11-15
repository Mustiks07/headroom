/**
 * Money result descriptors (round 6). Every money figure the engine returns to a reader carries what it
 * measures, against which baseline, over which horizon or by which date, and how precise it is. UI, PDF and
 * exports render labels from these fields and never relabel the number. Shape proposed to Claude 3 in
 * docs/handoffs/claude2-round6-contract-needs.md §1. Metric names follow the contract's MONEY_MEASURES (src/domain/actions.ts, 03ebf21);
 * settled_cash_year and credit_change are engine additions requested for the contract.
 */
import type { TaxYear } from "@/domain/contracts";

export const MONEY_METRICS = ["settled_two_year_cash", "settled_cash_year", "project_gross_by_date", "project_available_by_date",
  "household_balance", "retirement_principal", "credit_change"] as const;
export const COMPARISON_BASES = ["decline_unpaid_terms", "original_offer", "latest_client_offer", "agreed_terms", "household_proposal", "plan_before_change", "none"] as const;

export interface MoneyResult {
  metric: (typeof MONEY_METRICS)[number];
  amountCents: number | null;
  basis: { kind: (typeof COMPARISON_BASES)[number]; label: string };
  year: TaxYear | null;
  date: string | null;
  horizon: { from: string; through: string; settlementThrough: string } | null;
  precision: "exact" | "estimated_inputs" | "range_checked" | "conditional" | "not_calculable";
  conditions: string[];
}

export const METRIC_LABEL: Record<MoneyResult["metric"], string> = {
  settled_two_year_cash: "Spendable cash after both tax years settle",
  settled_cash_year: "Spendable cash after the year's tax and credit settle",
  project_gross_by_date: "Money received from the project by this date (before tax)",
  project_available_by_date: "Project money free to spend by this date (after costs, extra SEP and a tax reserve)",
  household_balance: "Household bank balance on this date",
  retirement_principal: "Added to retirement (not spendable cash)",
  credit_change: "Change in the premium tax credit",
};

export const HORIZON = { from: "2026-01-01", through: "2027-12-31", settlementThrough: "2028-04-18" } as const;

export function money(metric: MoneyResult["metric"], amountCents: number | null, basis: MoneyResult["basis"], extra: Partial<Omit<MoneyResult, "metric" | "amountCents" | "basis">> = {}): MoneyResult {
  return { metric, amountCents, basis, year: extra.year ?? null, date: extra.date ?? null,
    horizon: extra.horizon !== undefined ? extra.horizon : metric === "settled_two_year_cash" ? { ...HORIZON } : null,
    precision: amountCents === null ? "not_calculable" : extra.precision ?? "exact", conditions: (extra.conditions ?? []).slice(0, 5) };
}
