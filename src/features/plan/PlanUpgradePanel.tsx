"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SavedPlan } from "@/domain/contracts";
import { checkPlanCurrency, confirmPlanUpgrade, previewPlanUpgrade, type PlanCurrency, type PlanUpgradePreview } from "@/lib/client/api";
import { moneyExact as money } from "@/features/format";
import { describeStorageError, planRepository } from "./storage";
import { AgreedPlanImpact } from "./AgreedPlanImpact";

type Ready = Extract<PlanUpgradePreview, { status: "ready" }>;

/**
 * Claude 3 seam: a saved plan calculated with an older engine/rule pack (or whose stored result no
 * longer matches its inputs) must be reviewed before it is used or exported. The old revision is
 * kept in history; the previous option is never replaced without the user's choice.
 */
export function PlanUpgradePanel({ plan, onStatus, onUpgraded }: {
  plan: SavedPlan; onStatus: (outdated: boolean) => void; onUpgraded: (historyWarning?: string) => Promise<void>;
}) {
  const [currency, setCurrency] = useState<PlanCurrency | null>(null);
  const [preview, setPreview] = useState<PlanUpgradePreview | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null); setError(null);
    void checkPlanCurrency(plan).then(c => { if (live) { setCurrency(c); onStatus(c.status !== "current"); } });
    return () => { live = false; };
  }, [plan, onStatus]);

  if (!currency || currency.status === "current") return null;

  async function review() {
    setBusy(true); setError(null);
    try {
      const p = await previewPlanUpgrade(plan);
      setPreview(p);
      setChoice(p.status === "ready" ? p.suggestedScenarioId : null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  async function confirm(p: Ready) {
    if (!choice) return;
    setBusy(true); setError(null);
    try {
      const saved = await confirmPlanUpgrade(planRepository(), plan, p, choice);
      await onUpgraded(saved.historyWarning);
    }
    catch (e) { setError(describeStorageError(e)); setBusy(false); }
  }

  const why = currency.status === "outdated_rules"
    ? `This plan was calculated with ${currency.saved.engineVersion} / ${currency.saved.rulesVersion}. Headroom now uses ${currency.current.engineVersion} / ${currency.current.rulesVersion}.`
    : "The figures stored in this plan don't match its inputs, so they can't be used as the current result.";

  return <section className="notice warn" aria-labelledby="upgrade-title">
    <h2 id="upgrade-title" className="small-head"><RefreshCw size={16} aria-hidden="true" /> Review the updated calculation</h2>
    <p className="small">{why} The saved figures below are kept for reference, but PDF export is paused until you review the recalculated plan. Your current version stays in the plan history.</p>
    {!preview && <button type="button" className="btn small primary" disabled={busy} onClick={review}>{busy ? "Recalculating…" : "Recalculate and compare"}</button>}
    {preview?.status === "blocked" && <p className="small"><strong>The current rules can&apos;t calculate this plan as entered:</strong> {preview.result.message} Use “Something changed” to add or correct the listed facts.</p>}
    {preview?.status === "ready" && <div className="upgrade-review">
      {preview.sameOption
        ? !preview.sameOption.feasible && <p className="small"><strong>Your option “{preview.previousChoice.label}” is no longer available:</strong> {preview.sameOption.reasons.join(" ") || "it is outside your limits now."}</p>
        : <p className="small"><strong>Your option “{preview.previousChoice.label}” isn&apos;t offered by the updated calculation.</strong></p>}
      <AgreedPlanImpact evaluation={preview.agreedEvaluation} />
      <p className="small"><strong>Newly calculated option:</strong> review its amounts and dates before replacing your saved plan.</p>
      <div className="table-wrap"><table className="years-table compact">
        <thead><tr><th scope="col">For “{preview.previousChoice.label}”</th><th scope="col">Saved</th><th scope="col">Updated</th></tr></thead>
        <tbody>{preview.figures.map(f => <tr key={f.label}><th scope="row">{f.label}</th>
          <td className="num">{f.beforeCents === null ? "—" : money(f.beforeCents)}</td>
          <td className="num">{f.afterCents === null ? "—" : money(f.afterCents)}</td></tr>)}</tbody>
      </table></div>
      {preview.completedDropped.length > 0 && <p className="small">These completed actions changed or no longer exist and need review: {preview.completedDropped.map(a => a.title).join("; ")}. Their original confirmation remains in the saved revision.</p>}
      {preview.newActions.length > 0 && <p className="small">New or changed actions: {preview.newActions.map(a => `${a.title}${a.dueDate ? ` (by ${a.dueDate})` : ""}`).join("; ")}.</p>}
      <fieldset className="option-list">
        <legend className="small"><strong>Option to keep in your plan</strong></legend>
        {preview.feasibleOptions.length === 0 && <p>No option fits your limits under the updated rules. Keep the saved version or change a limit with “Something changed”.</p>}
        {preview.feasibleOptions.map(o => <label key={o.id} className={`option-row ${choice === o.id ? "on" : ""}`}>
          <input type="radio" name="upgrade-choice" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
          <span className="option-label">{o.label}</span>
          <span className="muted small">{[o.id === preview.suggestedScenarioId ? "your current option" : "", o.recommended ? "recommended" : ""].filter(Boolean).join(" · ")}</span>
        </label>)}
      </fieldset>
      <div className="row gap wrap">
        <button type="button" className="btn small primary" disabled={busy || !choice} onClick={() => confirm(preview)}>{busy ? "Saving…" : "Use the updated plan"}</button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => setPreview(null)}>Keep the saved version for now</button>
      </div>
    </div>}
    {error && <p className="hint warn" role="alert">{error}</p>}
  </section>;
}
