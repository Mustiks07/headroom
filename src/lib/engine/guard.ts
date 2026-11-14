/**
 * Support guard: structural parse + the complete supported-profile check.
 * Produces per-year models only when every required fact is known/estimated and
 * no excluded situation applies. Unknown is never turned into zero.
 */
import { CaseInputSchema, type BlockedComparison, type CaseInput, type MoneyFact } from "@/domain/contracts";
import { INCOME_FIELDS, type IncomeField, type PersonYear, type YearModel } from "./model";
import { rulesFor } from "./rules";

export const SUPPORTED_STATES = ["TX", "FL", "TN"] as const;

type Field = { path: string; reason: string };
export class Issues {
  unsupported: Array<Field & { code: string }> = [];
  needsData: Array<Field & { code: string }> = [];
  bad(code: string, path: string, reason: string) { this.unsupported.push({ code, path, reason }); }
  need(code: string, path: string, reason: string) { this.needsData.push({ code, path, reason }); }
  get count() { return this.unsupported.length + this.needsData.length; }
  toBlocked(): BlockedComparison | null {
    if (this.unsupported.length) {
      const first = this.unsupported[0];
      return { status: "unsupported", code: first.code,
        message: `This household is outside what Headroom can calculate reliably: ${first.reason}`,
        fields: this.unsupported.map(({ path, reason }) => ({ path, reason })) };
    }
    if (this.needsData.length) {
      const first = this.needsData[0];
      return { status: "needs_data", code: first.code,
        message: `More information is needed before calculating: ${first.reason}`,
        fields: this.needsData.map(({ path, reason }) => ({ path, reason })) };
    }
    return null;
  }
}

/** Zod parse and household-level checks shared by both entry points. */
export function parseCase(raw: unknown, issues: Issues): CaseInput | null {
  const parsed = CaseInputSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.need("INVALID_INPUT", i.path.map(String).join(".") || "(root)", i.message);
    return null;
  }
  const input = parsed.data;
  if (!(SUPPORTED_STATES as readonly string[]).includes(input.state)) {
    issues.bad("STATE_NOT_SUPPORTED", "state", `State ${input.state} is not supported; only TX, FL and TN (no state income tax) are calculated.`);
  }
  if (input.filingStatus === "other") issues.bad("FILING_STATUS", "filingStatus", "Only single and married filing jointly are supported.");
  const primaries = input.people.filter(p => p.role === "primary");
  const spouses = input.people.filter(p => p.role === "spouse");
  if (primaries.length !== 1) issues.need("PEOPLE", "people", "List exactly one primary taxpayer.");
  if (input.filingStatus === "single" && spouses.length > 0) issues.bad("FILING_STATUS", "people", "A spouse is listed, but the filing status is single.");
  if (input.filingStatus === "mfj" && spouses.length !== 1) issues.need("SPOUSE_MISSING", "people", "Married filing jointly needs exactly one spouse listed.");
  const owner = input.people.find(p => p.id === input.opportunity.ownerPersonId);
  if (owner && owner.role === "dependent") issues.bad("OWNER_ROLE", "opportunity.ownerPersonId", "The business owner must be the primary taxpayer or spouse.");
  return input;
}

const factOk = (f: MoneyFact): f is MoneyFact & { valueCents: number } => f.status !== "unknown" && f.valueCents !== null;

/** Build the supported model for one tax year, adding any blocking issue. */
export function buildYearModel(input: CaseInput, yi: 0 | 1, issues: Issues): YearModel | null {
  const before = issues.count;
  const year = input.years[yi];
  const rules = rulesFor(year.year);
  const base = `years[${yi}]`;
  const evidence = new Set(input.evidence.map(e => e.id));
  const usedEvidence = new Set<string>();
  const checkSource = (f: MoneyFact, path: string) => {
    if (!evidence.has(f.sourceId)) issues.need("SOURCE_MISSING", `${path}.sourceId`, `Source "${f.sourceId}" is not in the evidence list.`);
    else usedEvidence.add(f.sourceId);
  };

  year.unsupportedFacts.forEach((fact, i) => issues.bad("UNSUPPORTED_FACT", `${base}.unsupportedFacts[${i}]`, fact));
  if (year.scopeConfirmed === null) {
    issues.need("SCOPE_UNCONFIRMED", `${base}.scopeConfirmed`, `Confirm for ${year.year} that none of the excluded situations apply (itemizing, capital gains or dividends, rental, foreign or Social Security income, other businesses, EITC, other credits or special deductions).`);
  } else if (!year.scopeConfirmed) {
    issues.bad("SCOPE_EXCLUDED", `${base}.scopeConfirmed`, `An excluded tax situation applies in ${year.year}.`);
  }
  if (year.taxFamilySize !== input.people.length) {
    issues.need("TAX_FAMILY", `${base}.taxFamilySize`, `Tax family size (${year.taxFamilySize}) must equal the listed taxpayer, spouse and dependents (${input.people.length}).`);
  }
  if (year.benchmarkStatus === "unknown") issues.need("BENCHMARK_UNKNOWN", `${base}.benchmarkStatus`, "The benchmark (second-lowest-cost Silver) premium is not known.");

  input.people.forEach((p, i) => {
    if (p.role !== "dependent" && p.ageAt2026Start + (year.year - 2026) + 1 >= 65) {
      issues.bad("AGE_65", `people[${i}].ageAt2026Start`, `${p.id} may reach 65 during ${year.year} (Medicare eligibility, senior deductions); not supported.`);
    }
  });
  let qualifyingChildren = 0, otherDependents = 0;
  const dependents = input.people.filter(p => p.role === "dependent");
  input.people.forEach((p, i) => {
    if (p.role !== "dependent") return;
    if (p.qualifyingChildForCtc === null) { issues.need("CTC_UNKNOWN", `people[${i}].qualifyingChildForCtc`, `Say whether ${p.id} is a qualifying child for the child tax credit.`); return; }
    if (p.qualifyingChildForCtc) {
      const minAge = p.ageAt2026Start + (year.year - 2026);
      if (minAge >= 17) issues.bad("CTC_AGE", `people[${i}].ageAt2026Start`, `${p.id} is 17 or older at the end of ${year.year} and cannot be a CTC qualifying child.`);
      else if (minAge + 1 >= 17) issues.need("CTC_AGE", `people[${i}].ageAt2026Start`, `${p.id} may turn 17 during ${year.year}; confirm the child is under 17 on December 31.`);
      else qualifyingChildren++;
    } else otherDependents++;
  });

  const persons: PersonYear[] = [];
  for (const p of input.people) {
    const row = year.incomes.findIndex(r => r.personId === p.id);
    const amounts = Object.fromEntries(INCOME_FIELDS.map(f => [f, 0])) as Record<IncomeField, number>;
    const ranges: PersonYear["ranges"] = {};
    if (row < 0) {
      if (p.role !== "dependent") {
        issues.need("INCOME_ROW_MISSING", `${base}.incomes`, `No ${year.year} income entry for ${p.id}. A missing entry is not zero income; enter amounts or confirm $0.`);
      }
      persons.push({ id: p.id, role: p.role, row, amounts, ranges });
      continue;
    }
    const income = year.incomes[row];
    for (const f of INCOME_FIELDS) {
      const fact = income[f];
      const path = `${base}.incomes[${row}].${f}`;
      if (!factOk(fact)) { issues.need("FACT_UNKNOWN", path, `${p.id}: ${f} is unknown for ${year.year}. Enter it, an estimate, or confirm $0.`); continue; }
      checkSource(fact, path);
      if (fact.valueCents < 0) {
        if (f === "scheduleCProfit") issues.bad("LOSS", path, "A Schedule C loss is not supported.");
        else issues.need("NEGATIVE", path, `${f} cannot be negative.`);
      }
      amounts[f] = fact.valueCents;
      if (fact.range) ranges[f] = { low: fact.range.lowCents, high: fact.range.highCents };
    }
    if (p.role === "dependent" && INCOME_FIELDS.some(f => amounts[f] !== 0)) {
      issues.bad("DEPENDENT_INCOME", `${base}.incomes[${row}]`, "Dependent income (and their possible filing requirement) is not modeled.");
    }
    if (p.id !== input.opportunity.ownerPersonId) {
      if (amounts.scheduleCProfit > 0) issues.bad("MULTIPLE_BUSINESSES", `${base}.incomes[${row}].scheduleCProfit`, "Only one sole-proprietor business (the opportunity owner's) is supported.");
      if (amounts.existingSepContribution > 0) issues.bad("SEP_NON_OWNER", `${base}.incomes[${row}].existingSepContribution`, "Only the business owner's SEP is modeled.");
    }
    const wagesUsed = amounts.grossWages || amounts.w2Box1 || amounts.socialSecurityWages || amounts.medicareWages || amounts.payrollPretaxDeductions;
    if (wagesUsed) {
      const path = `${base}.incomes[${row}]`;
      if (amounts.payrollPretaxDeductions > amounts.grossWages) issues.need("PAYROLL", `${path}.payrollPretaxDeductions`, "Pre-tax deductions exceed gross wages.");
      if (Math.abs(amounts.grossWages - amounts.payrollPretaxDeductions - amounts.w2Box1) > 100) {
        issues.bad("PAYROLL_MODEL", `${path}.w2Box1`, "W-2 box 1 does not equal gross wages minus pre-tax deductions; other payroll arrangements are not modeled.");
      }
      if (amounts.medicareWages < amounts.w2Box1 || amounts.medicareWages > amounts.grossWages) {
        issues.bad("PAYROLL_MODEL", `${path}.medicareWages`, "Medicare wages must lie between W-2 box 1 and gross wages in the supported payroll model.");
      }
      if (amounts.socialSecurityWages > amounts.medicareWages) issues.bad("PAYROLL_MODEL", `${path}.socialSecurityWages`, "Social Security wages above Medicare wages are not modeled.");
      if (amounts.socialSecurityWages > rules.se.wageBase) {
        issues.bad("EXCESS_SS", `${path}.socialSecurityWages`, `Social Security wages above the ${year.year} wage base (several employers / excess withholding credit) are not modeled.`);
      }
    }
    persons.push({ id: p.id, role: p.role, row, amounts, ranges });
  }

  const months = [...year.coverage].sort((a, b) => a.month - b.month);
  const premium: number[] = [], benchmark: number[] = [], aptc: number[] = [];
  const ptcFlags: Array<boolean | null> = [], sehiFlags: Array<boolean | null> = [];
  months.forEach(m => {
    const mi = year.coverage.indexOf(m);
    const path = `${base}.coverage[${mi}]`;
    const vals: number[] = [];
    for (const f of ["enrollmentPremium", "benchmarkPremium", "advancePtc"] as const) {
      const fact = m[f];
      if (!factOk(fact)) { issues.need("COVERAGE_UNKNOWN", `${path}.${f}`, `${f} for month ${m.month} of ${year.year} is unknown.`); vals.push(0); continue; }
      checkSource(fact, `${path}.${f}`);
      vals.push(fact.valueCents);
    }
    const [prem, bench, adv] = vals;
    if (factOk(m.enrollmentPremium) && prem <= 0) issues.bad("PARTIAL_YEAR_COVERAGE", `${path}.enrollmentPremium`, `No Marketplace premium in month ${m.month}; partial-year coverage is not supported.`);
    if (factOk(m.benchmarkPremium) && bench <= 0) issues.need("BENCHMARK", `${path}.benchmarkPremium`, `Benchmark premium for month ${m.month} must be positive.`);
    if (adv < 0 || (factOk(m.advancePtc) && factOk(m.enrollmentPremium) && adv > prem)) issues.need("APTC", `${path}.advancePtc`, `Advance credit for month ${m.month} must be between $0 and the premium.`);
    premium.push(prem); benchmark.push(bench); aptc.push(adv);
    ptcFlags.push(m.ptcEligibilityConfirmed); sehiFlags.push(m.sehiEligibilityConfirmed);
  });
  const flag = (flags: Array<boolean | null>, name: string, what: string): boolean => {
    const nullAt = flags.findIndex(f => f === null);
    if (nullAt >= 0) { issues.need(`${name.toUpperCase()}_UNCONFIRMED`, `${base}.coverage[${year.coverage.indexOf(months[nullAt])}].${name}`, `Confirm ${what} for every month of ${year.year}.`); return false; }
    if (flags.some(f => f) && flags.some(f => !f)) { issues.bad("PARTIAL_ELIGIBILITY", `${base}.coverage`, `${what} changes during ${year.year}; month-by-month eligibility changes are not supported.`); return false; }
    return flags[0] === true;
  };
  const ptcEligible = flag(ptcFlags, "ptcEligibilityConfirmed", "premium tax credit eligibility (no employer or government coverage offer, lawful presence, enrollment through the Marketplace)");
  const sehiEligible = flag(sehiFlags, "sehiEligibilityConfirmed", "self-employed health insurance eligibility (no subsidized employer plan available, including a spouse's)");

  if (issues.count > before) return null;
  const uniformCoverage = premium.every(p => p === premium[0]) && benchmark.every(b => b === benchmark[0]);
  return {
    year: year.year, yearIndex: yi, rules, filing: input.filingStatus as "single" | "mfj", familySize: year.taxFamilySize,
    ownerId: input.opportunity.ownerPersonId, persons, qualifyingChildren, otherDependents,
    eitcChildren: Math.min(3, dependents.length), premium, benchmark, aptc, uniformCoverage, ptcEligible, sehiEligible,
    benchmarkStatus: year.benchmarkStatus, evidenceIds: [...usedEvidence].sort(),
  };
}

/** Opportunity facts needed for the two-year comparison. */
export function checkOpportunity(input: CaseInput, issues: Issues): void {
  const o = input.opportunity;
  if (o.grossRevenueCents === 0 && o.incrementalExpensesCents === 0) return;
  const yearOf = (d: string) => Number(d.slice(0, 4));
  if (![2026, 2027].includes(yearOf(o.plannedReceiptDate))) issues.bad("RECEIPT_YEAR", "opportunity.plannedReceiptDate", "Planned receipt must fall in 2026 or 2027.");
  if (o.incrementalExpensesCents > 0 && ![2026, 2027].includes(yearOf(o.expensePaymentDate))) {
    issues.bad("EXPENSE_YEAR", "opportunity.expensePaymentDate", "Project expenses must be paid in 2026 or 2027.");
  }
  if (o.cashAccountingConfirmed === null) {
    issues.need("CASH_METHOD_UNCONFIRMED", "opportunity.cashAccountingConfirmed", "Confirm the business uses the cash method, so income counts in the year it is received.");
  } else if (!o.cashAccountingConfirmed) {
    issues.bad("ACCRUAL_METHOD", "opportunity.cashAccountingConfirmed", "Accrual-method timing is not modeled.");
  }
}
