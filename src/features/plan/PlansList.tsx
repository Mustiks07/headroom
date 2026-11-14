"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileUp, Trash2 } from "lucide-react";
import type { CaseInput, SavedPlan } from "@/domain/contracts";
import { calculateComparison } from "@/lib/engine";
import { dateTime, signClass, signedMoney } from "@/features/format";
import { deltaVs } from "@/features/results/ComparisonView";
import {
  clearBrowserDrafts, describeStorageError, detectStorageMode, planRepository, readHeadroomFile, saveNewPlan, stashInputForCalculator,
  type StorageMode,
} from "./storage";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plans: SavedPlan[] };
type ImportState = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string; input?: CaseInput };

export function PlansList({ deleted }: { deleted: boolean }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [mode, setMode] = useState<StorageMode>("unknown");
  const [notice, setNotice] = useState<string | null>(deleted ? "Deleted." : null);
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const plans = await planRepository().list();
      setLoad({ kind: "ready", plans: [...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
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
    catch (e) { setNotice(`Figures entered in this browser were cleared, but saved plans couldn't be: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** Restores from JSON: validates the input, recalculates, never trusts stored numbers. */
  async function onImport(file: File | undefined) {
    if (!file) return;
    setImp({ kind: "working" });
    try {
      const parsed = readHeadroomFile(await file.text());
      if (!parsed.ok) { setImp({ kind: "error", message: parsed.message }); return; }
      const result = await calculateComparison(parsed.input);
      if (result.status !== "ready") {
        setImp({ kind: "error", input: parsed.input, message: result.status === "unavailable" ? `The calculation isn't available right now: ${result.message}`
          : `The data was read, but it can't be calculated as is: ${result.message}` });
        return;
      }
      const chosen = result.scenarios.find(s => s.id === parsed.chosenScenarioId && s.feasible)?.id ?? result.recommendedScenarioId;
      if (!chosen) { setImp({ kind: "error", input: parsed.input, message: "The data was recalculated, but no option fits its limits. Open it in the calculator to adjust." }); return; }
      const saved = await saveNewPlan(parsed.input, result, chosen);
      router.push(`/plan/${encodeURIComponent(saved.id)}?saved=1`);
    } catch (e) {
      setImp({ kind: "error", message: describeStorageError(e) });
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return <div className="shell page-pad">
    <p className="eyebrow">My plans</p>
    <h1 className="page-title">Your saved plans</h1>
    <p className="muted">{mode === "cloud" ? "Plans are kept in a private guest session for this browser." : mode === "local" ? "Plans are kept in this browser." : "Plans are saved for this browser."} They aren&apos;t synced to other devices — download a plan&apos;s JSON file to move it.</p>
    {notice && <p className="notice" role="status">{notice}</p>}

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
            <span className="plan-title">{p.input.opportunity.title}{p.input.isSynthetic && <span className="pill neutral small-pill">Sample</span>}</span>
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
