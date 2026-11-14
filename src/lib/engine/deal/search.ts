/**
 * Deal-term search (round 4) on the shared deal-planning contract v1.0 (src/domain/deal-planning.ts).
 * Price × payment schedule × additional SEP for ONE project, on top of every other commitment, using
 * the existing year calculation (guards, SEHI/PTC, taxes, rounding). No second tax engine.
 *
 * Search space and accuracy (returned in `search`):
 *  - total asked price: every `price.stepCents` from min to max; above ~60 points a coarser lattice of
 *    whole steps, then the simplest variant is refined back to `stepCents`;
 *  - schedule: the unpaid remainder split between 2026 and 2027 windows on a lattice (≤ ~60 points, ≥ $50);
 *    inside one tax year money goes to the earliest window first (tax depends only on the year; earlier is
 *    never worse for dated goals); each window's max share is respected;
 *  - additional SEP in ONE tax year: {0, the smallest amount that restores that year's premium tax credit
 *    (exact bisection), the most allowed by the goal, the SEP cash left and the legal limit};
 *  - each lattice point is evaluated exactly with evaluateYear (memoised); chosen variants are refined
 *    (split ±1 lattice step every $5, then $1; lower price every step) and re-run through run()/scenarioFromPlan
 *    before every constraint is checked. Not claimed: a global optimum between lattice points outside the
 *    refinement window, or SEP gains from applicable-figure steps smaller than the restore-the-credit amount.
 */
import type { BlockedComparison, CaseInput, ScenarioKind, ScenarioResult, TaxYear, YearResult } from "@/domain/contracts";
import {
  CashContextSchema, cashCompletenessFor, dealSearchFingerprint, DealGoalSchema, DealTermsSpaceSchema,
  type CashContext, type DatedFlow, type DateTarget, type DealGoal, type DealSearchMeta, type DealSearchResult, type DealTermsSpace,
  type DealVariant, type DecisionSensitivityResult, type NoFeasibleTerms, type SensitivityItem,
} from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { modelWarnings } from "../common";
import { firstBusinessDay, makeCtx, run, scenarioFromPlan, stressPlan, YEARS, type Ctx, type Plan } from "../comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "../guard";
import { candidateContext, engineWorkspaceFingerprint, type CandidateContext } from "../household";
import { formatUsd } from "../money";
import { EngineStop, type YearModel } from "../model";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";
import { profitHeadroomDollars } from "../search";
import { evaluateYear, solveCredit, toYearResult } from "../year";
import { hasRanges, modelAt, UNCERTAINTY_SCALE } from "../uncertainty";

/** Label of the search layer (documentation; fingerprints use ENGINE_VERSION per the contract). */
export const DEAL_SEARCH_VERSION = "headroom-deal-1.0.0";
const MAX_PRICE_POINTS = 60, MAX_SPLIT_POINTS = 60;
/** An option whose credit survives less than this much extra other profit (dollars) is called fragile. */
export const FRAGILE_ROOM_DOLLARS = 1_000;
/** A sturdier option keeps at least this much room when one exists in the limits. */
export const ROBUST_ROOM_DOLLARS = 5_000;

type YI = 0 | 1;
interface Slot { windowId: string; date: string; yi: YI; maxBps: number }
interface Payment { id: string; windowId: string; date: string; amountCents: number; yi: YI }
interface YearEval { spendable: number; ptc: number; magi: number; room: number }
interface Candidate { price: number; remainder: number; x: number; payments: Payment[]; sepYear: YI | null; sep: number; cashDelta: number; years: [YearEval, YearEval] }
/** Engine variant: the contract shape plus the exact v1 scenario (dropped by schema parsing when stored). */
export type EngineDealVariant = DealVariant & {
  scenario: ScenarioResult;
  /** The same option against BOTH baselines: declining the unpaid terms, and accepting the offer as it stands (null if not calculable). */
  comparisons: { versusDeclineCents: number; versusOfferedCents: number | null };
  /** Whether the option holds: across declared income ranges (exact credit check + worst checked cash), else by the room policy. */
  robustness: { holds: boolean; basis: "declared_ranges" | "room_policy"; roomCents: number | null; worstCashInRangesCents: number | null };
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const yearOf = (date: string): YI => (date.startsWith("2026") ? 0 : 1);
const blockedFromSchema = (what: string, issues: Array<{ path: PropertyKey[]; message: string }>): BlockedComparison => ({
  status: "needs_data", code: "INVALID_DEAL_INPUT", message: `The ${what} needs review before options can be searched.`,
  fields: issues.map(i => ({ path: `dealPlanning.${what}.${i.path.map(String).join(".")}`, reason: i.message })) });

// =====================================================================================================
interface Prepared {
  cc: CandidateContext; models: [YearModel, YearModel]; ctx: Ctx; parsed: CaseInput;
  received: number; offered: Array<{ id: string; date: string; amountCents: number }>; offeredPrice: number;
  openExpenses: [number, number]; due: [string, string]; sepCashLeft: number | null; warnings: string[];
}

function prepareDeal(ws: HouseholdWorkspace, projectId: string): Prepared | BlockedComparison {
  const cc = candidateContext(ws, projectId);
  if ("status" in cc) return cc;
  const { candidate, receipts: offered, expenses } = cc;
  const received = candidate.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0);
  const derived: CaseInput = structuredClone(cc.derived);
  const first = [...offered].sort((a, b) => a.date.localeCompare(b.date))[0];
  derived.opportunity = { title: candidate.title, ownerPersonId: candidate.ownerPersonId, grossRevenueCents: offered.reduce((a, r) => a + r.amountCents, 0),
    plannedReceiptDate: first.date, incrementalExpensesCents: expenses.reduce((a, e) => a + e.amountCents, 0), expensePaymentDate: expenses[0]?.date ?? first.date,
    cashAccountingConfirmed: candidate.cashAccountingConfirmed, timingArrangementConfirmed: candidate.timingArrangementConfirmed };
  const issues = new Issues();
  const parsed = parseCase(derived, issues);
  const m0 = parsed ? buildYearModel(parsed, 0, issues) : null, m1 = parsed ? buildYearModel(parsed, 1, issues) : null;
  if (parsed) checkOpportunity(parsed, issues);
  const b = issues.toBlocked();
  if (b || !parsed || !m0 || !m1) return { ...b!, fields: b!.fields.map(f => ({ ...f, path: cc.adapted.translatePath(f.path) })) };
  const models: [YearModel, YearModel] = [m0, m1];
  let ctx: Ctx;
  try { ctx = makeCtx(parsed, models); } catch (e) {
    if (e instanceof EngineStop) return { status: e.kind === "unsupported" ? "unsupported" : "needs_data", code: e.code, message: e.message, fields: [{ path: "household", reason: e.message }] };
    throw e;
  }
  const openExpenses: [number, number] = [0, 0];
  for (const e of expenses) openExpenses[yearOf(e.date)] += e.amountCents;
  return { cc, models, ctx, parsed, received, offered, offeredPrice: received + offered.reduce((a, r) => a + r.amountCents, 0), openExpenses,
    due: [m0.rules.returnDueDate, m1.rules.returnDueDate], sepCashLeft: cc.baseline.sepBudget.availableCents, warnings: [...cc.warnings] };
}

/** Exact year evaluation, memoised by (year, receipts, SEP). Expenses of open lines stay in their own year. */
function yearEvaluator(p: Prepared) {
  const memo = new Map<string, YearEval | null>();
  return (yi: YI, receipts: number, sep: number): YearEval | null => {
    const key = `${yi}|${receipts}|${sep}`;
    if (memo.has(key)) return memo.get(key)!;
    let out: YearEval | null = null;
    try {
      const yc = evaluateYear(p.models[yi], { profitDelta: receipts - p.openExpenses[yi], additionalSep: sep });
      out = { spendable: yc.spendable, ptc: yc.credit.ptc.ptc, magi: yc.credit.magi, room: yc.credit.sepMax - yc.credit.sepTotal };
    } catch (e) { if (!(e instanceof EngineStop)) throw e; }
    memo.set(key, out);
    return out;
  };
}

/** {0, smallest SEP that restores the year's credit (exact), the cap} for one year's receipts. */
function sepOptions(p: Prepared, ev: ReturnType<typeof yearEvaluator>, cap: number) {
  return (yi: YI, receipts: number): number[] => {
    const base = ev(yi, receipts, 0);
    if (!base || cap <= 0) return [0];
    const room = Math.min(base.room, cap);
    const opts = new Set<number>([0]);
    if (room >= 100) opts.add(Math.floor(room / 100) * 100);
    if (base.ptc === 0 && p.models[yi].ptcEligible && room >= 100) {
      const keeps = (s: number) => { try { return solveCredit(p.models[yi], { profitDelta: receipts - p.openExpenses[yi], additionalSep: s }, false).ptc.ptc > 0; } catch { return false; } };
      if (keeps(Math.floor(room / 100) * 100)) {
        let lo = 0, hi = Math.floor(room / 100);
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (keeps(mid * 100)) hi = mid; else lo = mid + 1; }
        opts.add(lo * 100);
      }
    }
    return [...opts].sort((a, b) => a - b);
  };
}

function buildSlots(space: DealTermsSpace, timingConfirmed: boolean, notes: string[]): Slot[] {
  const out: Slot[] = [];
  for (const w of space.paymentWindows) {
    for (const y of [2026, 2027] as const) {
      const lo = w.earliest > `${y}-01-01` ? w.earliest : y === 2027 ? firstBusinessDay(2027) : `${y}-01-01`;
      const start = y === 2027 && lo < firstBusinessDay(2027) ? firstBusinessDay(2027) : lo;
      if (start > w.latest || w.latest < `${y}-01-01` || start > `${y}-12-31`) continue;
      if (y === 2027 && !timingConfirmed) { notes.push(`Window ${w.id}: 2027 payments are not searched until the client confirms in writing that they are not payable or available to you earlier.`); continue; }
      const split = w.earliest.slice(0, 4) !== w.latest.slice(0, 4);
      out.push({ windowId: split ? `${w.id}-${y}` : w.id, date: start, yi: y === 2026 ? 0 : 1, maxBps: w.maxShareBps });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const maxIn = (remainder: number, s: Slot) => Math.floor((remainder * s.maxBps) / 10000 / 100) * 100;

function splitValues(remainder: number, slots: Slot[], step: number): number[] {
  const cap = (yi: YI) => slots.filter(s => s.yi === yi).reduce((a, s) => a + maxIn(remainder, s), 0);
  const lo = Math.max(0, remainder - cap(1)), hi = Math.min(remainder, cap(0));
  if (lo > hi) return [];
  const xs = new Set<number>([lo, hi]);
  for (let x = Math.ceil(lo / step) * step; x <= hi; x += step) xs.add(x);
  return [...xs];
}

/** Earliest windows first inside each tax year, within each window's max share. */
function allocate(remainder: number, x: number, slots: Slot[], maxPayments: number): Payment[] | null {
  const out: Payment[] = [];
  for (const yi of [0, 1] as const) {
    let left = yi === 0 ? x : remainder - x;
    for (const s of slots.filter(q => q.yi === yi)) {
      const amt = Math.min(left, maxIn(remainder, s));
      if (amt > 0) out.push({ id: `pay-${s.windowId}`, windowId: s.windowId, date: s.date, amountCents: amt, yi });
      left -= amt;
    }
    if (left > 0) return null;
  }
  return out.length && out.length <= maxPayments ? out : null;
}
const offeredPayments = (p: Prepared): Payment[] => p.offered.map(o => ({ id: o.id, windowId: "offered", date: o.date, amountCents: o.amountCents, yi: yearOf(o.date) }));

// =====================================================================================================
interface DateEnv { p: Prepared; cash: CashContext | null; complete: boolean }

function burden(p: Prepared, c: Candidate, decl: [YearEval, YearEval], yi: YI): number {
  const r = c.payments.filter(q => q.yi === yi).reduce((a, q) => a + q.amountCents, 0);
  return r - p.openExpenses[yi] - (c.years[yi].spendable - decl[yi].spendable) - (c.sepYear === yi ? c.sep : 0);
}

/**
 * Date targets. project_receipts = gross money from the project by D (received facts + scheduled).
 * project_available_cash = scheduled receipts − project expenses − additional SEP paid − the project's tax reserve:
 * a year's extra tax and lost credit set aside pro rata as its money arrives (a planning amount, NOT an estimated-tax
 * calculation), which becomes the settlement on the return due date — so it is never counted twice.
 * household_balance = only with a complete cash context covering D.
 */
function dateTarget(env: DateEnv, c: Candidate, decl: [YearEval, YearEval], t: DateTarget) {
  const { p } = env, D = t.byDate;
  const fact = p.cc.candidate.receipts.filter(l => l.actual && l.actual.date <= D).reduce((a, l) => a + l.actual!.amountCents, 0);
  const sched = c.payments.filter(q => q.date <= D).reduce((a, q) => a + q.amountCents, 0);
  const expD = p.cc.expenses.filter(e => e.date <= D).reduce((a, e) => a + e.amountCents, 0);
  const sepD = c.sepYear !== null && p.due[c.sepYear] <= D ? c.sep : 0;
  const reserveD = ([0, 1] as const).reduce<number>((a, yi) => {
    const b = burden(p, c, decl, yi);
    if (p.due[yi] <= D) return a + b;
    const ry = c.payments.filter(q => q.yi === yi).reduce((s, q) => s + q.amountCents, 0);
    const arrived = c.payments.filter(q => q.yi === yi && q.date <= D).reduce((s, q) => s + q.amountCents, 0);
    return a + (ry > 0 ? Math.round((Math.max(0, b) * arrived) / ry) : 0);
  }, 0);
  const res = (v: number | null, explanation: string) => ({ targetId: t.id, achievedCents: v, met: v === null ? null : v >= t.minimumCents, explanation: clip(explanation, 400) });
  if (t.kind === "project_receipts") {
    const v = fact + sched;
    return res(v, `By ${D}: ${formatUsd(v)} from the project (${formatUsd(fact)} already received + ${formatUsd(sched)} under these terms). Gross money, not profit after tax.`);
  }
  if (t.kind === "project_available_cash") {
    const v = sched - expD - sepD - reserveD;
    return res(v, `By ${D}: payments ${formatUsd(sched)} − project expenses ${formatUsd(expD)} − extra SEP ${formatUsd(sepD)} − reserve for this project's tax and credit settlement ${formatUsd(reserveD)} = ${formatUsd(v)}. The reserve is a planning amount, not an estimated-tax calculation.`);
  }
  const cash = env.cash;
  if (!env.complete || !cash?.snapshot || !cash.completeness.through || D > cash.completeness.through || D < cash.snapshot.date) {
    return res(null, `Household balance on ${D} is not calculated: it needs a bank balance snapshot and your confirmation that every significant flow is listed through ${D}. The project figures still apply.`);
  }
  const S = cash.snapshot.date, inc = new Set(cash.includedFactIds);
  const after = (date: string, id: string) => date > S && date <= D && !inc.has(id);
  // A fact dated ON the snapshot day may or may not be in that balance: the included ids decide, never the time of day.
  const sameDay = [
    ...env.p.cc.ws.projects.flatMap(pr => [...pr.receipts, ...pr.expenses].filter(l => l.actual?.date === S && !inc.has(l.id)).map(l => `${formatUsd(l.actual!.amountCents)} for "${pr.title}"`)),
    ...env.p.cc.ws.retirement.contributions.filter(sc => sc.paidDate === S && !inc.has(sc.id)).map(sc => `the ${formatUsd(sc.amountCents)} SEP-IRA contribution`),
  ];
  if (sameDay.length) return res(null, `Household balance on ${D} is not calculated yet: ${sameDay.join(" and ")} happened on the day of your balance (${S}). Say whether the balance already includes ${sameDay.length === 1 ? "it" : "them"}.`);
  let v = cash.snapshot.balanceCents + cash.flows.filter(f => f.date > S && f.date <= D).reduce((a, f) => a + f.amountCents, 0);
  for (const pr of env.p.cc.ws.projects) for (const [lines, sign] of [[pr.receipts, 1], [pr.expenses, -1]] as const) for (const l of lines) {
    if (l.actual) { if (after(l.actual.date, l.id)) v += sign * l.actual.amountCents; continue; }
    if (pr.id === p.cc.candidate.id || l.cancelledAt || !l.expected || pr.status !== "agreed") continue;
    if (after(l.expected.date, l.id)) v += sign * l.expected.amountCents;
  }
  v += c.payments.filter(q => q.date > S && q.date <= D).reduce((a, q) => a + q.amountCents, 0);
  v -= p.cc.expenses.filter(e => e.date > S && e.date <= D).reduce((a, e) => a + e.amountCents, 0);
  for (const sc of env.p.cc.ws.retirement.contributions) if (after(sc.paidDate, sc.id)) v -= sc.amountCents;
  const agreedSep = ([0, 1] as const).reduce<number>((a, yi) => a + (p.due[yi] <= D && p.due[yi] > S ? p.cc.baseline.years[yi].sep.remainingCents : 0), 0);
  v -= sepD + agreedSep;
  const value = v - reserveD - cash.reserveCents;
  return res(value, `Balance ${formatUsd(cash.snapshot.balanceCents)} on ${S}, your listed flows, plan payments, expenses and SEP not already in that balance${agreedSep ? ` (incl. agreed SEP ${formatUsd(agreedSep)})` : ""}, minus this project's tax reserve ${formatUsd(reserveD)} and your untouched reserve ${formatUsd(cash.reserveCents)}: ${formatUsd(value)} on ${D}. Other taxes only as listed.`);
}

// =====================================================================================================
export async function searchDealTerms(ws: HouseholdWorkspace, goalRaw: DealGoal, spaceRaw: DealTermsSpace, cashRaw: CashContext | null): Promise<DealSearchResult> {
  const g = DealGoalSchema.safeParse(goalRaw); if (!g.success) return blockedFromSchema("goal", g.error.issues);
  const sp = DealTermsSpaceSchema.safeParse(spaceRaw); if (!sp.success) return blockedFromSchema("terms", sp.error.issues);
  const cs = cashRaw === null ? null : CashContextSchema.safeParse(cashRaw);
  if (cs && !cs.success) return blockedFromSchema("cash", cs.error.issues);
  const goal = g.data, space = sp.data, cash = cs ? cs.data! : null;
  if (goal.projectId !== space.projectId) return { status: "needs_data", code: "DEAL_PROJECT_MISMATCH", message: "The goal and the allowed terms are for different projects.", fields: [{ path: "dealPlanning.termSpaces", reason: "Choose the terms for the goal's project." }] };
  const prep = prepareDeal(ws, goal.projectId);
  if ("status" in prep) return prep;
  const p = prep, { ctx, models } = p;
  const warnings = [...p.warnings];
  const ev = yearEvaluator(p);
  const decl = run(models, ctx.decline).map(y => ({ spendable: y.spendable, ptc: y.credit.ptc.ptc, magi: y.credit.magi, room: 0 })) as [YearEval, YearEval];

  // ---------------------------------------------------------------- limits --
  const fixedTerms = space.newTermsConfirmed !== true;
  if (fixedTerms) warnings.push(space.newTermsConfirmed === null
    ? "It is not yet known whether the client would accept new terms, so only the offered price and dates are evaluated (plus an optional SEP-IRA contribution)."
    : "The client does not accept new terms, so only the offered price and dates are evaluated (plus an optional SEP-IRA contribution).");
  let sepCap = 0;
  if (space.allowAdditionalSep) {
    if (p.sepCashLeft === null) warnings.push("No money set aside for future SEP-IRA contributions was entered, so no additional contribution is searched.");
    else if (p.sepCashLeft < 0) return { status: "needs_data", code: "AGREED_SEP_BUDGET_SHORTFALL", message: "Your existing SEP commitments exceed the cash still available. Review them before searching new terms.",
      fields: [{ path: "retirement.futureContributionBudget", reason: `Existing commitments need ${formatUsd(-p.sepCashLeft)} more than the remaining SEP cash.` }] };
    else sepCap = goal.maxAdditionalSepCents === null ? p.sepCashLeft : Math.min(goal.maxAdditionalSepCents, p.sepCashLeft);
  }
  const sepOpt = sepOptions(p, ev, sepCap);
  const slots = buildSlots(space, p.cc.candidate.timingArrangementConfirmed === true, warnings);
  const complete = cashCompletenessFor(goal, cash) === "household_complete";

  // ---------------------------------------------------------------- enumerate --
  const all: Candidate[] = [];
  let evaluated = 0, shift = 0;
  const consider = (price: number, payments: Payment[]) => {
    const remainder = price - p.received;
    const x = payments.filter(q => q.yi === 0).reduce((a, q) => a + q.amountCents, 0);
    const r: [number, number] = [x, remainder - x];
    const options: Array<[YI | null, number]> = [[null, 0]];
    for (const yi of [0, 1] as const) for (const s of sepOpt(yi, r[yi])) if (s > 0) options.push([yi, s]);
    for (const [sy, s] of options) {
      const y0 = ev(0, r[0], sy === 0 ? s : 0), y1 = ev(1, r[1], sy === 1 ? s : 0);
      evaluated++;
      if (!y0 || !y1) continue;
      all.push({ price, remainder, x, payments, sepYear: sy, sep: s, years: [y0, y1], cashDelta: y0.spendable + y1.spendable - ctx.declineCash - shift });
    }
  };
  consider(p.offeredPrice, offeredPayments(p));
  const asOfferedNoSep = all.find(c => c.sep === 0);
  if (goal.baseline === "accept_as_offered") {
    if (!asOfferedNoSep) return { status: "unsupported", code: "OFFER_NOT_CALCULABLE", message: "The offered terms cannot be calculated in the supported range, so they cannot be the baseline.", fields: [{ path: "dealPlanning.goals.baseline", reason: "Use the plan without this project as the baseline." }] };
    shift = asOfferedNoSep.cashDelta;
    for (const c of all) c.cashDelta -= shift;
  }

  let priceStep = space.price.stepCents;
  if (!fixedTerms) {
    const nSteps = Math.floor((space.price.maxCents - space.price.minCents) / space.price.stepCents);
    const stride = Math.max(1, Math.ceil((nSteps + 1) / MAX_PRICE_POINTS));
    priceStep = stride * space.price.stepCents;
    const prices = new Set<number>();
    for (let k = 0; k <= nSteps; k += stride) prices.add(space.price.minCents + k * space.price.stepCents);
    prices.add(space.price.minCents + nSteps * space.price.stepCents);
    for (const price of [...prices].sort((a, b) => a - b)) {
      const rem = price - p.received;
      if (rem <= 0) continue;
      const splitStep = Math.max(5000, Math.ceil(rem / MAX_SPLIT_POINTS / 5000) * 5000);
      for (const x of splitValues(rem, slots, splitStep)) {
        const pay = allocate(rem, x, slots, space.maxPayments);
        if (pay) consider(price, pay);
      }
    }
  }
  const env: DateEnv = { p, cash, complete };
  const meets = (c: Candidate) => c.cashDelta >= goal.minimumTwoYearCashDeltaCents && goal.dateTargets.every(t => dateTarget(env, c, decl, t).met !== false);
  const feasible = all.filter(meets);

  // ---------------------------------------------------------------- choose --
  /** Smallest extra other profit (whole dollars) that would lose a credit this option keeps; Infinity if no credit is at stake. */
  const roomMemo = new Map<Candidate, number>();
  const roomsOf = (c: Candidate): [number, number] => ([0, 1] as const).map(yi => {
    if (c.years[yi].ptc === 0) return Infinity;
    try { return profitHeadroomDollars(models[yi], { profitDelta: c.payments.filter(q => q.yi === yi).reduce((a, q) => a + q.amountCents, 0) - p.openExpenses[yi], additionalSep: c.sepYear === yi ? c.sep : 0 }) ?? Infinity; } catch { return Infinity; }
  }) as [number, number];
  const roomOf = (c: Candidate): number => {
    if (roomMemo.has(c)) return roomMemo.get(c)!;
    const r = Math.min(...roomsOf(c));
    roomMemo.set(c, r);
    return r;
  };
  const materiality = Math.max(10000, Math.round(p.offeredPrice / 100));
  const offeredKey = JSON.stringify(offeredPayments(p).map(q => [q.date, q.amountCents]));
  const isOffered = (c: Candidate) => c.price === p.offeredPrice && c.payments.every(q => q.windowId === "offered");
  const scheduleChanged = (c: Candidate) => !isOffered(c) && JSON.stringify(c.payments.map(q => [q.date, q.amountCents])) !== offeredKey;
  /**
   * Smallest change of terms first (documented policy): the offer as it stands < the same terms plus the household's own
   * SEP-IRA < a new schedule at the offered price < a different price (a price the client has not agreed to). Then fewer
   * payments, no 2027 payment, the smallest price change.
   */
  const complexity = (c: Candidate) => [c.price !== p.offeredPrice ? 1 : 0, scheduleChanged(c) ? 1 : 0, c.sep > 0 ? 1 : 0, c.payments.length,
    c.payments.some(q => q.yi === 1) ? 1 : 0, Math.abs(c.price - p.offeredPrice)];
  const lexi = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  /**
   * Holds: with declared income ranges, every credit the option keeps is still kept with every range at its high end
   * (credit loss is monotone in income, so this decides all combinations); without ranges, it keeps each credit with at
   * least FRAGILE_ROOM_DOLLARS of extra profit to spare. Cash across ranges is checked on the exact option (stress).
   */
  const highModels = models.some(hasRanges) ? models.map(m => modelAt(m, UNCERTAINTY_SCALE)) : null;
  const holds = (c: Candidate): boolean => ([0, 1] as const).every(yi => {
    if (c.years[yi].ptc === 0) return true;
    const v = { profitDelta: c.payments.filter(q => q.yi === yi).reduce((a, q) => a + q.amountCents, 0) - p.openExpenses[yi], additionalSep: c.sepYear === yi ? c.sep : 0 };
    if (highModels) { try { return solveCredit(highModels[yi], v, false).ptc.ptc > 0; } catch { return false; } }
    return roomsOf(c)[yi] >= FRAGILE_ROOM_DOLLARS;
  });
  const picks: Array<{ purpose: DealVariant["purpose"]; c: Candidate }> = [];
  let conditional = false;
  if (feasible.length) {
    const ordered = [...feasible].sort((a, b) => lexi(complexity(a), complexity(b)) || b.cashDelta - a.cashDelta);
    const smallestHolding = ordered.slice(0, 400).find(holds);
    const primary = smallestHolding ?? ordered[0];
    conditional = !smallestHolding;
    const mostCash = [...feasible].sort((a, b) => b.cashDelta - a.cashDelta || lexi(complexity(a), complexity(b)))[0];
    picks.push({ purpose: isOffered(primary) ? "as_offered" : "simplest", c: primary }, { purpose: "most_cash", c: mostCash });
    const target = goal.dateTargets.find(t => t.kind !== "household_balance") ?? goal.dateTargets[0];
    const val = (c: Candidate) => (target ? dateTarget(env, c, decl, target).achievedCents ?? -Infinity : -Infinity);
    const earliest = target && [...feasible].sort((a, b) => val(b) - val(a) || b.cashDelta - a.cashDelta)[0];
    const mostRet = [...feasible].sort((a, b) => b.sep - a.sep || b.cashDelta - a.cashDelta)[0];
    const pool = [...feasible].sort((a, b) => b.cashDelta - a.cashDelta).slice(0, 80);
    const roomiest = [...pool].sort((a, b) => roomOf(b) - roomOf(a) || b.cashDelta - a.cashDelta)[0];
    if ((conditional || !holds(mostCash)) && roomiest && roomOf(roomiest) >= Math.min(roomOf(primary), roomOf(mostCash)) + FRAGILE_ROOM_DOLLARS) picks.push({ purpose: "lowest_risk", c: roomiest });
    else if (earliest && val(earliest) > Math.max(val(primary), val(mostCash))) picks.push({ purpose: "earliest_money", c: earliest });
    else if (mostRet.sep > Math.max(primary.sep, mostCash.sep)) picks.push({ purpose: "most_retirement", c: mostRet });
    else if (roomiest && Number.isFinite(roomOf(roomiest)) && roomOf(roomiest) > Math.max(roomOf(primary), roomOf(mostCash))) picks.push({ purpose: "lowest_risk", c: roomiest });
  }

  // ---------------------------------------------------------------- refine + exact --
  const variants: EngineDealVariant[] = [];
  const keys = new Set<string>();
  const re: RefineEnv = { slots, space, meets, ev, sepOpt, shift, ctx, p, priceStep };
  const offeredCash = asOfferedNoSep ? asOfferedNoSep.cashDelta + shift : null;           // vs declining
  const agreedProject = p.cc.candidate.status === "agreed";
  if (agreedProject) warnings.push(goal.baseline === "decline_unpaid_terms"
    ? `"${p.cc.candidate.title}" is already agreed: declining its unpaid part is not a free choice (a deposit refund, costs or obligations may apply and are not known here, so they are not counted as $0). Compare options with the agreed terms first; the comparison with declining is for reference only.`
    : `"${p.cc.candidate.title}" is already agreed: options are compared with the agreed terms. Changing them needs the client's agreement.`);
  for (const { purpose, c } of picks) {
    let refined = fixedTerms ? c : purpose === "most_cash" ? refineSplit(c, re) : purpose === "simplest" ? refinePrice(c, re) : c;
    if (purpose === "simplest" && !conditional && !holds(refined)) refined = c;                // refinement never trades away the margin
    const key = JSON.stringify([refined.price, refined.payments.map(q => [q.date, q.amountCents]), refined.sepYear, refined.sep]);
    if (keys.has(key)) continue;
    keys.add(key);
    const v = exactVariant(refined, purpose, { p, env, decl, goal, space, slots, sepCap, shift, warnings });
    if (!v) continue;
    const vsDecline = v.twoYearCashDeltaCents + shift;
    const room = Math.min(...roomsOf(refined));
    v.comparisons = { versusDeclineCents: vsDecline, versusOfferedCents: offeredCash === null ? null : vsDecline - offeredCash };
    v.robustness = { holds: holds(refined), basis: highModels ? "declared_ranges" : "room_policy", roomCents: Number.isFinite(room) ? room * 100 : null,
      worstCashInRangesCents: highModels && v.scenario.stress.worstCashDeltaCents !== null ? v.scenario.stress.worstCashDeltaCents - shift : null };
    if (highModels && v.robustness.worstCashInRangesCents !== null && v.robustness.worstCashInRangesCents < goal.minimumTwoYearCashDeltaCents) v.robustness.holds = false;
    const changesTerms = refined.price !== p.offeredPrice || scheduleChanged(refined);
    if (purpose === "most_cash" && changesTerms) v.label = clip(v.label.replace(PURPOSE_LABEL.most_cash, "More cash, if the client agrees"), 200);
    if (purpose === "as_offered" && agreedProject) v.label = clip(v.label.replace(PURPOSE_LABEL.as_offered, "Keep the agreed terms"), 200);
    variants.push(v);
  }
  const best = variants.length ? Math.max(...variants.map(v => v.twoYearCashDeltaCents)) : 0;
  for (const v of variants) v.differenceFromBestCents = best - v.twoYearCashDeltaCents;
  for (const v of variants) {
    const room = v.robustness.roomCents;
    if (room === null) continue;
    if (room < FRAGILE_ROOM_DOLLARS * 100 || v.purpose === "lowest_risk") v.label = clip(`${v.label}; room before a credit is lost: ${formatUsd(room)}`, 200);
    if (room < FRAGILE_ROOM_DOLLARS * 100) warnings.push(`"${v.label.split(":")[0]}" keeps the premium tax credit with only ${formatUsd(room)} of extra profit to spare.`);
  }
  const primaryV = variants.find(v => v.purpose === "simplest" || v.purpose === "as_offered");
  const mostV = variants.find(v => v.purpose === "most_cash");
  if (primaryV && mostV && mostV !== primaryV && mostV.differenceFromBestCents === 0 && primaryV.differenceFromBestCents < materiality)
    warnings.push(`The option with more cash adds only ${formatUsd(primaryV.differenceFromBestCents)} (less than ${formatUsd(materiality)}); the smaller change is recommended.`);
  if (conditional && primaryV) warnings.push(highModels
    ? "No option in your limits keeps every credit and your minimum cash across your declared income ranges. The recommended option meets the goal at your entered values only."
    : `No option in your limits keeps every credit with at least ${formatUsd(FRAGILE_ROOM_DOLLARS * 100)} of extra profit to spare. The recommended option meets the goal at your entered values; a small change in income can lose a credit.`);
  if (mostV && primaryV && mostV !== primaryV && (mostV.terms.priceCents !== p.offeredPrice))
    warnings.push("Options with a different price depend on the client agreeing to it; allowing a price range does not mean the client accepts it.");
  // Recommendation: the smallest change of terms that meets the goal (and holds, when such an option exists).
  const recommended = primaryV ?? mostV ?? variants[0];

  // ---------------------------------------------------------------- meta --
  const workspaceFp = await engineWorkspaceFingerprint(p.cc.ws);
  const meta: DealSearchMeta = {
    goalId: goal.id, projectId: goal.projectId, workspaceFingerprint: workspaceFp,
    searchFingerprint: await dealSearchFingerprint(workspaceFp, goal, space, cash, ENGINE_VERSION, RULES_VERSION),
    engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
    baseline: goal.baseline === "decline_unpaid_terms"
      ? { kind: goal.baseline, label: `Your plan without the unpaid terms of "${p.cc.candidate.title}"`, description: clip(`Profit forecast, other agreed projects, ${formatUsd(p.received)} already received from this project and SEP goals already agreed. Declining does not cancel anything else.`, 400) }
      : { kind: goal.baseline, label: `Your plan with "${p.cc.candidate.title}" exactly as offered`, description: clip(`As offered: ${formatUsd(p.offeredPrice)} total, ${p.offered.map(o => `${formatUsd(o.amountCents)} on ${o.date}`).join(", ")}, no extra SEP.`, 400) },
    horizon: { from: "2026-01-01", through: "2027-12-31", settlementThrough: p.due[1] },
    search: { priceStepCents: fixedTerms ? 0 : priceStep, paymentDateCandidates: fixedTerms ? p.offered.length : slots.length, sepStepCents: null, evaluated, exhaustiveWithinSpace: fixedTerms,
      note: clip(fixedTerms ? "Offered terms only; additional SEP options: none, the exact amount that restores a credit, and the most allowed." :
        `Price every ${formatUsd(priceStep)} (the simplest option refined to ${formatUsd(space.price.stepCents)}), 2026/2027 split on a lattice refined to $1 for the most-cash option, SEP options exact. Shown options are re-checked with the full calculation; not a proof of the global optimum between lattice points.`, 400) },
    cashCompleteness: cashCompletenessFor(goal, cash),
    simplerVariantThresholdCents: materiality,
    warnings: [...new Set([...modelWarnings(models, p.parsed), ...warnings])],
  };
  if (variants.length) return { status: "ready", ...meta, variants, recommendedVariantId: recommended?.id ?? null };
  const nf: NoFeasibleTerms = { status: "no_feasible_terms", ...meta, violated: [], relaxations: [] };
  explainInfeasible(nf, { all, goal, env, decl, p, space, slots, sepCap, ev, shift, fixedTerms, priceStep });
  return nf;
}

// =====================================================================================================
interface RefineEnv { slots: Slot[]; space: DealTermsSpace; meets: (c: Candidate) => boolean; ev: ReturnType<typeof yearEvaluator>; sepOpt: (yi: YI, r: number) => number[]; shift: number; ctx: Ctx; p: Prepared; priceStep: number }
function bestAt(price: number, x: number, e: RefineEnv): Candidate | null {
  const rem = price - e.p.received;
  if (rem <= 0) return null;
  const pay = allocate(rem, x, e.slots, e.space.maxPayments);
  if (!pay) return null;
  const r: [number, number] = [x, rem - x];
  let best: Candidate | null = null;
  const options: Array<[YI | null, number]> = [[null, 0]];
  for (const yi of [0, 1] as const) for (const s of e.sepOpt(yi, r[yi])) if (s > 0) options.push([yi, s]);
  for (const [sy, s] of options) {
    const y0 = e.ev(0, r[0], sy === 0 ? s : 0), y1 = e.ev(1, r[1], sy === 1 ? s : 0);
    if (!y0 || !y1) continue;
    const c: Candidate = { price, remainder: rem, x, payments: pay, sepYear: sy, sep: s, years: [y0, y1], cashDelta: y0.spendable + y1.spendable - e.ctx.declineCash - e.shift };
    if (e.meets(c) && (!best || c.cashDelta > best.cashDelta || (c.cashDelta === best.cashDelta && c.sep < best.sep))) best = c;
  }
  return best;
}
/** Most cash: split refined at a fixed price, ±1 lattice step every $5, then every $1. */
function refineSplit(c: Candidate, e: RefineEnv): Candidate {
  if (c.payments.some(q => q.windowId === "offered")) return c;
  const step = Math.max(5000, Math.ceil(c.remainder / MAX_SPLIT_POINTS / 5000) * 5000);
  let best = c;
  const scan = (from: number, to: number, by: number) => {
    for (let x = Math.max(0, from); x <= Math.min(c.remainder, to); x += by) { const k = bestAt(c.price, x, e); if (k && k.cashDelta > best.cashDelta) best = k; }
  };
  scan(c.x - step, c.x + step, 500);
  scan(best.x - 500, best.x + 500, 100);
  return best;
}
/** Simplest: the lowest asked price (at the user's price step) between the previous lattice point and this one. */
function refinePrice(c: Candidate, e: RefineEnv): Candidate {
  if (c.payments.some(q => q.windowId === "offered")) return c;
  const share = c.remainder > 0 ? c.x / c.remainder : 0;
  for (let price = Math.max(e.space.price.minCents, c.price - e.priceStep + e.space.price.stepCents); price < c.price; price += e.space.price.stepCents) {
    const rem = price - e.p.received;
    const x = c.payments.every(q => q.yi === 0) ? rem : c.payments.every(q => q.yi === 1) ? 0 : Math.round((rem * share) / 100) * 100;
    const k = bestAt(price, x, e);
    if (k) return k;
  }
  return c;
}

// =====================================================================================================
interface ExactEnv { p: Prepared; env: DateEnv; decl: [YearEval, YearEval]; goal: DealGoal; space: DealTermsSpace; slots: Slot[]; sepCap: number; shift: number; warnings: string[] }
function kindOf(c: Candidate, p: Prepared): ScenarioKind {
  const offeredYear = yearOf([...p.offered].sort((a, b) => a.date.localeCompare(b.date))[0].date);
  if (c.price !== p.offeredPrice) return "renegotiate";
  if (c.payments.some(q => q.yi !== offeredYear)) return "split_payment";
  return c.sep > 0 ? "sep_minimum" : "accept_now";
}

const PURPOSE_LABEL: Record<DealVariant["purpose"], string> = { simplest: "Smallest change that meets your goal", most_cash: "Most cash after both returns",
  earliest_money: "Most money by your date", most_retirement: "Most added to retirement", lowest_risk: "Most room before losing a credit", as_offered: "Accept as offered" };

function exactVariant(c: Candidate, purpose: DealVariant["purpose"], x: ExactEnv): EngineDealVariant | null {
  const { p } = x;
  const plan: Plan = { kind: kindOf(c, p), label: "", revenue: c.remainder, receipts: c.payments.map(q => ({ date: q.date, amount: q.amountCents })),
    expenses: p.openExpenses.flatMap((amount, i) => (amount > 0 ? [{ yearIndex: i as YI, amount }] : [])),
    sep: c.sepYear === null ? [0, 0] : c.sepYear === 0 ? [c.sep, 0] : [0, c.sep], reasons: [], actions: [],
    assumptions: [...p.ctx.common, "Asked terms: nothing is agreed until the client confirms in writing.",
      "Additional SEP-IRA is on top of SEP goals already agreed; retirement money is not spendable cash."] };
  let ycs;
  try { ycs = run(p.models, plan); } catch (e) {
    if (!(e instanceof EngineStop)) throw e;
    x.warnings.push(`An option was dropped by the exact check: ${e.message}`);
    return null;
  }
  const exactDelta = ycs[0].spendable + ycs[1].spendable - p.ctx.declineCash - x.shift;
  const exact: Candidate = { ...c, cashDelta: exactDelta,
    years: ([0, 1] as const).map(i => ({ spendable: ycs[i].spendable, ptc: ycs[i].credit.ptc.ptc, magi: ycs[i].credit.magi, room: ycs[i].credit.sepMax - ycs[i].credit.sepTotal })) as [YearEval, YearEval] };
  const dts = x.goal.dateTargets.map(t => dateTarget(x.env, exact, x.decl, t));
  const changed = c.price !== p.offeredPrice || c.payments.some(q => q.windowId !== "offered");
  const constraints: DealVariant["constraints"] = [
    { id: "minimum_cash", satisfied: exactDelta >= x.goal.minimumTwoYearCashDeltaCents, detail: clip(`${formatUsd(exactDelta)} after both returns settle vs your minimum ${formatUsd(x.goal.minimumTwoYearCashDeltaCents)} (retirement excluded).`, 400) },
    ...dts.map(d => ({ id: "date_target" as const, satisfied: d.met !== false, detail: d.explanation })),
    { id: "price_bounds", satisfied: !changed || (c.price >= x.space.price.minCents && c.price <= x.space.price.maxCents),
      detail: `Total asked ${formatUsd(c.price)}${changed ? ` within ${formatUsd(x.space.price.minCents)}–${formatUsd(x.space.price.maxCents)}` : " (as offered)"}.` },
    { id: "payment_windows", satisfied: !changed || c.payments.every(q => x.slots.some(s => s.windowId === q.windowId && s.date === q.date && q.amountCents <= maxIn(c.remainder, s))),
      detail: clip(`${c.payments.map(q => `${formatUsd(q.amountCents)} on ${q.date}`).join(", ")}.`, 400) },
    { id: "max_payments", satisfied: !changed || c.payments.length <= x.space.maxPayments, detail: `${c.payments.length} payment(s), at most ${x.space.maxPayments}.` },
    { id: "additional_sep_limit", satisfied: x.goal.maxAdditionalSepCents === null || c.sep <= x.goal.maxAdditionalSepCents,
      detail: `Extra SEP-IRA ${formatUsd(c.sep)}${x.goal.maxAdditionalSepCents === null ? "" : `, your limit ${formatUsd(x.goal.maxAdditionalSepCents)}`}.` },
    { id: "sep_cash", satisfied: c.sep <= x.sepCap, detail: `SEP cash left after agreed goals and recorded payments: ${p.sepCashLeft === null ? "not entered" : formatUsd(p.sepCashLeft)}.` },
    { id: "sep_legal_limit", satisfied: true, detail: "The legal SEP-IRA limit on the year's whole business profit was checked by the tax calculation." },
    { id: "timing_confirmation", satisfied: !c.payments.some(q => q.yi === 1 && q.windowId !== "offered") || p.cc.candidate.timingArrangementConfirmed === true,
      detail: "2027 payments need the client's written confirmation that the money is not payable or available earlier." },
    { id: "new_terms_confirmation", satisfied: !changed || x.space.newTermsConfirmed === true, detail: changed ? "The client said new terms can be discussed." : "Offered terms." },
    { id: "fixed_facts", satisfied: c.payments.reduce((a, q) => a + q.amountCents, 0) === c.price - p.received,
      detail: `${formatUsd(p.received)} already received stays as recorded; payments cover only the remaining ${formatUsd(c.price - p.received)}.` },
  ];
  if (constraints.some(k => !k.satisfied)) { x.warnings.push(`An option failed its exact re-check and is not shown (${constraints.filter(k => !k.satisfied).map(k => k.id).join(", ")}).`); return null; }
  const scenario = scenarioFromPlan(p.ctx, plan, ycs, `deal-${purpose}`);
  const sepYear = c.sepYear === null ? null : YEARS[c.sepYear];
  const datedFlows: DatedFlow[] = [
    ...p.cc.candidate.receipts.filter(l => l.actual).map(l => ({ date: l.actual!.date, amountCents: l.actual!.amountCents, kind: "project_receipt" as const, basis: "fixed" as const, label: "Already received" })),
    ...c.payments.map(q => ({ date: q.date, amountCents: q.amountCents, kind: "project_receipt" as const, basis: "proposed" as const, label: "Payment under these terms" })),
    ...p.cc.expenses.map(e => ({ date: e.date, amountCents: -e.amountCents, kind: "project_expense" as const, basis: "estimated" as const, label: "Project expense" })),
    ...(c.sep > 0 && c.sepYear !== null ? [{ date: p.due[c.sepYear], amountCents: -c.sep, kind: "sep_contribution" as const, basis: "proposed" as const, label: `Extra SEP-IRA for ${sepYear} (by the return due date)` }] : []),
    ...([0, 1] as const).flatMap(yi => { const b = burden(p, exact, x.decl, yi); return b ? [{ date: p.due[yi], amountCents: -b, kind: "tax_settlement" as const, basis: "estimated" as const,
      label: clip(`This project's extra tax and credit settlement for ${YEARS[yi]} (${b > 0 ? "paid" : "received"} with the return)`, 200) }] : []; }),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const title = p.cc.candidate.title;
  const actions: DealVariant["actions"] = [
    ...(changed ? [{ id: "send-terms", title: clip(`Send the proposed terms for "${title}" to the client`, 300), dueDate: null, dueCondition: "Before the next invoice; nothing changes until the client confirms in writing.", kind: "send_terms" as const, sourceIds: ["irs-pub-334"] }] : []),
    ...c.payments.map(q => ({ id: `receive-${q.id}`, title: clip(`Receive ${formatUsd(q.amountCents)} for "${title}" and record the actual payment`, 300), dueDate: q.date, dueCondition: null, kind: "receive_payment" as const, sourceIds: [] })),
    ...(c.sep > 0 && c.sepYear !== null ? [{ id: `sep-${sepYear}`, title: `Contribute the extra ${formatUsd(c.sep)} to the SEP-IRA for ${sepYear}`, dueDate: p.due[c.sepYear], dueCondition: "Later only with a filed extension.", kind: "sep_contribution" as const, sourceIds: ["irs-pub-560"] }] : []),
    { id: "marketplace", title: "Update your Marketplace income estimate for the years these payments fall in", dueDate: null, dueCondition: "As soon as the client agrees to the terms.", kind: "marketplace_update" as const, sourceIds: ["healthcare-gov-report-changes"] },
    ...([0, 1] as const).flatMap(yi => { const b = burden(p, exact, x.decl, yi); return b > 0 ? [{ id: `settle-${YEARS[yi]}`, title: clip(`Keep about ${formatUsd(b)} for this project's extra ${YEARS[yi]} tax and credit repayment (an estimate, not a quarterly payment calculation)`, 300),
      dueDate: p.due[yi], dueCondition: null, kind: "tax_payment" as const, sourceIds: ["irs-ptc-qa"] }] : []; }),
  ].slice(0, 15);
  return {
    id: `v-${purpose}`, label: clip(`${PURPOSE_LABEL[purpose]}: ${formatUsd(c.price)} total; ${c.payments.map(q => `${formatUsd(q.amountCents)} ${q.date}`).join(", ")}${c.sep ? `; extra SEP ${formatUsd(c.sep)}` : ""}`, 200),
    purpose, terms: { priceCents: c.price, payments: c.payments.map(q => ({ id: q.id, date: q.date, amountCents: q.amountCents })),
      additionalSep: c.sep > 0 && sepYear ? { year: sepYear, personId: p.cc.candidate.ownerPersonId, amountCents: c.sep } : null },
    twoYearCashDeltaCents: exactDelta, retirementAddedCents: c.sep, datedFlows: datedFlows.slice(0, 100), dateTargets: dts,
    aca: ([0, 1] as const).map(i => ({ year: YEARS[i], magiCents: ycs[i].credit.magi, ptcCents: ycs[i].credit.ptc.ptc, creditLost: p.models[i].ptcEligible && x.decl[i].ptc > 0 && ycs[i].credit.ptc.ptc === 0 })),
    constraints, actions, differenceFromBestCents: 0, verifiedExact: true, scenario,
    comparisons: { versusDeclineCents: 0, versusOfferedCents: null }, robustness: { holds: false, basis: "room_policy", roomCents: null, worstCashInRangesCents: null },
  };
}

// =====================================================================================================
interface InfeasibleEnv { all: Candidate[]; goal: DealGoal; env: DateEnv; decl: [YearEval, YearEval]; p: Prepared; space: DealTermsSpace; slots: Slot[]; sepCap: number;
  ev: ReturnType<typeof yearEvaluator>; shift: number; fixedTerms: boolean; priceStep: number }
function explainInfeasible(nf: NoFeasibleTerms, a: InfeasibleEnv) {
  const { all, goal } = a;
  if (!all.length) { nf.violated.push({ id: "payment_windows", detail: "No schedule fits the allowed windows, shares and number of payments in the supported tax range." }); return; }
  const bestCash = Math.max(...all.map(c => c.cashDelta));
  if (bestCash < goal.minimumTwoYearCashDeltaCents) {
    nf.violated.push({ id: "minimum_cash", detail: clip(`Within the allowed prices, payment windows and SEP limit, the most this project adds after both returns is ${formatUsd(bestCash)}; the goal is ${formatUsd(goal.minimumTwoYearCashDeltaCents)}.`, 400) });
    nf.relaxations.push({ constraint: "minimum_cash", requiredCents: bestCash, requiredDate: null, explanation: clip(`With the current limits, the cash goal could be at most ${formatUsd(bestCash)}.`, 400) });
  }
  for (const t of goal.dateTargets) {
    const vals = all.map(c => dateTarget(a.env, c, a.decl, t)).filter(r => r.achievedCents !== null);
    if (!vals.length) continue;
    const best = Math.max(...vals.map(r => r.achievedCents!));
    if (best >= t.minimumCents) continue;
    nf.violated.push({ id: "date_target", detail: clip(`By ${t.byDate} at most ${formatUsd(best)} (${t.kind.replace(/_/g, " ")}); the goal is ${formatUsd(t.minimumCents)}.`, 400) });
    // Earliest later date by which an option that meets the cash goal reaches the target.
    let earliest: string | null = null;
    for (const c of all.filter(k => k.cashDelta >= goal.minimumTwoYearCashDeltaCents)) for (const d of [...new Set([...c.payments.map(q => q.date), ...a.p.due])].sort()) {
      if (d <= t.byDate) continue;
      if ((dateTarget(a.env, c, a.decl, { ...t, byDate: d }).achievedCents ?? -Infinity) >= t.minimumCents) { if (!earliest || d < earliest) earliest = d; break; }
    }
    if (earliest) nf.relaxations.push({ constraint: "date_target", requiredCents: null, requiredDate: earliest,
      explanation: clip(`With the cash goal kept, ${formatUsd(t.minimumCents)} (${t.kind.replace(/_/g, " ")}) is first reached on ${earliest}.`, 400) });
  }
  if (!nf.violated.length) nf.violated.push({ id: "minimum_cash", detail: "Each goal can be met on its own, but no single set of terms meets all of them together." });

  const meets = (c: Candidate) => c.cashDelta >= goal.minimumTwoYearCashDeltaCents && goal.dateTargets.every(t => dateTarget(a.env, c, a.decl, t).met !== false);
  const make = (price: number, pay: Payment[], sy: YI | null, s: number): Candidate | null => {
    const rem = price - a.p.received, x = pay.filter(q => q.yi === 0).reduce((t, q) => t + q.amountCents, 0);
    const y0 = a.ev(0, x, sy === 0 ? s : 0), y1 = a.ev(1, rem - x, sy === 1 ? s : 0);
    return y0 && y1 ? { price, remainder: rem, x, payments: pay, sepYear: sy, sep: s, years: [y0, y1], cashDelta: y0.spendable + y1.spendable - a.p.ctx.declineCash - a.shift } : null;
  };
  // Price ceiling only: search above the maximum at the same lattice step, all other limits unchanged.
  if (!a.fixedTerms) {
    const ceiling = a.space.price.maxCents + Math.max(a.space.price.maxCents - a.space.price.minCents, a.p.offeredPrice, 2_000_000);
    const sepOpt = sepOptions(a.p, a.ev, a.sepCap);
    let found: number | null = null;
    for (let price = a.space.price.maxCents + a.space.price.stepCents; price <= ceiling && found === null; price += a.priceStep) {
      const rem = price - a.p.received;
      for (const x of splitValues(rem, a.slots, Math.max(5000, Math.ceil(rem / MAX_SPLIT_POINTS / 5000) * 5000))) {
        const pay = allocate(rem, x, a.slots, a.space.maxPayments);
        if (!pay) continue;
        const opts: Array<[YI | null, number]> = [[null, 0], ...([0, 1] as const).flatMap(yi => sepOpt(yi, yi === 0 ? x : rem - x).filter(s => s > 0).map(s => [yi, s] as [YI, number]))];
        if (opts.some(([sy, s]) => { const c = make(price, pay, sy, s); return !!c && meets(c); })) { found = price; break; }
      }
    }
    nf.relaxations.push(found !== null
      ? { constraint: "price_max", requiredCents: found, requiredDate: null, explanation: clip(`Asking about ${formatUsd(found)} in total (your maximum is ${formatUsd(a.space.price.maxCents)}; checked every ${formatUsd(a.priceStep)}) would meet the goal with your other limits. A target to discuss, not a price the client accepted.`, 400) }
      : { constraint: "price_max", requiredCents: null, requiredDate: null, explanation: clip(`No total price up to ${formatUsd(ceiling)} meets the goal with your other limits.`, 400) });
  }
  // Additional SEP only: the legal limit still applies; the SEP cash and your cap are ignored to show what would be needed.
  const relaxedSep = sepOptions(a.p, a.ev, Number.MAX_SAFE_INTEGER);
  let needSep: number | null = null;
  for (const c of all) for (const yi of [0, 1] as const) for (const s of relaxedSep(yi, yi === 0 ? c.x : c.remainder - c.x)) {
    if (s <= a.sepCap) continue;
    const k = make(c.price, c.payments, yi, s);
    if (k && meets(k) && (needSep === null || s < needSep)) needSep = s;
  }
  if (needSep !== null) nf.relaxations.push({ constraint: "additional_sep", requiredCents: needSep, requiredDate: null,
    explanation: clip(`An extra SEP-IRA of ${formatUsd(needSep)} (more than the ${formatUsd(a.sepCap)} your limit and the SEP cash left allow now) would meet the goal within the allowed prices and dates. It needs that much cash and is retirement money, not spending money.`, 400) });
}

// =====================================================================================================
/**
 * What could change the chosen terms: exact credit limits per year (extra other profit), the first
 * extra 2026 profit found that breaks the cash goal (checked every $250 up to +$25,000 and at both
 * credit limits), a December payment slipping into January, the extra SEP not being paid, and
 * estimated/ranged facts. No probabilities.
 */
export async function evaluateDecisionSensitivity(ws: HouseholdWorkspace, goalRaw: DealGoal, variant: DealVariant, searchFingerprint: string): Promise<DecisionSensitivityResult> {
  const g = DealGoalSchema.safeParse(goalRaw); if (!g.success) return blockedFromSchema("goal", g.error.issues);
  const goal = g.data;
  const prep = prepareDeal(ws, goal.projectId);
  if ("status" in prep) return prep;
  const p = prep, { models, ctx } = p;
  const pays = variant.terms.payments.map(q => ({ ...q, yi: yearOf(q.date) }));
  if (pays.reduce((a, q) => a + q.amountCents, 0) !== variant.terms.priceCents - p.received) {
    return { status: "needs_data", code: "STALE_VARIANT", message: "These terms no longer match the payments already recorded. Search again.", fields: [{ path: "dealPlanning.packages", reason: "Received amounts changed since the search." }] };
  }
  const sepYi: YI | null = variant.terms.additionalSep ? (variant.terms.additionalSep.year === 2026 ? 0 : 1) : null;
  const sepAmt = variant.terms.additionalSep?.amountCents ?? 0;
  const receiptsIn = (yi: YI, list = pays) => list.filter(q => q.yi === yi).reduce((a, q) => a + q.amountCents, 0);
  const baselineCash = (extra: [number, number]) => {
    const d = ([0, 1] as const).map(yi => evaluateYear(models[yi], { profitDelta: extra[yi], additionalSep: 0 }).spendable);
    if (goal.baseline === "decline_unpaid_terms") return d[0] + d[1];
    const o = ([0, 1] as const).map(yi => evaluateYear(models[yi], { profitDelta: extra[yi] + p.offered.filter(q => yearOf(q.date) === yi).reduce((a, q) => a + q.amountCents, 0) - p.openExpenses[yi], additionalSep: 0 }).spendable);
    return o[0] + o[1];
  };
  const variantCash = (extra: [number, number], list = pays, sep = sepAmt) =>
    ([0, 1] as const).reduce<number>((a, yi) => a + evaluateYear(models[yi], { profitDelta: extra[yi] + receiptsIn(yi, list) - p.openExpenses[yi], additionalSep: sepYi === yi ? sep : 0 }).spendable, 0);
  const items: SensitivityItem[] = [];
  const forecastPath = (yi: YI) => {
    const i = ws.forecasts.findIndex(f => f.personId === p.cc.adapted.ownerPersonId && f.year === YEARS[yi]);
    const f = ws.forecasts[i];
    return f ? `forecasts[${i}].${f.method === "annual_total" ? "annualNetProfit" : "remainingReceipts"}` : "forecasts";
  };
  for (const yi of [0, 1] as const) {
    let head: number | null = null;
    try { head = profitHeadroomDollars(models[yi], { profitDelta: receiptsIn(yi) - p.openExpenses[yi], additionalSep: sepYi === yi ? sepAmt : 0 }); } catch { head = null; }
    if (head === null) continue;
    const current = p.cc.baseline.years[yi]?.components.filter(c => c.basis === "forecast").reduce((a, c) => a + c.cents, 0) ?? null;
    items.push({ id: `credit-${YEARS[yi]}`, factKind: "household_income", path: forecastPath(yi), description: `Other ${YEARS[yi]} business profit`,
      currentCents: current, thresholdCents: current === null ? null : current + (head + 1) * 100, direction: "increase",
      outcomeChange: `With ${formatUsd((head + 1) * 100)} more ${YEARS[yi]} profit, the ${YEARS[yi]} premium tax credit under these terms is lost.`, checked: "exact_threshold" });
  }
  // First extra 2026 profit (in the option and its baseline alike) that breaks the cash goal.
  try {
    const points = new Set<number>();
    for (let e = 0; e <= 2_500_000; e += 25_000) points.add(e);
    for (const it of items) if (it.id === "credit-2026" && it.thresholdCents !== null && it.currentCents !== null) { points.add(it.thresholdCents - it.currentCents - 100); points.add(it.thresholdCents - it.currentCents); }
    const bh = profitHeadroomDollars(models[0], { profitDelta: 0, additionalSep: 0 });
    if (bh !== null) { points.add(bh * 100); points.add((bh + 1) * 100); }
    let first: number | null = null;
    for (const e of [...points].filter(v => v >= 0).sort((a, b) => a - b)) {
      if (variantCash([e, 0]) - baselineCash([e, 0]) < goal.minimumTwoYearCashDeltaCents) { first = e; break; }
    }
    items.push({ id: "goal-2026-profit", factKind: "household_income", path: forecastPath(0), description: "Other 2026 business profit (with and without these terms)",
      currentCents: null, thresholdCents: first, direction: first === null ? null : "increase",
      outcomeChange: first === null ? "No break of your cash goal found up to +$25,000 (checked every $250 and at both credit limits)." : `From about +${formatUsd(first)} of other 2026 profit, these terms no longer leave your minimum cash (checked every $250 and at both credit limits).`,
      checked: "interval_checked" });
  } catch (e) { if (!(e instanceof EngineStop)) throw e; }
  // A December payment slipping into January.
  const late = pays.filter(q => q.yi === 0 && q.date >= "2026-12-01");
  if (late.length) {
    const moved = pays.map(q => (late.includes(q) ? { ...q, date: firstBusinessDay(2027), yi: 1 as YI } : q));
    try {
      const now = variantCash([0, 0]) - baselineCash([0, 0]), then = variantCash([0, 0], moved) - baselineCash([0, 0]);
      items.push({ id: "december-payment", factKind: "payment_date", path: "dealPlanning.packages.variant.terms.payments", description: "December payment arrives in January",
        currentCents: now, thresholdCents: then, direction: null,
        outcomeChange: clip(`If ${formatUsd(late.reduce((a, q) => a + q.amountCents, 0))} arrives on ${firstBusinessDay(2027)} instead, it becomes 2027 income: two-year cash ${formatUsd(then)} instead of ${formatUsd(now)}${then < goal.minimumTwoYearCashDeltaCents ? " — below your goal" : ""}.`, 400),
        checked: "condition" });
    } catch (e) { if (!(e instanceof EngineStop)) throw e; }
  }
  if (sepAmt > 0 && sepYi !== null) {
    try {
      const without = variantCash([0, 0], pays, 0) - baselineCash([0, 0]);
      const ptcWithout = evaluateYear(models[sepYi], { profitDelta: receiptsIn(sepYi) - p.openExpenses[sepYi], additionalSep: 0 }).credit.ptc.ptc;
      items.push({ id: "extra-sep", factKind: "sep_cash", path: "retirement.futureContributionBudget", description: `The extra SEP-IRA of ${formatUsd(sepAmt)} for ${YEARS[sepYi]}`,
        currentCents: sepAmt, thresholdCents: 0, direction: "decrease",
        outcomeChange: clip(`If it is not paid by ${p.due[sepYi]}, two-year cash is ${formatUsd(without)}${ptcWithout === 0 ? ` and the ${YEARS[sepYi]} premium tax credit is lost` : ""}.`, 400), checked: "condition" });
    } catch (e) { if (!(e instanceof EngineStop)) throw e; }
  }
  // Estimated or ranged forecast facts.
  ws.forecasts.forEach((f, i) => {
    const facts = f.method === "annual_total" ? [["annualNetProfit", f.annualNetProfit]] as const
      : [["ytdNetProfit", f.ytdNetProfit], ["remainingReceipts", f.remainingReceipts], ["remainingExpenses", f.remainingExpenses]] as const;
    for (const [k, fact] of facts) if (fact.status !== "confirmed" || fact.range) items.push({ id: `fact-${i}-${k}`, factKind: "unconfirmed_fact", path: `forecasts[${i}].${k}`,
      description: `${f.year} ${k.replace(/([A-Z])/g, " $1").toLowerCase()} is ${fact.status}`, currentCents: fact.valueCents,
      thresholdCents: null, direction: null, outcomeChange: fact.range ? `Range ${formatUsd(fact.range.lowCents)}–${formatUsd(fact.range.highCents)}; confirm it before relying on the terms.` : "Confirm it before relying on the terms.", checked: "condition" });
  });
  const plan: Plan = { kind: "accept_now", label: "", revenue: variant.terms.priceCents - p.received, receipts: pays.map(q => ({ date: q.date, amount: q.amountCents })),
    expenses: p.openExpenses.flatMap((amount, i) => (amount > 0 ? [{ yearIndex: i as YI, amount }] : [])), sep: sepYi === null ? [0, 0] : sepYi === 0 ? [sepAmt, 0] : [0, sepAmt], reasons: [], assumptions: [], actions: [] };
  try {
    const st = stressPlan(ctx, plan);
    if (st.status === "fails_within_range") items.push({ id: "ranges", factKind: "unconfirmed_fact", path: "forecasts", description: "Declared income ranges", currentCents: null, thresholdCents: null, direction: null,
      outcomeChange: clip(st.checkedDescription, 400), checked: "interval_checked" });
  } catch (e) { if (!(e instanceof EngineStop)) throw e; }
  const numeric = items.filter(i => i.thresholdCents !== null && i.currentCents !== null && i.direction === "increase").sort((a, b) => (a.thresholdCents! - a.currentCents!) - (b.thresholdCents! - b.currentCents!));
  return { status: "ready", variantId: variant.id, searchFingerprint, items, firstChange: numeric[0]?.outcomeChange ?? items.find(i => i.checked === "condition")?.outcomeChange ?? null };
}

// =====================================================================================================
/** Exact result of given terms (no search): the chosen terms, the baseline and the offer as it stands. */
export interface ExactTerms {
  status: "ready";
  projectId: string;
  title: string;
  receivedCents: number;
  offeredPriceCents: number;
  /** Baseline years (decline unpaid terms) and the evaluated terms' years, from the same models. */
  decline: [YearResult, YearResult];
  chosen: [YearResult, YearResult];
  /** Two-year cash change of the terms relative to the goal's baseline. */
  cashDeltaCents: number;
  /** The offer exactly as it stands, relative to the same baseline (null if it cannot be calculated). */
  offered: { cashDeltaCents: number; years: [YearResult, YearResult] } | null;
  baselineKind: DealGoal["baseline"];
  retirementCents: number;
  dueDates: [string, string];
}

/**
 * Evaluate given terms exactly with the existing year engine: used to explain a choice and to
 * re-verify a recorded decision on its own snapshot. Payments must cover exactly the unpaid remainder.
 */
export function evaluateTermsExact(ws: HouseholdWorkspace, goal: DealGoal, terms: DealVariant["terms"]): ExactTerms | BlockedComparison {
  const prep = prepareDeal(ws, goal.projectId);
  if ("status" in prep) return prep;
  const p = prep;
  if (terms.payments.reduce((a, q) => a + q.amountCents, 0) !== terms.priceCents - p.received) {
    return { status: "needs_data", code: "STALE_VARIANT", message: "These terms no longer match the payments already recorded.", fields: [{ path: "terms.payments", reason: "Received amounts changed." }] };
  }
  const plan = (payments: Array<{ date: string; amountCents: number }>, sep: [number, number]): Plan => ({ kind: "accept_now", label: "", revenue: payments.reduce((a, q) => a + q.amountCents, 0),
    receipts: [...payments].sort((a, b) => a.date.localeCompare(b.date)).map(q => ({ date: q.date, amount: q.amountCents })),
    expenses: p.openExpenses.flatMap((amount, i) => (amount > 0 ? [{ yearIndex: i as YI, amount }] : [])), sep, reasons: [], assumptions: [], actions: [] });
  const sep: [number, number] = !terms.additionalSep ? [0, 0] : terms.additionalSep.year === 2026 ? [terms.additionalSep.amountCents, 0] : [0, terms.additionalSep.amountCents];
  try {
    const d = run(p.models, p.ctx.decline), c = run(p.models, plan(terms.payments, sep));
    let o: ReturnType<typeof run> | null = null;
    try { o = run(p.models, plan(p.offered, [0, 0])); } catch (e) { if (!(e instanceof EngineStop)) throw e; }
    const cash = (ycs: ReturnType<typeof run>) => ycs[0].spendable + ycs[1].spendable;
    const shift = goal.baseline === "accept_as_offered" && o ? cash(o) - cash(d) : 0;
    if (goal.baseline === "accept_as_offered" && !o) return { status: "unsupported", code: "OFFER_NOT_CALCULABLE", message: "The offered terms cannot be calculated, so they cannot be the baseline.", fields: [{ path: "goal.baseline", reason: "Use declining as the baseline." }] };
    const yr = (ycs: ReturnType<typeof run>) => [toYearResult(p.models[0], ycs[0]), toYearResult(p.models[1], ycs[1])] as [YearResult, YearResult];
    return { status: "ready", projectId: goal.projectId, title: p.cc.candidate.title, receivedCents: p.received, offeredPriceCents: p.offeredPrice,
      decline: yr(d), chosen: yr(c), cashDeltaCents: cash(c) - cash(d) - shift,
      offered: o ? { cashDeltaCents: cash(o) - cash(d) - shift, years: yr(o) } : null, baselineKind: goal.baseline, retirementCents: sep[0] + sep[1], dueDates: p.due };
  } catch (e) {
    if (e instanceof EngineStop) return { status: e.kind === "unsupported" ? "unsupported" : "needs_data", code: e.code, message: e.message, fields: [{ path: "terms", reason: e.message }] };
    throw e;
  }
}
