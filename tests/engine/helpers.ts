import type { CaseInput, MoneyFact } from "@/domain/contracts";
import { familyCase, ordinaryCase } from "@/fixtures/cases";
import { buildYearModel, Issues } from "@/lib/engine/guard";
import type { YearModel } from "@/lib/engine/model";

export const fact = (cents: number): MoneyFact => ({ valueCents: cents, status: "confirmed", sourceId: "demo-input" });
export const usd = (dollars: number) => Math.round(dollars * 100);

export const family = (): CaseInput => structuredClone(familyCase);
export const single = (): CaseInput => structuredClone(ordinaryCase);

export function setIncome(c: CaseInput, yi: 0 | 1, personId: string, values: Partial<Record<string, number>>): CaseInput {
  const row = c.years[yi].incomes.find(r => r.personId === personId)!;
  for (const [k, v] of Object.entries(values)) (row as unknown as Record<string, MoneyFact>)[k] = fact(v!);
  return c;
}

export function setCoverage(c: CaseInput, yi: 0 | 1, premium: number, benchmark: number, aptc: number): CaseInput {
  for (const m of c.years[yi].coverage) {
    m.enrollmentPremium = fact(premium); m.benchmarkPremium = fact(benchmark); m.advancePtc = fact(aptc);
  }
  return c;
}

export function model(c: CaseInput, yi: 0 | 1 = 0): YearModel {
  const issues = new Issues();
  const m = buildYearModel(c, yi, issues);
  if (!m) throw new Error(JSON.stringify(issues.toBlocked()));
  return m;
}

/** Spouse wages of an amount, consistent payroll fields. */
export const wages = (cents: number) => ({ w2Box1: cents, socialSecurityWages: cents, medicareWages: cents, grossWages: cents });
