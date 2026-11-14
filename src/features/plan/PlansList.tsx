"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileUp, Trash2 } from "lucide-react";
import type { CaseInput, SavedPlan } from "@/domain/contracts";
import { analyzePlanFile, PartialClearError, planFromAnalysis, type RestoreAnalysis } from "@/lib/client/api";
import { dateTime, signClass, signedMoney } from "@/features/format";
import { deltaVs } from "@/features/results/ComparisonView";
import {
  clearBrowserDrafts, describeStorageError, detectStorageMode, planRepository, stashInputForCalculator,
  type StorageMode,
} from "./storage";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plans: SavedPlan[] };
type ImportState = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string; input?: CaseInput }
  | { kind: "choose"; analysis: Extract<RestoreAnalysis, { status: "ready" }>; choice: string | null };

export function PlansList({ deleted }: { deleted: boolean }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [mode, setMode] = useState<StorageMode>("unknown");
  const [notice, setNotice] = useState<string | null>(deleted ? "Deleted." : null);
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const [cloudProblem, setCloudProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const plans = await planRepository().list();
      setLoad({ kind: "ready", plans: [...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      setCloudProblem(planRepository().cloudProblem());
    } catch (e) { setLoad({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }, []);
  useEffect(() => { void reload(); void detectStorageMode().then(setMode); }, [reload]);

  async function remove(plan: SavedPlan) {
    if (!window.confirm(`Delete “${plan.input.opportunity.title}” and its history?`)) return;
    try { await planRepository().remove(plan.id); setNotice("Plan deleted."); await reload(); }
    catch (e) { setNotice(`The plan couldn't be deleted: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function clearAll() {
    if (!window.confirm("Delete all Headroom plans, history and entered figures saved for this browser?")) return;
    clearBrowserDrafts();
    try { await planRepository().clear(); setNotice("Your Headroom data was cleared."); await reload(); }
    catch (e) {
      setNotice(e instanceof PartialClearError ? e.message : `Figures entered in this browser were cleared, but saved plans couldn't be: ${e instanceof Error ? e.message : String(e)}`);
      await reload();
    }
  }

  /** Restores from JSON: validates, recalculates with the current engine, never trusts stored numbers (Claude 3 seam). */
  async function onImport(file: File | undefined) {
    if (!file) return;
    setImp({ kind: "working" });
    try {
      const analysis = await analyzePlanFile(await file.text());
      if (analysis.status === "invalid") { setImp({ kind: "error", message: analysis.message }); return; }
      if (analysis.status === "blocked") { setImp({ kind: "error", input: analysis.input, message: analysis.message }); return; }
      if (analysis.feasibleOptions.length === 0) { setImp({ kind: "error", input: analysis.input, message: "The data was recalculated, but no option fits its limits. Open it in the calculator to adjust." }); return; }
      if (analysis.suggestedScenarioId && analysis.notes.length === 0) { await restore(analysis, analysis.suggestedScenarioId); return; }
      setImp({ kind: "choose", analysis, choice: analysis.suggestedScenarioId });
    } catch (e) {
      setImp({ kind: "error", message: describeStorageError(e) });
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function restore(analysis: Extract<RestoreAnalysis, { status: "ready" }>, choice: string) {
    setImp({ kind: "working" });
    try {
      const saved = await planRepository().save(planFromAnalysis(analysis, choice), null);
      router.push(`/plan/${encodeURIComponent(saved.id)}?saved=1`);
    } catch (e) {
      setImp({ kind: "error", input: analysis.input, message: describeStorageError(e) });
    }
  }

  return <div className="shell page-pad">
    <p className="eyebrow">My plans</p>
    <h1 className="page-title">Your saved plans</h1>
    <p className="small">Looking for your household plan with several projects and payments? <Link className="text-link" href="/household">Household plans</Link>.</p>
    <p className="muted">{mode === "cloud" ? "Plans are kept in a private guest session for this browser." : mode === "local" ? "Plans are kept in this browser." : "Plans are saved for this browser."} They aren&apos;t synced to other devices — download a plan&apos;s JSON file to move it.</p>
    {notice && <p className="notice" role="status">{notice}</p>}
    {cloudProblem && <p className="notice warn" role="status">{cloudProblem}</p>}

    {load.kind === "loading" && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Loading…</p>}
    {load.kind === "error" && <div className="notice warn" role="alert"><strong>Saved plans couldn&apos;t be loaded.</strong> {load.message}
      <div className="row gap"><button type="button" className="btn small secondary" onClick={() => { setLoad({ kind: "loading" }); void reload(); }}>Try again</button></div></div>}
    {load.kind === "ready" && load.plans.length === 0 && <div className="empty-state">
      <h2>No saved plans yet</h2>
      <p className="muted">Check your subsidy or try a sample household, compare options, then choose <strong>Use this plan</strong>.</p>
      <div className="row gap wrap"><Link href="/check" className="btn primary">Check my subsidy</Link><Link href="/demo" className="btn ghost">Try a sample household</Link></div>
    </div>}
    {load.kind === "ready" && load.plans.length > 0 && <ul className="plan-list">
      {load.plans.map(p => {
        const chosen = p.comparison.scenarios.find(s => s.id === p.chosenScenarioId);
        const base = p.comparison.scenarios.find(s => s.id === p.comparison.baselineScenarioId);
        const d = chosen && base && chosen.id !== base.id ? deltaVs(chosen, base).cash : null;
        return <li key={p.id}>
          <Link href={`/plan/${encodeURIComponent(p.id)}`} className="plan-link">
            <span className="plan-title">{p.input.opportunity.title}{p.input.isSynthetic && <span className="pill neutral small-pill">Sample</span>}
              {mode === "cloud" && planRepository().locationOf(p.id) === "local" && <span className="pill neutral small-pill">This browser only</span>}</span>
            <span className="muted small">{chosen?.label ?? "Option missing"} · revision {p.revision} · updated {dateTime(p.updatedAt)}</span>
            {d !== null && <span className={`num ${signClass(d)}`}>{signedMoney(d)} <span className="muted small">cash after settlements</span></span>}
            <ArrowRight size={16} aria-hidden="true" className="go-icon" />
          </Link>
          <button type="button" className="icon-btn" aria-label={`Delete ${p.input.opportunity.title}`} onClick={() => remove(p)}><Trash2 size={16} /></button>
        </li>;
      })}
    </ul>}
    {mode !== "unknown" && load.kind === "ready" && <p className="save-status small"><span className="dot" aria-hidden="true" />{mode === "cloud" ? "Cloud guest session active." : "Browser storage active."}</p>}

    <section className="plan-section" aria-labelledby="restore-title">
      <h2 id="restore-title" className="section-title small">Restore from a JSON file</h2>
      <p className="muted small">Use a file downloaded from a Headroom plan. Headroom recalculates it with the current rules instead of trusting the stored numbers.</p>
      <label className="btn secondary small file-btn"><FileUp size={16} /> Choose a JSON file
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={e => onImport(e.target.files?.[0])} disabled={imp.kind === "working"} /></label>
      {imp.kind === "working" && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Reading and recalculating…</p>}
      {imp.kind === "choose" && <div className="notice" role="group" aria-labelledby="restore-choose">
        <p id="restore-choose"><strong>Check the restored plan before saving it</strong></p>
        {imp.analysis.notes.length > 0 && <ul className="bullets small">{imp.analysis.notes.map(n => <li key={n}>{n}</li>)}</ul>}
        <fieldset className="option-list"><legend className="small"><strong>Option for the restored plan</strong></legend>
          {imp.analysis.feasibleOptions.map(o => <label key={o.id} className={`option-row ${imp.choice === o.id ? "on" : ""}`}>
            <input type="radio" name="restore-choice" checked={imp.choice === o.id} onChange={() => setImp({ ...imp, choice: o.id })} />
            <span className="option-label">{o.label}</span>
            <span className="muted small">{[o.id === imp.analysis.suggestedScenarioId ? "from the file" : "", o.recommended ? "recommended" : ""].filter(Boolean).join(" · ")}</span></label>)}
        </fieldset>
        <div className="row gap wrap">
          <button type="button" className="btn small primary" disabled={!imp.choice} onClick={() => imp.choice && restore(imp.analysis, imp.choice)}>Save restored plan</button>
          <button type="button" className="btn small ghost" onClick={() => setImp({ kind: "idle" })}>Cancel</button>
        </div>
      </div>}
      {imp.kind === "error" && <div className="notice warn" role="alert">{imp.message}
        {imp.input && <div className="row gap"><button type="button" className="btn small secondary" onClick={() => { stashInputForCalculator(imp.input!); router.push("/check"); }}>Open the data in the calculator</button></div>}
      </div>}
    </section>

    <section className="plan-section danger" aria-labelledby="clear-title">
      <h2 id="clear-title" className="section-title small">Clear my data</h2>
      <p className="muted small">Deletes saved plans, their history and any figures you typed in this browser.</p>
      <button type="button" className="btn ghost small" onClick={clearAll}><Trash2 size={15} /> Clear my data</button>
    </section>
  </div>;
}
