/**
 * Evaluate decisions the household ALREADY agreed to (receipts, expenses, SEP)
 * against the current facts, without re-optimizing them. Uses the same guards,
 * rules and year calculation as calculateComparison, so a saved plan can show
 * what its fixed actions now produce — or why they are no longer possible —
 * before any new option is suggested.
 */
import type { CaseInput, ScenarioKind, ScenarioResult, TaxYear } from "@/domain/contracts";
import { makeCtx, run, scenarioFromPlan, total, YEARS, yearIndexOf, type Models, type Plan } from "./comparison";
import { formatUsd } from "./money";
import { EngineStop } from "./model";

export interface AgreedPlan {
  /** Kind of the scenario that was chosen (kept for labels and checklist). */
  kind: ScenarioKind;
  label?: string;
  decisions: ScenarioResult["decisions"];
}

export interface AgreedPlanChange {
  year: TaxYear | null;
  item: "household_income" | "premium_tax_credit" | "settlement" | "spendable_cash" | "two_year_cash_change";
  label: string;
  previousCents: number;
  currentCents: number;
}

export interface AgreedPlanOutcome {
  /** The same decisions on the current facts; null when they can no longer be calculated. */
  agreed: ScenarioResult | null;
  /** True when the agreed actions are still allowed by the current facts and constraints. */
  stillFeasible: boolean;
  /** Why the agreed actions are no longer possible or allowed (plain English). */
  reasons: string[];
  /** Differences from the previously saved result, when one is supplied. */
  changes: AgreedPlanChange[];
  /** Years where the previous result had a premium tax credit and the agreed plan now has none. */
  creditLostYears: TaxYear[];
  warnings: string[];
}

export function evaluateAgreed(input: CaseInput, models: Models, plan: AgreedPlan, previous: ScenarioResult | null): AgreedPlanOutcome {
  const ctx = makeCtx(input, models);
  const o = input.opportunity, c = input.constraints;
  const reasons: string[] = [], warnings: string[] = [];
  const d = plan.decisions;
  const yearOk = (y: number) => y === 2026 || y === 2027;
  const badDates = d.receipts.filter(r => !yearOk(Number(r.date.slice(0, 4))));
  if (badDates.length) reasons.push(`Agreed payments dated ${badDates.map(r => r.date).join(", ")} fall outside the 2026–2027 years Headroom calculates.`);
  if ([...d.receipts.map(r => r.amountCents), ...d.expenses.map(e => e.amountCents), ...d.additionalSep.map(s => s.amountCents)].some(a => !Number.isInteger(a) || a < 0)) {
    reasons.push("Agreed amounts must be whole cents and not negative.");
  }
  const strangers = d.additionalSep.filter(s => s.personId !== o.ownerPersonId && s.amountCents > 0);
  if (strangers.length) reasons.push("The agreed SEP-IRA contribution is for someone who is no longer the business owner in this plan.");
  if (reasons.length) return { agreed: null, stillFeasible: false, reasons, changes: [], creditLostYears: [], warnings };

  const sep: [number, number] = [0, 0];
  for (const s of d.additionalSep) sep[YEARS.indexOf(s.year)] += s.amountCents;
  const fixed: Plan = {
    kind: plan.kind, label: plan.label ?? "Your agreed plan", revenue: d.grossRevenueCents,
    receipts: d.receipts.map(r => ({ date: r.date, amount: r.amountCents })),
    expenses: d.expenses.map(e => ({ yearIndex: YEARS.indexOf(e.year) as 0 | 1, amount: e.amountCents })),
    sep, reasons: [], assumptions: [...ctx.common, "Your agreed amounts and dates are kept exactly; nothing is re-optimized here."], actions: [],
  };

  // Constraints as they stand now.
  for (const yi of [0, 1] as const) {
    if (sep[yi] > c.maxAdditionalSepCents) fixed.reasons.push(`The agreed ${YEARS[yi]} SEP-IRA contribution of ${formatUsd(sep[yi])} is above your current maximum of ${formatUsd(c.maxAdditionalSepCents)}.`);
  }
  const plannedYear = yearIndexOf(o.plannedReceiptDate);
  const deferred = fixed.receipts.filter(r => yearIndexOf(r.date) > plannedYear && r.amount > 0);
  if (deferred.length) {
    if (!c.canSplitPayment) fixed.reasons.push("The plan moves part of the payment into 2027, but you now say the payment cannot be split.");
    if (o.timingArrangementConfirmed !== true) fixed.reasons.push("The client's agreement that the 2027 part is not payable or available before January 1, 2027 is no longer confirmed.");
    const late = c.nextYearPaymentLatestDate;
    for (const r of deferred) if (late === null || r.date > late) fixed.reasons.push(`The 2027 payment dated ${r.date} is after your latest acceptable date${late ? ` (${late})` : ""}.`);
  }
  const receiptTotal = fixed.receipts.reduce((a, r) => a + r.amount, 0);
  if (plan.kind !== "renegotiate" && receiptTotal !== o.grossRevenueCents) {
    warnings.push(`The agreed payments total ${formatUsd(receiptTotal)}, but the project amount is now ${formatUsd(o.grossRevenueCents)}; the agreed amounts are used.`);
  }
  const expenseTotal = fixed.expenses.reduce((a, e) => a + e.amount, 0);
  if (expenseTotal !== (receiptTotal > 0 ? o.incrementalExpensesCents : 0)) {
    warnings.push(`The agreed project expenses total ${formatUsd(expenseTotal)}, but the current entry is ${formatUsd(o.incrementalExpensesCents)}; the agreed amounts are used.`);
  }

  let ycs;
  try { ycs = run(models, fixed); } catch (e) {
    if (!(e instanceof EngineStop)) throw e;
    return { agreed: null, stillFeasible: false, reasons: [...fixed.reasons, `The agreed actions can no longer be carried out as planned: ${e.message}`],
      changes: [], creditLostYears: [], warnings };
  }
  const agreed = scenarioFromPlan(ctx, fixed, ycs, "agreed");
  const delta = total(ycs) - ctx.declineCash;
  if (delta < ctx.target) warnings.push(`With the new facts the agreed plan no longer reaches ${ctx.targetText} (two-year change ${formatUsd(delta)}).`);

  const changes: AgreedPlanChange[] = [];
  const creditLostYears: TaxYear[] = [];
  if (previous) {
    agreed.years.forEach((y, i) => {
      const p = previous.years[i];
      const push = (item: AgreedPlanChange["item"], label: string, prev: number, cur: number) => {
        if (prev !== cur) changes.push({ year: y.year, item, label: `${label} (${y.year})`, previousCents: prev, currentCents: cur });
      };
      push("household_income", "Household income for the premium tax credit", p.magiCents, y.magiCents);
      push("premium_tax_credit", "Premium tax credit", p.ptcCents, y.ptcCents);
      push("settlement", "Settlement on the return (+ repay / − receive)", p.aptcSettlementCents, y.aptcSettlementCents);
      push("spendable_cash", "Spendable cash after settlement", p.spendableAfterSettlementCents, y.spendableAfterSettlementCents);
      if (p.ptcCents > 0 && y.ptcCents === 0) creditLostYears.push(y.year);
    });
    if (previous.twoYearCashDeltaCents !== agreed.twoYearCashDeltaCents) {
      changes.push({ year: null, item: "two_year_cash_change", label: "Two-year cash change vs declining", previousCents: previous.twoYearCashDeltaCents, currentCents: agreed.twoYearCashDeltaCents });
    }
    for (const y of creditLostYears) warnings.push(`With the new facts, the agreed plan loses the ${y} premium tax credit.`);
  }
  return { agreed, stillFeasible: agreed.feasible, reasons: agreed.infeasibilityReasons, changes, creditLostYears, warnings };
}
