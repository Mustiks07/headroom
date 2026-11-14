/**
 * Insurance data assistance (round 5): which benchmark premium a year can use, and how sure it is.
 *
 * Result per year:
 *  - confirmed: the user entered the benchmark from their own Marketplace notice / plan document for THAT year;
 *  - county_candidate: computed here from the CMS Landscape county extract of that plan year (second-lowest-cost
 *    Silver for the covered members' ages) — a candidate for the county, NOT the exact benchmark for the address;
 *  - not_available: the data does not cover the county, year or ages, or the county is not known. Never filled with
 *    an average, never another year's figure, never a county guessed from an ambiguous ZIP.
 *
 * Covered members (who is enrolled) price the benchmark; the TAX family sets the poverty line. They can differ.
 */
import type { TaxYear } from "@/domain/contracts";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import ages from "../../../../data/reference/age-factors-verified.json";
import davidson2026 from "../../../../data/reference/davidson_tn_silver_2026.json";
import davidson2027 from "../../../../data/reference/davidson_tn_silver_2027.json";
import { formatUsd } from "../money";

type CountyFile = { year: number; source: string; sha256: string; status: string; plans: Array<Record<string, string>> };
/** County extracts available in this build (county FIPS → plan year → file). */
const COUNTY_DATA: Record<string, { name: string; state: string; years: Partial<Record<TaxYear, CountyFile>> }> = {
  "47037": { name: "Davidson County, TN", state: "TN", years: { 2026: davidson2026 as CountyFile, 2027: davidson2027 as CountyFile } },
};

/** Source manifest for the insurance figures this resolver can produce. */
export const BENCHMARK_SOURCES = {
  countyFiles: Object.entries(COUNTY_DATA).flatMap(([fips, c]) => Object.values(c.years).map(f => ({ countyFips: fips, county: c.name, year: f!.year, source: f!.source, sha256: f!.sha256, status: f!.status }))),
  ageFactors: { source: ages.source, sha256: ages.source_sha256, verifiedAges: Object.keys(ages.factors), note: ages.not_included },
} as const;

export interface CoveredMemberPremium { personId: string; age: number; factor: number; monthlyCents: number; charged: boolean }
export type BenchmarkResolution =
  | { status: "confirmed"; year: TaxYear; monthlyCents: number[]; annualCents: number; source: string; notes: string[] }
  | { status: "county_candidate"; year: TaxYear; countyFips: string; county: string; planId: string; planName: string; plansCompared: number;
      monthlyCents: number; annualCents: number; members: CoveredMemberPremium[]; source: { url: string; sha256: string }; notes: string[] }
  | { status: "not_available"; year: TaxYear; reason: string; need: string };

const money = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
const factorFor = (age: number): number | null => (age <= 14 ? ages.factors["0-14"] : (ages.factors as Record<string, number>)[String(age)] ?? null);

/** Benchmark for one plan year. `age` = age on January 1 of the plan year (ageAt2026Start + years since 2026). */
export function resolveBenchmark(ws: HouseholdWorkspace, year: TaxYear): BenchmarkResolution {
  const yi = year === 2026 ? 0 : 1;
  const hy = ws.household.years[yi];
  const notes: string[] = [];
  if (hy.benchmarkStatus === "marketplace_confirmed") {
    const vals = hy.coverage.slice().sort((a, b) => a.month - b.month).map(m => m.benchmarkPremium.valueCents);
    if (vals.every((v): v is number => v !== null && v > 0)) {
      if (yi === 1) {
        const prev = ws.household.years[0].coverage.slice().sort((a, b) => a.month - b.month).map(m => m.benchmarkPremium.valueCents);
        if (JSON.stringify(prev) === JSON.stringify(vals)) notes.push("The 2027 benchmark equals the 2026 one month for month. Make sure it comes from a 2027 notice: benchmark premiums change every year.");
      }
      return { status: "confirmed", year, monthlyCents: vals, annualCents: vals.reduce((a, b) => a + b, 0), source: "Your Marketplace notice or plan document", notes };
    }
  }
  const fips = ws.household.countyFips;
  if (!fips) return { status: "not_available", year, reason: "The county is not known.", need: "Choose your county (a ZIP code can cross county lines, so it is not guessed), or enter the benchmark from your Marketplace notice." };
  const county = COUNTY_DATA[fips];
  const file = county?.years[year];
  if (!county || !file) return { status: "not_available", year, reason: county ? `No ${year} plan data for ${county.name} in this build.` : "This build has county plan data only for Davidson County, TN.",
    need: `Enter the ${year} benchmark (second-lowest-cost Silver) premium from your Marketplace notice or the HealthCare.gov plan preview.` };
  if (county.state !== ws.household.state) return { status: "not_available", year, reason: `The county ${fips} is not in ${ws.household.state}.`, need: "Check the state and county." };

  const covered = ws.household.people.filter(p => hy.coveredPersonIds.includes(p.id));
  const members = covered.map(p => ({ personId: p.id, age: p.ageAt2026Start + yi, role: p.role }));
  const missing = members.filter(m => factorFor(m.age) === null);
  if (missing.length) return { status: "not_available", year, reason: `County plan prices are verified here only for ages 0–14, 21, 38, 39 and 40; ${missing.map(m => `a covered member aged ${m.age}`).join(", ")} is outside them.`,
    need: `Enter the ${year} benchmark premium from your Marketplace notice or the HealthCare.gov plan preview for your family.` };
  // At most the three oldest children under 21 are charged (45 CFR 147.102(c)(1)).
  const kids = members.filter(m => m.age < 21).sort((a, b) => b.age - a.age);
  const charged = new Set([...members.filter(m => m.age >= 21), ...kids.slice(0, 3)].map(m => m.personId));
  if (kids.length > 3) notes.push(`${kids.length - 3} younger child${kids.length - 3 === 1 ? " is" : "ren are"} not charged: only the three oldest children under 21 count in a family premium.`);
  const priced = file.plans.map(pl => {
    const base = money(pl["Premium Adult Individual Age 21"]);
    const ms = members.map(m => ({ personId: m.personId, age: m.age, factor: factorFor(m.age)!, monthlyCents: Math.round(base * factorFor(m.age)!), charged: charged.has(m.personId) }));
    return { id: pl["Plan ID (Standard Component)"], name: pl["Plan Marketing Name"], ehb: pl["EHB Percent of Total Premium"], ms, total: ms.filter(m => m.charged).reduce((a, m) => a + m.monthlyCents, 0) };
  }).sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
  if (priced.length < 2) return { status: "not_available", year, reason: "Fewer than two Silver plans in the county file.", need: "Enter the benchmark from your Marketplace notice." };
  const second = priced[1];
  if (second.ehb !== "100.00%") notes.push(`The plan's essential-health-benefit share is ${second.ehb}; the benchmark uses only that share.`);
  notes.push(`${county.name}, plan year ${year}: second-lowest-cost Silver among ${priced.length} county plans for the covered members' ages. Plans available at your exact address can differ, so this is a county candidate, not your confirmed benchmark.`);
  notes.push("Per-member premiums are the age-21 rate times the CMS age factor, rounded to cents; the insurer's own rounding can differ by a few cents a month.");
  if (covered.length !== hy.taxFamilySize) notes.push(`${covered.length} of the ${hy.taxFamilySize} people in the tax family are covered: the benchmark is for the covered members, while the poverty line uses the whole tax family.`);
  const entered = hy.coverage.map(m => m.benchmarkPremium.valueCents);
  if (hy.benchmarkStatus === "county_candidate" && entered.every(v => v !== null) && entered.some(v => Math.abs(v! - second.total) > 100))
    notes.push(`The benchmark in your plan (${formatUsd(entered[0]!)} a month) differs from this county candidate (${formatUsd(second.total)}); check which one is current.`);
  return { status: "county_candidate", year, countyFips: fips, county: county.name, planId: second.id, planName: second.name, plansCompared: priced.length,
    monthlyCents: second.total, annualCents: second.total * 12, members: second.ms, source: { url: file.source, sha256: file.sha256 }, notes };
}

/** Coverage facts that look inconsistent (never corrected automatically). */
export function checkCoverageFacts(ws: HouseholdWorkspace, year: TaxYear): string[] {
  const hy = ws.household.years[year === 2026 ? 0 : 1];
  const out: string[] = [];
  for (const m of [...hy.coverage].sort((a, b) => a.month - b.month)) {
    const prem = m.enrollmentPremium.valueCents, adv = m.advancePtc.valueCents;
    if (prem !== null && adv !== null && adv > prem) out.push(`Month ${m.month}: the advance credit (${formatUsd(adv)}) is larger than the premium (${formatUsd(prem)}); one of them is probably read from the wrong line.`);
  }
  const unknownMonths = hy.coverage.filter(m => m.enrollmentPremium.status === "unknown").map(m => m.month);
  if (unknownMonths.length && unknownMonths.length < 12) out.push(`Premiums are missing for months ${unknownMonths.join(", ")}; they are not copied from other months.`);
  return out;
}
