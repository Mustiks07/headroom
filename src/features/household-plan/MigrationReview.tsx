"use client";

import { useMemo, useState } from "react";
import type { SavedPlan } from "@/domain/contracts";
import { confirmV1Migration, previewV1Migration, type ExistingSepAnswer, type V1MigrationPreview } from "@/lib/client/api";
import { humanizeDates, money, shortDate } from "@/features/format";
import { personName } from "@/features/household/draft";
import { AmountInput, parseAmount } from "./parts";
import { workspaceRepo } from "./store";

type SepDraft = { kind: "paid" | "planned" | "unknown" | ""; amount: string; date: string };

/**
 * Converting an earlier single-project plan: shows what moves over and asks what really happened.
 * Old "done" marks and planned SEP amounts are never turned into payments without an amount and date.
 */
export function MigrationReview({ plan, source, onCancel, onDone }: {
  plan: SavedPlan; source: V1MigrationPreview["source"]; onCancel: () => void; onDone: (workspaceId: string) => void;
}) {
  const preview = useMemo(() => { try { return { ok: true as const, p: previewV1Migration(plan, source) }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; } }, [plan, source]);
  const [status, setStatus] = useState<"agreed" | "proposed">("agreed");
  const [sep, setSep] = useState<Record<string, SepDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!preview.ok) return <div className="notice warn" role="alert">{preview.error} <button type="button" className="link-btn" onClick={onCancel}>Close</button></div>;
  const p = preview.p;
  const sepQs = p.questions.filter(q => q.kind === "existing_sep");

  function answers(): Record<string, ExistingSepAnswer> | string {
    const out: Record<string, ExistingSepAnswer> = {};
    for (const q of sepQs) {
      const a = sep[q.id];
      if (!a?.kind) return "Answer what happened to each SEP-IRA amount.";
      if (a.kind === "paid") {
        const amt = parseAmount(a.amount);
        if (amt.error || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return "For a contribution that was paid, enter the amount and the date it was paid.";
        out[q.id] = { kind: "paid", amountCents: amt.cents!, paidDate: a.date };
      } else out[q.id] = { kind: a.kind };
    }
    return out;
  }

  async function confirm() {
    const a = answers();
    if (typeof a === "string") { setError(a); return; }
    setBusy(true); setError(null);
    try {
      const ws = confirmV1Migration(plan, p, { projectStatus: status, existingSep: a });
      const saved = await workspaceRepo().save(ws, null, { legacySnapshot: plan });
      onDone(saved.id);
    } catch (e) { setError(`Nothing was converted: ${e instanceof Error ? e.message : String(e)}`); setBusy(false); }
  }

  return <section className="plan-section changed" aria-labelledby="mig-title">
    <h2 id="mig-title" className="section-title small">Convert “{plan.input.opportunity.title}” into a household plan</h2>
    <p className="muted small">Nothing is saved until you confirm. The original plan stays available.</p>
    <h3 className="small-head">Your profit forecast becomes</h3>
    <ul className="bullets small">{p.baseline.map(b => <li key={`${b.personId}${b.year}`}>{b.year} · {personName(plan.input, b.personId)}: {b.profit.valueCents === null ? "unknown" : money(b.profit.valueCents)}{b.profit.status === "estimated" ? " (estimate)" : ""} — a whole-year estimate that leaves out the project</li>)}</ul>
    {p.opportunity && <>
      <h3 className="small-head">The project</h3>
      <p className="small">{p.opportunity.title}: {humanizeDates(p.opportunity.chosenLabel)}. Payments: {p.opportunity.receipts.map(r => `${money(r.amountCents)} on ${shortDate(r.date)}`).join(", ") || "none"}.</p>
      <fieldset className="tri"><legend className="field-label">Is it agreed with the client?</legend>
        <div className="seg small">{(["agreed", "proposed"] as const).map(v => <label key={v} className={status === v ? "on" : ""}><input type="radio" name="mig-status" checked={status === v} onChange={() => setStatus(v)} />{v === "agreed" ? "Yes, agreed" : "Still only an offer"}</label>)}</div></fieldset>
    </>}
    {sepQs.map(q => { const a = sep[q.id] ?? { kind: "", amount: "", date: "" };
      const set = (patch: Partial<SepDraft>) => setSep(s => ({ ...s, [q.id]: { ...a, ...patch } }));
      return <fieldset key={q.id} className="tri"><legend className="field-label">{q.text}{q.amountCents ? ` (${money(q.amountCents)} in the old plan)` : ""}</legend>
        <div className="seg small">{([["paid", "It was paid"], ["planned", "Only planned"], ["unknown", "I don't know"]] as const).map(([v, t]) =>
          <label key={v} className={a.kind === v ? "on" : ""}><input type="radio" name={`mig-${q.id}`} checked={a.kind === v} onChange={() => set({ kind: v })} />{t}</label>)}</div>
        {a.kind === "paid" && <div className="grid-2"><AmountInput id={`mig-amt-${q.id}`} label="Amount actually contributed" value={a.amount} onChange={v => set({ amount: v })} />
          <div className="field"><label className="field-label" htmlFor={`mig-date-${q.id}`}>Date paid</label><input id={`mig-date-${q.id}`} type="date" value={a.date} onChange={e => set({ date: e.target.value })} /></div></div>}
        {a.kind && a.kind !== "paid" && <p className="hint">Kept as a yearly goal, not as money contributed.</p>}
      </fieldset>; })}
    {p.completedActions.length > 0 && <div className="notice warn small"><strong>Earlier “done” marks</strong> are kept for you to confirm — they are not treated as payments:
      <ul className="bullets small">{p.completedActions.map(c => <li key={c.id}>{humanizeDates(c.title)}</li>)}</ul></div>}
    {p.warnings.length > 0 && <ul className="warnings">{p.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="row gap"><button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Converting…" : "Convert and save"}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
  </section>;
}
