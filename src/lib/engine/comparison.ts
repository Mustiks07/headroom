/** Two-year scenario comparison: decline, accept, SEP, split payment, counteroffer, stress and ranking. */
import type { CaseInput, ScenarioKind, ScenarioResult, TaxYear } from "@/domain/contracts";
import { formatUsd } from "./money";
import { EngineStop, type Variation, type YearModel } from "./model";
import { firstMeeting, magiOf, magiThresholds, optimize, profitHeadroomDollars, ROUNDING_NOISE_CENTS, type MonotoneMagi } from "./search";
import { checkedPositions, hasRanges, modelAt, modelAtPositions, UNCERTAINTY_SCALE } from "./uncertainty";
import { evaluateYear, solveCredit, toYearResult, type YearComputation } from "./year";

export type Models = [YearModel, YearModel];
export const YEARS: [TaxYear, TaxYear] = [2026, 2027];

export interface Plan {
  kind: ScenarioKind;
  label: string;
  revenue: number;
  receipts: Array<{ date: string; amount: number }>;
  expenses: Array<{ yearIndex: 0 | 1; amount: number }>;
  sep: [number, number];
  reasons: string[];
  assumptions: string[];
  actions: ScenarioResult["actions"];
}

export const yearIndexOf = (date: string): 0 | 1 => (Number(date.slice(0, 4)) === 2026 ? 0 : 1);

export function variations(plan: Plan): [Variation, Variation] {
  const v: [Variation, Variation] = [{ profitDelta: 0, additionalSep: plan.sep[0] }, { profitDelta: 0, additionalSep: plan.sep[1] }];
  for (const r of plan.receipts) v[yearIndexOf(r.date)].profitDelta += r.amount;
  for (const e of plan.expenses) v[e.yearIndex].profitDelta -= e.amount;
  return v;
}

export function run(models: Models, plan: Plan): [YearComputation, YearComputation] {
  const v = variations(plan);
  return [evaluateYear(models[0], v[0]), evaluateYear(models[1], v[1])];
}
export const total = (ycs: [YearComputation, YearComputation]) => ycs[0].spendable + ycs[1].spendable;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function firstBusinessDay(year: number): string {
  let date = `${year}-01-02`;                       // January 1 is a federal holiday
  for (;;) {
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return date;
    date = addDays(date, 1);
  }
}

export function tryValue<T>(f: () => T): T | null {
  try { return f(); } catch (e) { if (e instanceof EngineStop) return null; throw e; }
}
export function runError(models: Models, plan: Plan): string {
  try { run(models, plan); return "unknown reason"; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

// ------------------------------------------------------------- shared context --
export interface Ctx {
  input: CaseInput;
  models: Models;
  decline: Plan;
  declineCash: number;
  target: number;
  targetText: string;
  anyRanges: boolean;
  common: string[];
  expenseList: Plan["expenses"];
}

export function makeCtx(input: CaseInput, models: Models): Ctx {
  const o = input.opportunity, c = input.constraints;
  const expenseList = o.incrementalExpensesCents > 0 ? [{ yearIndex: yearIndexOf(o.expensePaymentDate), amount: o.incrementalExpensesCents }] : [];
  const common = [
    "Planning estimate under current federal rules, not a tax return or Marketplace eligibility determination.",
    `Cash is measured after both tax years settle (2026 return due ${models[0].rules.returnDueDate}, 2027 return due ${models[1].rules.returnDueDate}), not a bank balance on December 31.`,
    "Any repayment of advance credit is counted once: premiums are modeled net of the final allowed credit.",
    o.incrementalExpensesCents > 0
      ? `Project expenses of ${formatUsd(o.incrementalExpensesCents)} stay in ${YEARS[expenseList[0].yearIndex]} (paid ${o.expensePaymentDate}); they do not move with receipts.`
      : "No extra project expenses entered.",
    "Your time and any other work you give up are not included.",
  ];
  const decline: Plan = { kind: "decline", label: "Decline the project", revenue: 0, receipts: [], expenses: [], sep: [0, 0], reasons: [],
    assumptions: [...common.slice(0, 3), "Baseline: your current forecast without this project."], actions: [] };
  const target = Math.max(0, c.minimumDesiredCashGainCents);
  return {
    input, models, decline, declineCash: total(run(models, decline)), target,
    targetText: target > 0 ? `your desired gain of ${formatUsd(target)}` : "break-even with declining",
    anyRanges: hasRanges(models[0]) || hasRanges(models[1]), common, expenseList,
  };
}

/** Checklist that follows the plan's actual decisions in both years. */
export function planActions(ctx: Ctx, plan: Plan, ycs: [YearComputation, YearComputation]): ScenarioResult["actions"] {
  const id = plan.kind;
  const actions: ScenarioResult["actions"] = [];
  for (const yi of [0, 1] as const) {
    const year = YEARS[yi];
    const received = plan.receipts.filter(r => yearIndexOf(r.date) === yi).reduce((a, r) => a + r.amount, 0);
    if (received > 0 || plan.sep[yi] > 0) {
      const sepNote = plan.sep[yi] > 0 ? `, less the planned ${formatUsd(plan.sep[yi])} SEP-IRA deduction` : "";
      const title = yi === 0
        ? `Update your ${year} Marketplace income estimate now: expected household income for the credit is about ${formatUsd(ycs[yi].credit.magi)} (including ${formatUsd(received)} from this project${sepNote}). Do not wait for the payment.`
        : `Use about ${formatUsd(ycs[yi].credit.magi)} as your ${year} household income when you apply or renew for ${year} coverage (including ${formatUsd(received)} from this project received in ${year}${sepNote}).`;
      actions.push({ id: `${id}-marketplace-${year}`, title, dueDate: null, sourceIds: ["healthcare-gov-report-changes"] });
    }
    if (plan.sep[yi] > 0) {
      actions.push({ id: `${id}-sep-${year}`, title: `Contribute ${formatUsd(plan.sep[yi])} to an owner-only SEP-IRA for ${year}; it can be made until the ${year} return due date (later if you file an extension).`,
        dueDate: ctx.models[yi].rules.returnDueDate, sourceIds: ["irs-pub-560"] });
    }
    if (plan.kind !== "decline" && ycs[yi].settlement > 0) {
      actions.push({ id: `${id}-settle-${year}`, title: `Set aside ${formatUsd(ycs[yi].settlement)} to repay advance credit on the ${year} return.`,
        dueDate: ctx.models[yi].rules.returnDueDate, sourceIds: ["irs-ptc-qa"] });
    }
  }
  return actions;
}

/**
 * Two-year cash change vs declining across INDEPENDENT declared ranges (see uncertainty.ts).
 * The option fails within the ranges when its conclusion at the entered values does not hold
 * everywhere: a combination becomes invalid/unsupported, a premium tax credit kept at the
 * entered values is lost, or a result that met the target falls below it.
 */
export function stressPlan(ctx: Ctx, plan: Plan): ScenarioResult["stress"] {
  if (!ctx.anyRanges) return { status: "not_tested", worstCashDeltaCents: null, checkedDescription: "No uncertainty range was declared for any income amount." };
  const pv = variations(plan), dv = variations(ctx.decline);
  const point = run(ctx.models, plan);
  const pointDelta = total(point) - ctx.declineCash;
  let worstTotal = 0;
  const worstAt: string[] = [];
  let failure: string | null = null;
  const summaries: string[] = [];
  for (const yi of [0, 1] as const) {
    const model = ctx.models[yi];
    const { positions, summary } = checkedPositions(model, [pv[yi], dv[yi]]);
    if (summary) summaries.push(summary);
    let worst: { delta: number; description: string } | null = null;
    for (const p of positions) {
      const m = modelAtPositions(model, p.pos);
      try {
        const s = evaluateYear(m, pv[yi]), d = evaluateYear(m, dv[yi]);
        const delta = s.spendable - d.spendable;
        if (!worst || delta < worst.delta) worst = { delta, description: p.description };
        if (!failure && point[yi].credit.ptc.ptc > 0 && s.credit.ptc.ptc === 0) failure = `the ${YEARS[yi]} premium tax credit is lost with ${p.description}`;
      } catch (e) {
        if (!(e instanceof EngineStop)) throw e;
        if (!failure) failure = `the option is not valid with ${p.description}: ${e.message}`;
      }
    }
    if (worst) { worstTotal += worst.delta; if (summary) worstAt.push(`${YEARS[yi]}: ${worst.description}`); }
  }
  if (!failure && pointDelta >= ctx.target && worstTotal < ctx.target) {
    failure = `the two-year result can fall below ${ctx.target > 0 ? "your desired gain" : "declining"}`;
  }
  const checked = `Ranges treated as independent. Checked ${summaries.join("; ")}. Credit loss and validity are decided for every combination (each ranged amount only raises household income, so the extremes are the all-high and all-low combinations); the cash figure is the worst among the checked combinations, not a proven minimum.`;
  return { status: failure ? "fails_within_range" : "within_declared_range", worstCashDeltaCents: worstTotal,
    checkedDescription: `${checked}${failure ? ` Within the ranges, ${failure}.` : " The result at your entered values holds across the ranges."} Worst checked two-year cash change ${formatUsd(worstTotal)} (${worstAt.join("; ")}).` };
}

export function scenarioFromPlan(ctx: Ctx, plan: Plan, ycs: [YearComputation, YearComputation], id: string = plan.kind): ScenarioResult {
  const v = variations(plan);
  const extra = (yi: 0 | 1) => (v[yi].profitDelta !== 0 ? ["opportunity.grossRevenueCents", "opportunity.plannedReceiptDate"] : []);
  return {
    id, kind: plan.kind, label: plan.label, feasible: plan.reasons.length === 0, infeasibilityReasons: plan.reasons,
    decisions: {
      grossRevenueCents: plan.revenue,
      receipts: plan.receipts.map(r => ({ date: r.date, amountCents: r.amount })),
      expenses: plan.expenses.map(e => ({ year: YEARS[e.yearIndex], amountCents: e.amount })),
      additionalSep: plan.sep.flatMap((s, i) => (s > 0 ? [{ year: YEARS[i], personId: ctx.input.opportunity.ownerPersonId, amountCents: s }] : [])),
    },
    years: [toYearResult(ctx.models[0], ycs[0], extra(0)), toYearResult(ctx.models[1], ycs[1], extra(1))],
    twoYearCashDeltaCents: total(ycs) - ctx.declineCash,
    grossAdditionalRetirementCents: plan.sep[0] + plan.sep[1],
    assumptions: plan.assumptions,
    actions: [...plan.actions, ...planActions(ctx, plan, ycs)],
    stress: plan.kind === "decline" ? { status: "not_tested", worstCashDeltaCents: null, checkedDescription: "Baseline for comparison." } : stressPlan(ctx, plan),
  };
}

function searchNote(step: number): string {
  return step === 1 ? "every whole dollar checked"
    : `subsidy thresholds checked exactly, every $${step} otherwise with a $1 scan around the best point; the true best can be better by at most about ${formatUsd(step * 200 + ROUNDING_NOISE_CENTS)}`;
}

export interface ComparisonOutput {
  scenarios: ScenarioResult[];
  baselineScenarioId: string;
  recommendedScenarioId: string | null;
  warnings: string[];
}

export function compare(input: CaseInput, models: Models): ComparisonOutput {
  const ctx = makeCtx(input, models);
  const o = input.opportunity, c = input.constraints;
  const warnings: string[] = [];
  const G = o.grossRevenueCents;
  const ry = yearIndexOf(o.plannedReceiptDate);
  const receiptYear = YEARS[ry];
  const make = (kind: ScenarioKind, label: string, receipts: Plan["receipts"], sep: [number, number] = [0, 0]): Plan => ({
    kind, label, revenue: receipts.reduce((a, r) => a + r.amount, 0), receipts, expenses: receipts.length ? ctx.expenseList : [],
    sep, reasons: [], assumptions: [...ctx.common], actions: [] });

  const plans: Plan[] = [ctx.decline];
  const accept = make("accept_now", `Accept as offered: ${formatUsd(G)} received ${o.plannedReceiptDate}`, [{ date: o.plannedReceiptDate, amount: G }]);
  plans.push(accept);
  if (G === 0) warnings.push("No project amount entered; only the current forecast is compared.");

  const acceptV = variations(accept);
  const acceptYcs = tryValue(() => run(models, accept));
  const ryModel = models[ry];
  const yearMagi = (m: YearModel, f: (v: number) => Variation): MonotoneMagi => ({ magi: v => magiOf(m, f(v)), thresholds: magiThresholds(m) });
  const budget = Math.floor(c.maxAdditionalSepCents / 100);

  // ---------------------------------------------------------- SEP options --
  let sepMin: { s: number; feasible: boolean } | null = null;
  if (G > 0 && acceptYcs) {
    const base = acceptV[ry];
    const legalRoom = Math.floor((acceptYcs[ry].credit.sepMax - acceptYcs[ry].credit.sepExisting) / 100);
    const objective = (m: YearModel) => (s: number) => evaluateYear(m, { ...base, additionalSep: s * 100 }).spendable;
    const sepMagi = (m: YearModel) => yearMagi(m, s => ({ ...base, additionalSep: s * 100 }));
    const at0 = acceptYcs[ry].spendable;
    const inBudgetTop = Math.min(budget, legalRoom);
    const inBudget = optimize(0, inBudgetTop, objective(ryModel), [sepMagi(ryModel)], "low");
    const unlimited = optimize(0, legalRoom, objective(ryModel), [sepMagi(ryModel)], "low");
    const label = (s: number) => `Accept + SEP-IRA contribution ${formatUsd(s * 100)} for ${receiptYear}`;
    const sepAssumptions = (s: number) => [...ctx.common,
      `Owner-only SEP: no eligible employees and no conflicting retirement plan. The ${receiptYear} legal room for this option is ${formatUsd(legalRoom * 100)}.`,
      `${formatUsd(s * 100)} goes to retirement savings; it is not spendable and is taxed when withdrawn later.`];
    const sepPair = (s: number): [number, number] => (ry === 0 ? [s * 100, 0] : [0, s * 100]);
    if (inBudget && inBudget.v > 0 && inBudget.value > at0) {
      const p = make("sep_minimum", label(inBudget.v), accept.receipts, sepPair(inBudget.v));
      p.assumptions = [...sepAssumptions(inBudget.v),
        `Smallest contribution giving the most spendable cash among $0–${formatUsd(inBudgetTop * 100)} (your maximum and the legal limit; ${searchNote(inBudget.step)}).`];
      plans.push(p); sepMin = { s: inBudget.v, feasible: true };
    } else if (unlimited && unlimited.v > 0 && unlimited.value > at0) {
      const p = make("sep_minimum", label(unlimited.v), accept.receipts, sepPair(unlimited.v));
      p.reasons.push(`Needs ${formatUsd(unlimited.v * 100)}, above your maximum additional contribution of ${formatUsd(budget * 100)}.`);
      p.assumptions = [...sepAssumptions(unlimited.v), `Searched up to the legal limit (${searchNote(unlimited.step)}).`];
      plans.push(p); sepMin = { s: unlimited.v, feasible: false };
    } else {
      warnings.push(legalRoom <= 0 ? "No SEP-IRA room is available for this option." :
        "An additional SEP-IRA contribution does not increase spendable cash for this project; any contribution would be optional retirement saving.");
    }

    // Buffer: keep the credit across the declared ranges, or use the user's own maximum when no range is declared.
    const sMin = sepMin?.feasible ? sepMin.s : 0;
    if (hasRanges(ryModel)) {
      const high = modelAt(ryModel, UNCERTAINTY_SCALE), low = modelAt(ryModel, -UNCERTAINTY_SCALE);
      const keeps = (x: number) => { const cr = tryValue(() => solveCredit(high, { ...base, additionalSep: x * 100 }, false)); return cr !== null && cr.ptc.ptc > 0; };
      const highRoom = tryValue(() => { const cr = solveCredit(high, base); return Math.floor((cr.sepMax - cr.sepExisting) / 100); });
      if (!ryModel.ptcEligible || keeps(sMin)) {
        if (sMin > 0) warnings.push("The minimum SEP-IRA contribution already keeps the credit for every combination of your declared ranges.");
      } else if (highRoom === null || !keeps(highRoom)) {
        warnings.push("With every declared range at its high end, no allowed SEP-IRA contribution keeps the premium tax credit.");
      } else {
        let lo = sMin, hi = highRoom;            // solved household income falls monotonically as the contribution rises
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (keeps(mid)) hi = mid; else lo = mid + 1; }
        const v = lo;
        const p = make("sep_buffer", `Accept + SEP-IRA ${formatUsd(v * 100)}: keeps the credit for every combination of your declared ranges`, accept.receipts, sepPair(v));
        if (v > budget) p.reasons.push(`Needs ${formatUsd(v * 100)}, above your maximum additional contribution of ${formatUsd(budget * 100)}.`);
        const lowCredit = tryValue(() => solveCredit(low, base, false));
        if (lowCredit && v * 100 + lowCredit.sepExisting > lowCredit.sepMax) {
          p.reasons.push(`If every range ends at its low end, the legal SEP-IRA limit is ${formatUsd(lowCredit.sepMax)}; size the contribution after income is known.`);
        }
        if (v > legalRoom) p.reasons.push(`At your entered income the legal SEP-IRA room is ${formatUsd(legalRoom * 100)}.`);
        p.assumptions = [...sepAssumptions(v),
          "Smallest whole-dollar contribution that keeps the credit with every declared range at its high end; because each ranged amount only raises household income, that covers every combination. A SEP-IRA can be funded until the return due date, so you can contribute less once actual income is known."];
        plans.push(p);
      }
    } else if (sepMin?.feasible) {
      const s = Math.min(budget, legalRoom);
      if (s > sMin) {
        const p = make("sep_buffer", `Accept + SEP-IRA ${formatUsd(s * 100)} (your maximum, adds margin)`, accept.receipts, sepPair(s));
        const margin = tryValue(() => profitHeadroomDollars(ryModel, { ...base, additionalSep: s * 100 }));
        p.assumptions = [...sepAssumptions(s), "No uncertainty range was declared; this uses your stated maximum contribution as the margin.",
          margin !== null && margin !== undefined ? `About ${formatUsd(margin * 100)} of extra ${receiptYear} profit could arrive before the credit is lost.` : "The margin before the credit is lost could not be computed."];
        plans.push(p);
      }
    }
  }

  // ---------------------------------------------------------- split payment --
  if (G > 0 && acceptYcs) {
    if (!c.canSplitPayment) warnings.push("Split payment not shown: you said the payment cannot be split.");
    else if (ry !== 0) warnings.push("Split payment not shown: the project is already paid in 2027.");
    else {
      const secondDate = firstBusinessDay(2027);
      const late = c.nextYearPaymentLatestDate;
      const Gd = Math.floor(G / 100);
      const receiptsFor = (x: number) => [{ date: o.plannedReceiptDate, amount: x * 100 }, { date: secondDate, amount: G - x * 100 }];
      const vy = (x: number) => variations(make("split_payment", "", receiptsFor(x)));
      const objective = (x: number) => { const v = vy(x); return evaluateYear(models[0], v[0]).spendable + evaluateYear(models[1], v[1]).spendable; };
      const best = optimize(0, Gd, objective, [yearMagi(models[0], x => vy(x)[0]), yearMagi(models[1], x => vy(x)[1])], "high");
      if (!best || best.v === Gd || best.value <= total(acceptYcs)) {
        warnings.push("Moving part of the payment into 2027 does not improve the two-year result.");
      } else {
        const first = best.v * 100, second = G - first;
        const p = make("split_payment", `Split: ${formatUsd(first)} by ${o.plannedReceiptDate}, ${formatUsd(second)} on or after ${secondDate}`,
          receiptsFor(best.v).filter(r => r.amount > 0));
        if (late === null) p.reasons.push("Enter the latest date the client could pay the second part.");
        else if (late < secondDate) p.reasons.push(`The second part would arrive ${secondDate}, after your latest acceptable date ${late}.`);
        if (o.timingArrangementConfirmed !== true) p.reasons.push("Confirm with the client in writing that the second part is not payable or available to you before January 1, 2027.");
        p.assumptions = [...ctx.common,
          "Cash method: income counts when actually or constructively received. An invoice dated in January does not by itself move income; the money must not be available to you in 2026.",
          `Best 2026 portion searched from $0 to ${formatUsd(G)} (${searchNote(best.step)}).`,
          `Both tax years change: the 2027 part raises 2027 income, credit and taxes, settled on the 2027 return (${models[1].rules.returnDueDate}).`];
        p.actions = [
          { id: "split-agreement", title: `Agree a written payment schedule with the client: ${formatUsd(first)} in 2026 and ${formatUsd(second)} on or after ${secondDate}${late ? `, no later than ${late}` : ""}.`,
            dueDate: o.plannedReceiptDate, sourceIds: ["irs-pub-334"] },
          { id: "split-no-access", title: "Do not receive, or have access to, the second payment before January 1, 2027.", dueDate: "2026-12-31", sourceIds: ["irs-pub-334"] },
        ];
        plans.push(p);
      }
    }
  }

  // ------------------------------------------------------------ counteroffer --
  if (G > 0 && acceptYcs) {
    const acceptDelta = total(acceptYcs) - ctx.declineCash;
    if (!c.canRenegotiatePrice) warnings.push("Counteroffer not shown: you said the price cannot be renegotiated.");
    else if (acceptDelta >= ctx.target) warnings.push(`The offered price already reaches ${ctx.targetText}; no counteroffer is needed.`);
    else {
      const Gd = Math.floor(G / 100);
      const hi = Gd + Math.max(Gd, 30000);
      const other = 1 - ry as 0 | 1;
      const otherCash = evaluateYear(models[other], acceptV[other]).spendable;
      const vAt = (p: number): Variation => ({ ...acceptV[ry], profitDelta: acceptV[ry].profitDelta + (p - Gd) * 100 });
      const found = firstMeeting(Gd, hi, p => evaluateYear(ryModel, vAt(p)).spendable + otherCash - ctx.declineCash >= ctx.target,
        [yearMagi(ryModel, vAt)]);
      if (found.v === null) {
        warnings.push(`No price up to ${formatUsd(hi * 100)} reaches ${ctx.targetText}.`);
      } else {
        const price = found.v * 100 + (G - Gd * 100);
        const p = make("renegotiate", `Counteroffer at ${formatUsd(price)} (reaches ${ctx.targetText})`, [{ date: o.plannedReceiptDate, amount: price }]);
        p.assumptions = [...ctx.common,
          found.exact
            ? `Lowest whole-dollar price at or above the offer (${formatUsd(G)}) that reaches ${ctx.targetText}: every dollar from the offer up to this price was checked.`
            : `Lowest price found at or above the offer (${formatUsd(G)}) that reaches ${ctx.targetText}, searched up to ${formatUsd(hi * 100)} (${searchNote(found.step)}); a slightly lower qualifying price is possible.`,
          "Requires the client to agree. This is a target for your finances, not a statement that the price is fair for your time."];
        p.actions = [{ id: "counteroffer", title: `Propose ${formatUsd(price)} instead of ${formatUsd(G)}.`, dueDate: null, sourceIds: ["headroom-engine-policy"] }];
        plans.push(p);
      }
    }
  }

  // ------------------------------------------------------------ results --
  const scenarios: ScenarioResult[] = [];
  for (const plan of plans) {
    const ycs = tryValue(() => run(models, plan));
    if (!ycs) { warnings.push(`${plan.label}: not calculated — ${runError(models, plan)}`); continue; }
    if (plan.kind !== "decline") {
      for (const [i, s] of plan.sep.entries()) {
        if (s > c.maxAdditionalSepCents && !plan.reasons.some(r => r.includes("maximum"))) plan.reasons.push(`SEP-IRA ${formatUsd(s)} in ${YEARS[i]} exceeds your maximum.`);
      }
    }
    scenarios.push(scenarioFromPlan(ctx, plan, ycs));
  }

  // ------------------------------------------------------------ ranking --
  const order: ScenarioKind[] = ["accept_now", "sep_minimum", "split_payment", "renegotiate", "sep_buffer", "decline"];
  const eligible = scenarios.filter(s => s.feasible && (s.kind === "decline" ? ctx.target === 0 : s.twoYearCashDeltaCents >= ctx.target));
  const rank = (a: ScenarioResult, b: ScenarioResult) => {
    if (c.objective === "retirement_and_cash" && a.grossAdditionalRetirementCents !== b.grossAdditionalRetirementCents) {
      return b.grossAdditionalRetirementCents - a.grossAdditionalRetirementCents;
    }
    if (Math.abs(a.twoYearCashDeltaCents - b.twoYearCashDeltaCents) > 100) return b.twoYearCashDeltaCents - a.twoYearCashDeltaCents;
    return order.indexOf(a.kind) - order.indexOf(b.kind);
  };
  const recommended = eligible.length ? [...eligible].sort(rank)[0] : null;
  if (!recommended) warnings.push(`No available option reaches ${ctx.targetText}.`);
  if (c.objective === "retirement_and_cash") {
    warnings.push("Ranking favours retirement contributions while keeping spendable cash at or above your minimum; retirement dollars are taxed on withdrawal and are not spendable now.");
  }
  if (recommended && recommended.stress.status === "fails_within_range") {
    warnings.push(`The recommended option can fall short within your declared ranges: ${recommended.stress.checkedDescription}`);
  }
  if (recommended?.kind === "accept_now" && !scenarios.some(s => s.kind !== "accept_now" && s.kind !== "decline" && s.feasible && s.twoYearCashDeltaCents > recommended.twoYearCashDeltaCents + 100)) {
    warnings.push("No special action is needed: accepting as offered is the best available option.");
  }
  return { scenarios, baselineScenarioId: "decline", recommendedScenarioId: recommended?.id ?? null, warnings };
}
