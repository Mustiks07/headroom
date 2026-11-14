"use client";

import { useState } from "react";
import type { CountyCandidate } from "@/domain/insurance";
import { lookupLocation } from "@/lib/client/api";

/**
 * County by name or ZIP (Claude 3's /api/insurance/location). The 5-digit county code is kept
 * internally; the person never has to know it. A ZIP that crosses county lines asks which county.
 */
export function CountyPicker({ id, state, countyFips, onChange }: { id: string; state: string | null; countyFips: string | null; onChange: (fips: string | null) => void }) {
  const [q, setQ] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<CountyCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function find() {
    const text = q.trim();
    if (!text) { setMessage("Type your county name or 5-digit ZIP."); return; }
    const zip = /^\d{5}$/.test(text);
    if (!zip && !state) { setMessage("Choose your state first, or type your ZIP."); return; }
    setBusy(true); setMessage(null); setFound(null);
    try {
      const r = await lookupLocation(zip ? { zip: text } : { state: state!, q: text });
      if (r.status === "not_available") setMessage(`${r.reason} ${r.need}`.trim());
      else if (r.status === "single") { pick(r.counties[0]); setMessage(r.notes.join(" ") || null); }
      else { setFound(r.counties); setMessage(r.notes.join(" ") || "Several counties match. Choose yours."); }
    } catch (e) { setMessage(`The county lookup isn't available right now: ${e instanceof Error ? e.message : String(e)}. You can leave the county empty.`); }
    setBusy(false);
  }
  function pick(c: CountyCandidate) { onChange(c.countyFips); setName(`${c.name}, ${c.state}`); setFound(null); setQ(""); }
  return <div className="county-picker">
    {countyFips && <p className="small"><strong>{name ?? "County selected"}</strong>{" "}
      <button type="button" className="link-btn" onClick={() => { onChange(null); setName(null); }}>Change</button></p>}
    {!countyFips && <div className="row gap">
      <input id={id} value={q} placeholder="County name or ZIP, e.g. Davidson" onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} aria-describedby={`${id}-hint`} />
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void find()}>{busy ? "Finding…" : "Find"}</button>
    </div>}
    {found && <div className="seg small" role="radiogroup" aria-label="Choose your county">{found.map(c =>
      <label key={c.countyFips}><input type="radio" name={`${id}-pick`} onChange={() => pick(c)} />{c.name}, {c.state}</label>)}</div>}
    {message && <p className="hint" role="status">{message}</p>}
    <p className="hint" id={`${id}-hint`}>Optional. Used to look up a county estimate of the benchmark plan when you don&apos;t have your Marketplace notice.</p>
  </div>;
}
