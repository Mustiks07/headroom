"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Download, FileJson, FileSearch, FlaskConical, History, Mail, RefreshCw, Trash2 } from "lucide-react";
import type { ComparisonResult, PlanEvent, ReadyComparison, SavedPlan, ScenarioResult } from "@/domain/contracts";
import { resolveSource } from "@/domain/sources";
import { calculateComparison } from "@/lib/engine";
import { exportPlanPdf } from "@/lib/client/api";
import { dateTime, money, shortDate, shortFingerprint, signClass, signedMoney } from "@/features/format";
import { adults, buildCaseInput, draftFromCase, fieldId, invalidProblems, normalizePath, personName, pruneInvalid, type Draft } from "@/features/household/draft";
import { InvalidInputsProvider } from "@/features/household/invalidInputs";
import { CoverageEditor, IncomeEditor, type Update } from "@/features/household/editors";
import { ProjectEditor } from "@/features/household/projectEditors";
import { BlockedResult, ErrorNotice, ProblemsList } from "@/features/results/BlockedResult";
import { CalculationDrawer, type DrawerContent } from "@/features/results/CalculationDrawer";
import { ComparisonView, baselineLabel, deltaVs, scenarioTrace } from "@/features/results/ComparisonView";
import { diffInputs } from "./diff";
import {
  clearBrowserDrafts, describeStorageError, detectStorageMode, downloadBlob, downloadJson, eventId, fileStamp, planFile, planRepository,
  storageText, type StorageMode,
} from "./storage";

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ready"; plan: SavedPlan; events: PlanEvent[]; eventsError?: string };

export function PlanView({ id, justSaved }: { id: string; justSaved: boolean }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [mode, setMode] = useState<StorageMode>("unknown");
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(justSaved ? { tone: "ok", text: "Plan saved." } : null);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(async () => {
    const repo = planRepository();
    try {
      const plan = await repo.get(id);
      if (!plan) { setLoad({ kind: "missing" }); return; }
      let events: PlanEvent[] = []; let eventsError: string | undefined;
      try { events = await repo.listEvents(id); } catch (e) { eventsError = e instanceof Error ? e.message : String(e); }
      setLoad({ kind: "ready", plan, events, eventsError });
    } catch (e) {
      setLoad({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [id]);

  useEffect(() => { void reload(); void detectStorageMode().then(setMode); }, [reload]);

  if (load.kind === "loading") return <div className="shell page-pad"><p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Opening your plan…</p></div>;
  if (load.kind === "missing") return <div className="shell page-pad"><h1 className="page-title">We couldn&apos;t find this plan</h1>
    <p className="intro">It may have been deleted, or it was saved in a different browser. Plans aren&apos;t synced between devices.</p>
    <div className="row gap"><Link className="btn primary" href="/plans">My plans</Link><Link className="btn ghost" href="/check">Check my subsidy</Link></div></div>;
  if (load.kind === "error") return <div className="shell page-pad"><h1 className="page-title">Your plan couldn&apos;t be opened</h1>
    <p className="notice warn" role="alert">{load.message}</p>
    <div className="row gap"><button type="button" className="btn secondary" onClick={() => { setLoad({ kind: "loading" }); void reload(); }}>Try again</button>
      <Link className="btn ghost" href="/plans">My plans</Link></div></div>;

  const { plan, events } = load;
  return <PlanReady plan={plan} events={events} eventsError={load.eventsError} mode={mode} notice={notice} setNotice={setNotice}
    editing={editing} setEditing={setEditing} showAll={showAll} setShowAll={setShowAll}
    onDrawer={setDrawer} onReload={reload} onDeleted={() => router.push("/plans?deleted=1")} drawer={drawer} />;
}

function PlanReady({ plan, events, eventsError, mode, notice, setNotice, editing, setEditing, showAll, setShowAll, onDrawer, onReload, onDeleted, drawer }: {
  plan: SavedPlan; events: PlanEvent[]; eventsError?: string; mode: StorageMode;
  notice: { tone: "ok" | "warn"; text: string } | null; setNotice: (n: { tone: "ok" | "warn"; text: string } | null) => void;
  editing: boolean; setEditing: (v: boolean) => void; showAll: boolean; setShowAll: (v: boolean) => void;
  onDrawer: (c: DrawerContent | null) => void; onReload: () => Promise<void>; onDeleted: () => void; drawer: DrawerContent | null;
}) {
  const c = plan.comparison;
  const chosen = c.scenarios.find(s => s.id === plan.chosenScenarioId);
  const base = c.scenarios.find(s => s.id === c.baselineScenarioId);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState(false);
  const repo = planRepository();

  async function persist(next: SavedPlan, event: Omit<PlanEvent, "id" | "planId" | "occurredAt"> | null, okText: string) {
    try {
      const saved = await repo.save({ ...next, updatedAt: new Date().toISOString() }, plan.revision);
      if (event) {
        try { await repo.appendEvent({ ...event, id: eventId(), planId: saved.id, occurredAt: new Date().toISOString() }); }
        catch (e) { setNotice({ tone: "warn", text: `Plan saved, but its history entry couldn't be recorded: ${e instanceof Error ? e.message : String(e)}` }); await onReload(); return true; }
      }
      setNotice({ tone: "ok", text: okText });
      await onReload();
      return true;
    } catch (e) {
      setNotice({ tone: "warn", text: describeStorageError(e) });
      return false;
    }
  }

  async function toggleAction(actionId: string, done: boolean) {
    setBusy(actionId);
    const action = chosen?.actions.find(a => a.id === actionId);
    const completed = done ? [...new Set([...plan.completedActionIds, actionId])] : plan.completedActionIds.filter(x => x !== actionId);
    await persist({ ...plan, completedActionIds: completed },
      done ? { kind: "action_confirmed", description: `Confirmed done: ${action?.title ?? actionId}`, previousFingerprint: c.calculationFingerprint, nextFingerprint: null } : null,
      done ? "Marked as done." : "Marked as not done.");
    setBusy(null); setConfirming(null);
  }

  async function switchScenario(scenarioId: string) {
    setBusy(scenarioId);
    const next = c.scenarios.find(s => s.id === scenarioId);
    const ok = await persist({ ...plan, chosenScenarioId: scenarioId, completedActionIds: plan.completedActionIds.filter(a => next?.actions.some(x => x.id === a)) }, null, `Your plan now uses “${next?.label}”.`);
    setBusy(null);
    if (ok) setShowAll(false);
  }

  async function exportPdf() {
    setBusy("pdf");
    try { downloadBlob(await exportPlanPdf(plan), `headroom-plan-${fileStamp()}.pdf`); setNotice({ tone: "ok", text: "PDF downloaded." }); }
    catch (e) { setNotice({ tone: "warn", text: `The PDF couldn't be created: ${e instanceof Error ? e.message : String(e)}. You can still download the JSON file.` }); }
    setBusy(null);
  }

  async function deletePlan() {
    if (!window.confirm("Delete this plan and its history? This can't be undone.")) return;
    try { await repo.remove(plan.id); onDeleted(); } catch (e) { setNotice({ tone: "warn", text: `The plan couldn't be deleted: ${e instanceof Error ? e.message : String(e)}` }); }
  }

  async function clearAll() {
    if (!window.confirm("Delete all Headroom plans, history and entered figures saved for this browser?")) return;
    try { await repo.clear(); clearBrowserDrafts(); onDeleted(); } catch (e) { setNotice({ tone: "warn", text: `Your data couldn't be cleared: ${e instanceof Error ? e.message : String(e)}` }); }
  }

  const title = plan.input.opportunity.title;
  const delta = chosen && base ? deltaVs(chosen, base) : null;
  const outdated = editing && pendingEdits;

  return <div className="shell plan-page">
    <div className="plan-head">
      <div>
        <p className="eyebrow">Your plan{plan.input.isSynthetic ? " · sample household" : ""}</p>
        <h1 className="page-title">{title}</h1>
        <p className="muted">{chosen ? <>Chosen option: <strong>{chosen.label}</strong></> : "The chosen option is missing from this saved result."}</p>
        <p className="save-status small"><span className="dot" aria-hidden="true" />{storageText(mode)} Revision {plan.revision} · updated {dateTime(plan.updatedAt)}</p>
      </div>
      <div className="plan-head-actions">
        <button type="button" className="btn primary" onClick={() => { setEditing(true); setTimeout(() => document.getElementById("changed")?.scrollIntoView({ behavior: "smooth" }), 30); }}><RefreshCw size={17} /> Something changed</button>
      </div>
    </div>
    {plan.input.isSynthetic && <p className="sample-banner small"><FlaskConical size={16} aria-hidden="true" /> Built from a synthetic sample household. Plan prices are county candidates or illustrative.</p>}
    {notice && <p className={`notice ${notice.tone === "warn" ? "warn" : "ok"}`} role={notice.tone === "warn" ? "alert" : "status"}>{notice.text}</p>}

    <section className={`plan-figures ${outdated ? "is-stale" : ""}`} aria-labelledby="figures-title">
      {outdated && <p className="stale-banner">These figures are from your saved plan (revision {plan.revision}). They don&apos;t include the changes you&apos;re making yet.</p>}
      <h2 id="figures-title" className="visually-hidden">Plan figures</h2>
      {chosen && base && delta ? <>
        <div className="figure-row">
          <div className="big-figure"><span className="k">Cash after tax-year settlements</span>
            <span className={`v num ${signClass(delta.cash)}`}>{chosen.id === base.id ? "Baseline" : signedMoney(delta.cash)}</span>
            <span className="muted small">{baselineLabel(base)} · 2026 + 2027</span></div>
          {chosen.grossAdditionalRetirementCents > 0 && <div className="big-figure retire"><span className="k">Moved into retirement savings</span>
            <span className="v num">{money(chosen.grossAdditionalRetirementCents)}</span><span className="muted small">Pre-tax; taxed when withdrawn. Not spendable cash.</span></div>}
        </div>
        <div className="table-wrap"><table className="years-table compact">
          <thead><tr><th scope="col">For this option</th>{chosen.years.map(y => <th scope="col" key={y.year}>{y.year}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Income counted for the subsidy</th>{chosen.years.map(y => <td key={y.year} className="num">{money(y.magiCents)}</td>)}</tr>
            <tr><th scope="row">Premium tax credit</th>{chosen.years.map(y => <td key={y.year} className="num">{money(y.ptcCents)}</td>)}</tr>
            <tr><th scope="row">Settlement when you file</th>{chosen.years.map(y => <td key={y.year} className="num">{y.aptcSettlementCents === 0 ? "None" : y.aptcSettlementCents > 0 ? `Repay ${money(y.aptcSettlementCents)}` : `Extra ${money(-y.aptcSettlementCents)}`}</td>)}</tr>
            <tr><th scope="row">Federal income tax</th>{chosen.years.map(y => <td key={y.year} className="num">{money(y.federalIncomeTaxCents)}</td>)}</tr>
            <tr><th scope="row">Self-employment tax</th>{chosen.years.map(y => <td key={y.year} className="num">{money(y.selfEmploymentTaxCents)}</td>)}</tr>
          </tbody></table></div>
        <div className="row gap wrap">
          <button type="button" className="btn ghost small" disabled={outdated} onClick={() => onDrawer(scenarioTrace(chosen, c, plan.input))}><FileSearch size={16} /> Show the calculation</button>
          <button type="button" className="btn ghost small" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Hide other options" : "Compare all options again"}</button>
        </div>
        {chosen.assumptions.length > 0 && <details className="explain"><summary>Conditions and assumptions</summary><ul className="bullets small">{chosen.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>}
      </> : <p className="notice warn">This saved plan doesn&apos;t contain its chosen option. Use “Something changed” to recalculate.</p>}
    </section>

    {showAll && <section className="plan-section"><ComparisonView comparison={c} input={plan.input} stale={outdated} onShowCalc={onDrawer}
      useLabel="Switch my plan to this" currentId={plan.chosenScenarioId}
      onUse={id => { if (id !== plan.chosenScenarioId) void switchScenario(id); }} busyScenarioId={busy && c.scenarios.some(s => s.id === busy) ? busy : null} /></section>}

    <div className="plan-grid">
      <section className="plan-section" aria-labelledby="todo-title">
        <h2 id="todo-title" className="section-title small">Your checklist</h2>
        {!chosen || chosen.actions.length === 0 ? <p className="muted">This option needs no special actions.</p> : <ul className="checklist">
          {[...chosen.actions].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).map(a => {
            const done = plan.completedActionIds.includes(a.id);
            return <li key={a.id} className={done ? "done" : ""}>
              {done ? <CheckCircle2 className="check-icon" size={20} aria-hidden="true" /> : <Circle className="check-icon" size={20} aria-hidden="true" />}
              <div className="check-body">
                <p className="check-title">{a.title}</p>
                <p className="muted small">{a.dueDate ? `Due ${shortDate(a.dueDate)}` : "No fixed date"}
                  {a.sourceIds.map(sid => { const source = resolveSource(plan.input, sid); return <span key={sid}> · {source?.url
                    ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source?.label ?? sid}</span>; })}
                </p>
                {confirming === a.id ? <div className="confirm-row" role="group" aria-label="Confirm this action">
                  <span className="small">Have you actually done this?</span>
                  <button type="button" className="btn small primary" disabled={busy === a.id} onClick={() => toggleAction(a.id, true)}>Yes, it&apos;s done</button>
                  <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
                </div> : done ? <button type="button" className="link-btn" disabled={busy === a.id} onClick={() => toggleAction(a.id, false)}>Mark as not done</button>
                  : <button type="button" className="btn small secondary" onClick={() => setConfirming(a.id)}>Mark as done</button>}
              </div>
            </li>;
          })}
        </ul>}
        <p className="hint">Headroom never sends messages or moves money. An action counts as done only when you confirm it.</p>
        {chosen && <ClientNote scenario={chosen} plan={plan} />}
      </section>

      <section className="plan-section" aria-labelledby="export-title">
        <h2 id="export-title" className="section-title small">Export</h2>
        <p className="muted small">For your accountant: inputs, sources, assumptions, both tax years, cash and retirement shown separately, and the calculation version.</p>
        <div className="stack-sm">
          <button type="button" className="btn secondary" disabled={outdated || busy === "pdf"} onClick={exportPdf}><Download size={16} /> {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</button>
          <button type="button" className="btn ghost" disabled={outdated} onClick={() => downloadJson(planFile(plan), `headroom-plan-${fileStamp()}.json`)}><FileJson size={16} /> Download JSON (restorable)</button>
          {outdated && <p className="hint">Save or discard your changes first, so the export matches the current result.</p>}
        </div>
        <dl className="meta-list small">
          <div><dt>Rules</dt><dd>{c.rulesVersion}</dd></div>
          <div><dt>Engine</dt><dd>{c.engineVersion}</dd></div>
          <div><dt>Fingerprint</dt><dd title={c.calculationFingerprint}>{shortFingerprint(c.calculationFingerprint)}</dd></div>
        </dl>
      </section>
    </div>

    {editing && <SomethingChanged plan={plan} onCancel={() => { setEditing(false); setPendingEdits(false); }} onDirty={setPendingEdits}
      onSaved={async (next, event) => {
        const ok = await persist(next, event, "Plan updated with your change.");
        if (ok) { setEditing(false); setPendingEdits(false); }
        return ok;
      }} onDrawer={onDrawer} />}

    <section className="plan-section" aria-labelledby="history-title">
      <h2 id="history-title" className="section-title small"><History size={18} aria-hidden="true" /> History</h2>
      {eventsError && <p className="notice warn">History couldn&apos;t be loaded: {eventsError}</p>}
      <ol className="history">
        {[...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(e => <li key={e.id}>
          <span className="muted small">{dateTime(e.occurredAt)}</span>
          <span><strong>{EVENT_LABEL[e.kind]}</strong> — {e.description}</span>
          {e.nextFingerprint && <span className="muted small">Recalculated · {shortFingerprint(e.previousFingerprint)} → {shortFingerprint(e.nextFingerprint)}</span>}
        </li>)}
        <li><span className="muted small">{dateTime(plan.createdAt)}</span><span><strong>Plan created</strong></span></li>
      </ol>
    </section>

    <section className="plan-section danger" aria-labelledby="data-title">
      <h2 id="data-title" className="section-title small">Your data</h2>
      <div className="row gap wrap">
        <button type="button" className="btn ghost small" onClick={deletePlan}><Trash2 size={15} /> Delete this plan</button>
        <button type="button" className="btn ghost small" onClick={clearAll}>Clear my data</button>
        <Link href="/plans" className="btn ghost small">All my plans</Link>
      </div>
    </section>
    <CalculationDrawer content={drawer} onClose={() => onDrawer(null)} />
  </div>;
}

const EVENT_LABEL: Record<PlanEvent["kind"], string> = {
  income_changed: "Income changed", coverage_changed: "Coverage changed", opportunity_changed: "Project changed", action_confirmed: "Action confirmed",
};

/* ---------------- Something changed ---------------- */

const CHANGE_KINDS = [
  { key: "income", kind: "income_changed", label: "My income forecast changed", text: "Updated my income forecast" },
  { key: "spouse", kind: "income_changed", label: "My spouse's income changed", text: "Updated my spouse's income" },
  { key: "project", kind: "opportunity_changed", label: "The project or a payment changed", text: "Project or payment changed" },
  { key: "coverage", kind: "coverage_changed", label: "Our health insurance changed", text: "Health insurance changed" },
] as const;
type ChangeKey = typeof CHANGE_KINDS[number]["key"];

function SomethingChanged({ plan, onCancel, onSaved, onDirty, onDrawer }: {
  plan: SavedPlan; onCancel: () => void; onDirty: (v: boolean) => void;
  onSaved: (next: SavedPlan, event: Omit<PlanEvent, "id" | "planId" | "occurredAt">) => Promise<boolean>;
  onDrawer: (c: DrawerContent) => void;
}) {
  const [key, setKey] = useState<ChangeKey | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFromCase(plan.input));
  const [version, setVersion] = useState(0);
  const [description, setDescription] = useState("");
  const [calc, setCalc] = useState<{ version: number; pending: boolean; result?: ComparisonResult; input?: SavedPlan["input"]; problems?: Array<{ path: string; reason: string }>; error?: string } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasSpouse = plan.input.people.some(p => p.role === "spouse");

  const update: Update = useCallback(mutate => { setDraft(prev => { const n = structuredClone(prev); mutate(n); pruneInvalid(n); return n; }); setVersion(v => v + 1); }, []);
  useEffect(() => { onDirty(version > 0); }, [version, onDirty]);

  const problems = useMemo(() => calc?.problems ?? (calc?.result && calc.result.status !== "ready" ? calc.result.fields : []), [calc]);
  const problemAt = useCallback((path: string) => problems.find(p => { const n = normalizePath(p.path); const t = normalizePath(path); return n === t || n.startsWith(`${t}.`); })?.reason, [problems]);

  async function recalc() {
    const v = version;
    setCalc({ version: v, pending: true });
    const built = buildCaseInput(draft, "comparison");
    if (!built.ok) { setCalc({ version: v, pending: false, problems: built.problems }); return; }
    try {
      const result = await calculateComparison(built.input);
      setCalc({ version: v, pending: false, result, input: built.input });
      if (result.status === "ready") {
        const same = result.scenarios.find(s => s.id === plan.chosenScenarioId && s.feasible)
          ?? result.scenarios.find(s => s.kind === plan.comparison.scenarios.find(x => x.id === plan.chosenScenarioId)?.kind && s.feasible);
        setChoice(same?.id ?? result.recommendedScenarioId ?? null);
      }
    } catch (e) { setCalc({ version: v, pending: false, error: e instanceof Error ? e.message : String(e) }); }
  }

  const stale = !!calc && !calc.pending && calc.version !== version;
  const ready = calc?.result?.status === "ready" && !stale ? calc.result as ReadyComparison : null;
  const changes = ready && calc?.input ? diffInputs(plan.input, calc.input) : [];

  function goTo(path: string) {
    const n = normalizePath(path);
    const keys = n.split(".");
    for (let i = keys.length; i > 0; i--) {
      const el = document.getElementById(fieldId(keys.slice(0, i).join("."))) ?? document.getElementById(fieldId(keys.slice(0, i).join(".").replace(/coverage\.\d+/, "coverage.0")));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); ((el.matches("input,select") ? el : el.querySelector("input,select")) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
    }
  }

  const invalidCount = invalidProblems(draft).length;
  return <InvalidInputsProvider draft={draft} update={update}><section id="changed" className="plan-section changed" aria-labelledby="changed-title">
    <h2 id="changed-title" className="section-title small">Something changed</h2>
    <p className="muted">Pick what happened, update the figures, and Headroom recalculates your plan. Nothing is saved until you choose “Save the updated plan”.</p>
    <div className="change-kinds" role="radiogroup" aria-label="What changed?">
      {CHANGE_KINDS.filter(k => k.key !== "spouse" || hasSpouse).map(k => <label key={k.key} className={`change-kind ${key === k.key ? "on" : ""}`}>
        <input type="radio" name="change-kind" checked={key === k.key} onChange={() => { setKey(k.key); if (!description) setDescription(k.text); }} />{k.label}
      </label>)}
      <a className="change-kind" href="#todo-title">I finished one of the actions</a>
    </div>

    {key && <div className="stack">
      {(key === "income" || key === "spouse") && adults(draft).filter(p => key === "spouse" ? p.role === "spouse" : p.role === "primary").map(p =>
        <div key={p.id} className="grid-years">
          <div><h3 className="subhead">2026 · {personName(draft, p.id)}</h3><IncomeEditor draft={draft} update={update} problemAt={problemAt} yearIndex={0} personId={p.id} /></div>
          <div><h3 className="subhead">2027 · {personName(draft, p.id)}</h3><IncomeEditor draft={draft} update={update} problemAt={problemAt} yearIndex={1} personId={p.id} /></div>
        </div>)}
      {key === "project" && <><p className="hint">Payment cancelled? Set what the client will pay to the amount you still expect.</p><ProjectEditor draft={draft} update={update} problemAt={problemAt} /></>}
      {key === "coverage" && <div className="grid-years">
        <div><h3 className="subhead">2026 coverage</h3><CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={0} /></div>
        <div><h3 className="subhead">2027 coverage</h3><CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={1} /></div>
      </div>}
      <div className="field"><label className="field-label" htmlFor="change-desc">What happened? <span className="optional">for your history</span></label>
        <input id="change-desc" maxLength={200} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="row gap wrap">
        <button type="button" className="btn primary" disabled={calc?.pending || version === 0 || invalidCount > 0} onClick={recalc}><RefreshCw size={16} /> Recalculate</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Discard changes</button>
        {version === 0 && <span className="muted small">Change a figure first.</span>}
        {invalidCount > 0 && <span className="field-error">Fix {invalidCount} amount{invalidCount > 1 ? "s" : ""} before recalculating.</span>}
      </div>
    </div>}

    <div aria-live="polite">
      {calc?.pending && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Recalculating…</p>}
      {stale && <p className="stale-banner">You changed more figures. Recalculate to see the effect.</p>}
      {!stale && calc?.problems && <ProblemsList title="Before we can recalculate" problems={calc.problems} draft={draft} onGoTo={goTo} />}
      {!stale && calc?.error && <ErrorNotice message={calc.error} onRetry={recalc} />}
      {!stale && calc?.result && calc.result.status !== "ready" && <BlockedResult result={calc.result} draft={calc.input ?? draft} context="comparison" onGoTo={goTo} />}
      {ready && calc?.input && <ChangeReview before={plan} after={ready} afterInput={calc.input} changes={changes} choice={choice} setChoice={setChoice} onDrawer={onDrawer}
        saving={saving} onSave={async () => {
          if (!choice || !calc.input) return;
          setSaving(true);
          const kind = CHANGE_KINDS.find(k => k.key === key)?.kind ?? "income_changed";
          const nextScenario = ready.scenarios.find(s => s.id === choice);
          await onSaved({ ...plan, input: calc.input, comparison: ready, chosenScenarioId: choice,
            completedActionIds: plan.completedActionIds.filter(a => nextScenario?.actions.some(x => x.id === a)) },
          { kind, description: description.trim() || "Plan updated", previousFingerprint: plan.comparison.calculationFingerprint, nextFingerprint: ready.calculationFingerprint });
          setSaving(false);
        }} />}
    </div>
  </section></InvalidInputsProvider>;
}

function ChangeReview({ before, after, afterInput, changes, choice, setChoice, onSave, saving, onDrawer }: {
  before: SavedPlan; after: ReadyComparison; afterInput: SavedPlan["input"]; changes: ReturnType<typeof diffInputs>;
  choice: string | null; setChoice: (id: string) => void; onSave: () => void; saving: boolean; onDrawer: (c: DrawerContent) => void;
}) {
  const oldChosen = before.comparison.scenarios.find(s => s.id === before.chosenScenarioId);
  const oldBase = before.comparison.scenarios.find(s => s.id === before.comparison.baselineScenarioId);
  const newBase = after.scenarios.find(s => s.id === after.baselineScenarioId);
  const sameNow = after.scenarios.find(s => s.id === before.chosenScenarioId) ?? after.scenarios.find(s => s.kind === oldChosen?.kind);
  const oldDelta = oldChosen && oldBase ? deltaVs(oldChosen, oldBase) : null;
  const newDelta = sameNow && newBase ? deltaVs(sameNow, newBase) : null;
  const feasible = after.scenarios.filter(s => s.feasible);

  return <div className="change-review">
    <h3 className="small-head">What changed</h3>
    {changes.length === 0 ? <p className="muted small">No figures changed.</p> : <ul className="diff-list">
      {changes.map(ch => <li key={ch.path}><span>{ch.label}</span><span className="num muted">{ch.before}</span><span aria-hidden="true">→</span><span className="num"><strong>{ch.after}</strong></span></li>)}
    </ul>}
    <h3 className="small-head">Effect on your plan</h3>
    <div className="before-after">
      <div><p className="k">Before · saved</p><p className="v num">{oldDelta ? signedMoney(oldDelta.cash) : "—"}</p><p className="muted small">{oldChosen?.label}</p></div>
      <div><p className="k">After · recalculated</p><p className={`v num ${newDelta ? signClass(newDelta.cash) : ""}`}>{newDelta ? signedMoney(newDelta.cash) : "—"}</p>
        <p className="muted small">{sameNow ? `${sameNow.label}${sameNow.feasible ? "" : " — no longer available"}` : "This option is no longer offered"}</p></div>
    </div>
    <p className="muted small">Cash after tax-year settlements, {baselineLabel(newBase).toLowerCase()}.</p>
    {sameNow && !sameNow.feasible && <p className="notice warn">Your chosen option no longer works: {sameNow.infeasibilityReasons.join(" ") || "it is outside your limits now."} Choose another below.</p>}

    <fieldset className="field">
      <legend className="field-label">Keep or choose an option</legend>
      <div className="option-list">
        {feasible.map(s => <OptionRow key={s.id} s={s} base={newBase} checked={choice === s.id} onChange={() => setChoice(s.id)} recommended={s.id === after.recommendedScenarioId} />)}
      </div>
      {feasible.length === 0 && <p className="notice warn">No option fits your limits after this change. You can keep the saved plan or change a limit.</p>}
    </fieldset>
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={!choice || saving} onClick={onSave}>{saving ? "Saving…" : "Save the updated plan"}</button>
      {sameNow && <button type="button" className="btn ghost small" onClick={() => onDrawer(scenarioTrace(sameNow, after, afterInput))}><FileSearch size={16} /> Show the new calculation</button>}
    </div>
  </div>;
}

function OptionRow({ s, base, checked, onChange, recommended }: { s: ScenarioResult; base?: ScenarioResult; checked: boolean; onChange: () => void; recommended: boolean }) {
  const d = base ? deltaVs(s, base) : null;
  return <label className={`option-row ${checked ? "on" : ""}`}>
    <input type="radio" name="new-choice" checked={checked} onChange={onChange} />
    <span className="option-label">{s.label}{recommended && <span className="pill good small-pill">Best within your limits</span>}</span>
    <span className={`num ${d ? signClass(d.cash) : ""}`}>{d && base?.id !== s.id ? signedMoney(d.cash) : "Baseline"}</span>
    {s.grossAdditionalRetirementCents > 0 && <span className="muted small">+ {money(s.grossAdditionalRetirementCents)} retirement</span>}
  </label>;
}

/** Optional draft message — only for options that need the client's agreement. */
function ClientNote({ scenario, plan }: { scenario: ScenarioResult; plan: SavedPlan }) {
  const receipts = scenario.decisions.receipts;
  const needsClient = scenario.kind === "split_payment" || scenario.kind === "renegotiate";
  const [copied, setCopied] = useState(false);
  if (!needsClient) return null;
  const lines = scenario.kind === "renegotiate"
    ? [`Thanks for the offer for "${plan.input.opportunity.title}". Having reviewed the scope, my price for this work is ${money(scenario.decisions.grossRevenueCents)}.`]
    : [`Thanks for the offer for "${plan.input.opportunity.title}". Could we schedule the payment in parts?`, ...receipts.map(r => `• ${money(r.amountCents)} paid on ${shortDate(r.date)}`),
      "I'd like the payment dates to reflect when the money is actually paid, so please let me know if these dates work on your side."];
  const text = ["Hi,", "", ...lines, "", "Best regards,"].join("\n");
  return <details className="explain client-note">
    <summary><Mail size={15} aria-hidden="true" /> Draft a note to your client</summary>
    <p className="hint">A starting point you can edit and send yourself. Headroom doesn&apos;t send it.</p>
    <textarea readOnly value={text} rows={Math.min(10, text.split("\n").length + 1)} aria-label="Draft note to your client" />
    <button type="button" className="btn small ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy text"}</button>
  </details>;
}
