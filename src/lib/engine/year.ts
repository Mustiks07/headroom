/**
 * One tax year: Schedule SE, SEP limit, coupled SEHI/PTC solution (Form 8962 +
 * Pub. 974 inequality), federal income tax in the supported range, and
 * spendable cash after the final APTC settlement.
 */
import type { TraceItem, YearResult } from "@/domain/contracts";
import { divRound, formatUsd, mulRate, mulRatio, sum, toWholeDollars } from "./money";
import { EngineStop, type Variation, type YearModel } from "./model";
import type { Filing, RulePack } from "./rules";

// ---------------------------------------------------------------- Schedule SE --
export interface SeResult { personId: string; netEarnings: number; ssPart: number; medicarePart: number; total: number; half: number }

/** Schedule SE for one individual. The Social Security cap uses THAT person's own SS wages only. */
export function scheduleSe(rules: RulePack, personId: string, profit: number, ownSocialSecurityWages: number): SeResult {
  const netEarnings = mulRate(Math.max(0, profit), rules.se.factor);              // line 4a/6
  if (netEarnings < rules.se.minimumNet) return { personId, netEarnings: 0, ssPart: 0, medicarePart: 0, total: 0, half: 0 };
  const ssRoom = Math.max(0, rules.se.wageBase - ownSocialSecurityWages);         // lines 7-9
  const ssPart = mulRate(Math.min(netEarnings, ssRoom), rules.se.ss);              // line 10
  const medicarePart = mulRate(netEarnings, rules.se.medicare);                    // line 11
  const total = ssPart + medicarePart;                                             // line 12
  return { personId, netEarnings, ssPart, medicarePart, total, half: divRound(total, 2, "half_up") }; // line 13
}

// ----------------------------------------------------------------- Form 8962 --
export interface PtcResult { line5: number; figure: number; contribution8a: number; contribution8b: number | null; ptc: number }

export function line5Of(magiCents: number, fplDollars: number): number {
  // line 5 = household income ÷ FPL × 100, truncated; above 4 × FPL → 401.
  if (magiCents > 400 * fplDollars) return 401;
  return Math.floor(Math.max(0, magiCents) / fplDollars);
}

/** Premium tax credit for a household income, Form 8962 lines 1–24. Below 100% returns no credit (exception not modeled). */
export function ptcFor(model: YearModel, magiCents: number): PtcResult {
  const fpl = model.rules.fplDollars(model.familySize);
  const line5 = line5Of(magiCents, fpl);
  if (!model.ptcEligible || line5 > 400 || line5 < 100) return { line5, figure: 0, contribution8a: 0, contribution8b: null, ptc: 0 };
  const figure = model.rules.applicableFigure(line5);
  const contribution8a = toWholeDollars(mulRatio(magiCents, figure, 10000, "half_up"));  // line 8a, whole dollars
  if (model.uniformCoverage) {                                                            // line 11 (annual)
    const maxAssist = Math.max(0, sum(model.benchmark) - contribution8a);
    return { line5, figure, contribution8a, contribution8b: null, ptc: Math.min(sum(model.premium), maxAssist) };
  }
  const contribution8b = toWholeDollars(divRound(contribution8a, 12, "half_up"));         // line 8b, whole dollars
  let ptc = 0;                                                                             // lines 12-23 (monthly)
  for (let m = 0; m < 12; m++) ptc += Math.min(model.premium[m], Math.max(0, model.benchmark[m] - contribution8b));
  return { line5, figure, contribution8a, contribution8b, ptc };
}

// ------------------------------------------------------ SEHI / PTC solution --
export interface CreditSolution {
  ownerProfit: number;
  se: SeResult[];
  seTotal: number;
  halfSe: number;
  ownerHalfSe: number;
  sepExisting: number;
  sepAdditional: number;
  sepTotal: number;
  sepMax: number;
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
  premiumTotal: number;
  aptcTotal: number;
  below100: boolean;
}

/** Legal owner SEP maximum for a profit: 20% of (net profit − deductible half of SE tax), Pub. 560, capped. */
export function sepMaximum(rules: RulePack, profit: number, ownerHalfSe: number): number {
  return Math.min(rules.sep.cap, mulRate(Math.max(0, profit - ownerHalfSe), rules.sep.rate, "down"));
}

/**
 * Coupled SEHI deduction and PTC.
 *
 * Valid pairs (Pub. 974 / Rev. Proc. 2014-41): 0 ≤ d ≤ earned-income and premium
 * limit, PTC computed from MAGI after d, and d + PTC ≤ eligible premiums. Equality
 * is NOT required. Choice: the largest valid whole-dollar d. Proof of optimality
 * inside the supported region (household income ≥ 100% FPL):
 *  - MAGI falls 1:1 with d; line 5 and the applicable figure are non-increasing
 *    in d, so the required contribution is non-increasing and PTC non-decreasing;
 *  - income tax after credits is non-increasing in d (taxable income and AGI-based
 *    phaseouts only fall);
 *  - hence spendable cash is non-decreasing in d, and g(d) = d + PTC(d) is strictly
 *    increasing, so the valid set is an interval [0, d*] found exactly by bisection
 *    even across PTC discontinuities (133%, 400%, rounding steps).
 * Deductions that would push income below 100% FPL are not considered because
 * the below-100% eligibility exception is not modeled (reported in the trace).
 */
export function solveCredit(model: YearModel, v: Variation, checkSepLimit = true): CreditSolution {
  const rules = model.rules;
  const owner = model.persons.find(p => p.id === model.ownerId)!;
  const ownerProfit = owner.amounts.scheduleCProfit + v.profitDelta;
  if (ownerProfit < 0) throw new EngineStop("infeasible", "LOSS", "This option would create a Schedule C loss, which is not supported.");
  const se = model.persons.map(p => scheduleSe(rules, p.id, p.id === model.ownerId ? ownerProfit : p.amounts.scheduleCProfit,
    p.amounts.socialSecurityWages));
  const seTotal = sum(se.map(s => s.total));
  const halfSe = sum(se.map(s => s.half));
  const ownerHalfSe = se.find(s => s.personId === model.ownerId)!.half;
  const sepExisting = owner.amounts.existingSepContribution;
  if (v.additionalSep < 0) throw new EngineStop("infeasible", "SEP_NEGATIVE", "A SEP contribution cannot be negative.");
  const sepTotal = sepExisting + v.additionalSep;
  const sepMax = sepMaximum(rules, ownerProfit, ownerHalfSe);
  if (checkSepLimit && sepTotal > sepMax) {
    throw new EngineStop("infeasible", "SEP_OVER_LIMIT",
      `Total SEP contributions ${formatUsd(sepTotal)} exceed the ${model.year} owner limit ${formatUsd(sepMax)}.`);
  }
  const all = (f: keyof typeof owner.amounts) => sum(model.persons.map(p => p.amounts[f]));
  const otherProfit = sum(model.persons.filter(p => p.id !== model.ownerId).map(p => p.amounts.scheduleCProfit));
  const agiBeforeSehi = all("w2Box1") + all("taxableInterest") + ownerProfit + otherProfit - halfSe - sepTotal;
  const magiBeforeSehi = agiBeforeSehi + all("taxExemptInterest");
  const premiumTotal = sum(model.premium);
  const sehiLimit = model.sehiEligible
    ? toWholeDollars(Math.min(premiumTotal, Math.max(0, ownerProfit - ownerHalfSe - sepTotal)), "floor") : 0;
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
    if (g(mid) <= premiumTotal) lo = mid; else hi = mid - 1;
  }
  const sehi = lo * 100;
  const magi = magiBeforeSehi - sehi;
  return { ownerProfit, se, seTotal, halfSe, ownerHalfSe, sepExisting, sepAdditional: v.additionalSep, sepTotal, sepMax,
    agiBeforeSehi, magiBeforeSehi, sehiLimit, sehi, sehiCappedAt100: sehiCappedAt100 && lo === dMax,
    agi: agiBeforeSehi - sehi, magi, fplDollars, ptc: ptcFor(model, magi), premiumTotal, aptcTotal: sum(model.aptc), below100 };
}

// ------------------------------------------------------------ income tax --
function scheduleTax(brackets: Array<{ top: number; rate: { num: number; den: number } }>, taxable: number): { tax: number; exact: [number, number] } {
  // Exact sum of bracket portions as a single rational with the common denominator.
  const den = Math.max(...brackets.map(b => b.rate.den));
  let numerator = 0, prev = 0;
  for (const b of brackets) {
    if (taxable <= prev) break;
    numerator += (Math.min(taxable, b.top) - prev) * b.rate.num * (den / b.rate.den);
    prev = b.top;
  }
  if (taxable > prev) throw new EngineStop("unsupported", "TAX_RANGE", "Taxable income is above the transcribed tax brackets.");
  return { tax: divRound(numerator, den, "half_up"), exact: [numerator, den] };
}

/** Tax Table (under $100,000: tax on the band midpoint, rounded to whole dollars) or Tax Computation Worksheet. */
export function regularTax(rules: RulePack, filing: Filing, taxable: number): number {
  const brackets = rules.brackets[filing];
  if (taxable >= rules.taxTableUpper) return scheduleTax(brackets, taxable).tax;
  if (taxable < 500) return 0;
  let lo: number, width: number;
  if (taxable < 2500) { width = 1000; lo = 500 + Math.floor((taxable - 500) / width) * width; }
  else if (taxable < 300000) { width = 2500; lo = 2500 + Math.floor((taxable - 2500) / width) * width; }
  else { width = 5000; lo = 300000 + Math.floor((taxable - 300000) / width) * width; }
  const [num, den] = scheduleTax(brackets, lo + width / 2).exact;
  return toWholeDollars(divRound(num, den, "half_up"));
}

// ------------------------------------------------------------- full year --
export interface YearComputation {
  credit: CreditSolution;
  standardDeduction: number;
  taxableBeforeQbi: number;
  qbi: number;
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
      `${model.year} taxable income would exceed ${formatUsd(rules.supportedTaxableBeforeQbi[f])}, where QBI wage/SSTB limits and higher brackets apply; this range is not supported.`);
  }
  const qbi = Math.max(0, c.ownerProfit - c.ownerHalfSe - c.sepTotal - c.sehi);
  let qbiComponent = mulRate(qbi, rules.qbi.rate);
  if (qbi >= rules.qbi.minimumQbi) qbiComponent = Math.max(qbiComponent, rules.qbi.minimumDeduction);
  const qbiDeduction = Math.min(qbiComponent, mulRate(taxableBeforeQbi, rules.qbi.rate));
  const taxable = taxableBeforeQbi - qbiDeduction;
  const tax = regularTax(rules, f, taxable);

  const earnedIncome = sum(model.persons.map(p => p.amounts.w2Box1)) + Math.max(0, c.ownerProfit - c.ownerHalfSe);
  const eitcBound = rules.eitcBound[f][Math.min(3, model.eitcChildren)];
  if (Math.max(c.agi, earnedIncome) < eitcBound) {
    throw new EngineStop("unsupported", "EITC_POSSIBLE",
      `${model.year} income is low enough that the earned income tax credit may apply; it is not calculated, so take-home results are not supported here.`);
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
      throw new EngineStop("unsupported", "ACTC_THREE_PLUS", "The refundable child tax credit for three or more children (Part II-B) is not modeled.");
    }
    refundableCtc = Math.min(unused, model.qualifyingChildren * rules.ctc.refundablePerChild,
      mulRate(Math.max(0, earnedIncome - rules.ctc.earnedFloor), rules.ctc.refundableRate));
  }
  const medicareWages = sum(model.persons.map(p => p.amounts.medicareWages));
  const thr = rules.addlMedicare.threshold[f];
  const seIncome = sum(c.se.map(s => s.netEarnings));
  const additionalMedicare = mulRate(Math.max(0, medicareWages - thr), rules.addlMedicare.rate)
    + mulRate(Math.max(0, seIncome - Math.max(0, thr - medicareWages)), rules.addlMedicare.rate);
  const nii = sum(model.persons.map(p => p.amounts.taxableInterest));
  const niit = mulRate(Math.min(nii, Math.max(0, c.agi - rules.niit.threshold[f])), rules.niit.rate);
  const federalIncomeTax = tax - nonrefundableCredit - refundableCtc + additionalMedicare + niit;
  const employeeFica = sum(model.persons.map(p => mulRate(p.amounts.socialSecurityWages, rules.fica.ss) + mulRate(p.amounts.medicareWages, rules.fica.medicare)));
  const cashIncome = sum(model.persons.map(p => p.amounts.grossWages - p.amounts.payrollPretaxDeductions
    + p.amounts.taxableInterest + p.amounts.taxExemptInterest + (p.id === model.ownerId ? c.ownerProfit : p.amounts.scheduleCProfit)));
  const netPremium = c.premiumTotal - c.ptc.ptc;          // = premiums paid net of APTC + settlement; counted once
  const settlement = c.aptcTotal - c.ptc.ptc;
  const spendable = cashIncome - employeeFica - c.seTotal - federalIncomeTax - netPremium - c.sepTotal;
  return { credit: c, standardDeduction, taxableBeforeQbi, qbi, qbiDeduction, taxable, regularTax: tax, childCredits,
    nonrefundableCredit, refundableCtc, additionalMedicare, niit, federalIncomeTax, employeeFica, earnedIncome, cashIncome,
    netPremium, settlement, spendable, additionalRetirement: v.additionalSep };
}

// ------------------------------------------------------------------ trace --
export function creditTrace(model: YearModel, c: CreditSolution, extraPaths: string[] = []): TraceItem[] {
  const y = model.year, yi = model.yearIndex, r = model.rules;
  const inc = (field: string) => model.persons.filter(p => p.row >= 0).map(p => `years[${yi}].incomes[${p.row}].${field}`);
  const owner = model.persons.find(p => p.id === model.ownerId)!;
  const cov = (field: string) => [`years[${yi}].coverage[*].${field}`];
  const ev = model.evidenceIds;
  const t = (id: string, label: string, amountCents: number | null, inputPaths: string[], sourceIds: string[], explanation: string): TraceItem =>
    ({ id: `${y}.${id}`, label, amountCents, inputPaths, sourceIds: [...new Set(sourceIds)], explanation });
  const items: TraceItem[] = [
    t("owner_profit", "Schedule C net profit (business owner)", c.ownerProfit, [`years[${yi}].incomes[${owner.row}].scheduleCProfit`, ...extraPaths], ev,
      "Forecast net profit for the full year, plus this option's receipts minus its expenses paid this year."),
    ...c.se.filter(s => s.total > 0).map(s => t(`se_tax.${s.personId}`, `Self-employment tax (${s.personId})`, s.total,
      [`years[${yi}].incomes[${model.persons.find(p => p.id === s.personId)!.row}].socialSecurityWages`], r.se.sourceIds,
      `Schedule SE: net earnings ${formatUsd(s.netEarnings)} (92.35% of profit). Social Security part ${formatUsd(s.ssPart)} uses this person's own wage-base room; Medicare part ${formatUsd(s.medicarePart)}.`)),
    t("half_se", "Deductible half of SE tax", c.halfSe, [], r.se.sourceIds, "Schedule SE line 13, an adjustment to income."),
    t("sep", "SEP contributions deducted", c.sepTotal, [`years[${yi}].incomes[${owner.row}].existingSepContribution`], r.sep.sourceIds,
      `Existing ${formatUsd(c.sepExisting)} + additional ${formatUsd(c.sepAdditional)}. Owner limit ${formatUsd(c.sepMax)} (20% of net profit after half SE tax). Retirement money, not spendable cash.`),
    t("sehi", "Self-employed health insurance deduction", c.sehi, [...cov("enrollmentPremium"), ...cov("sehiEligibilityConfirmed")], ["irs-pub-974", "headroom-engine-policy"],
      `Largest whole-dollar deduction with deduction + PTC ≤ premiums (${formatUsd(c.premiumTotal)}) and deduction ≤ ${formatUsd(c.sehiLimit)} (premiums and net profit after half SE tax and SEP). Equality is not required.` +
      (c.sehiCappedAt100 ? " Capped so household income stays at 100% FPL: the below-100% exception is not modeled, so the result may understate the household's options." : "")),
    t("magi", "ACA household income (MAGI)", c.magi, [...inc("w2Box1"), ...inc("taxableInterest"), ...inc("taxExemptInterest")], ["irs-i8962-2026-draft"],
      "AGI plus tax-exempt interest. Standard deduction and QBI do not reduce ACA income. Dependents have no income in the supported case."),
    t("fpl", `Poverty line, family of ${model.familySize}`, c.fplDollars * 100, [`years[${yi}].taxFamilySize`], [r.fplSourceId],
      `Prior-year HHS guideline, contiguous states. Credit requires income at or below 400% (${formatUsd(c.fplDollars * 400)}).`),
    t("line5", "Income as % of poverty line (Form 8962 line 5)", null, [], ["irs-i8962-2026-draft"],
      c.ptc.line5 > 400 ? "Above 400% → 401: no premium tax credit." : `${c.ptc.line5}% (truncated, not rounded).`),
    t("contribution", "Required contribution (line 8a)", c.ptc.contribution8a, [], [...r.applicableFigureSourceIds],
      c.ptc.line5 > 400 || !model.ptcEligible ? "Not applicable." :
        `Household income × applicable figure ${(c.ptc.figure / 10000).toFixed(4)}, rounded to whole dollars. ${r.applicableFigureStatus}`),
    t("ptc", "Premium tax credit allowed", c.ptc.ptc, [...cov("benchmarkPremium"), ...cov("enrollmentPremium"), ...cov("ptcEligibilityConfirmed")],
      ["irs-i8962-2026-draft", ...r.applicableFigureSourceIds],
      !model.ptcEligible ? "Not eligible for the credit in any month (as entered)." :
        model.uniformCoverage ? "Annual calculation (line 11): smaller of enrollment premiums and benchmark minus contribution."
          : `Monthly calculation (lines 12–23) with monthly contribution ${formatUsd(c.ptc.contribution8b ?? 0)}.`),
    t("aptc", "Advance credit paid during the year", c.aptcTotal, cov("advancePtc"), ev, "Sum of monthly advance payments."),
    t("settlement", "Settlement at filing (+ repay / − receive)", c.aptcTotal - c.ptc.ptc, [], ["irs-ptc-qa"],
      `Advance minus allowed credit. No repayment cap applies after 2025. Already inside net premium cost; not subtracted again. Settled on the ${y} return (${r.returnDueDate}).`),
  ];
  return items;
}

export function yearTrace(model: YearModel, yc: YearComputation, extraPaths: string[] = []): TraceItem[] {
  const y = model.year, r = model.rules, ev = model.evidenceIds, yi = model.yearIndex;
  const t = (id: string, label: string, amountCents: number | null, inputPaths: string[], sourceIds: string[], explanation: string): TraceItem =>
    ({ id: `${y}.${id}`, label, amountCents, inputPaths, sourceIds: [...new Set(sourceIds)], explanation });
  const inc = (field: string) => model.persons.filter(p => p.row >= 0).map(p => `years[${yi}].incomes[${p.row}].${field}`);
  return [
    ...creditTrace(model, yc.credit, extraPaths),
    t("agi", "Adjusted gross income", yc.credit.agi, inc("w2Box1"), ev, "W-2 box 1 + taxable interest + net profit − half SE tax − SEP − SEHI."),
    t("standard_deduction", "Standard deduction", yc.standardDeduction, ["filingStatus"], [r.bracketSourceId], "Itemizing is outside the supported case."),
    t("qbi_deduction", "Qualified business income deduction", yc.qbiDeduction, [], [r.qbi.sourceId],
      `20% of QBI ${formatUsd(yc.qbi)} (profit after half SE tax, SEP and SEHI), limited to 20% of taxable income before QBI; $400 minimum when QBI ≥ $1,000 (material participation assumed). Below the wage/SSTB threshold.`),
    t("taxable_income", "Taxable income", yc.taxable, [], [r.bracketSourceId], "AGI − standard deduction − QBI deduction."),
    t("regular_tax", "Income tax before credits", yc.regularTax, [], [r.bracketSourceId, "irs-i1040-tax-table"],
      yc.taxable < r.taxTableUpper ? "Tax Table method: rate schedule at the $50 band midpoint, rounded to whole dollars." : "Tax Computation Worksheet (rate schedule)."),
    t("child_credits", "Child tax credit / credit for other dependents", yc.nonrefundableCredit + yc.refundableCtc, ["people[*].qualifyingChildForCtc"], r.ctc.sourceIds,
      `Credit after phaseout ${formatUsd(yc.childCredits)}: nonrefundable ${formatUsd(yc.nonrefundableCredit)}, refundable ${formatUsd(yc.refundableCtc)}. Required SSNs assumed.`),
    t("other_taxes", "Additional Medicare tax + net investment income tax", yc.additionalMedicare + yc.niit, inc("medicareWages"), [r.addlMedicare.sourceId, r.niit.sourceId],
      `Additional Medicare ${formatUsd(yc.additionalMedicare)}; NIIT ${formatUsd(yc.niit)}.`),
    t("federal_income_tax", "Federal income tax after credits", yc.federalIncomeTax, [], [r.bracketSourceId],
      "Regular tax − child credits (incl. refundable part) + additional Medicare + NIIT. Excludes SE tax and the PTC settlement. State income tax: none in TX/FL/TN."),
    t("employee_fica", "Employee Social Security and Medicare withheld", yc.employeeFica, [...inc("socialSecurityWages"), ...inc("medicareWages")], [r.fica.sourceId],
      "6.2% of each person's SS wages + 1.45% of Medicare wages (single employer per person)."),
    t("cash_income", "Cash income before taxes and premiums", yc.cashIncome, [...inc("grossWages"), ...inc("payrollPretaxDeductions")], ev,
      "Gross pay − payroll pre-tax deductions + net profit + taxable and tax-exempt interest."),
    t("net_premium", "Health premiums after final credit", yc.netPremium, [`years[${yi}].coverage[*].enrollmentPremium`], ["irs-i8962-2026-draft"],
      "Enrollment premiums − allowed PTC. Equals premiums paid net of advance + settlement, so the settlement is not counted twice."),
    t("spendable", "Spendable cash after final settlement", yc.spendable, [], ["headroom-engine-policy"],
      `Cash income − FICA − SE tax − federal income tax − net premiums − SEP contributions. After eventual settlement of the ${y} return, not a December 31 bank balance.`),
    t("retirement", "Additional retirement contribution (not spendable)", yc.additionalRetirement, [], ["irs-pub-560"],
      "Held in the SEP-IRA, taxable on future withdrawal; shown separately from spendable cash."),
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
