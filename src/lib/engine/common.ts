/** Helpers shared by the v1 and household entry points (no entry points here, to avoid import cycles). */
import type { BlockedComparison, CaseInput } from "@/domain/contracts";
import type { EngineStop, YearModel } from "./model";
import { ENGINE_VERSION, RULES_VERSION } from "./rules";

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** SHA-256 of canonical key-sorted input + engine version + rules version. */
export async function calculationFingerprint(input: CaseInput): Promise<string> {
  return sha256Hex(JSON.stringify({ input: canonical(input), engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION }));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function stopToBlocked(e: EngineStop, path = ""): BlockedComparison {
  // A baseline that is itself infeasible (e.g. existing SEP above the legal limit) is a data problem.
  return { status: e.kind === "unsupported" ? "unsupported" : "needs_data", code: e.code, message: e.message,
    fields: [{ path: e.path || path, reason: e.message }] };
}

export function modelWarnings(models: YearModel[], input: CaseInput): string[] {
  const w: string[] = [];
  if (input.isSynthetic) w.push("Synthetic example household: amounts are illustrative, not a real customer's results.");
  for (const m of models) {
    if (m.benchmarkStatus === "county_candidate") w.push(`${m.year} benchmark is a county-level candidate, not a confirmed benchmark for your exact address and family.`);
    if (m.benchmarkStatus === "illustrative") w.push(`${m.year} benchmark premium is illustrative.`);
    if (m.rules.applicableFigureMethod === "official-table") w.push(`${m.year} applicable figures come from the DRAFT 2026 Form 8962 instructions.`);
    else w.push(`${m.year} applicable figures are derived from Rev. Proc. 2026-26 bands (no published ${m.year} Form 8962 table yet).`);
    if (!m.ptcEligible) w.push(`${m.year}: no premium tax credit eligibility was confirmed, so any advance credit is fully repaid.`);
  }
  w.push("Assumes required SSNs, lawful presence, Marketplace enrollment and no other coverage offers as confirmed in your entries; not a Marketplace eligibility determination.");
  return [...new Set(w)];
}

