"use client";

import { useState } from "react";
import type { BenchmarkLookup } from "@/domain/insurance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { lookupBenchmark } from "@/lib/client/api";
import { money, shortDate } from "@/features/format";
import { CountyPicker } from "./CountyPicker";

/**
 * "Help me find this" for the benchmark premium (second-lowest-cost Silver). Explains where the
 * figure is on the Marketplace notice, and can look up Claude 3's county candidate from the bundled
 * CMS extract. A county candidate is never shown as the confirmed benchmark; using it is a choice.
 */
export function BenchmarkHelp({ ws, year, onUse, onSaveCounty }: { ws: HouseholdWorkspace; year: 2026 | 2027;
  onUse: (monthlyCents: number, status: "marketplace_confirmed" | "county_candidate", label: string) => Promise<boolean>;
  /** Saves the chosen county on the plan (one revision). */
  onSaveCounty: (fips: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<BenchmarkLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function look() {
    setBusy(true); setError(null);
    try { setR(await lookupBenchmark(ws, year)); } catch (e) { setError(`The lookup isn't available right now: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  }
  return <div className="bench-help">
    <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>Help me find this</button>
    {open && <div className="bench-body">
      <p className="small">On your {year} Marketplace eligibility notice or HealthCare.gov plan summary, look for <strong>“second lowest cost silver plan (SLCSP)”</strong> or <strong>“benchmark plan”</strong>. It is not your own plan&apos;s premium and not the advance credit paid to your insurer. Form 1095-A column B shows it only after the year ends.</p>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void look()}>{busy ? "Looking up…" : `Look up a county estimate for ${year}`}</button>
      {error && <p className="hint warn" role="status">{error}</p>}
      {r?.status === "not_available" && <p className="notice warn small" role="status">{r.reason} {r.need}</p>}
      {!ws.household.countyFips && <div className="field"><label className="field-label" htmlFor={`bench-county-${year}`}>Your county</label>
        <CountyPicker id={`bench-county-${year}`} state={ws.household.state} countyFips={null} onChange={fips => { if (fips) void onSaveCounty(fips).then(ok => { if (ok) setR(null); }); }} /></div>}
      {r && r.status !== "not_available" && <div className="bench-result" role="status">
        <p><strong className="num">{money(r.status === "confirmed" ? r.monthlyCents[0] : r.monthlyCents)}</strong> a month
          {r.status === "county_candidate" ? <> — county estimate for {r.county}: {r.planName}, the second-lowest Silver among {r.plansCompared} plans for your household&apos;s ages.</> : <> — from your own document.</>}</p>
        {r.status === "county_candidate" && <p className="hint warn">A candidate for your county, not the exact benchmark for your address and family. Your notice wins if you have it.</p>}
        <p className="hint">Source: {r.source.label}{r.source.dataVersion ? ` · ${r.source.dataVersion}` : ""}{r.source.sourceDate ? ` · retrieved ${shortDate(r.source.sourceDate)}` : ""}{r.notes.length ? ` · ${r.notes.join(" ")}` : ""}</p>
        <button type="button" className="btn small secondary" onClick={() => void onUse(r.status === "confirmed" ? r.monthlyCents[0] : r.monthlyCents,
          r.status === "confirmed" ? "marketplace_confirmed" : "county_candidate", r.status === "confirmed" ? "benchmark from your document" : `county estimate for ${r.county}`)}>
          {r.status === "county_candidate" ? "Use as a county estimate" : "Use this figure"}</button>
      </div>}
    </div>}
  </div>;
}
