/**
 * One tax year: Schedule SE, SEP limit, coupled SEHI/PTC solution (Form 8962 +
 * Pub. 974 inequality), federal income tax in the supported range, and
 * spendable cash after the final APTC settlement.
 *
 * Rounding policy (r3): the return is prepared in whole dollars. Form 8962 and
 * IRS e-file accept dollars only (2026 Form 8962 instructions, "Entering amounts
 * from Form 1095-A"), and the Form 1040 instructions ("Rounding Off to Whole
 * Dollars") require that, once any amount is rounded, all amounts are: add with
 * cents, round only each line's total, 50 cents and up rounds up. Cash that
 * actually moves (gross pay, payroll withholding, premiums, APTC paid to the
 * insurer) stays in cents.
 */
import type { TraceItem, YearResult } from "@/domain/contracts";
import { divRound, formatUsd, mulRate, sum, toWholeDollars, type Rate } from "./money";
import { EngineStop, type Variation, type YearModel } from "./model";
import type { Filing, RulePack } from "./rules";

/** Whole-dollar line amount (cents in, cents out). */
export const W = (cents: number): number => toWholeDollars(cents, "half_up");
/** Exact cents × rate, rounded once to whole dollars (no intermediate cent rounding). */
export const mulW = (cents: number, r: Rate, mode: "half_up" | "floor" = "half_up"): number =>
  divRound(cents * r.num, r.den * 100, mode) * 100;

// ---------------------------------------------------------------- Schedule SE --
export interface SeResult { personId: string; netEarnings: number; ssPart: number; medicarePart: number; total: number; half: number }

/** Schedule SE for one individual. The Social Security cap uses THAT person's own SS wages only. */
export function scheduleSe(rules: RulePack, personId: string, profit: number, ownSocialSecurityWages: number): SeResult {
  const netEarnings = mulW(Math.max(0, W(profit)), rules.se.factor);              // line 4a/6
  if (netEarnings < rules.se.minimumNet) return { personId, netEarnings: 0, ssPart: 0, medicarePart: 0, total: 0, half: 0 };
  const ssRoom = Math.max(0, rules.se.wageBase - W(ownSocialSecurityWages));       // lines 7-9
  const ssPart = mulW(Math.min(netEarnings, ssRoom), rules.se.ss);                 // line 10
  const medicarePart = mulW(netEarnings, rules.se.medicare);                       // line 11
  const total = ssPart + medicarePart;                                             // line 12
  return { personId, netEarnings, ssPart, medicarePart, total, half: divRound(total, 200, "half_up") * 100 }; // line 13
}

// ----------------------------------------------------------------- Form 8962 --
export interface PtcResult { line5: number; figure: number; contribution8a: number; contribution8b: number | null; ptc: number }

/** Form 8962 columns (a) premium, (b) SLCSP, (c) APTC in whole dollars: annual totals (line 11) or each month (lines 12–23). */
export interface Form8962Amounts { premium: number[]; benchmark: number[]; aptc: number[]; premiumTotal: number; benchmarkTotal: number; aptcTotal: number }
const amountsCache = new WeakMap<YearModel, Form8962Amounts>();
export function form8962Amounts(model: YearModel): Form8962Amounts {
  const hit = amountsCache.get(model);
  if (hit) return hit;
  const premium = model.premium.map(W), benchmark = model.benchmark.map(W), aptc = model.aptc.map(W);
  const out = model.uniformCoverage
    ? { premium, benchmark, aptc, premiumTotal: W(sum(model.premium)), benchmarkTotal: W(sum(model.benchmark)), aptcTotal: W(sum(model.aptc)) }
    : { premium, benchmark, aptc, premiumTotal: sum(premium), benchmarkTotal: sum(benchmark), aptcTotal: sum(aptc) };
  amountsCache.set(model, out);
  return out;
}

export function line5Of(householdIncomeCents: number, fplDollars: number): number {
  // Worksheet 2: above 4 × FPL → 401; otherwise income ÷ FPL × 100 with decimals dropped.
  if (householdIncomeCents > 400 * fplDollars) return 401;
  return Math.floor(Math.max(0, householdIncomeCents) / fplDollars);
}

/** Premium tax credit for household income (line 3, whole dollars). Below 100% returns no credit (exception not modeled). */
export function ptcFor(model: YearModel, magiCents: number): PtcResult {
  const fpl = model.rules.fplDollars(model.familySize);
  const line3 = W(magiCents);
  const line5 = line5Of(line3, fpl);
  if (!model.ptcEligible || line5 > 400 || line5 < 100) return { line5, figure: 0, contribution8a: 0, contribution8b: null, ptc: 0 };
  const figure = model.rules.applicableFigure(line5);
  const contribution8a = divRound(line3 * figure, 1000000, "half_up") * 100;               // line 8a, whole dollars
  const a = form8962Amounts(model);
  if (model.uniformCoverage) {                                                             // line 11 (annual)
    return { line5, figure, contribution8a, contribution8b: null, ptc: Math.min(a.premiumTotal, Math.max(0, a.benchmarkTotal - contribution8a)) };
  }
  const contribution8b = W(divRound(contribution8a, 12, "half_up"));                        // line 8b, whole dollars
  let ptc = 0;                                                                              // lines 12-23 (monthly)
  for (let m = 0; m < 12; m++) ptc += Math.min(a.premium[m], Math.max(0, a.benchmark[m] - contribution8b));
  return { line5, figure, contribution8a, contribution8b, ptc };
}

// ------------------------------------------------------ SEHI / PTC solution --
export interface CreditSolution {
  ownerProfit: number;
  profitLine: number;
  se: SeResult[];
  seTotal: number;
  halfSe: number;
  ownerHalfSe: number;
  sepExisting: number;
  sepAdditional: number;
  sepTotal: number;
  sepLine: number;
  sepMax: number;
  wagesLine: number;
  agiBeforeSehi: number;
  magiBeforeSehi: number;
  sehiLimit: number;
  sehi: number;
  /** True when the SEHI choice was capped to keep household income at or above 100% FPL. */
  sehiCappedAt100: boolean;
  agi: number;
  magi: number;
  fplDollars: number;
  ptc: PtcResult;
  /** Form 8962 premium and APTC totals (whole dollars). */
  premiumTotal: number;
  aptcTotal: number;
  below100: boolean;
}

/** Legal owner SEP maximum: 20% of (net profit − deductible half of SE tax), Pub. 560 rate worksheet; whole dollars down; annual cap. */
export function sepMaximum(rules: RulePack, profitLine: number, ownerHalfSe: number): number {
  return Math.min(rules.sep.cap, mulW(Math.max(0, profitLine - ownerHalfSe), rules.sep.rate, "floor"));
}

/**
 * Coupled SEHI deduction and PTC.
 *
 * Valid pairs (Pub. 974, 2025, "Self-Employed Health Insurance Deduction and PTC":
 * "you may use any computation method that results in reporting amounts that
 * satisfy the rules for both the deduction and PTC, as long as the sum of the
 * deduction claimed for the premiums and the PTC computed, taking the deduction
 * into account, is less than or equal to the enrollment premiums"):
 * 0 ≤ d ≤ earned-income and premium limit, PTC from household income after d,
 * d + PTC ≤ enrollment premiums. Equality is NOT required. Choice: the largest
 * valid whole-dollar d. Proof of optimality inside household income ≥ 100% FPL:
 *  - household income falls 1:1 with d; line 5 and the applicable figure are
 *    non-increasing in d, so the contribution is non-increasing and PTC non-decreasing;
 *  - income tax after credits is non-increasing in d;
 *  - so spendable cash is non-decreasing in d, and g(d) = d + PTC(d) is strictly
 *    increasing; the valid set is an interval [0, d*] found exactly by bisection
 *    even across PTC discontinuities (133%, 400%, rounding steps).
 * Deductions that would push income below 100% FPL are not considered because
 * the below-100% eligibility exception is not modeled (reported in the trace).
 */
export function solveCredit(model: YearModel, v: Variation, checkSepLimit = true): CreditSolution {
  const rules = model.rules;
  const owner = model.persons.find(p => p.id === model.ownerId)!;
  const ownerProfit = owner.amounts.scheduleCProfit + v.profitDelta;
  if (ownerProfit < 0) throw new EngineStop("infeasible", "LOSS", "This option would create a business loss (Schedule C), which is not supported.");
  const profitLine = W(ownerProfit);
  const se = model.persons.map(p => scheduleSe(rules, p.id, p.id === model.ownerId ? ownerProfit : p.amounts.scheduleCProfit,
    p.amounts.socialSecurityWages));
  const seTotal = sum(se.map(s => s.total));
  const halfSe = sum(se.map(s => s.half));
  const ownerHalfSe = se.find(s => s.personId === model.ownerId)!.half;
  const sepExisting = owner.amounts.existingSepContribution;
  if (v.additionalSep < 0) throw new EngineStop("infeasible", "SEP_NEGATIVE", "A SEP-IRA contribution cannot be negative.");
  const sepTotal = sepExisting + v.additionalSep;
  const sepMax = sepMaximum(rules, profitLine, ownerHalfSe);
  if (checkSepLimit && sepTotal > sepMax) {
    throw new EngineStop("infeasible", "SEP_OVER_LIMIT",
      `Total SEP-IRA contributions of ${formatUsd(sepTotal)} would exceed the ${model.year} limit of ${formatUsd(sepMax)} for this business profit.`);
  }
  const sepLine = W(sepTotal);
  const all = (f: keyof typeof owner.amounts) => sum(model.persons.map(p => p.amounts[f]));
  const otherProfit = W(sum(model.persons.filter(p => p.id !== model.ownerId).map(p => p.amounts.scheduleCProfit)));
  const wagesLine = W(all("w2Box1"));
  const agiBeforeSehi = wagesLine + W(all("taxableInterest")) + profitLine + otherProfit - halfSe - sepLine;
  const magiBeforeSehi = agiBeforeSehi + W(all("taxExemptInterest"));
  const a = form8962Amounts(model);
  const sehiLimit = model.sehiEligible
    ? toWholeDollars(Math.min(sum(model.premium), Math.max(0, profitLine - ownerHalfSe - sepLine)), "floor") : 0;
  const fplDollars = rules.fplDollars(model.familySize);
  const below100 = model.ptcEligible && magiBeforeSehi < 100 * fplDollars;
  let dMax = sehiLimit / 100;
  let sehiCappedAt100 = false;
  if (model.ptcEligible) {
    const room = Math.floor(Math.max(0, magiBeforeSehi - 100 * fplDollars) / 100);
    if (room < dMax) { dMax = room; sehiCappedAt100 = true; }
  }
  const g = (d: number) => d * 100 + ptcFor(model, magiBeforeSehi - d * 100).ptc;
  let lo = 0, hi = dMax;                       // g(0) ≤ premiums always (PTC ≤ premiums)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g(mid) <= a.premiumTotal) lo = mid; else hi = mid - 1;
  }
  const sehi = lo * 100;
  const magi = magiBeforeSehi - sehi;
  return { ownerProfit, profitLine, se, seTotal, halfSe, ownerHalfSe, sepExisting, sepAdditional: v.additionalSep, sepTotal, sepLine, sepMax,
    wagesLine, agiBeforeSehi, magiBeforeSehi, sehiLimit, sehi, sehiCappedAt100: sehiCappedAt100 && lo === dMax,
    agi: agiBeforeSehi - sehi, magi, fplDollars, ptc: ptcFor(model, magi), premiumTotal: a.premiumTotal, aptcTotal: a.aptcTotal, below100 };
}

// ------------------------------------------------------------ income tax --
function scheduleTax(brackets: Array<{ top: number; rate: { num: number; den: number } }>, taxable: number): [number, number] {
  // Exact sum of bracket portions as a single rational with the common denominator.
  const den = Math.max(...brackets.map(b => b.rate.den));
  let numerator = 0, prev = 0;
  for (const b of brackets) {
    if (taxable <= prev) break;
    numerator += (Math.min(taxable, b.top) - prev) * b.rate.num * (den / b.rate.den);
    prev = b.top;
  }
  if (taxable > prev) throw new EngineStop("unsupported", "TAX_RANGE", "Taxable income is above the transcribed tax brackets.");
  return [numerator, den];
}

/**
 * Tax Table below $100,000 (tax on the band midpoint, whole dollars: $5/$10 bands
 * to $25, $25 bands to $3,000, $50 bands to $100,000), else the Tax Computation
 * Worksheet rounded to whole dollars. Method verified against the 2025 draft table;
 * each calculated year uses its own published Revenue Procedure brackets.
 */
export function regularTax(rules: RulePack, filing: Filing, taxable: number): number {
  const brackets = rules.brackets[filing];
  const exact = (x: number) => { const [num, den] = scheduleTax(brackets, x); return divRound(num, den * 100, "half_up") * 100; };
  if (taxable >= rules.taxTableUpper) return exact(taxable);
  if (taxable < 500) return 0;
  let lo: number, width: number;
  if (taxable < 2500) { width = 1000; lo = 500 + Math.floor((taxable - 500) / width) * width; }
  else if (taxable < 300000) { width = 2500; lo = 2500 + Math.floor((taxable - 2500) / width) * width; }
  else { width = 5000; lo = 300000 + Math.floor((taxable - 300000) / width) * width; }
  return exact(lo + width / 2);
}

// ------------------------------------------------------------- full year --
export interface YearComputation {
  credit: CreditSolution;
  standardDeduction: number;
  taxableBeforeQbi: number;
  qbi: number;
  qbiBeforeMinimum: number;
  qbiDeduction: number;
  taxable: number;
  regularTax: number;
  childCredits: number;
  nonrefundableCredit: number;
  refundableCtc: number;
  additionalMedicare: number;
  niit: number;
  federalIncomeTax: number;
  employeeFica: number;
  earnedIncome: number;
  cashIncome: number;
  netPremium: number;
  settlement: number;
  spendable: number;
  additionalRetirement: number;
}

export function evaluateYear(model: YearModel, v: Variation): YearComputation {
  const rules = model.rules, f = model.filing;
  const c = solveCredit(model, v);
  if (c.below100) {
    throw new EngineStop("unsupported", "BELOW_100_FPL",
      `${model.year} household income would be below 100% of the poverty line. The eligibility exception below 100% has several conditions that are not modeled.`);
  }
  const standardDeduction = rules.standardDeduction[f];
  const taxableBeforeQbi = Math.max(0, c.agi - standardDeduction);
  if (taxableBeforeQbi > rules.supportedTaxableBeforeQbi[f]) {
    throw new EngineStop("unsupported", "TAX_RANGE",
      `${model.year} taxable income would exceed ${formatUsd(rules.supportedTaxableBeforeQbi[f])}, the QBI threshold where wage and specified-service limits begin; this range is not supported.`);
  }
  // Form 8995 (2026+): line 15 = smaller of 20% of QBI and 20% of taxable income; line 17 = greater of line 15
  // and the minimum deduction when active QBI is at least the qualifying amount (material participation assumed).
  const qbi = Math.max(0, c.profitLine - c.ownerHalfSe - c.sepLine - c.sehi);
  const qbiBeforeMinimum = Math.min(mulW(qbi, rules.qbi.rate), mulW(taxableBeforeQbi, rules.qbi.rate));
  const qbiDeduction = qbi >= rules.qbi.minimumQbi ? Math.max(qbiBeforeMinimum, rules.qbi.minimumDeduction) : qbiBeforeMinimum;
  const taxable = Math.max(0, taxableBeforeQbi - qbiDeduction);
  const tax = regularTax(rules, f, taxable);

  // Schedule 8812 Earned Income Worksheet: wages + Schedule C profit − deductible half of SE tax.
  const earnedIncome = Math.max(0, c.wagesLine + c.profitLine - c.halfSe);
  const eitcBound = rules.eitcBound[f][Math.min(3, model.eitcChildren)];
  if (Math.max(c.agi, earnedIncome) < eitcBound) {
    throw new EngineStop("unsupported", "EITC_POSSIBLE",
      `${model.year} income is below ${formatUsd(eitcBound)}, where the earned income tax credit can apply; it is not calculated, so take-home results are not supported here.`);
  }
  const ctcGross = model.qualifyingChildren * rules.ctc.perChild + model.otherDependents * rules.ctc.otherDependent;
  const excess = Math.max(0, c.agi - rules.ctc.phaseoutThreshold[f]);
  const childCredits = Math.max(0, ctcGross - divRound(excess, 100000, "ceil") * rules.ctc.phaseoutPerThousand);
  const nonrefundableCredit = Math.min(childCredits, tax);
  let refundableCtc = 0;
  const unused = childCredits - nonrefundableCredit;                         // Schedule 8812 line 16a
  if (unused > 0 && model.qualifyingChildren > 0) {
    if (rules.ctc.refundablePerChild === null) {
      throw new EngineStop("unsupported", "ACTC_NOT_TRANSCRIBED",
        `The ${model.year} refundable child tax credit amount is not in this rule pack; this income level is not supported for ${model.year}.`);
    }
    if (model.qualifyingChildren >= 3) {
      throw new EngineStop("unsupported", "ACTC_THREE_PLUS", "The refundable child tax credit for three or more children (Schedule 8812 Part II-B) is not modeled.");
    }
    refundableCtc = Math.min(unused, model.qualifyingChildren * rules.ctc.refundablePerChild,
      mulW(Math.max(0, earnedIncome - rules.ctc.earnedFloor), rules.ctc.refundableRate));
  }
  const medicareWages = W(sum(model.persons.map(p => p.amounts.medicareWages)));
  const thr = rules.addlMedicare.threshold[f];
  const seIncome = sum(c.se.map(s => s.netEarnings));
  const additionalMedicare = mulW(Math.max(0, medicareWages - thr), rules.addlMedicare.rate)        // Form 8959 Part I
    + mulW(Math.max(0, seIncome - Math.max(0, thr - medicareWages)), rules.addlMedicare.rate);    // Part II
  const nii = W(sum(model.persons.map(p => p.amounts.taxableInterest)));
  const niit = mulW(Math.min(nii, Math.max(0, c.agi - rules.niit.threshold[f])), rules.niit.rate);
  const federalIncomeTax = tax - nonrefundableCredit - refundableCtc + additionalMedicare + niit;
  const employeeFica = sum(model.persons.map(p => mulRate(p.amounts.socialSecurityWages, rules.fica.ss) + mulRate(p.amounts.medicareWages, rules.fica.medicare)));
  const cashIncome = sum(model.persons.map(p => p.amounts.grossWages - p.amounts.payrollPretaxDeductions
    + p.amounts.taxableInterest + p.amounts.taxExemptInterest + (p.id === model.ownerId ? c.ownerProfit : p.amounts.scheduleCProfit)));
  const settlement = c.aptcTotal - c.ptc.ptc;                                       // Form 8962 line 29 / 26
  // Premiums actually paid net of the advance, plus the settlement: equals premiums − allowed credit, counted once.
  const netPremium = sum(model.premium) - sum(model.aptc) + settlement;
  const spendable = cashIncome - employeeFica - c.seTotal - federalIncomeTax - netPremium - c.sepTotal;
  return { credit: c, standardDeduction, taxableBeforeQbi, qbi, qbiBeforeMinimum, qbiDeduction, taxable, regularTax: tax, childCredits,
    nonrefundableCredit, refundableCtc, additionalMedicare, niit, federalIncomeTax, employeeFica, earnedIncome, cashIncome,
    netPremium, settlement, spendable, additionalRetirement: v.additionalSep };
}

// ------------------------------------------------------------------ trace --
type T = (id: string, label: string, amountCents: number | null, inputPaths: string[], sourceIds: string[], explanation: string) => TraceItem;
const maker = (year: number): T => (id, label, amountCents, inputPaths, sourceIds, explanation) =>
  ({ id: `${year}.${id}`, label: `${label} (${year})`, amountCents, inputPaths, sourceIds: [...new Set(sourceIds)], explanation });

export function creditTrace(model: YearModel, c: CreditSolution, extraPaths: string[] = []): TraceItem[] {
  const y = model.year, yi = model.yearIndex, r = model.rules, t = maker(y);
  const inc = (field: string) => model.persons.filter(p => p.row >= 0).map(p => `years[${yi}].incomes[${p.row}].${field}`);
  const owner = model.persons.find(p => p.id === model.ownerId)!;
  const cov = (field: string) => [`years[${yi}].coverage[*].${field}`];
  const ev = model.evidenceIds;
  const form = ["irs-i8962-2026-draft", ...r.applicableFigureSourceIds];
  const fplLabel = `${r.coverageFplGuidelineYear} HHS poverty guideline`;
  return [
    t("owner_profit", `${owner.possessive} business profit`, c.ownerProfit, [`years[${yi}].incomes[${owner.row}].scheduleCProfit`, ...extraPaths], ev,
      `Full-year Schedule C net profit forecast, plus this option's receipts minus its expenses paid in ${y}. Entered on the return as ${formatUsd(c.profitLine)}.`),
    ...c.se.filter(s => s.total > 0).map(s => {
      const person = model.persons.find(p => p.id === s.personId)!;
      return t(`se_tax.${s.personId}`, `${person.possessive} self-employment tax`, s.total,
        [`years[${yi}].incomes[${person.row}].socialSecurityWages`], r.se.sourceIds,
        `Schedule SE: net earnings ${formatUsd(s.netEarnings)} (92.35% of profit). Social Security part ${formatUsd(s.ssPart)} uses only this person's own room under the ${y} wage base of ${formatUsd(r.se.wageBase)}; Medicare part ${formatUsd(s.medicarePart)}.`);
    }),
    t("half_se", "Deductible half of self-employment tax", c.halfSe, [], r.se.sourceIds, "Schedule SE line 13, an adjustment to income."),
    t("sep", "SEP-IRA contributions deducted", c.sepTotal, [`years[${yi}].incomes[${owner.row}].existingSepContribution`], r.sep.sourceIds,
      `Already planned ${formatUsd(c.sepExisting)} + this option ${formatUsd(c.sepAdditional)}. ${y} limit for this profit: ${formatUsd(c.sepMax)} (20% of net profit after half of SE tax, at most ${formatUsd(r.sep.cap)}). Retirement money, not spendable cash.`),
    t("sehi", "Self-employed health insurance deduction", c.sehi, [...cov("enrollmentPremium"), ...cov("sehiEligibilityConfirmed")], ["irs-pub-974", "headroom-engine-policy"],
      `Largest whole-dollar deduction where deduction + premium tax credit ≤ enrollment premiums (${formatUsd(c.premiumTotal)}) and deduction ≤ ${formatUsd(c.sehiLimit)} (premiums, and profit after half of SE tax and SEP). Equality is not required.` +
      (c.sehiCappedAt100 ? " Capped so household income stays at 100% of the poverty line: the below-100% exception is not modeled, so the household may have more options than shown." : "")),
    t("magi", "Household income for the premium tax credit (ACA MAGI)", c.magi, [...inc("w2Box1"), ...inc("taxableInterest"), ...inc("taxExemptInterest")], form,
      "Adjusted gross income plus tax-exempt interest (Form 8962 line 3). The standard deduction and QBI deduction do not reduce it. Dependents have no income in the supported case."),
    t("fpl", `Poverty line for a family of ${model.familySize}`, c.fplDollars * 100, [`years[${yi}].taxFamilySize`], [r.fplSourceId],
      `${fplLabel}, contiguous states (Form 8962 line 4). The credit requires household income at or below 400%: ${formatUsd(c.fplDollars * 400)}.`),
    t("line5", "Income as a percentage of the poverty line (Form 8962 line 5)", null, [], form,
      c.ptc.line5 > 400 ? "Above 400%: entered as 401, so no premium tax credit." : `${c.ptc.line5}% (decimals dropped, not rounded).`),
    t("contribution", "Your required contribution (Form 8962 line 8a)", c.ptc.contribution8a, [], form,
      c.ptc.line5 > 400 || !model.ptcEligible ? "Not applicable." :
        `Household income × applicable figure ${(c.ptc.figure / 10000).toFixed(4)}, rounded to whole dollars. ${r.applicableFigureStatus}`),
    t("ptc", "Premium tax credit allowed", c.ptc.ptc, [...cov("benchmarkPremium"), ...cov("enrollmentPremium"), ...cov("ptcEligibilityConfirmed")], form,
      !model.ptcEligible ? "Not eligible for the credit in any month (as entered)." :
        model.uniformCoverage ? "Annual calculation (line 11): the smaller of enrollment premiums and benchmark premium minus your contribution, in whole dollars."
          : `Monthly calculation (lines 12–23) with a monthly contribution of ${formatUsd(c.ptc.contribution8b ?? 0)}.`),
    t("aptc", "Advance credit paid to your insurer", c.aptcTotal, cov("advancePtc"), ev, "Sum of the monthly advance payments (whole dollars on Form 8962)."),
    t("settlement", "Settlement on the return (+ repay / − receive)", c.aptcTotal - c.ptc.ptc, [], ["irs-ptc-qa", "irs-rp-2025-32"],
      `Advance minus allowed credit. From 2026 there is no repayment cap. Already included in the net premium cost and not subtracted again. Settled on the ${y} return due ${r.returnDueDate}.`),
  ];
}

export function yearTrace(model: YearModel, yc: YearComputation, extraPaths: string[] = []): TraceItem[] {
  const y = model.year, r = model.rules, ev = model.evidenceIds, yi = model.yearIndex, t = maker(y);
  const inc = (field: string) => model.persons.filter(p => p.row >= 0).map(p => `years[${yi}].incomes[${p.row}].${field}`);
  return [
    ...creditTrace(model, yc.credit, extraPaths),
    t("agi", "Adjusted gross income", yc.credit.agi, inc("w2Box1"), ev, "W-2 taxable wages + taxable interest + business profit − half of SE tax − SEP − health insurance deduction, in whole dollars."),
    t("standard_deduction", "Standard deduction", yc.standardDeduction, ["filingStatus"], [r.bracketSourceId], `${y} amount for this filing status. Itemizing is outside the supported case.`),
    t("qbi_deduction", "Qualified business income deduction", yc.qbiDeduction, [], [r.qbi.sourceId, "irs-i8995"],
      `Form 8995: 20% of qualified business income ${formatUsd(yc.qbi)} (profit after half of SE tax, SEP and the health insurance deduction), limited to 20% of taxable income before this deduction (${formatUsd(yc.qbiBeforeMinimum)}); ` +
      `then at least ${formatUsd(r.qbi.minimumDeduction)} when that income is ${formatUsd(r.qbi.minimumQbi)} or more (${y} amounts; assumes you materially participate in the business). Below the ${formatUsd(r.supportedTaxableBeforeQbi[model.filing])} threshold.`),
    t("taxable_income", "Taxable income", yc.taxable, [], [r.bracketSourceId], "Adjusted gross income − standard deduction − QBI deduction (not below zero)."),
    t("regular_tax", "Income tax before credits", yc.regularTax, [], [r.bracketSourceId, "irs-i1040-tax-table"],
      yc.taxable < r.taxTableUpper ? `Tax Table method with ${y} brackets: tax at the midpoint of the $50 (or smaller) band, rounded to whole dollars.` : `Tax Computation Worksheet with ${y} brackets.`),
    t("child_credits", "Child tax credit and credit for other dependents", yc.nonrefundableCredit + yc.refundableCtc, ["people[*].qualifyingChildForCtc"], r.ctc.sourceIds,
      `${y}: ${formatUsd(r.ctc.perChild)} per qualifying child, ${formatUsd(r.ctc.otherDependent)} per other dependent, after phaseout ${formatUsd(yc.childCredits)}. Used against tax ${formatUsd(yc.nonrefundableCredit)}; refundable part ${formatUsd(yc.refundableCtc)}` +
      (r.ctc.refundablePerChild !== null ? ` (up to ${formatUsd(r.ctc.refundablePerChild)} per child, 15% of earned income over ${formatUsd(r.ctc.earnedFloor)}).` : ".") + " Required Social Security numbers assumed."),
    t("other_taxes", "Additional Medicare tax and net investment income tax", yc.additionalMedicare + yc.niit, inc("medicareWages"), [r.addlMedicare.sourceId, r.niit.sourceId],
      `Additional Medicare tax ${formatUsd(yc.additionalMedicare)}; net investment income tax ${formatUsd(yc.niit)}.`),
    t("federal_income_tax", "Federal income tax after credits", yc.federalIncomeTax, [], [r.bracketSourceId],
      "Tax − child credits (including the refundable part) + additional Medicare tax + net investment income tax. Excludes SE tax and the premium tax credit settlement. No state income tax in TX, FL or TN."),
    t("employee_fica", "Social Security and Medicare withheld from pay", yc.employeeFica, [...inc("socialSecurityWages"), ...inc("medicareWages")], [r.fica.sourceId],
      "6.2% of each person's Social Security wages + 1.45% of Medicare wages (one employer per person)."),
    t("cash_income", "Cash income before taxes and premiums", yc.cashIncome, [...inc("grossWages"), ...inc("payrollPretaxDeductions")], ev,
      "Gross pay − pre-tax payroll deductions + business profit + taxable and tax-exempt interest."),
    t("net_premium", "Health premiums after the final credit", yc.netPremium, [`years[${yi}].coverage[*].enrollmentPremium`], ["irs-i8962-2026-draft"],
      "Premiums paid during the year net of the advance, plus the settlement. The settlement is counted here once."),
    t("spendable", "Spendable cash after the final settlement", yc.spendable, [], ["headroom-engine-policy"],
      `Cash income − payroll taxes − SE tax − federal income tax − net premiums − SEP contributions. Measured after the ${y} return settles, not a December 31 bank balance.`),
    t("retirement", "Additional retirement contribution (not spendable)", yc.additionalRetirement, [], ["irs-pub-560"],
      "Held in the SEP-IRA and taxed on future withdrawal; shown separately from spendable cash."),
  ];
}

export function toYearResult(model: YearModel, yc: YearComputation, extraPaths: string[] = []): YearResult {
  return {
    year: model.year,
    magiCents: yc.credit.magi,
    ptcCents: yc.credit.ptc.ptc,
    aptcCents: yc.credit.aptcTotal,
    aptcSettlementCents: yc.settlement,
    federalIncomeTaxCents: yc.federalIncomeTax,
    selfEmploymentTaxCents: yc.credit.seTotal,
    employeeFicaCents: yc.employeeFica,
    sehiDeductionCents: yc.credit.sehi,
    spendableAfterSettlementCents: yc.spendable,
    additionalRetirementCents: yc.additionalRetirement,
    trace: yearTrace(model, yc, extraPaths),
  };
}
