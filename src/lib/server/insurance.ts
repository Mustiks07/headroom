import "server-only";
import { z } from "zod";
import type { TaxYear } from "@/domain/contracts";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import type { BenchmarkLookup, CountyCandidate, InsuranceSource, LocationLookup } from "@/domain/insurance";
import { BENCHMARK_SOURCES, resolveBenchmark } from "@/lib/engine";
import manifest from "../../../data/reference/source-manifest.json";

/*
 * Insurance data assistance (capability 8). Figures come only from Claude 2's resolver over the CMS
 * plan-year county extracts bundled in the build (sha256 + retrieval date) or from the user's own
 * notice. The optional ZIP → county lookup calls ONE fixed official endpoint (CMS Marketplace API)
 * with the ZIP only — never income, names or family data — and never a URL chosen by a model.
 */

type ManifestFile = { source: string; retrieved_date?: string };
const retrievedOn = (url: string): string | null =>
  (manifest.files as ManifestFile[]).find(f => f.source === url)?.retrieved_date ?? manifest.retrieved_date ?? null;

/** Counties this build has plan data for, with the plan years covered. */
export function countiesWithPlanData(): CountyCandidate[] {
  const by = new Map<string, CountyCandidate>();
  for (const f of BENCHMARK_SOURCES.countyFiles) {
    const [name, state] = f.county.split(/,\s*/);
    const c = by.get(f.countyFips) ?? { countyFips: f.countyFips, name, state, planDataYears: [] };
    if (f.year === 2026 || f.year === 2027) c.planDataYears = [...new Set([...c.planDataYears, f.year as TaxYear])].sort();
    by.set(f.countyFips, c);
  }
  return [...by.values()];
}

const withPlanYears = (fips: string, name: string, state: string): CountyCandidate =>
  ({ countyFips: fips, name, state, planDataYears: countiesWithPlanData().find(c => c.countyFips === fips)?.planDataYears ?? [] });

const BUNDLED_LIST: InsuranceSource = { kind: "bundled_county_list", label: "Counties with CMS plan data in this build", url: null, sha256: null, dataVersion: "PY2026, PY2027", sourceDate: manifest.retrieved_date ?? null };

/** Benchmark lookup for one plan year, in the contract shape with source, version and date. */
export function lookupBenchmark(ws: HouseholdWorkspace, year: TaxYear): BenchmarkLookup {
  const r = resolveBenchmark(ws, year);
  if (r.status === "not_available") return r;
  if (r.status === "confirmed") return { ...r, source: { kind: "user_document", label: r.source, url: null, sha256: null, dataVersion: `PY${year}`, sourceDate: null } };
  return { status: "county_candidate", year, countyFips: r.countyFips, county: r.county, planId: r.planId, planName: r.planName, plansCompared: r.plansCompared,
    monthlyCents: r.monthlyCents, annualCents: r.annualCents, members: r.members.map(m => ({ personId: m.personId, age: m.age, monthlyCents: m.monthlyCents, charged: m.charged })),
    source: { kind: "cms_county_extract", label: `CMS Marketplace plan data (individual market medical), plan year ${year}; county extract`, url: r.source.url, sha256: r.source.sha256,
      dataVersion: `PY${year}`, sourceDate: retrievedOn(r.source.url) },
    notes: r.notes };
}

/** State + county name → counties with plan data in this build. Never guesses a county outside the data. */
export function lookupCountyByName(state: string, q: string): LocationLookup {
  const needle = q.trim().toLowerCase().replace(/\s+county$/, "");
  const hits = countiesWithPlanData().filter(c => c.state === state && c.name.toLowerCase().replace(/\s+county$/, "").startsWith(needle));
  if (!hits.length) return { status: "not_available", reason: `This build has county plan data only for ${countiesWithPlanData().map(c => `${c.name}, ${c.state}`).join("; ")}.`,
    need: "Enter the benchmark (second-lowest-cost Silver) premium from your Marketplace notice or the HealthCare.gov plan preview. The county is then optional." };
  const notes = ["Plan prices for a county are a candidate, not the exact benchmark for your address."];
  return hits.length === 1 ? { status: "single", counties: [hits[0]], source: BUNDLED_LIST, notes } : { status: "ambiguous", counties: hits, source: BUNDLED_LIST, notes };
}

/* ------------------------------------------------------------------ ZIP → county (optional, official API) */

const MARKETPLACE_ZIP_URL = "https://marketplace.api.healthcare.gov/api/v1/counties/by/zip/";
const ZipResponseSchema = z.object({ counties: z.array(z.object({ fips: z.string().regex(/^\d{5}$/), name: z.string().min(1).max(120), state: z.string().length(2) })).max(20) });
const cache = new Map<string, { at: number; value: LocationLookup }>();
const CACHE_MS = 24 * 60 * 60 * 1000;

export const zipLookupConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.MARKETPLACE_API_KEY && env.MARKETPLACE_API_KEY.length >= 16);

/**
 * ZIP → county candidates. A ZIP that crosses county lines returns "ambiguous" with every county;
 * the user picks. Without MARKETPLACE_API_KEY, or on any failure/unexpected shape, "not_available".
 */
export async function lookupCountiesByZip(zip: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<LocationLookup> {
  const off: LocationLookup = { status: "not_available", reason: "ZIP code lookup isn't available right now.", need: "Choose your state and county, or enter the benchmark from your Marketplace notice." };
  if (!zipLookupConfigured(env)) return { ...off, reason: "ZIP code lookup isn't set up in this version." };
  const hit = cache.get(zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: LocationLookup;
  try {
    const res = await fetchImpl(`${MARKETPLACE_ZIP_URL}${zip}?apikey=${encodeURIComponent(env.MARKETPLACE_API_KEY!)}`, { signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) { console.warn(JSON.stringify({ event: "insurance_zip_lookup", outcome: `http_${res.status}` })); return off; }
    const parsed = ZipResponseSchema.safeParse(await res.json());
    if (!parsed.success) { console.warn(JSON.stringify({ event: "insurance_zip_lookup", outcome: "unexpected_shape" })); return off; }
    const counties = [...new Map(parsed.data.counties.map(c => [c.fips, withPlanYears(c.fips, c.name, c.state)])).values()];
    const source: InsuranceSource = { kind: "marketplace_api", label: "HealthCare.gov Marketplace API (counties by ZIP)", url: "https://marketplace.api.healthcare.gov/", sha256: null,
      dataVersion: null, sourceDate: new Date().toISOString().slice(0, 10) };
    value = counties.length === 0 ? { status: "not_available", reason: "No county was found for this ZIP code.", need: "Check the ZIP code or choose your state and county." }
      : counties.length === 1 ? { status: "single", counties: [counties[0]], source, notes: [] }
      : { status: "ambiguous", counties, source, notes: ["This ZIP code crosses county lines. Choose the county you live in; Headroom does not guess it."] };
  } catch (e) {
    console.warn(JSON.stringify({ event: "insurance_zip_lookup", outcome: e instanceof Error ? e.name : "error" }));
    return off;
  }
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(zip, { at: Date.now(), value });
  return value;
}
