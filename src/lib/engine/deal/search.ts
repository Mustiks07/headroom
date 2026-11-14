/**
 * Deal-term search (round 4): price × payment schedule × additional SEP for ONE project, on top of
 * every other commitment, using the existing year calculation (guards, SEHI/PTC, taxes, rounding).
 *
 * Search space and accuracy (also returned in `search`):
 *  - price: lattice from the minimum to the maximum asked price (≤ ~80 points, ≥ $50 step) plus the offered price;
 *  - schedule: the amount paid in 2026 windows vs 2027 windows on the same lattice; inside one tax year money
 *    goes to the earliest allowed window first (tax depends only on the year; earlier is never worse for dated goals);
 *  - additional SEP per tax year: {0, the smallest amount that restores that year's premium tax credit (exact
 *    bisection), the most allowed by the cap, the cash set aside and the legal limit};
 *  - every year result comes from evaluateYear (memoised by profit change and SEP), so lattice values are exact for
 *    the lattice point; chosen variants are then refined (split ±1 lattice step at $5 then $1; lowest price every $5
 *    then $1 below the lattice point) and re-evaluated with run()/scenarioFromPlan before all constraints are checked.
 * Not claimed: a global optimum between lattice points beyond the refinement window, or SEP gains from line-5
 * steps smaller than the restore-the-credit amount.
 */
import type { CaseInput, ScenarioKind, TaxYear } from "@/domain/contracts";
import { canonicalWorkspaceContent, type HouseholdWorkspace } from "@/domain/household-workspace";
import { canonical, modelWarnings, sha256Hex } from "../common";
import { firstBusinessDay, makeCtx, run, scenarioFromPlan, stressPlan, YEARS, type Ctx, type Plan } from "../comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "../guard";
import { formatUsd } from "../money";
import { EngineStop, type YearModel } from "../model";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";
import { profitHeadroomDollars } from "../search";
import { evaluateYear, solveCredit } from "../year";
import { candidateContext } from "../household";
import { DealSearchRequestSchema, type CashContext, type ConstraintCheck, type DatedFlow, type DateTarget, type DateTargetResult,
  type DealGoal, type DealSearchRequest, type DealSearchResult, type DealTerms, type DealTermsSpace, type DealVariant,
  type DecisionSensitivity, type Relaxation, type SensitivityItem, type Violation } from "./types";

export const DEAL_SEARCH_VERSION = "headroom-deal-1.0.0";
const MAX_LATTICE = 80;

interface Slot { windowId: string; date: string; yi: 0 | 1; minBps: number; maxBps: number }
interface YearEval { spendable: number; ptc: number; magi: number; room: number }
interface Candidate {
  price: number;
  x: number;                                 // amount paid in 2026 (cents)
  payments: Array<{ windowId: string; date: string; amountCents: number; yi: 0 | 1 }>;
  sep: [number, number];
  cashDelta: number;
  retirement: number;
  years: [YearEval, YearEval];
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;

export async function searchDealTerms(ws: HouseholdWorkspace, rawRequest: DealSearchRequest): Promise<DealSearchResult> {
  const parsedReq = DealSearchRequestSchema.safeParse(rawRequest);
  if (!parsedReq.success) {
    return { status: "needs_data", code: "INVALID_DEAL_REQUEST", message: "The goal or the allowed terms need review.",
      fields: parsedReq.error.issues.map(i => ({ path: `dealRequest.${i.path.join(".")}`, reason: i.message })) };
  }
  const { goal, terms, cash } = parsedReq.data;
  const cc = candidateContext(ws, goal.projectId);
  if ("status" in cc) return cc;
  const { candidate, receipts: offered, expenses, baseline } = cc;
  const warnings = [...cc.warnings];

  // ------------------------------------------------------------ models --
  const derived: CaseInput = structuredClone(cc.derived);
  const offeredTotal = offered.reduce((a, r) => a + r.amountCents, 0);
  const firstOffered = [...offered].sort((a, b) => a.date.localeCompare(b.date))[0];
  derived.opportunity = { title: candidate.title, ownerPersonId: candidate.ownerPersonId, grossRevenueCents: offeredTotal,
    plannedReceiptDate: firstOffered.date, incrementalExpensesCents: expenses.reduce((a, e) => a + e.amountCents, 0),
    expensePaymentDate: expenses[0]?.date ?? firstOffered.date, cashAccountingConfirmed: candidate.cashAccountingConfirmed,
    timingArrangementConfirmed: candidate.timingArrangementConfirmed };
  const v1Issues = new Issues();
  const parsed = parseCase(derived, v1Issues);
  const m0 = parsed ? buildYearModel(parsed, 0, v1Issues) : null, m1 = parsed ? buildYearModel(parsed, 1, v1Issues) : null;
  if (parsed) checkOpportunity(parsed, v1Issues);
  const v1Blocked = v1Issues.toBlocked();
  if (v1Blocked || !parsed || !m0 || !m1) return { ...v1Blocked!, fields: v1Blocked!.fields.map(f => ({ ...f, path: cc.adapted.translatePath(f.path) })) };
  const models: [YearModel, YearModel] = [m0, m1];
  let ctx: Ctx;
  try { ctx = makeCtx(parsed, models); } catch (e) {
    if (e instanceof EngineStop) return { status: e.kind === "unsupported" ? "unsupported" : "needs_data", code: e.code, message: e.message, fields: [{ path: "household", reason: e.message }] };
    throw e;
  }
  ctx.target = goal.minTwoYearCashDeltaCents;
  const declineYears = run(models, ctx.decline);

  // SEP cap: the goal's cap, the cash set aside after agreed unpaid goals, then the legal limit per year (checked per evaluation).
  const cashLeft = baseline.sepBudget.availableCents;
  const sepCap = Math.max(0, Math.min(goal.maxAdditionalSepCents, cashLeft ?? 0));
  if (cashLeft === null && goal.maxAdditionalSepCents > 0) warnings.push("No money set aside for future SEP-IRA contributions was entered, so no additional contribution is searched.");

  // ------------------------------------------------------------ slots --
  const slotIssues: string[] = [];
  const slots = buildSlots(terms, candidate.timingArrangementConfirmed === true, slotIssues);
  warnings.push(...slotIssues);
  const fixedTerms = !terms.newTermsConfirmed;
  if (fixedTerms) warnings.push("The client has not confirmed that new terms can be discussed, so only the offered price and dates are evaluated; only an additional SEP-IRA contribution is searched.");

  // ------------------------------------------------------- year memo --
  const memo = new Map<string, YearEval | null>();
  const openExpenses: [number, number] = [0, 0];
  for (const e of expenses) openExpenses[YEARS.indexOf(Number(e.date.slice(0, 4)) as TaxYear)] += e.amountCents;
  const yearEval = (yi: 0 | 1, receipts: number, s: number): YearEval | null => {
    const key = `${yi}|${receipts}|${s}`;
    if (memo.has(key)) return memo.get(key)!;
    let out: YearEval | null = null;
    try {
      const yc = evaluateYear(models[yi], { profitDelta: receipts - openExpenses[yi], additionalSep: s });
      out = { spendable: yc.spendable, ptc: yc.credit.ptc.ptc, magi: yc.credit.magi, room: yc.credit.sepMax - yc.credit.sepTotal };
    } catch (e) { if (!(e instanceof EngineStop)) throw e; }
    memo.set(key, out);
    return out;
  };
  const sepOptions = (yi: 0 | 1, receipts: number): number[] => {
    const base = yearEval(yi, receipts, 0);
    if (!base || sepCap === 0) return [0];
    const room = Math.min(base.room, sepCap);
    const opts = new Set<number>([0]);
    if (room > 0) opts.add(Math.floor(room / 100) * 100);
    if (base.ptc === 0 && models[yi].ptcEligible && room > 0) {
      const keeps = (s: number) => { try { return solveCredit(models[yi], { profitDelta: receipts - openExpenses[yi], additionalSep: s }, false).ptc.ptc > 0; } catch { return false; } };
      if (keeps(Math.floor(room / 100) * 100)) {
        let lo = 0, hi = Math.floor(room / 100);
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (keeps(mid * 100)) hi = mid; else lo = mid + 1; }
        opts.add(lo * 100);
      }
    }
    return [...opts].sort((a, b) => a - b);
  };

  // ------------------------------------------------------- enumerate --
  const priceMin = fixedTerms ? offeredTotal : terms.minPriceCents, priceMax = fixedTerms ? offeredTotal : terms.maxPriceCents;
  const step = Math.max(5000, ceilTo(Math.ceil(Math.max(priceMax, 1) / MAX_LATTICE), 5000));
  let evaluated = 0;
  const all: Candidate[] = [];
  const consider = (price: number, payments: Candidate["payments"]) => {
    const x = payments.filter(p => p.yi === 0).reduce((a, p) => a + p.amountCents, 0);
    const r: [number, number] = [x, price - x];
    const o0 = sepOptions(0, r[0]), o1 = sepOptions(1, r[1]);
    for (const s0 of o0) for (const s1 of o1) {
      if (s0 + s1 > sepCap) continue;
      const y0 = yearEval(0, r[0], s0), y1 = yearEval(1, r[1], s1);
      evaluated++;
      if (!y0 || !y1) continue;
      all.push({ price, x, payments, sep: [s0, s1], retirement: s0 + s1, years: [y0, y1],
        cashDelta: y0.spendable + y1.spendable - ctx.declineCash });
    }
  };
  if (fixedTerms) {
    consider(offeredTotal, offered.map(o => ({ windowId: "offered", date: o.date, amountCents: o.amountCents, yi: yearOf(o.date) })));
  } else {
    const prices = new Set<number>([priceMin, priceMax]);
    for (let p = ceilTo(priceMin, step); p <= priceMax; p += step) prices.add(p);
    if (offeredTotal >= priceMin && offeredTotal <= priceMax) prices.add(offeredTotal);
    for (const price of [...prices].sort((a, b) => a - b)) {
      for (const x of splitValues(price, slots, step)) {
        const pay = allocate(price, x, slots, terms.maxPayments);
        if (pay) consider(price, pay);
      }
    }
    // The offered schedule is always a reference, also when it lies outside the windows.
    if (!all.some(c => c.price === offeredTotal && samePayments(c.payments, offered))) {
      consider(offeredTotal, offered.map(o => ({ windowId: "offered", date: o.date, amountCents: o.amountCents, yi: yearOf(o.date) })));
    }
  }

  // ------------------------------------------------- goals per candidate --
  const due: [string, string] = [models[0].rules.returnDueDate, models[1].rules.returnDueDate];
  const burden = (c: Candidate, yi: 0 | 1) => {
    const receiptsY = c.payments.filter(p => p.yi === yi).reduce((a, p) => a + p.amountCents, 0);
    return receiptsY - openExpenses[yi] - (c.years[yi].spendable - declineYears[yi].spendable) - c.sep[yi];
  };
  const projectFlows = (c: Candidate): DatedFlow[] => {
    const flows: DatedFlow[] = [];
    for (const l of candidate.receipts.filter(l => l.actual)) flows.push({ date: l.actual!.date, amountCents: l.actual!.amountCents, label: "Received (fact)", kind: "project_receipt" });
    for (const p of c.payments) flows.push({ date: p.date, amountCents: p.amountCents, label: `Payment in window ${p.windowId}`, kind: "project_receipt" });
    for (const e of expenses) flows.push({ date: e.date, amountCents: -e.amountCents, label: "Project expense", kind: "project_expense" });
    ([0, 1] as const).forEach(yi => {
      if (c.sep[yi] > 0) flows.push({ date: due[yi], amountCents: -c.sep[yi], label: `Additional SEP-IRA for ${YEARS[yi]} (assumed paid on the return due date)`, kind: "sep_contribution" });
      const b = burden(c, yi);
      if (b !== 0) flows.push({ date: due[yi], amountCents: -b, label: `This project's extra tax and premium credit settlement for ${YEARS[yi]} (paid with the return)`, kind: "tax_settlement" });
    });
    return flows.sort((a, b) => a.date.localeCompare(b.date));
  };
  const dateResult = (c: Candidate, t: DateTarget): DateTargetResult => evaluateDateTarget(c, t, { ws, candidateId: candidate.id, offeredExpenses: expenses,
    burden: [burden(c, 0), burden(c, 1)], due, cash, remainingSep: [baseline.years[0].sep.remainingCents, baseline.years[1].sep.remainingCents] });
  const meets = (c: Candidate) => c.cashDelta >= goal.minTwoYearCashDeltaCents &&
    goal.dateTargets.every(t => dateResult(c, t).met !== false);
  const feasible = all.filter(meets);

  // ------------------------------------------------------- choose --
  const materiality = Math.max(10000, Math.round(offeredTotal / 100));
  const complexity = (c: Candidate) => [new Set(c.payments.map(p => p.windowId)).size, c.payments.some(p => p.yi === 1) ? 1 : 0, c.retirement > 0 ? 1 : 0, c.price === offeredTotal ? 0 : 1];
  const lexi = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const chosen: Array<{ role: DealVariant["role"]; c: Candidate }> = [];
  if (feasible.length) {
    const mostCash = [...feasible].sort((a, b) => b.cashDelta - a.cashDelta || lexi(complexity(a), complexity(b)) || a.price - b.price)[0];
    const simplest = [...feasible].sort((a, b) => lexi(complexity(a), complexity(b)) || a.price - b.price || b.cashDelta - a.cashDelta)[0];
    chosen.push({ role: "simplest", c: simplest }, { role: "most_cash", c: mostCash });
    // Third option: a genuinely different trade-off, first that applies.
    const lowestPrice = [...feasible].sort((a, b) => a.price - b.price || b.cashDelta - a.cashDelta)[0];
    const noSep = [...feasible].filter(c => c.retirement === 0).sort((a, b) => b.cashDelta - a.cashDelta)[0];
    const firstTarget = goal.dateTargets.find(t => t.kind !== "household_balance");
    const earliest = firstTarget && [...feasible].sort((a, b) => (dateResult(b, firstTarget).valueCents ?? 0) - (dateResult(a, firstTarget).valueCents ?? 0) || b.cashDelta - a.cashDelta)[0];
    if (lowestPrice.price < Math.min(simplest.price, mostCash.price)) chosen.push({ role: "lowest_price", c: lowestPrice });
    else if (noSep && (simplest.retirement > 0 || mostCash.retirement > 0)) chosen.push({ role: "no_additional_sep", c: noSep });
    else if (earliest && firstTarget && (dateResult(earliest, firstTarget).valueCents ?? 0) > Math.max(dateResult(simplest, firstTarget).valueCents ?? 0, dateResult(mostCash, firstTarget).valueCents ?? 0)) {
      chosen.push({ role: "most_by_date", c: earliest });
    }
  }
  const offeredCand = all.filter(c => c.price === offeredTotal && samePayments(c.payments, offered)).sort((a, b) => a.retirement - b.retirement)[0];
  const offeredTerms = offeredCand ? { twoYearCashDeltaCents: offeredCand.cashDelta, retirementCents: offeredCand.retirement,
    unmetGoals: [...(offeredCand.cashDelta < goal.minTwoYearCashDeltaCents ? ["two_year_cash"] : []),
      ...goal.dateTargets.filter(t => dateResult(offeredCand, t).met === false).map(t => `date_target:${t.id}`)] } : null;

  // ------------------------------------------------------- refine + exact --
  const refineCtx = { slots, terms, sepOptions, yearEval, ctx, meets, step, offeredTotal, fixedTerms };
  const variants: DealVariant[] = [];
  const seen = new Set<string>();
  for (const { role, c } of chosen) {
    const refined = role === "most_cash" || role === "no_additional_sep" ? refineSplit(c, refineCtx) : role === "lowest_price" || role === "simplest" ? refinePrice(c, refineCtx) : c;
    const key = termsKey(refined);
    if (seen.has(key)) continue;
    seen.add(key);
    const v = exactVariant(refined, role, { ctx, models, candidateTitle: candidate.title, goal, terms, offeredTotal, slots, sepCap, cashLeft, dateResult, projectFlows, warnings, openExpenses, offeredYear: yearOf(firstOffered.date) });
    if (v) variants.push(v);
  }
  const simplestV = variants.find(v => v.role === "simplest");
  for (const v of variants) {
    if (simplestV && v !== simplestV) {
      const gain = v.twoYearCashDeltaCents - simplestV.twoYearCashDeltaCents;
      v.marginalGainOverSimplestCents = gain;
      if (gain > 0 && gain < materiality) v.label += ` (only ${formatUsd(gain)} more than the simplest option)`;
    }
  }

  // ------------------------------------------------------- infeasible --
  const violations: Violation[] = [], relaxations: Relaxation[] = [];
  if (!variants.length) {
    analyseInfeasible({ all, goal, dateResult, violations });
    relax({ goal, terms, fixedTerms, slots, sepCap, offeredTotal, ctx, models, yearEval, sepOptionsRelaxed: makeSepOptions(models, openExpenses, Infinity, yearEval),
      dateResult, relaxations, all, step });
  }

  const fingerprint = await sha256Hex(JSON.stringify(canonical({ content: canonicalWorkspaceContent(cc.ws), request: parsedReq.data,
    engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, dealSearchVersion: DEAL_SEARCH_VERSION })));
  const others = cc.ws.projects.filter(p => p.id !== candidate.id && p.status === "agreed").map(p => `"${p.title}"`);
  return {
    status: variants.length ? "ready" : "no_feasible_terms",
    engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, dealSearchVersion: DEAL_SEARCH_VERSION, fingerprint, projectId: candidate.id,
    baseline: { label: `Your plan without the unpaid terms of "${candidate.title}"`,
      description: `Your profit forecast${others.length ? `, agreed ${others.join(", ")}` : ""}, money already received from "${candidate.title}", and SEP-IRA goals already agreed. Changes are measured against this.`,
      horizon: `Spendable cash after the 2026 and 2027 returns settle (due ${due[0]} and ${due[1]}); dated goals use the flows listed with each option.` },
    variants, offeredTerms, violations, relaxations,
    search: { priceRange: [priceMin, priceMax], priceStepCents: fixedTerms ? 0 : step, splitStepCents: fixedTerms ? 0 : step,
      sepCandidates: "0, the smallest amount that keeps that year's premium tax credit (exact), and the most allowed by your cap, the cash set aside and the legal limit",
      windows: slots.map(s => ({ id: s.windowId, year: YEARS[s.yi], date: s.date })), evaluatedTermCombinations: evaluated,
      exactRefinement: "Each shown option is refined (split: ±1 step at $5, then $1; lowest price: every $5 below the step, then $1) and recalculated with the full tax and credit calculation before its constraints are checked.",
      materialityCents: materiality, additionalSepLimitCents: sepCap },
    warnings: [...new Set([...modelWarnings(models, parsed), ...warnings])],
  };
}

// ----------------------------------------------------------------- slots & schedules --
const yearOf = (date: string): 0 | 1 => (date.startsWith("2026") ? 0 : 1);

function buildSlots(terms: DealTermsSpace, timingConfirmed: boolean, notes: string[]): Slot[] {
  const out: Slot[] = [];
  for (const w of terms.windows) {
    for (const y of [2026, 2027] as const) {
      const start = w.earliestDate > `${y}-01-01` ? w.earliestDate : y === 2027 ? firstBusinessDay(2027) : `${y}-01-01`;
      if (start > w.latestDate || start > `${y}-12-31` || w.latestDate < `${y}-01-01`) continue;
      if (y === 2027 && !timingConfirmed) {
        notes.push(`Window ${w.id}: payments in 2027 are not searched until the client confirms in writing that they are not payable or available to you earlier.`);
        continue;
      }
      out.push({ windowId: w.earliestDate.slice(0, 4) === w.latestDate.slice(0, 4) ? w.id : `${w.id}-${y}`, date: start, yi: y === 2026 ? 0 : 1, minBps: w.minShareBps, maxBps: w.maxShareBps });
    }
  }
  if (terms.windows.some(w => !["2026", "2027"].includes(w.earliestDate.slice(0, 4)) || !["2026", "2027"].includes(w.latestDate.slice(0, 4)))) {
    notes.push("Window dates outside 2026–2027 are not calculated.");
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const bounds = (price: number, s: Slot) => [Math.ceil((price * s.minBps) / 10000 / 100) * 100, Math.floor((price * s.maxBps) / 10000 / 100) * 100] as const;

function splitValues(price: number, slots: Slot[], step: number): number[] {
  const s26 = slots.filter(s => s.yi === 0), s27 = slots.filter(s => s.yi === 1);
  const lo = Math.max(s26.reduce((a, s) => a + bounds(price, s)[0], 0), price - s27.reduce((a, s) => a + bounds(price, s)[1], 0));
  const hi = Math.min(s26.reduce((a, s) => a + bounds(price, s)[1], 0), price - s27.reduce((a, s) => a + bounds(price, s)[0], 0));
  if (lo > hi) return [];
  const xs = new Set<number>([lo, hi]);
  for (let x = ceilTo(lo, step); x <= hi; x += step) xs.add(x);
  return [...xs];
}

/** Money in each tax year goes to the earliest windows first, within each window's share bounds. */
function allocate(price: number, x: number, slots: Slot[], maxPayments: number): Candidate["payments"] | null {
  const out: Candidate["payments"] = [];
  for (const yi of [0, 1] as const) {
    const ys = slots.filter(s => s.yi === yi);
    let left = yi === 0 ? x : price - x;
    const amounts = ys.map(s => bounds(price, s)[0]);
    left -= amounts.reduce((a, b) => a + b, 0);
    if (left < 0) return null;
    ys.forEach((s, i) => { const add = Math.min(left, bounds(price, s)[1] - amounts[i]); amounts[i] += add; left -= add; });
    if (left > 0) return null;
    ys.forEach((s, i) => { if (amounts[i] > 0) out.push({ windowId: s.windowId, date: s.date, amountCents: amounts[i], yi }); });
  }
  return new Set(out.map(p => p.windowId)).size <= maxPayments && out.length > 0 ? out : null;
}

const samePayments = (a: Candidate["payments"], b: Array<{ date: string; amountCents: number }>) =>
  a.length === b.length && a.every((p, i) => p.date === b[i].date && p.amountCents === b[i].amountCents);
const termsKey = (c: Candidate) => JSON.stringify([c.price, c.payments.map(p => [p.date, p.amountCents]), c.sep]);

function makeSepOptions(models: [YearModel, YearModel], openExpenses: [number, number], cap: number, yearEval: (yi: 0 | 1, r: number, s: number) => YearEval | null) {
  return (yi: 0 | 1, receipts: number): number[] => {
    const base = yearEval(yi, receipts, 0);
    if (!base) return [0];
    const room = Math.min(base.room, cap);
    const opts = new Set<number>([0]);
    if (base.ptc === 0 && models[yi].ptcEligible && room > 0) {
      const keeps = (s: number) => { try { return solveCredit(models[yi], { profitDelta: receipts - openExpenses[yi], additionalSep: s }, false).ptc.ptc > 0; } catch { return false; } };
      if (keeps(Math.floor(room / 100) * 100)) {
        let lo = 0, hi = Math.floor(room / 100);
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (keeps(mid * 100)) hi = mid; else lo = mid + 1; }
        opts.add(lo * 100);
      }
    }
    return [...opts];
  };
}

// ----------------------------------------------------------------- refinement --
interface RefineCtx {
  slots: Slot[]; terms: DealTermsSpace; step: number; offeredTotal: number; fixedTerms: boolean; ctx: Ctx;
  sepOptions: (yi: 0 | 1, r: number) => number[];
  yearEval: (yi: 0 | 1, r: number, s: number) => YearEval | null;
  meets: (c: Candidate) => boolean;
}
function bestFor(price: number, x: number, rc: RefineCtx, prefer: (a: Candidate, b: Candidate) => number, mustMeet: boolean): Candidate | null {
  const pay = rc.fixedTerms ? null : allocate(price, x, rc.slots, rc.terms.maxPayments);
  if (!pay) return null;
  let best: Candidate | null = null;
  const r: [number, number] = [x, price - x];
  for (const s0 of rc.sepOptions(0, r[0])) for (const s1 of rc.sepOptions(1, r[1])) {
    const y0 = rc.yearEval(0, r[0], s0), y1 = rc.yearEval(1, r[1], s1);
    if (!y0 || !y1) continue;
    const c: Candidate = { price, x, payments: pay, sep: [s0, s1], retirement: s0 + s1, years: [y0, y1], cashDelta: y0.spendable + y1.spendable - rc.ctx.declineCash };
    if (mustMeet && !rc.meets(c)) continue;
    if (!best || prefer(c, best) < 0) best = c;
  }
  return best;
}
/** Split at a fixed price: ±1 lattice step at $5, then $1 around the best. */
function refineSplit(c: Candidate, rc: RefineCtx): Candidate {
  if (rc.fixedTerms) return c;
  const prefer = (a: Candidate, b: Candidate) => b.cashDelta - a.cashDelta || a.retirement - b.retirement;
  let best = c;
  const scan = (from: number, to: number, by: number) => {
    for (let x = Math.max(0, from); x <= Math.min(c.price, to); x += by) {
      const k = bestFor(c.price, x, rc, prefer, true);
      if (k && prefer(k, best) < 0) best = k;
    }
  };
  scan(c.x - rc.step, c.x + rc.step, 500);
  scan(best.x - 500, best.x + 500, 100);
  return best;
}
/** Lowest price meeting all goals: every $5 below the lattice point, then every $1. */
function refinePrice(c: Candidate, rc: RefineCtx): Candidate {
  if (rc.fixedTerms) return c;
  const share = c.price > 0 ? c.x / c.price : 0;
  const prefer = (a: Candidate, b: Candidate) => b.cashDelta - a.cashDelta;
  const at = (p: number) => {
    const x = Math.round((p * share) / 100) * 100;
    return bestFor(p, x, rc, prefer, true) ?? bestFor(p, c.payments.every(q => q.yi === 0) ? p : c.payments.every(q => q.yi === 1) ? 0 : x, rc, prefer, true);
  };
  const lowest = Math.max(rc.terms.minPriceCents, c.price - rc.step);
  let found: Candidate | null = null;
  for (let p = lowest; p < c.price; p += 500) { const k = at(p); if (k) { found = k; break; } }
  if (found) for (let p = Math.max(lowest, found.price - 500); p < found.price; p += 100) { const k = at(p); if (k) { found = k; break; } }
  return found && found.price < c.price ? found : c;
}

// ----------------------------------------------------------------- exact variant --
function kindOf(c: Candidate, offeredTotal: number, offeredYear: 0 | 1): ScenarioKind {
  if (c.price !== offeredTotal) return "renegotiate";
  if (c.payments.some(p => p.yi !== offeredYear)) return "split_payment";
  if (c.retirement > 0) return "sep_minimum";
  return "accept_now";
}

interface ExactCtx {
  ctx: Ctx; models: [YearModel, YearModel]; candidateTitle: string; goal: DealGoal; terms: DealTermsSpace; offeredTotal: number;
  slots: Slot[]; sepCap: number; cashLeft: number | null; warnings: string[]; openExpenses: [number, number]; offeredYear: 0 | 1;
  dateResult: (c: Candidate, t: DateTarget) => DateTargetResult; projectFlows: (c: Candidate) => DatedFlow[];
}
function exactVariant(c: Candidate, role: DealVariant["role"], x: ExactCtx): DealVariant | null {
  const plan: Plan = { kind: kindOf(c, x.offeredTotal, x.offeredYear), label: "", revenue: c.price,
    receipts: c.payments.map(p => ({ date: p.date, amount: p.amountCents })),
    expenses: x.openExpenses.flatMap((amount, i) => (amount > 0 ? [{ yearIndex: i as 0 | 1, amount }] : [])), sep: c.sep, reasons: [], actions: [],
    assumptions: [...x.ctx.common, "Asked terms: the client has not agreed until they confirm in writing.",
      "Additional SEP-IRA amounts are on top of SEP goals already agreed; retirement money is not spendable cash."] };
  let ycs;
  try { ycs = run(x.models, plan); } catch (e) {
    if (!(e instanceof EngineStop)) throw e;
    x.warnings.push(`An option was dropped after the exact check: ${e.message}`);
    return null;
  }
  const exactDelta = ycs[0].spendable + ycs[1].spendable - x.ctx.declineCash;
  const exact: Candidate = { ...c, cashDelta: exactDelta,
    years: [0, 1].map(i => ({ spendable: ycs[i].spendable, ptc: ycs[i].credit.ptc.ptc, magi: ycs[i].credit.magi, room: ycs[i].credit.sepMax - ycs[i].credit.sepTotal })) as [YearEval, YearEval] };
  const dateTargets = x.goal.dateTargets.map(t => x.dateResult(exact, t));
  const checks: ConstraintCheck[] = [
    { constraint: "price", satisfied: x.terms.newTermsConfirmed ? c.price >= x.terms.minPriceCents && c.price <= x.terms.maxPriceCents : c.price === x.offeredTotal,
      detail: x.terms.newTermsConfirmed ? `Asked ${formatUsd(c.price)} within ${formatUsd(x.terms.minPriceCents)}–${formatUsd(x.terms.maxPriceCents)}.` : `Offered price ${formatUsd(c.price)} kept.` },
    { constraint: "payment_windows", satisfied: c.payments.every(p => p.windowId === "offered" || x.slots.some(s => s.windowId === p.windowId && s.date === p.date))
      && new Set(c.payments.map(p => p.windowId)).size <= x.terms.maxPayments,
      detail: `${c.payments.length} payment(s): ${c.payments.map(p => `${formatUsd(p.amountCents)} on ${p.date}`).join(", ")}.` },
    { constraint: "additional_sep", satisfied: c.retirement <= x.sepCap && c.retirement <= x.goal.maxAdditionalSepCents,
      detail: `${formatUsd(c.retirement)} additional SEP-IRA; limit ${formatUsd(x.sepCap)} (your cap ${formatUsd(x.goal.maxAdditionalSepCents)}, cash left after agreed goals ${x.cashLeft === null ? "not entered" : formatUsd(x.cashLeft)}); the legal limit was checked by the tax calculation.` },
    { constraint: "two_year_cash", satisfied: exactDelta >= x.goal.minTwoYearCashDeltaCents,
      detail: `${formatUsd(exactDelta)} after both returns settle vs your minimum ${formatUsd(x.goal.minTwoYearCashDeltaCents)}.` },
    ...dateTargets.map(d => ({ constraint: `date_target:${d.targetId}`, satisfied: d.met !== false, detail: d.explanation })),
  ];
  if (checks.some(k => !k.satisfied)) { x.warnings.push(`An option failed its exact re-check and was not shown (${checks.filter(k => !k.satisfied).map(k => k.constraint).join(", ")}).`); return null; }
  const scenario = scenarioFromPlan(x.ctx, plan, ycs, `deal-${role}`);
  const roleLabel = { simplest: "Simplest that meets your goal", most_cash: "Most cash after both returns", lowest_price: "Lowest price that meets your goal",
    no_additional_sep: "No additional SEP-IRA", most_by_date: "Most money by your date", offered: "Offered terms" }[role];
  const terms: DealTerms = { priceCents: c.price, payments: c.payments.map(p => ({ windowId: p.windowId, date: p.date, amountCents: p.amountCents })),
    additionalSep: ([0, 1] as const).filter(i => c.sep[i] > 0).map(i => ({ year: YEARS[i], amountCents: c.sep[i] })) };
  scenario.label = `${roleLabel}: ${formatUsd(c.price)} — ${terms.payments.map(p => `${formatUsd(p.amountCents)} ${p.date}`).join(", ")}${c.retirement ? `; SEP-IRA +${formatUsd(c.retirement)}` : ""}`;
  return {
    id: `deal-${role}`, role, label: scenario.label, kind: plan.kind, terms, twoYearCashDeltaCents: exactDelta, retirementCents: c.retirement,
    goalMet: dateTargets.some(d => d.met === null) ? null : true, dateTargets,
    aca: ([0, 1] as const).map(i => ({ year: YEARS[i], magiCents: ycs[i].credit.magi, ptcCents: ycs[i].credit.ptc.ptc, creditKept: !x.models[i].ptcEligible || ycs[i].credit.ptc.ptc > 0 })),
    checks, flows: x.projectFlows(exact), scenario, marginalGainOverSimplestCents: null,
    clientTermsDraft: clientDraft(x.candidateTitle, terms),
    reminders: [
      ...terms.payments.map(p => ({ date: p.date, title: `Expect ${formatUsd(p.amountCents)} for "${x.candidateTitle}" (record the actual payment when it arrives)` })),
      ...terms.additionalSep.map(s => ({ date: x.models[YEARS.indexOf(s.year)].rules.returnDueDate, title: `Last day to contribute the additional ${formatUsd(s.amountCents)} SEP-IRA for ${s.year} (later with an extension)` })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    sensitivity: sensitivity(exact, x),
  };
}

function clientDraft(title: string, t: DealTerms): string {
  const lines = t.payments.map(p => `• ${formatUsd(p.amountCents)} paid on ${p.date}`).join("\n");
  return `Proposed terms for "${title}": total ${formatUsd(t.priceCents)} for the remaining work.\n${lines}\n` +
    (t.payments.some(p => p.date.startsWith("2027")) ? "The 2027 payment is not payable or available before that date.\n" : "") +
    "These terms apply once you confirm them in writing.";
}

// ----------------------------------------------------------------- dated goals --
interface DateCtx { ws: HouseholdWorkspace; candidateId: string; offeredExpenses: Array<{ id: string; amountCents: number; date: string }>;
  burden: [number, number]; due: [string, string]; cash: CashContext | null; remainingSep: [number, number] }

function evaluateDateTarget(c: Candidate, t: DateTarget, d: DateCtx): DateTargetResult {
  const D = t.byDate;
  const receivedFacts = d.ws.projects.find(p => p.id === d.candidateId)!.receipts.filter(l => l.actual && l.actual.date <= D)
    .reduce((a, l) => a + l.actual!.amountCents, 0);
  const scheduled = c.payments.filter(p => p.date <= D).reduce((a, p) => a + p.amountCents, 0);
  const expensesByD = d.offeredExpenses.filter(e => e.date <= D).reduce((a, e) => a + e.amountCents, 0);
  const sepByD = ([0, 1] as const).reduce<number>((a, i) => a + (d.due[i] <= D ? c.sep[i] : 0), 0);
  // Planning reserve: the project's extra tax and lost/changed credit for a year, set aside pro rata as its money arrives;
  // it is paid with that year's return, so it is never counted twice. A benefit (negative burden) arrives only at filing.
  const reserveByD = ([0, 1] as const).reduce<number>((a, i) => {
    const receiptsY = c.payments.filter(p => p.yi === i).reduce((s, p) => s + p.amountCents, 0);
    const arrived = c.payments.filter(p => p.yi === i && p.date <= D).reduce((s, p) => s + p.amountCents, 0);
    if (d.due[i] <= D) return a + d.burden[i];
    return a + (receiptsY > 0 ? Math.round((Math.max(0, d.burden[i]) * arrived) / receiptsY) : 0);
  }, 0);
  if (t.kind === "project_receipts") {
    const v = receivedFacts + scheduled;
    return { targetId: t.id, kind: t.kind, byDate: D, requiredCents: t.minCents, valueCents: v, met: v >= t.minCents,
      explanation: `Received from the project by ${D}: ${formatUsd(v)} (${formatUsd(receivedFacts)} already received + ${formatUsd(scheduled)} scheduled). Gross receipts, not profit after tax.` };
  }
  if (t.kind === "project_available_cash") {
    const v = scheduled - expensesByD - sepByD - reserveByD;
    return { targetId: t.id, kind: t.kind, byDate: D, requiredCents: t.minCents, valueCents: v, met: v >= t.minCents,
      explanation: `Added to money you can use by ${D}: scheduled receipts ${formatUsd(scheduled)} − project expenses ${formatUsd(expensesByD)} − additional SEP ${formatUsd(sepByD)} − reserve for this project's tax and credit settlement ${formatUsd(reserveByD)} = ${formatUsd(v)}. The reserve is a planning amount, not a calculated estimated-tax payment.` };
  }
  // household_balance: only with a complete cash context through the date.
  const cash = d.cash;
  if (!cash || !cash.completeThrough || cash.completeThrough < D || cash.snapshot.date > D) {
    return { targetId: t.id, kind: t.kind, byDate: D, requiredCents: t.minCents, valueCents: null, met: null,
      explanation: `Household balance by ${D} is not calculated: confirm a bank balance snapshot and that all other money in and out is listed through ${D}. The project-only figures above still apply.` };
  }
  const S = cash.snapshot.date, inc = new Set(cash.snapshot.includedFactIds);
  const after = (date: string, id: string) => date > S && date <= D && !inc.has(id);
  let v = cash.snapshot.balanceCents + cash.knownFlows.filter(f => f.date > S && f.date <= D).reduce((a, f) => a + f.amountCents, 0);
  for (const p of d.ws.projects) for (const [lines, sign] of [[p.receipts, 1], [p.expenses, -1]] as const) for (const l of lines) {
    if (l.actual) { if (after(l.actual.date, l.id)) v += sign * l.actual.amountCents; continue; }
    if (p.id === d.candidateId || l.cancelledAt || !l.expected || p.status !== "agreed") continue;
    if (after(l.expected.date, l.id)) v += sign * l.expected.amountCents;
  }
  v += c.payments.filter(p => p.date > S && p.date <= D).reduce((a, p) => a + p.amountCents, 0);
  v -= d.offeredExpenses.filter(e => e.date > S && e.date <= D).reduce((a, e) => a + e.amountCents, 0);
  for (const sc of d.ws.retirement.contributions) if (after(sc.paidDate, sc.id)) v -= sc.amountCents;
  v -= sepByD;
  // Agreed SEP goals still unpaid are assumed paid on that year's return due date (existing commitments, counted once).
  const agreedSepByD = ([0, 1] as const).reduce<number>((a, i) => a + (d.due[i] <= D ? d.remainingSep[i] : 0), 0);
  v -= agreedSepByD;
  const value = v - reserveByD - cash.protectedReserveCents;
  return { targetId: t.id, kind: t.kind, byDate: D, requiredCents: t.minCents, valueCents: value, met: value >= t.minCents,
    explanation: `Balance ${formatUsd(cash.snapshot.balanceCents)} on ${S} + your listed flows + plan payments, expenses and SEP not already in that balance` +
      `${agreedSepByD ? ` (incl. agreed SEP ${formatUsd(agreedSepByD)})` : ""} − this project's tax and credit reserve or settlement ${formatUsd(reserveByD)} − protected reserve ${formatUsd(cash.protectedReserveCents)} = ${formatUsd(value)} by ${D}. Other taxes come only from your listed flows.` };
}

// ----------------------------------------------------------------- infeasible --
function analyseInfeasible(a: { all: Candidate[]; goal: DealGoal; dateResult: (c: Candidate, t: DateTarget) => DateTargetResult; violations: Violation[] }) {
  if (!a.all.length) { a.violations.push({ constraint: "terms", requiredCents: 0, bestAchievableCents: null, explanation: "No payment schedule fits the allowed windows, share limits and number of payments." }); return; }
  const bestCash = Math.max(...a.all.map(c => c.cashDelta));
  if (bestCash < a.goal.minTwoYearCashDeltaCents) {
    a.violations.push({ constraint: "two_year_cash", requiredCents: a.goal.minTwoYearCashDeltaCents, bestAchievableCents: bestCash,
      explanation: `Within your price range, payment windows and SEP limit, the most this project can add after both returns is ${formatUsd(bestCash)}; you asked for at least ${formatUsd(a.goal.minTwoYearCashDeltaCents)}.` });
  }
  for (const t of a.goal.dateTargets) {
    const vals = a.all.map(c => a.dateResult(c, t)).filter(r => r.valueCents !== null);
    if (!vals.length) continue;
    const best = Math.max(...vals.map(r => r.valueCents!));
    if (best < t.minCents) a.violations.push({ constraint: `date_target:${t.id}`, requiredCents: t.minCents, bestAchievableCents: best,
      explanation: `By ${t.byDate} the most possible is ${formatUsd(best)} (${t.kind.replace(/_/g, " ")}); you asked for ${formatUsd(t.minCents)}.` });
  }
  if (!a.violations.length) a.violations.push({ constraint: "combination", requiredCents: 0, bestAchievableCents: null,
    explanation: "Each goal can be met on its own, but no single set of terms meets all of them together." });
}

interface RelaxCtx {
  goal: DealGoal; terms: DealTermsSpace; fixedTerms: boolean; slots: Slot[]; sepCap: number; offeredTotal: number; ctx: Ctx; step: number;
  models: [YearModel, YearModel]; yearEval: (yi: 0 | 1, r: number, s: number) => YearEval | null;
  sepOptionsRelaxed: (yi: 0 | 1, r: number) => number[];
  dateResult: (c: Candidate, t: DateTarget) => DateTargetResult; relaxations: Relaxation[]; all: Candidate[];
}
function relax(r: RelaxCtx) {
  const meets = (c: Candidate) => c.cashDelta >= r.goal.minTwoYearCashDeltaCents && r.goal.dateTargets.every(t => r.dateResult(c, t).met !== false);
  const build = (price: number, pay: Candidate["payments"], s0: number, s1: number): Candidate | null => {
    const x = pay.filter(p => p.yi === 0).reduce((a, p) => a + p.amountCents, 0);
    const y0 = r.yearEval(0, x, s0), y1 = r.yearEval(1, price - x, s1);
    return y0 && y1 ? { price, x, payments: pay, sep: [s0, s1], retirement: s0 + s1, years: [y0, y1], cashDelta: y0.spendable + y1.spendable - r.ctx.declineCash } : null;
  };
  // 1. Price ceiling only (other limits unchanged).
  if (!r.fixedTerms) {
    const hiLimit = r.terms.maxPriceCents + Math.max(r.terms.maxPriceCents - r.terms.minPriceCents, r.offeredTotal, 2_000_000);
    let found: number | null = null;
    for (let p = r.terms.maxPriceCents + 100; p <= hiLimit && found === null; p += r.step) {
      for (const x of splitValues(p, r.slots, r.step)) {
        const pay = allocate(p, x, r.slots, r.terms.maxPayments);
        if (!pay) continue;
        const sepOpts = (yi: 0 | 1, rec: number) => { const base = r.yearEval(yi, rec, 0); return base ? [0, Math.min(base.room, r.sepCap)].filter((v, i, a) => a.indexOf(v) === i) : [0]; };
        for (const s0 of sepOpts(0, x)) for (const s1 of sepOpts(1, p - x)) {
          if (s0 + s1 > r.sepCap) continue;
          const c = build(p, pay, s0, s1);
          if (c && meets(c)) { found = p; break; }
        }
        if (found !== null) break;
      }
    }
    r.relaxations.push(found !== null
      ? { constraint: "max_price", value: `${found}`, explanation: `Asking about ${formatUsd(found)} (above your maximum of ${formatUsd(r.terms.maxPriceCents)}; checked every ${formatUsd(r.step)}) would meet the goal with your other limits. This is a target to discuss, not a price the client accepted.` }
      : { constraint: "max_price", value: "none", explanation: `No price up to ${formatUsd(hiLimit)} meets the goal with your other limits.` });
  }
  // 2. Additional SEP cap only (legal limit still applies; cash set aside is ignored to show the amount needed).
  let needSep: number | null = null;
  const pool = r.fixedTerms ? r.all : r.all.filter(c => c.price <= r.terms.maxPriceCents);
  for (const c of pool) for (const s0 of r.sepOptionsRelaxed(0, c.x)) for (const s1 of r.sepOptionsRelaxed(1, c.price - c.x)) {
    const k = build(c.price, c.payments, s0, s1);
    if (k && meets(k) && (needSep === null || k.retirement < needSep)) needSep = k.retirement;
  }
  if (needSep !== null && needSep > r.sepCap) {
    r.relaxations.push({ constraint: "max_additional_sep", value: `${needSep}`, explanation: `An additional SEP-IRA contribution of ${formatUsd(needSep)} (above the ${formatUsd(r.sepCap)} you can use now) would meet the goal at an allowed price and schedule. It needs that much cash, and it is retirement money, not spending money.` });
  }
  // 3. Dated goals: the earliest date by which the best schedule reaches each target.
  for (const t of r.goal.dateTargets) {
    if (t.kind === "household_balance") continue;
    const okOthers = r.all.filter(c => c.cashDelta >= r.goal.minTwoYearCashDeltaCents);
    let earliest: string | null = null;
    for (const c of okOthers) {
      for (const date of [...new Set([...c.payments.map(p => p.date), "2027-04-15", "2028-04-18"])].sort()) {
        if (date < t.byDate) continue;
        if ((r.dateResult(c, { ...t, byDate: date }).valueCents ?? -Infinity) >= t.minCents) { if (!earliest || date < earliest) earliest = date; break; }
      }
    }
    if (earliest && earliest > t.byDate) r.relaxations.push({ constraint: `date_target:${t.id}`, value: earliest,
      explanation: `With your other goals, ${formatUsd(t.minCents)} (${t.kind.replace(/_/g, " ")}) is first reached on ${earliest}, not by ${t.byDate}.` });
  }
}

// ----------------------------------------------------------------- sensitivity --
function sensitivity(c: Candidate, x: ExactCtx): DecisionSensitivity {
  const items: SensitivityItem[] = [];
  for (const yi of [0, 1] as const) {
    const receipts = c.payments.filter(p => p.yi === yi).reduce((a, p) => a + p.amountCents, 0);
    const v = { profitDelta: receipts - x.openExpenses[yi], additionalSep: c.sep[yi] };
    let headroom: number | null = null;
    try { headroom = profitHeadroomDollars(x.models[yi], v); } catch { headroom = null; }
    if (headroom !== null) items.push({ year: YEARS[yi], fact: "other business profit", kind: "credit_lost", thresholdCents: (headroom + 1) * 100,
      checked: "exact: the household income limit is re-solved with the deduction and credit at each amount" });
  }
  // First additional 2026 base profit (same for this option and the baseline) at which the option no longer meets the cash goal.
  const deltaAt = (extra: number): number | null => {
    try {
      const yc = (i: 0 | 1, rec: number, s: number) => evaluateYear(x.models[i], { profitDelta: rec + (i === 0 ? extra : 0), additionalSep: s }).spendable;
      const exp = (i: 0 | 1) => x.openExpenses[i];
      const rec = (i: 0 | 1) => c.payments.filter(p => p.yi === i).reduce((a, p) => a + p.amountCents, 0);
      const opt = yc(0, rec(0) - exp(0), c.sep[0]) + yc(1, rec(1) - exp(1), c.sep[1]);
      const base = yc(0, 0, 0) + yc(1, 0, 0);
      return opt - base;
    } catch { return null; }
  };
  const points = new Set<number>();
  for (let e = 0; e <= 2_500_000; e += 25_000) points.add(e);
  for (const it of items) if (it.year === 2026 && it.thresholdCents !== null) { points.add(it.thresholdCents - 100); points.add(it.thresholdCents); }
  const baseHead = (() => { try { return profitHeadroomDollars(x.models[0], { profitDelta: 0, additionalSep: 0 }); } catch { return null; } })();
  if (baseHead !== null) { points.add(baseHead * 100); points.add((baseHead + 1) * 100); }
  let first: number | null = null;
  for (const e of [...points].sort((a, b) => a - b)) { const d = deltaAt(e); if (d !== null && d < x.goal.minTwoYearCashDeltaCents) { first = e; break; } }
  items.push({ year: 2026, fact: "other business profit (in this option and without it)", kind: "goal_not_met", thresholdCents: first,
    checked: "every $250 up to +$25,000, plus both credit limits exactly; a change between checked points is possible" });
  const plan2: Plan = { kind: "accept_now", label: "", revenue: c.price, receipts: c.payments.map(p => ({ date: p.date, amount: p.amountCents })),
    expenses: x.openExpenses.flatMap((amount, i) => (amount > 0 ? [{ yearIndex: i as 0 | 1, amount }] : [])), sep: c.sep, reasons: [], assumptions: [], actions: [] };
  let uncertainty: DecisionSensitivity["uncertainty"];
  try { uncertainty = stressPlan(x.ctx, plan2); } catch (e) { if (!(e instanceof EngineStop)) throw e; uncertainty = { status: "not_tested", worstCashDeltaCents: null, checkedDescription: e.message }; }
  const unconfirmed: string[] = [];
  for (const m of x.models) for (const p of m.persons) for (const [f, r] of Object.entries(p.ranges)) unconfirmed.push(`${m.year}: ${p.possessive} ${f} is a range (${formatUsd(r!.low)}–${formatUsd(r!.high)}).`);
  return { items, uncertainty, unconfirmedFacts: unconfirmed };
}
