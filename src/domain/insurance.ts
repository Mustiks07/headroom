/**
 * Insurance data assistance — round 5 additive contract (capability 8).
 *
 * Location → county candidates, and plan year → benchmark (second-lowest-cost Silver) lookup with
 * an explicit certainty. Never "found" with an average, another year's figure or a county guessed
 * from a ZIP that crosses county lines.
 *
 *  - confirmed: the user's own Marketplace notice / plan document for THAT year;
 *  - county_candidate: computed from an official CMS plan-year county extract bundled in the build
 *    (sha256 + source date) — a candidate for the county, NOT the exact benchmark for the address;
 *  - ambiguous: the location matches several counties; the user picks one;
 *  - not_available: no data for the county/year/ages, or the lookup service is off — with what to enter.
 *
 * Only the ZIP (location lookup) or the workspace already held by the user's browser is sent to
 * Headroom; Headroom calls only fixed official endpoints, never an LLM-chosen URL, and never sends
 * income or names. Ownership: schema/API — Claude 3; benchmark figures — Claude 2's resolver; picker UI — Claude 1.
 */
import { z } from "zod";
import { TaxYearSchema } from "./contracts";

export const InsuranceSourceSchema = z.object({
  kind: z.enum(["user_document", "cms_county_extract", "marketplace_api", "bundled_county_list"]),
  label: z.string().max(200),
  url: z.string().url().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** Plan year / data version of the source. */
  dataVersion: z.string().max(60).nullable(),
  /** Date the source file was retrieved or the API answered (YYYY-MM-DD). */
  sourceDate: z.string().date().nullable(),
});

export const CountyCandidateSchema = z.object({
  countyFips: z.string().regex(/^\d{5}$/), name: z.string().max(120), state: z.string().length(2),
  /** Plan years for which this build has county plan data (empty = enter the benchmark from the notice). */
  planDataYears: z.array(TaxYearSchema).max(2),
});

/** GET /api/insurance/location?zip=37203 | ?state=TN&q=davidson */
export type LocationLookup =
  | { status: "single"; counties: [z.infer<typeof CountyCandidateSchema>]; source: z.infer<typeof InsuranceSourceSchema>; notes: string[] }
  | { status: "ambiguous"; counties: Array<z.infer<typeof CountyCandidateSchema>>; source: z.infer<typeof InsuranceSourceSchema>; notes: string[] }
  | { status: "not_available"; reason: string; need: string };

/** POST /api/insurance/benchmark { workspace, year } */
export type BenchmarkLookup =
  | { status: "confirmed"; year: 2026 | 2027; monthlyCents: number[]; annualCents: number; source: z.infer<typeof InsuranceSourceSchema>; notes: string[] }
  | { status: "county_candidate"; year: 2026 | 2027; countyFips: string; county: string; planId: string; planName: string; plansCompared: number;
      monthlyCents: number; annualCents: number; members: Array<{ personId: string; age: number; monthlyCents: number; charged: boolean }>;
      source: z.infer<typeof InsuranceSourceSchema>; notes: string[] }
  | { status: "not_available"; year: 2026 | 2027; reason: string; need: string };

export const BenchmarkLookupBodySchema = z.object({ workspace: z.unknown(), year: TaxYearSchema });
export const LocationQuerySchema = z.union([
  z.object({ zip: z.string().regex(/^\d{5}$/) }),
  z.object({ state: z.string().regex(/^[A-Z]{2}$/), q: z.string().min(2).max(60) }),
]);

export type InsuranceSource = z.infer<typeof InsuranceSourceSchema>;
export type CountyCandidate = z.infer<typeof CountyCandidateSchema>;
