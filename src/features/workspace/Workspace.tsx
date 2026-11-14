"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, FlaskConical, RotateCcw } from "lucide-react";
import type { CaseInput, ComparisonResult, RiskAssessment, SavedPlan } from "@/domain/contracts";
import { assessCurrentRisk, calculateComparison } from "@/lib/engine";
import {
  adults, blankDraft, buildCaseInput, draftFromCase, fieldId, normalizePath, type Draft, type Problem,
} from "@/features/household/draft";
import { CoverageEditor, HouseholdBasics, IncomeEditor, ScopeEditor, type Update } from "@/features/household/editors";
import { LimitsEditor, NextYearEditor, ProjectEditor } from "@/features/household/projectEditors";
import { DocumentImport } from "@/features/household/DocumentImport";
import { HouseholdSummary } from "@/features/household/HouseholdSummary";
import { BlockedResult, ErrorNotice, ProblemsList } from "@/features/results/BlockedResult";
import { RiskResult } from "@/features/results/RiskPanel";
import { ComparisonView } from "@/features/results/ComparisonView";
import { CalculationDrawer, type DrawerContent } from "@/features/results/CalculationDrawer";
import { StorageFallback } from "@/features/plan/StorageFallback";
import {
  DRAFT_KEY, describeStorageError, downloadJson, draftPlan, fileStamp, inputFile, saveNewPlan, takeStashedInput,
} from "@/features/plan/storage";
import { IDLE_RUN, isStale, type Run } from "./useRuns";

type Step = "household" | "compare";

export function Workspace({ seed, mode, initialStep = "household", entry }: {
  seed: CaseInput | null; mode: "own" | "demo"; initialStep?: Step; entry?: "project";
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => seed ? draftFromCase(seed) : blankDraft());
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(mode === "demo");
  const [step, setStep] = useState<Step>(initialStep);
  const [risk, setRisk] = useState<Run<RiskAssessment>>(IDLE_RUN);
  const [comparison, setComparison] = useState<Run<ComparisonResult>>(IDLE_RUN);
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<{ error: unknown; plan: SavedPlan } | null>(null);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);

  const draftRef = useRef(draft); draftRef.current = draft;
  const versionRef = useRef(version); versionRef.current = version;
  const riskReq = useRef(0); const compReq = useRef(0);

  /* ----- restore own data (browser only) ----- */
  useEffect(() => {
    if (mode !== "own") return;
    const stashed = takeStashedInput();
    if (stashed) { setDraft(draftFromCase(stashed)); setRestoredNote("Opened the household data from your file. Check it, then calculate again."); setLoaded(true); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Draft;
        if (saved?.contractVersion === "1.0" && Array.isArray(saved.years) && saved.ui) { setDraft(saved); setRestoredNote("We restored the figures you entered earlier in this browser."); }
      }
    } catch { /* storage unavailable: start blank */ }
    setLoaded(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== "own" || !loaded) return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ } }, 300);
    return () => clearTimeout(t);
  }, [draft, loaded, mode]);

  const update: Update = useCallback(mutate => {
    setDraft(prev => { const next = structuredClone(prev); mutate(next); return next; });
    setVersion(v => v + 1);
    setSaveError(null);
  }, []);

  /* ----- calculations ----- */
  const runRisk = useCallback(async () => {
    const id = ++riskReq.current;
    const v = versionRef.current;
    setRisk(r => ({ ...r, requested: true, pending: true }));
    const built = buildCaseInput(draftRef.current, "risk");
    if (!built.ok) { setRisk({ requested: true, pending: false, version: v, outcome: { kind: "invalid", problems: built.problems } }); return; }
    try {
      const result = await assessCurrentRisk(built.input);
      if (id === riskReq.current) setRisk({ requested: true, pending: false, version: v, outcome: { kind: "done", input: built.input, result } });
    } catch (e) {
      if (id === riskReq.current) setRisk({ requested: true, pending: false, version: v, outcome: { kind: "error", message: e instanceof Error ? e.message : String(e) } });
    }
  }, []);

  const runComparison = useCallback(async () => {
    const id = ++compReq.current;
    const v = versionRef.current;
    setComparison(r => ({ ...r, requested: true, pending: true }));
    const built = buildCaseInput(draftRef.current, "comparison");
    if (!built.ok) { setComparison({ requested: true, pending: false, version: v, outcome: { kind: "invalid", problems: built.problems } }); return; }
    try {
      const result = await calculateComparison(built.input);
      if (id === compReq.current) setComparison({ requested: true, pending: false, version: v, outcome: { kind: "done", input: built.input, result } });
    } catch (e) {
      if (id === compReq.current) setComparison({ requested: true, pending: false, version: v, outcome: { kind: "error", message: e instanceof Error ? e.message : String(e) } });
    }
  }, []);

  // Sample households show a first result without any typing.
  useEffect(() => {
    if (mode === "demo") { void runRisk(); if (draftRef.current.ui.projectStarted) void runComparison(); }
  }, [mode, runRisk, runComparison]);

  // Any edit invalidates results immediately; recalculate shortly after typing stops.
  const riskRequested = risk.requested; const compRequested = comparison.requested;
  useEffect(() => {
    if (version === 0) return;
    const t = setTimeout(() => { if (riskRequested) void runRisk(); if (compRequested) void runComparison(); }, 450);
    return () => clearTimeout(t);
  }, [version, riskRequested, compRequested, runRisk, runComparison]);

  /* ----- problems & navigation ----- */
  const problems: Problem[] = useMemo(() => {
    const list: Problem[] = [];
    for (const run of [risk, comparison] as Array<Run<RiskAssessment | ComparisonResult>>) {
      const o = run.outcome;
      if (!o) continue;
      if (o.kind === "invalid") list.push(...o.problems);
      if (o.kind === "done" && (o.result.status === "needs_data" || o.result.status === "unsupported")) list.push(...o.result.fields);
    }
    return list;
  }, [risk, comparison]);

  const problemAt = useCallback((path: string) => {
    const target = normalizePath(path);
    return problems.find(p => { const n = normalizePath(p.path); return n === target || n.startsWith(`${target}.`); })?.reason;
  }, [problems]);

  const goTo = useCallback((path: string) => {
    const n = normalizePath(path);
    const nextStep: Step = /^(opportunity|constraints|years\.1)/.test(n) ? "compare" : "household";
    setStep(nextStep);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const candidates: string[] = [];
      const keys = n.split(".");
      for (let i = keys.length; i > 0; i--) candidates.push(keys.slice(0, i).join("."));
      candidates.push(...candidates.map(c => c.replace(/coverage\.\d+/, "coverage.0")));
      for (const c of candidates) {
        const el = document.getElementById(fieldId(c));
        if (el) {
          el.closest("details")?.setAttribute("open", "");
          el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
          const focusable = el.matches("input,select,button,textarea") ? el : el.querySelector<HTMLElement>("input,select,button,textarea");
          (focusable as HTMLElement | null)?.focus({ preventScroll: true });
          return;
        }
      }
    }));
  }, []);

  function scrollToId(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function onUse(scenarioId: string) {
    const o = comparison.outcome;
    if (!o || o.kind !== "done" || o.result.status !== "ready" || isStale(comparison, version)) return;
    setSaving(scenarioId); setSaveError(null); setSaveFailure(null);
    try {
      const saved = await saveNewPlan(o.input, o.result, scenarioId);
      if (mode === "own") { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
      router.push(`/plan/${encodeURIComponent(saved.id)}?saved=1`);
    } catch (e) {
      setSaveError(describeStorageError(e));
      setSaveFailure({ error: e, plan: draftPlan(o.input, o.result, scenarioId) });
      setSaving(null);
      requestAnimationFrame(() => document.getElementById("save-error")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }

  function downloadData() {
    const built = buildCaseInput(draftRef.current, "risk");
    downloadJson(inputFile(built.ok ? built.input : draftRef.current), `headroom-household-${fileStamp()}.json`);
  }

  function startOver() {
    if (!window.confirm("Clear the figures on this page and start with an empty household?")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setDraft(seed && mode === "demo" ? draftFromCase(seed) : blankDraft());
    setVersion(v => v + 1); setRisk(IDLE_RUN); setComparison(IDLE_RUN); setRestoredNote(null);
  }

  const riskStale = isStale(risk, version) || risk.pending;
  const compStale = isStale(comparison, version) || comparison.pending;

  return <div className="workspace shell">
    <div className="ws-intro">
      {mode === "demo" ? <div className="sample-banner" role="note">
        <FlaskConical size={18} aria-hidden="true" />
        <div><strong>Sample household — synthetic data.</strong> {draft.title}. Edit any figure; every result is calculated by the same engine as your own data.
          {draft.evidence.find(e => e.kind === "synthetic") && <span className="muted"> {draft.evidence.find(e => e.kind === "synthetic")!.label}</span>}</div>
        <Link className="btn ghost small" href="/check">Use my own data</Link>
      </div> : <div className="ws-title-row">
        <div><p className="eyebrow">Your household</p><h1 className="page-title">{entry === "project" ? "Check a new project" : "Check my subsidy"}</h1></div>
        <button type="button" className="btn ghost small" onClick={startOver}><RotateCcw size={15} /> Start over</button>
      </div>}
      {restoredNote && <p className="notice" role="status">{restoredNote}</p>}
      {entry === "project" && mode === "own" && step === "household" && <p className="notice">First, a few facts about your household — the project is measured against them. You&apos;ll add the project in the next step.</p>}
    </div>

    <nav className="steps" aria-label="Steps">
      <button type="button" className={step === "household" ? "on" : ""} aria-current={step === "household" ? "step" : undefined} onClick={() => setStep("household")}><span>1</span> Your household</button>
      <button type="button" className={step === "compare" ? "on" : ""} aria-current={step === "compare" ? "step" : undefined} onClick={() => setStep("compare")}><span>2</span> Compare options</button>
      <Link href="/plans" className="step-link"><span>3</span> Your plan</Link>
    </nav>

    <div className="ws-grid">
      <div className="ws-main">
        {step === "household" ? <>
          <DocumentImport draft={draft} update={update} />
          <Section n="A" title="Who's in your household" lead="Your state, filing status and everyone on your tax return.">
            <HouseholdBasics draft={draft} update={update} problemAt={problemAt} />
          </Section>
          <Section n="B" title="2026 income forecast" lead="Your best estimate for the whole year. Each spouse is entered separately — their payroll tax limits differ. Leave anything you don't know blank; it stays unknown, never zero.">
            {adults(draft).map(p => <IncomeEditor key={p.id} draft={draft} update={update} problemAt={problemAt} yearIndex={0} personId={p.id} />)}
          </Section>
          <Section n="C" title="2026 health coverage" lead="Your Marketplace plan for 2026.">
            <CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={0} />
          </Section>
          <Section n="D" title="Situations Headroom doesn't cover yet" lead="We check these so the answer doesn't quietly leave something out.">
            <ScopeEditor draft={draft} update={update} problemAt={problemAt} />
          </Section>

          <div className="action-bar">
            <button type="button" className="btn primary" onClick={() => { void runRisk(); scrollToId("risk-area"); }} disabled={risk.pending}>
              <Calculator size={18} /> {risk.requested ? "Check again" : "Check my subsidy"}</button>
            <span className="muted small">Checks 2026 only. No project or 2027 figures needed.</span>
          </div>
          <div id="risk-area" className="result-area" aria-live="polite">
            <RiskArea run={risk} stale={riskStale} draft={draft} onGoTo={goTo} onShowCalc={setDrawer} onDownload={downloadData}
              onCompare={() => { setStep("compare"); window.scrollTo({ top: 0 }); }} onRetry={runRisk} />
          </div>
        </> : <>
          <Section n="A" title="The project" lead="What the client offers. The price is not the same as profit.">
            <ProjectEditor draft={draft} update={update} problemAt={problemAt} />
          </Section>
          <Section n="B" title="Your limits" lead="Headroom only recommends options you can actually do. Changing a limit recalculates.">
            <LimitsEditor draft={draft} update={update} problemAt={problemAt} />
          </Section>
          <details className="section-card" open={mode === "own" || !!problems.some(p => normalizePath(p.path).startsWith("years.1"))}>
            <summary className="section-summary"><span className="section-n">C</span><span><strong>Next year (2027)</strong><span className="muted small"> — needed to compare both tax years</span></span></summary>
            <div className="section-body"><NextYearEditor draft={draft} update={update} problemAt={problemAt} /></div>
          </details>

          <div className="action-bar">
            <button type="button" className="btn primary" onClick={() => { void runComparison(); scrollToId("compare-area"); }} disabled={comparison.pending}>
              <Calculator size={18} /> {comparison.requested ? "Compare again" : "Compare options"}</button>
            <span className="muted small">Compares 2026 + 2027, settled when you file in 2027 and 2028.</span>
          </div>
          <div id="compare-area" className="result-area" aria-live="polite">
            {saveError && <div id="save-error" className="notice warn" role="alert">{saveError}
              {saveFailure && <StorageFallback error={saveFailure.error} plan={saveFailure.plan}
                onSaved={saved => router.push(`/plan/${encodeURIComponent(saved.id)}?saved=1`)} />}</div>}
            <ComparisonArea run={comparison} stale={compStale} draft={draft} onGoTo={goTo} onShowCalc={setDrawer} onDownload={downloadData}
              onUse={onUse} saving={saving} onRetry={runComparison} />
          </div>
        </>}
      </div>

      <aside className="ws-aside" aria-label="Household summary">
        <HouseholdSummary draft={draft} onEdit={() => setStep("household")} />
        <MiniRisk run={risk} stale={riskStale} onRun={() => { setStep("household"); void runRisk(); scrollToId("risk-area"); }} />
      </aside>
    </div>
    <CalculationDrawer content={drawer} onClose={() => setDrawer(null)} />
  </div>;
}

function Section({ n, title, lead, children }: { n: string; title: string; lead?: string; children: React.ReactNode }) {
  return <section className="section-card" aria-labelledby={`sec-${n}-${title.length}`}>
    <div className="section-head"><span className="section-n" aria-hidden="true">{n}</span>
      <div><h2 id={`sec-${n}-${title.length}`}>{title}</h2>{lead && <p className="muted">{lead}</p>}</div></div>
    <div className="section-body">{children}</div>
  </section>;
}

function Loading({ text }: { text: string }) {
  return <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> {text}</p>;
}

function RiskArea({ run, stale, draft, onGoTo, onShowCalc, onDownload, onCompare, onRetry }: {
  run: Run<RiskAssessment>; stale: boolean; draft: Draft; onGoTo: (p: string) => void; onShowCalc: (c: DrawerContent) => void;
  onDownload: () => void; onCompare: () => void; onRetry: () => void;
}) {
  const o = run.outcome;
  if (!o) return run.pending ? <Loading text="Checking your subsidy…" /> : null;
  if (o.kind === "invalid") return <ProblemsList title="Before we can check your subsidy" problems={o.problems} draft={draft} onGoTo={onGoTo} />;
  if (o.kind === "error") return <ErrorNotice message={o.message} onRetry={onRetry} />;
  const r = o.result;
  if (r.status !== "ready") return <BlockedResult result={r} draft={o.input} context="risk" onGoTo={onGoTo} onDownloadData={onDownload} />;
  return <RiskResult assessment={r} input={o.input} stale={stale} onShowCalc={onShowCalc} onCompare={onCompare} />;
}

function ComparisonArea({ run, stale, draft, onGoTo, onShowCalc, onDownload, onUse, saving, onRetry }: {
  run: Run<ComparisonResult>; stale: boolean; draft: Draft; onGoTo: (p: string) => void; onShowCalc: (c: DrawerContent) => void;
  onDownload: () => void; onUse: (id: string) => void; saving: string | null; onRetry: () => void;
}) {
  const o = run.outcome;
  if (!o) return run.pending ? <Loading text="Comparing your options…" /> : <p className="muted empty-hint">Add the project and your limits, then choose <strong>Compare options</strong>.</p>;
  if (o.kind === "invalid") return <ProblemsList title="Before we can compare options" problems={o.problems} draft={draft} onGoTo={onGoTo} />;
  if (o.kind === "error") return <ErrorNotice message={o.message} onRetry={onRetry} />;
  const r = o.result;
  if (r.status !== "ready") return <BlockedResult result={r} draft={o.input} context="comparison" onGoTo={onGoTo} onDownloadData={onDownload} />;
  return <ComparisonView comparison={r} input={o.input} stale={stale} onShowCalc={onShowCalc} onUse={onUse} busyScenarioId={saving} />;
}

function MiniRisk({ run, stale, onRun }: { run: Run<RiskAssessment>; stale: boolean; onRun: () => void }) {
  const o = run.outcome;
  const ready = o?.kind === "done" && o.result.status === "ready" ? o.result : null;
  return <div className="mini-risk">
    <p className="eyebrow">Your subsidy check</p>
    {ready ? <>
      <p className={`mini-state ${stale ? "is-stale" : ""}`}>{{ below_cliff: "Below the limit", at_risk: "May be at risk", over_cliff: "Above the limit", no_credit: "No credit expected" }[ready.risk.state]}
        {stale && <span className="muted small"> · updating</span>}</p>
      <p className="small muted">{ready.risk.year} forecast</p>
    </> : o?.kind === "done" && o.result.status !== "ready" ? <p className="small">{o.result.status === "needs_data" ? "Needs a few more facts" : o.result.status === "unsupported" ? "Not supported for this household" : "Calculation unavailable"}</p>
      : <p className="small muted">Not checked yet.</p>}
    <button type="button" className="btn ghost small" onClick={onRun}>{o ? "Recheck" : "Check my subsidy"} <ArrowRight size={14} /></button>
  </div>;
}
