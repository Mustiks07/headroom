/** Two-year scenario comparison: decline, accept, SEP, split payment, counteroffer, stress and ranking. */
import type { CaseInput, ScenarioKind, ScenarioResult, TaxYear } from "@/domain/contracts";
import { formatUsd } from "./money";
import { EngineStop, type Variation, type YearModel } from "./model";
import { UNCERTAINTY_SCALE, firstMeeting, hasRanges, magiOf, magiThresholds, modelAt, optimize, profitHeadroomDollars,
  ROUNDING_NOISE_CENTS, type MonotoneMagi } from "./search";
import { evaluateYear, solveCredit, toYearResult, type YearComputation } from "./year";

type Models = [YearModel, YearModel];
const YEARS: [TaxYear, TaxYear] = [2026, 2027];

interface Plan {
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

const yearIndexOf = (date: string): 0 | 1 => (Number(date.slice(0, 4)) === 2026 ? 0 : 1);

function variations(plan: Plan): [Variation, Variation] {
  const v: [Variation, Variation] = [{ profitDelta: 0, additionalSep: plan.sep[0] }, { profitDelta: 0, additionalSep: plan.sep[1] }];
  for (const r of plan.receipts) v[yearIndexOf(r.date)].profitDelta += r.amount;
  for (const e of plan.expenses) v[e.yearIndex].profitDelta -= e.amount;
  return v;
}

function run(models: Models, plan: Plan): [YearComputation, YearComputation] {
  const v = variations(plan);
  return [evaluateYear(models[0], v[0]), evaluateYear(models[1], v[1])];
}
const total = (ycs: [YearComputation, YearComputation]) => ycs[0].spendable + ycs[1].spendable;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function firstBusinessDay(year: number): string {
  let date = `${year}-01-02`;
  for (;;) {
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return date;
    date = addDays(date, 1);
  }
}

export interface ComparisonOutput {
  scenarios: ScenarioResult[];
  baselineScenarioId: string;
  recommendedScenarioId: string | null;
  warnings: string[];
}

export function compare(input: CaseInput, models: Models): ComparisonOutput {
  const o = input.opportunity, c = input.constraints;
  const warnings: string[] = [];
  const G = o.grossRevenueCents;
  const ry = yearIndexOf(o.plannedReceiptDate);
  const receiptYear = YEARS[ry];
  const expenseList = o.incrementalExpensesCents > 0 ? [{ yearIndex: yearIndexOf(o.expensePaymentDate), amount: o.incrementalExpensesCents }] : [];
  const expenseNote = o.incrementalExpensesCents > 0
    ? `Project expenses ${formatUsd(o.incrementalExpensesCents)} stay in ${YEARS[expenseList[0].yearIndex]} (paid ${o.expensePaymentDate}); they do not move with receipts.`
    : "No incremental project expenses entered.";
  const returnDue = (yi: 0 | 1) => models[yi].rules.returnDueDate;
  const marketplaceAction = (date: string, id: string) => ({ id: `${id}-marketplace`, title: `Update your Marketplace income estimate for ${date.slice(0, 4)} as soon as your expected income changes; do not wait for payment`,
    dueDate: null, sourceIds: ["healthcare-gov-report-changes"] });
  const common = [
    "Planning estimate under current federal rules, not a tax return or Marketplace eligibility determination.",
    `Cash is measured after both tax years settle (2026 return due ${returnDue(0)}, 2027 return due ${returnDue(1)}), not a bank balance on December 31.`,
    "APTC repayment is counted once: premiums are modeled net of the final allowed credit.",
    expenseNote,
    "Labor time and opportunity cost are not included.",
  ];

  const make = (kind: ScenarioKind, label: string, receipts: Plan["receipts"], sep: [number, number] = [0, 0]): Plan => ({
    kind, label, revenue: receipts.reduce((a, r) => a + r.amount, 0), receipts, expenses: receipts.length ? expenseList : [],
    sep, reasons: [], assumptions: [...common], actions: [] });

  // ---------------------------------------------------------------- baseline --
  const decline = make("decline", "Decline the project", []);
  decline.assumptions = [...common.filter(a => a !== expenseNote), "Baseline: your current forecast without this project."];
  const declineYcs = run(models, decline);
  const declineCash = total(declineYcs);

  const plans: Plan[] = [decline];
  const accept = make("accept_now", `Accept as offered: ${formatUsd(G)} received ${o.plannedReceiptDate}`, [{ date: o.plannedReceiptDate, amount: G }]);
  accept.actions.push(marketplaceAction(o.plannedReceiptDate, "accept"));
  plans.push(accept);
  if (G === 0) warnings.push("No project amount entered; only the current forecast is compared.");

  const acceptV = variations(accept);
  const acceptYcs = tryRun(models, accept);
  const ryModel = models[ry];
  const yearMagi = (m: YearModel, f: (v: number) => Variation): MonotoneMagi => ({ magi: v => magiOf(m, f(v)), thresholds: magiThresholds(m) });

  // ---------------------------------------------------------- SEP options --
  let sepMin: { s: number; feasible: boolean } | null = null;
  if (G > 0 && acceptYcs) {
    const base = acceptV[ry];
    const legalRoom = Math.floor((acceptYcs[ry].credit.sepMax - acceptYcs[ry].credit.sepExisting) / 100);
    const budget = Math.floor(c.maxAdditionalSepCents / 100);
    const objective = (m: YearModel) => (s: number) => evaluateYear(m, { ...base, additionalSep: s * 100 }).spendable;
    const sepMagi = (m: YearModel) => yearMagi(m, s => ({ ...base, additionalSep: s * 100 }));
    const at0 = acceptYcs[ry].spendable;
    const inBudget = optimize(0, Math.min(budget, legalRoom), objective(ryModel), [sepMagi(ryModel)], "low");
    const unlimited = optimize(0, legalRoom, objective(ryModel), [sepMagi(ryModel)], "low");
    const label = (s: number) => `Accept + SEP-IRA contribution ${formatUsd(s * 100)} for ${receiptYear}`;
    const sepActions = (s: number, id: string) => [
      { id: `${id}-sep`, title: `Contribute ${formatUsd(s * 100)} to an owner-only SEP-IRA for ${receiptYear} (deadline: the ${receiptYear} return due date, or the extended date if you extend)`,
        dueDate: returnDue(ry), sourceIds: ["irs-pub-560"] },
      marketplaceAction(o.plannedReceiptDate, id)];
    const sepAssumptions = (s: number) => [...common,
      `Owner-only SEP: no eligible employees and no conflicting retirement plan. The ${receiptYear} legal room for this option is ${formatUsd(legalRoom * 100)}.`,
      `${formatUsd(s * 100)} goes to retirement savings; it is not spendable and is taxed when withdrawn later.`];
    if (inBudget && inBudget.v > 0 && inBudget.value > at0) {
      const p = make("sep_minimum", label(inBudget.v), accept.receipts, ry === 0 ? [inBudget.v * 100, 0] : [0, inBudget.v * 100]);
      p.assumptions = [...sepAssumptions(inBudget.v), `Smallest contribution giving the most spendable cash (searched $0–${formatUsd(Math.min(budget, legalRoom) * 100)}; ${searchNote(inBudget.step)}).`];
      p.actions = sepActions(inBudget.v, "sep-min");
      plans.push(p); sepMin = { s: inBudget.v, feasible: true };
    } else if (unlimited && unlimited.v > 0 && unlimited.value > at0) {
      const p = make("sep_minimum", label(unlimited.v), accept.receipts, ry === 0 ? [unlimited.v * 100, 0] : [0, unlimited.v * 100]);
      p.reasons.push(`Needs ${formatUsd(unlimited.v * 100)}, above your maximum additional contribution of ${formatUsd(budget * 100)}.`);
      p.assumptions = sepAssumptions(unlimited.v);
      p.actions = sepActions(unlimited.v, "sep-min");
      plans.push(p); sepMin = { s: unlimited.v, feasible: false };
    } else {
      warnings.push(legalRoom <= 0 ? "No SEP room is available for this option." :
        "An additional SEP contribution does not increase spendable cash for this project; any contribution would be optional retirement saving.");
    }

    // Buffer: tolerate the declared uncertainty, or the user's own maximum when no range is declared.
    const sMin = sepMin?.feasible ? sepMin.s : 0;
    if (hasRanges(ryModel) || sepMin?.feasible) {
      if (hasRanges(ryModel)) {
        const high = modelAt(ryModel, UNCERTAINTY_SCALE), low = modelAt(ryModel, -UNCERTAINTY_SCALE);
        // Smallest contribution that keeps the credit at the high end of every declared range.
        const highCredit = (x: number) => tryValue(() => solveCredit(high, { ...base, additionalSep: x * 100 }, false));
        const highRoom = tryValue(() => { const cr = solveCredit(high, base); return Math.floor((cr.sepMax - cr.sepExisting) / 100); });
        const keeps = (x: number) => { const cr = highCredit(x); return cr !== null && cr.ptc.ptc > 0; };
        if (!ryModel.ptcEligible || keeps(sMin)) {
          if (sMin > 0) warnings.push("The minimum SEP contribution already keeps the credit across your declared income ranges.");
        } else if (highRoom === null || !keeps(highRoom)) {
          warnings.push("At the high end of your declared income ranges, no allowed SEP contribution keeps the premium tax credit.");
        } else {
          let lo = sMin, hi = highRoom;            // solved MAGI falls monotonically as the contribution rises
          while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (keeps(mid)) hi = mid; else lo = mid + 1; }
          const v = lo;
          const p = make("sep_buffer", `Accept + SEP-IRA ${formatUsd(v * 100)}: keeps the credit across your declared income range`, accept.receipts,
            ry === 0 ? [v * 100, 0] : [0, v * 100]);
          if (v > budget) p.reasons.push(`Needs ${formatUsd(v * 100)}, above your maximum additional contribution of ${formatUsd(budget * 100)}.`);
          const lowCredit = tryValue(() => solveCredit(low, base, false));
          if (lowCredit && v * 100 + lowCredit.sepExisting > lowCredit.sepMax) {
            p.reasons.push(`At the low end of your range the legal SEP limit is ${formatUsd(lowCredit.sepMax)}; size the contribution after income is known.`);
          }
          if (v > legalRoom) p.reasons.push(`At your entered income the legal SEP room is ${formatUsd(legalRoom * 100)}.`);
          p.assumptions = [...sepAssumptions(v),
            "Sized so the credit is kept even if every declared income range ends at its high end. A SEP can be funded until the return due date, so you can contribute less once actual income is known."];
          p.actions = sepActions(v, "sep-buffer");
          plans.push(p);
        }
      } else {
        const s = Math.min(budget, legalRoom);
        if (s > sMin) {
          const p = make("sep_buffer", `Accept + SEP-IRA ${formatUsd(s * 100)} (your maximum, adds margin)`, accept.receipts, ry === 0 ? [s * 100, 0] : [0, s * 100]);
          const margin = tryValue(() => profitHeadroomDollars(ryModel, { ...base, additionalSep: s * 100 }));
          p.assumptions = [...sepAssumptions(s), "No uncertainty range was declared; this uses your stated maximum contribution as the margin.",
            margin !== null && margin !== undefined ? `About ${formatUsd(margin * 100)} of extra ${receiptYear} profit could arrive before the credit is lost.` : "Margin before credit loss could not be computed."];
          p.actions = sepActions(s, "sep-buffer");
          plans.push(p);
        }
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
      const objective = (x: number) => {
        const p = make("split_payment", "", [{ date: o.plannedReceiptDate, amount: x * 100 }, { date: secondDate, amount: G - x * 100 }].filter(r => r.amount > 0));
        return total(run(models, p));
      };
      const Gd = Math.floor(G / 100);
      const vy = (x: number): [Variation, Variation] => {
        const p = make("split_payment", "", [{ date: o.plannedReceiptDate, amount: x * 100 }, { date: secondDate, amount: G - x * 100 }]);
        return variations(p);
      };
      const best = optimize(0, Gd, objective, [yearMagi(models[0], x => vy(x)[0]), yearMagi(models[1], x => vy(x)[1])], "high");
      if (!best || best.v === Gd || best.value <= (acceptYcs ? total(acceptYcs) : -Infinity)) {
        warnings.push("Moving part of the payment into 2027 does not improve the two-year result.");
      } else {
        const first = best.v * 100, second = G - first;
        const p = make("split_payment", `Split: ${formatUsd(first)} by ${o.plannedReceiptDate}, ${formatUsd(second)} on or after ${secondDate}`,
          [{ date: o.plannedReceiptDate, amount: first }, { date: secondDate, amount: second }].filter(r => r.amount > 0));
        if (late === null) p.reasons.push("Enter the latest date the client could pay the second part.");
        else if (late < secondDate) p.reasons.push(`The second part would arrive ${secondDate}, after your latest acceptable date ${late}.`);
        if (o.timingArrangementConfirmed !== true) p.reasons.push("Confirm with the client in writing that the second part is not payable or available to you before January 1, 2027.");
        p.assumptions = [...common,
          "Cash method: income counts when actually or constructively received. An invoice dated in January does not by itself move income; the money must not be available to you in 2026.",
          `Best split searched over every $1–${formatUsd(G)} allocation (${searchNote(best.step)}).`,
          `Both tax years change: 2027 income, credit and taxes settle on the 2027 return (${returnDue(1)}).`];
        p.actions = [
          { id: "split-agreement", title: `Agree a written payment schedule: ${formatUsd(first)} in 2026 and ${formatUsd(second)} on or after ${secondDate}${late ? `, no later than ${late}` : ""}`,
            dueDate: o.plannedReceiptDate, sourceIds: ["irs-pub-334"] },
          { id: "split-no-access", title: "Do not receive, or have access to, the second payment before January 1, 2027", dueDate: "2026-12-31", sourceIds: ["irs-pub-334"] },
          marketplaceAction(o.plannedReceiptDate, "split"),
        ];
        plans.push(p);
      }
    }
  }

  // ------------------------------------------------------------ counteroffer --
  const target = Math.max(0, c.minimumDesiredCashGainCents);
  const targetText = target > 0 ? `your desired gain of ${formatUsd(target)}` : "break-even with declining";
  if (G > 0 && acceptYcs) {
    const acceptDelta = total(acceptYcs) - declineCash;
    if (!c.canRenegotiatePrice) warnings.push("Counteroffer not shown: you said the price cannot be renegotiated.");
    else if (acceptDelta >= target) warnings.push(`The offered price already reaches ${targetText}; no counteroffer is needed.`);
    else {
      const Gd = Math.floor(G / 100);
      const hi = Gd + Math.max(Gd, 30000);
      const priced = (p: number) => make("renegotiate", "", [{ date: o.plannedReceiptDate, amount: p * 100 }]);
      const found = firstMeeting(Gd, hi, p => total(run(models, priced(p))) - declineCash >= target,
        [yearMagi(ryModel, p => variations(priced(p))[ry])]);
      if (found.v === null) {
        warnings.push(`No price up to ${formatUsd(hi * 100)} reaches ${targetText}.`);
      } else {
        const p = make("renegotiate", `Counteroffer at ${formatUsd(found.v * 100)} (reaches ${targetText})`, [{ date: o.plannedReceiptDate, amount: found.v * 100 }]);
        p.assumptions = [...common,
          `Lowest price at or above the offer (${formatUsd(G)}) that reaches ${targetText}, searched up to ${formatUsd(hi * 100)} including every subsidy threshold (${searchNote(found.step)}).`,
          "Requires the client to agree; this is a target, not a statement that the price is fair for your time."];
        p.actions = [{ id: "counteroffer", title: `Propose ${formatUsd(found.v * 100)} instead of ${formatUsd(G)}`, dueDate: null, sourceIds: ["headroom-engine-policy"] },
          marketplaceAction(o.plannedReceiptDate, "counteroffer")];
        plans.push(p);
      }
    }
  }

  // ------------------------------------------------------------ results --
  const anyRanges = hasRanges(models[0]) || hasRanges(models[1]);
  const scenarios: ScenarioResult[] = [];
  for (const plan of plans) {
    const ycs = tryRun(models, plan);
    if (!ycs) {
      const why = runError(models, plan);
      warnings.push(`${plan.label}: not calculated — ${why}`);
      continue;
    }
    const v = variations(plan);
    const extra = (yi: 0 | 1) => (v[yi].profitDelta !== 0 ? ["opportunity.grossRevenueCents", "opportunity.plannedReceiptDate"] : []);
    const delta = total(ycs) - declineCash;
    const id = plan.kind;
    if (plan.kind !== "decline" && plan.reasons.length === 0) {
      for (const [i, s] of plan.sep.entries()) if (s > c.maxAdditionalSepCents) plan.reasons.push(`SEP ${formatUsd(s)} in ${YEARS[i]} exceeds your maximum.`);
    }
    for (const [i, yc] of ycs.entries()) {
      if (plan.kind !== "decline" && yc.settlement > 0) {
        plan.actions.push({ id: `${id}-settle-${YEARS[i]}`, title: `Set aside ${formatUsd(yc.settlement)} to repay advance credit on the ${YEARS[i]} return`,
          dueDate: models[i].rules.returnDueDate, sourceIds: ["irs-ptc-qa"] });
      }
    }
    scenarios.push({
      id, kind: plan.kind, label: plan.label, feasible: plan.reasons.length === 0, infeasibilityReasons: plan.reasons,
      decisions: {
        grossRevenueCents: plan.revenue,
        receipts: plan.receipts.map(r => ({ date: r.date, amountCents: r.amount })),
        expenses: plan.expenses.map(e => ({ year: YEARS[e.yearIndex], amountCents: e.amount })),
        additionalSep: plan.sep.flatMap((s, i) => (s > 0 ? [{ year: YEARS[i], personId: o.ownerPersonId, amountCents: s }] : [])),
      },
      years: [toYearResult(models[0], ycs[0], extra(0)), toYearResult(models[1], ycs[1], extra(1))],
      twoYearCashDeltaCents: delta,
      grossAdditionalRetirementCents: plan.sep[0] + plan.sep[1],
      assumptions: plan.assumptions,
      actions: plan.actions,
      stress: plan.kind === "decline"
        ? { status: "not_tested", worstCashDeltaCents: null, checkedDescription: "Baseline for comparison." }
        : anyRanges ? stress(models, plan, decline, target)
          : { status: "not_tested", worstCashDeltaCents: null, checkedDescription: "No uncertainty range was declared for any income amount." },
    });
  }

  // ------------------------------------------------------------ ranking --
  const order: ScenarioKind[] = ["accept_now", "sep_minimum", "split_payment", "renegotiate", "sep_buffer", "decline"];
  const eligible = scenarios.filter(s => s.feasible && (s.kind === "decline" ? target === 0 : s.twoYearCashDeltaCents >= target));
  let recommended: ScenarioResult | null = null;
  const rank = (a: ScenarioResult, b: ScenarioResult) => {
    if (c.objective === "retirement_and_cash" && a.grossAdditionalRetirementCents !== b.grossAdditionalRetirementCents) {
      return b.grossAdditionalRetirementCents - a.grossAdditionalRetirementCents;
    }
    if (Math.abs(a.twoYearCashDeltaCents - b.twoYearCashDeltaCents) > 100) return b.twoYearCashDeltaCents - a.twoYearCashDeltaCents;
    return order.indexOf(a.kind) - order.indexOf(b.kind);
  };
  if (eligible.length) recommended = [...eligible].sort(rank)[0];
  else warnings.push(`No available option reaches ${targetText}.`);
  if (c.objective === "retirement_and_cash") {
    warnings.push("Ranking favours retirement contributions while keeping spendable cash at or above your minimum; retirement dollars are taxed on withdrawal and are not spendable now.");
  }
  if (recommended && recommended.stress.status === "fails_within_range") {
    warnings.push(`The recommended option can fall short within your declared income range: ${recommended.stress.checkedDescription}`);
  }
  if (recommended?.kind === "accept_now" && scenarios.length > 1 && !scenarios.some(s => s.kind !== "accept_now" && s.kind !== "decline" && s.feasible && s.twoYearCashDeltaCents > recommended!.twoYearCashDeltaCents + 100)) {
    warnings.push("No special action is needed: accepting as offered is the best available option.");
  }
  return { scenarios, baselineScenarioId: "decline", recommendedScenarioId: recommended?.id ?? null, warnings };
}

function searchNote(step: number): string {
  return step === 1 ? "every whole dollar checked"
    : `structural subsidy thresholds checked exactly, $${step} grid with $1 refinement; worst-case gap ≤ ${formatUsd(step * 200 + ROUNDING_NOISE_CENTS)}`;
}

function tryValue<T>(f: () => T): T | null {
  try { return f(); } catch (e) { if (e instanceof EngineStop) return null; throw e; }
}
function tryRun(models: Models, plan: Plan) { return tryValue(() => run(models, plan)); }
function runError(models: Models, plan: Plan): string {
  try { run(models, plan); return "unknown"; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Two-year cash change vs declining, across the declared ranges (all moved together), including threshold crossings. */
function stress(models: Models, plan: Plan, decline: Plan, target: number): ScenarioResult["stress"] {
  const N = UNCERTAINTY_SCALE;
  const at = (k: number): Models => [modelAt(models[0], k), modelAt(models[1], k)];
  const pv = variations(plan), dv = variations(decline);
  const ks = new Set<number>();
  for (let k = -N; k <= N; k += N / 20) ks.add(k);
  for (const yi of [0, 1] as const) {
    for (const v of [pv[yi], dv[yi]]) {
      const m: MonotoneMagi = { magi: k => magiOf(modelAt(models[yi], k), v), thresholds: magiThresholds(models[yi]) };
      const { points } = candidateSetSafe(-N, N, m);
      points.forEach(k => ks.add(k));
    }
  }
  // The option "fails within the range" when its conclusion at the entered values does not hold everywhere:
  // a point becomes infeasible/unsupported, a premium tax credit kept at the entered values is lost, or a
  // result that met the target at the entered values falls below it.
  const point = run(models, plan);
  const pointDelta = total(point) - total(run(models, decline));
  let worst: { k: number; delta: number } | null = null;
  let failure: string | null = null;
  for (const k of [...ks].sort((a, b) => a - b)) {
    const ms = at(k);
    try {
      const ycs = run(ms, plan);
      const delta = total(ycs) - total(run(ms, decline));
      if (!worst || delta < worst.delta) worst = { k, delta };
      for (const yi of [0, 1] as const) {
        if (!failure && point[yi].credit.ptc.ptc > 0 && ycs[yi].credit.ptc.ptc === 0) failure = `the ${YEARS[yi]} premium tax credit is lost at ${describeK(k)}`;
      }
      if (!failure && pointDelta >= target && delta < target) failure = `the result falls below ${target > 0 ? "your desired gain" : "declining"} at ${describeK(k)}`;
    } catch (e) {
      if (!(e instanceof EngineStop)) throw e;
      if (!failure) failure = `not valid at ${describeK(k)}: ${e.message}`;
    }
  }
  const checked = `Checked ${ks.size} positions from the low to the high end of every declared range (all moved together), including each point where this option or declining crosses a subsidy threshold`;
  const worstText = worst ? ` Worst two-year cash change ${formatUsd(worst.delta)} at ${describeK(worst.k)}.` : "";
  return { status: failure ? "fails_within_range" : "within_declared_range", worstCashDeltaCents: worst?.delta ?? null,
    checkedDescription: `${checked}.${failure ? ` Within the range, ${failure}.` : " The result at your entered values holds across the range."}${worstText}` };
}

function candidateSetSafe(lo: number, hi: number, m: MonotoneMagi) {
  try { return { points: crossingsOnly(lo, hi, m) }; } catch (e) { if (e instanceof EngineStop) return { points: [] }; throw e; }
}
function crossingsOnly(lo: number, hi: number, m: MonotoneMagi): number[] {
  const out: number[] = [];
  const a = m.magi(lo), b = m.magi(hi);
  for (const t of m.thresholds) {
    if (t < Math.min(a, b) || t >= Math.max(a, b)) continue;
    let l = lo, h = hi;
    while (l < h) { const mid = Math.ceil((l + h) / 2); if (m.magi(mid) <= t) l = mid; else h = mid - 1; }
    out.push(l, Math.min(hi, l + 1));
  }
  return out;
}
function describeK(k: number): string {
  if (k === 0) return "your entered values";
  const pct = Math.round(Math.abs(k) / 10);
  return k < 0 ? `${pct}% of the way to the low end` : `${pct}% of the way to the high end`;
}
