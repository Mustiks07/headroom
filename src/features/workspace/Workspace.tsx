"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, ChevronDown, FlaskConical, Pencil, RotateCcw } from "lucide-react";
import type { CaseInput, ComparisonResult, ReadyRiskAssessment, RiskAssessment, SavedPlan } from "@/domain/contracts";
import { assessCurrentRisk, calculateComparison } from "@/lib/engine";
import {
  SCOPE_EXCLUSIONS, adults, blankDraft, buildCaseInput, draftFromCase, fieldId, invalidProblems, normalizePath, pruneInvalid,
  restoreDraft, stateName, type Draft, type Problem,
} from "@/features/household/draft";
import { InvalidInputsProvider } from "@/features/household/invalidInputs";
import { QuickInputs } from "./QuickInputs";
import { money } from "@/features/format";
import { CoverageEditor, HouseholdBasics, IncomeEditor, ScopeEditor, type Update } from "@/features/household/editors";
import { LimitsEditor, NextYearEditor, ProjectEditor } from "@/features/household/projectEditors";
import { DocumentImport } from "@/features/household/DocumentImport";
import { HouseholdSummary } from "@/features/household/HouseholdSummary";
import { BlockedResult, ErrorNotice, ProblemsList } from "@/features/results/BlockedResult";
import { RiskResult } from "@/features/results/RiskPanel";
import { ComparisonView, DecisionOverview } from "@/features/results/ComparisonView";
import { CalculationDrawer, type DrawerContent } from "@/features/results/CalculationDrawer";
import { StorageFallback } from "@/features/plan/StorageFallback";
import {
  DRAFT_KEY, describeStorageError, downloadJson, draftPlan, fileStamp, inputFile, saveNewPlan, takeStashedInput,
} from "@/features/plan/storage";
import { IDLE_RUN, isStale, type Run } from "./useRuns";

type Step = "household" | "compare";
type SectionKey = "A" | "B" | "C" | "D";
const SECTIONS: SectionKey[] = ["A", "B", "C", "D"];

/** Which household section holds a contract path (for "Add this" links). */
function sectionFor(path: string): SectionKey | null {
  const n = normalizePath(path);
  if (/^(state|filingStatus|countyFips|people)/.test(n)) return "A";
  if (/^years\.0\.incomes/.test(n)) return "B";
  if (/^years\.0\.(coverage|benchmarkStatus|coveredPersonIds|taxFamilySize)/.test(n)) return "C";
  if (/^years\.\d\.(scopeConfirmed|unsupportedFacts)/.test(n)) return "D";
  return null;
}

function firstIncomplete(d: Draft): SectionKey {
  if (!d.state || !d.filingStatus || d.people.some(p => p.ageAt2026Start === null)) return "A";
  if (d.years[0].incomes.some(r => r.scheduleCProfit.status === "unknown")) return "B";
  const m = d.years[0].coverage[0];
  if ([m.enrollmentPremium, m.benchmarkPremium, m.advancePtc].some(f => f.status === "unknown") || m.ptcEligibilityConfirmed === null) return "C";
  return "D";
}

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
  // Sample households open on the result; the full form is one explicit click away.
  const [formOpen, setFormOpen] = useState(mode === "own");
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(() => new Set(mode === "demo" ? SECTIONS : ["A"]));

  const draftRef = useRef(draft); draftRef.current = draft;
  const versionRef = useRef(version); versionRef.current = version;
  const riskReq = useRef(0); const compReq = useRef(0);

  /* ----- restore own data (browser only) ----- */
  useEffect(() => {
    if (mode !== "own") return;
    const stashed = takeStashedInput();
    if (stashed) { const d = draftFromCase(stashed); setDraft(d); setOpenSections(new Set(SECTIONS)); setRestoredNote("Opened the household data from your file. Check it, then calculate again."); setLoaded(true); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = restoreDraft(JSON.parse(raw));
        if (saved) {
          setDraft(saved);
          setOpenSections(new Set([firstIncomplete(saved)]));
          const bad = invalidProblems(saved).length;
          setRestoredNote(`We restored the figures you entered earlier in this browser.${bad ? ` ${bad} amount${bad > 1 ? "s need" : " needs"} fixing before Headroom can calculate.` : ""}`);
        } else {
          localStorage.removeItem(DRAFT_KEY);
          setRestoredNote("Figures saved earlier in this browser couldn't be restored safely, so you're starting with an empty household.");
        }
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
    setDraft(prev => { const next = structuredClone(prev); mutate(next); pruneInvalid(next); return next; });
    setVersion(v => v + 1);
    setSaveError(null);
    setSaveFailure(null);
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
    const list: Problem[] = invalidProblems(draft);
    for (const run of [risk, comparison] as Array<Run<RiskAssessment | ComparisonResult>>) {
      const o = run.outcome;
      if (!o) continue;
      if (o.kind === "invalid") list.push(...o.problems);
      if (o.kind === "done" && (o.result.status === "needs_data" || o.result.status === "unsupported")) list.push(...o.result.fields);
    }
    return list;
  }, [risk, comparison, draft]);

  const problemAt = useCallback((path: string) => {
    const target = normalizePath(path);
    return problems.find(p => { const n = normalizePath(p.path); return n === target || n.startsWith(`${target}.`); })?.reason;
  }, [problems]);

  const goTo = useCallback((path: string) => {
    const n = normalizePath(path);
    const nextStep: Step = /^(opportunity|constraints|years\.1)/.test(n) ? "compare" : "household";
    setFormOpen(true);
    setStep(nextStep);
    const section = sectionFor(n);
    if (section) setOpenSections(prev => new Set([...prev, section]));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const candidates: string[] = [];
      const keys = n.split(".");
      for (let i = keys.length; i > 0; i--) candidates.push(keys.slice(0, i).join("."));
      candidates.push(...candidates.map(c => c.replace(/coverage\.(\d+|\*)/, "coverage.0")));
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
    setVersion(v => v + 1); setRisk(IDLE_RUN); setComparison(IDLE_RUN); setRestoredNote(null); setOpenSections(new Set(["A"]));
  }

  function toggleSection(key: SectionKey, open?: boolean) {
    setOpenSections(prev => { const n = new Set(prev); if (open ?? !n.has(key)) n.add(key); else n.delete(key); return n; });
  }
  function continueFrom(key: SectionKey) {
    const next = SECTIONS[SECTIONS.indexOf(key) + 1];
    setOpenSections(prev => { const n = new Set(prev); n.delete(key); if (next) n.add(next); return n; });
    if (next) requestAnimationFrame(() => document.getElementById(`sec-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const riskStale = isStale(risk, version) || risk.pending;
  const compStale = isStale(comparison, version) || comparison.pending;
  const riskReady = risk.outcome?.kind === "done" && risk.outcome.result.status === "ready" ? risk.outcome.result : null;
  const invalidCount = invalidProblems(draft).length;
  const progressive = mode === "own";
  const sectionProps = (key: SectionKey) => ({ k: key, open: openSections.has(key), onToggle: () => toggleSection(key),
    onContinue: progressive && key !== "D" ? () => continueFrom(key) : undefined, summary: sectionSummary(key, draft) });

  const form = <>
    <nav className="steps" aria-label="Steps">
      <button type="button" className={step === "household" ? "on" : ""} aria-current={step === "household" ? "step" : undefined} onClick={() => setStep("household")}><span>1</span> This year</button>
      <button type="button" className={step === "compare" ? "on" : ""} aria-current={step === "compare" ? "step" : undefined} onClick={() => setStep("compare")}><span>2</span> A new project</button>
      <Link href="/plans" className="step-link"><span>3</span> Your plan</Link>
    </nav>
    {step === "household" ? <>
      <Section {...sectionProps("A")} title="Who's in your household" lead="Your state, filing status and everyone on your tax return.">
        <HouseholdBasics draft={draft} update={update} problemAt={problemAt} />
      </Section>
      <Section {...sectionProps("B")} title="2026 income forecast" lead="Your best estimate for the whole year, each adult separately. Leave anything you don't know blank — it stays unknown, never zero.">
        <details className="doc-disclosure"><summary>Have a pay stub or statement? Import figures from it (optional)</summary><DocumentImport draft={draft} update={update} /></details>
        {adults(draft).map(p => <IncomeEditor key={p.id} draft={draft} update={update} problemAt={problemAt} yearIndex={0} personId={p.id} />)}
      </Section>
      <Section {...sectionProps("C")} title="2026 health coverage" lead="Your Marketplace plan for 2026.">
        <CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={0} />
      </Section>
      <Section {...sectionProps("D")} title="Situations Headroom doesn't cover yet" lead="We check these so the answer doesn't quietly leave something out.">
        <ScopeEditor draft={draft} update={update} problemAt={problemAt} />
      </Section>
      <div className="action-bar">
        <button type="button" className="btn primary" onClick={() => { void runRisk(); scrollToId("risk-area"); }} disabled={risk.pending}>
          <Calculator size={18} /> {risk.requested ? "Check again" : "Check my subsidy"}</button>
        <span className="muted small">{invalidCount ? `Fix ${invalidCount} amount${invalidCount > 1 ? "s" : ""} first.` : "Checks 2026 only. No project or 2027 figures needed."}</span>
      </div>
      {mode === "own" && <div id="risk-area" className="result-area" aria-live="polite">
        <RiskArea run={risk} stale={riskStale} draft={draft} onGoTo={goTo} onShowCalc={setDrawer} onDownload={downloadData}
          onCompare={() => { setStep("compare"); window.scrollTo({ top: 0 }); }} onRetry={runRisk} />
      </div>}
    </> : <>
      <SimpleSection n="A" title="The project" lead="What the client offers. The price is not the same as profit.">
        <ProjectEditor draft={draft} update={update} problemAt={problemAt} />
      </SimpleSection>
      <SimpleSection n="B" title="Your limits" lead="Headroom only recommends options you can actually do. Changing a limit recalculates.">
        <LimitsEditor draft={draft} update={update} problemAt={problemAt} />
      </SimpleSection>
      <details className="section-card" open={mode === "own" || problems.some(p => normalizePath(p.path).startsWith("years.1"))}>
        <summary className="section-summary"><span className="section-n">C</span><span><strong>Next year (2027)</strong><span className="muted small"> — needed because a payment or the subsidy can move into 2027</span></span></summary>
        <div className="section-body"><NextYearEditor draft={draft} update={update} problemAt={problemAt} /></div>
      </details>
      {mode === "own" && <div className="action-bar">
        <button type="button" className="btn primary" onClick={() => { void runComparison(); scrollToId("compare-area"); }} disabled={comparison.pending}>
          <Calculator size={18} /> {comparison.requested ? "Compare again" : "Compare options"}</button>
        <span className="muted small">{invalidCount ? `Fix ${invalidCount} amount${invalidCount > 1 ? "s" : ""} first.` : "Compares 2026 + 2027, settled when you file in 2027 and 2028."}</span>
      </div>}
    </>}
  </>;

  const saveNotice = saveError && <div id="save-error" className="notice warn" role="alert">{saveError}
    {saveFailure && <StorageFallback error={saveFailure.error} plan={saveFailure.plan}
      onSaved={saved => router.push(`/plan/${encodeURIComponent(saved.id)}?saved=1`)} />}</div>;

  return <InvalidInputsProvider draft={draft} update={update}>
    <div className="workspace shell">
      {mode === "demo" ? <>
        <div className="sample-banner" role="note">
          <FlaskConical size={18} aria-hidden="true" />
          <div><strong>Sample household — synthetic data.</strong> {sampleLine(draft)} Change any figure: results come from the same calculation as your own data.</div>
          <Link className="btn ghost small" href="/check">Use my own data</Link>
        </div>
        <div className="result-first">
          <div className="rf-main" aria-live="polite">
            <h1 className="rf-title">{draft.opportunity.title}</h1>
            {saveNotice}
            {invalidCount > 0 && <ProblemsList title="Fix these amounts to update the result" problems={invalidProblems(draft)} draft={draft} onGoTo={goTo} />}
            <DemoResult risk={risk} comparison={comparison} riskReady={riskReady} riskStale={riskStale} compStale={compStale} draft={draft}
              onGoTo={goTo} onShowCalc={setDrawer} onUse={onUse} saving={saving} onRetry={() => { void runRisk(); void runComparison(); }} />
          </div>
          <aside className="rf-quick" aria-label="Change the main figures">
            {formOpen ? <p className="muted small">The full form is open below. Edit figures there.</p>
              : <QuickInputs draft={draft} update={update} problemAt={problemAt} />}
            <button type="button" className="btn ghost small" aria-expanded={formOpen} onClick={() => { setFormOpen(v => !v); if (!formOpen) scrollToId("full-form"); }}>
              <Pencil size={14} /> {formOpen ? "Hide the full household form" : "Edit everything (full household form)"}</button>
          </aside>
        </div>
        {comparison.outcome?.kind === "done" && comparison.outcome.result.status === "ready" && <div id="compare-area" className="result-area">
          <ComparisonView comparison={comparison.outcome.result} input={comparison.outcome.input} stale={compStale} onShowCalc={setDrawer}
            onUse={onUse} busyScenarioId={saving} hideOverview />
        </div>}
        {formOpen && <div id="full-form" className="ws-main full-form">{form}</div>}
      </> : <>
        <div className="ws-intro">
          <div className="ws-title-row">
            <div><p className="eyebrow">Your household</p><h1 className="page-title">{entry === "project" ? "Check a new project" : "Check my subsidy"}</h1></div>
            <button type="button" className="btn ghost small" onClick={startOver}><RotateCcw size={15} /> Start over</button>
          </div>
          {restoredNote && <p className="notice" role="status">{restoredNote}</p>}
          {entry === "project" && step === "household" && <p className="notice">First, a few facts about this year — the project is measured against them. You&apos;ll add the project in step 2.</p>}
          {step === "household" && <p className="muted small">About 5 minutes. Your figures stay in this browser while you work.</p>}
        </div>
        <div className="ws-grid">
          <div className="ws-main">
            {/* Wait for the browser draft so inputs start from the restored values. */}
            {loaded ? form : <Loading text="Opening your figures…" />}
            {step === "compare" && <div id="compare-area" className="result-area" aria-live="polite">
              {saveNotice}
              <ComparisonArea run={comparison} stale={compStale} draft={draft} onGoTo={goTo} onShowCalc={setDrawer} onDownload={downloadData}
                onUse={onUse} saving={saving} onRetry={runComparison} risk={riskReady} />
            </div>}
          </div>
          <aside className="ws-aside" aria-label="Household summary">
            <HouseholdSummary draft={draft} onEdit={() => setStep("household")} />
            <MiniRisk run={risk} stale={riskStale} onRun={() => { setStep("household"); void runRisk(); scrollToId("risk-area"); }} />
          </aside>
        </div>
      </>}
      <CalculationDrawer content={drawer} onClose={() => setDrawer(null)} />
    </div>
  </InvalidInputsProvider>;
}

function sampleLine(d: Draft) {
  const kids = d.people.filter(p => p.role === "dependent").length;
  const who = d.filingStatus === "mfj" ? `Married couple${kids ? ` with ${kids === 1 ? "one child" : `${kids} children`}` : ""}` : "Single freelancer";
  return `${who} in ${stateName(d.state)}, offered ${money(d.opportunity.grossRevenueCents)} for “${d.opportunity.title}”.`;
}

function sectionSummary(key: SectionKey, d: Draft): string {
  if (key === "A") return [d.state ? stateName(d.state) : null, d.filingStatus === "mfj" ? "Married filing jointly" : d.filingStatus === "single" ? "Single" : d.filingStatus ? "Other filing status" : null,
    `${d.people.length} ${d.people.length === 1 ? "person" : "people"}`].filter(Boolean).join(" · ");
  if (key === "B") {
    const unknown = d.years[0].incomes.reduce((n, r) => n + Object.values(r).filter(v => typeof v === "object" && v && (v as { status?: string }).status === "unknown").length, 0);
    const profit = d.years[0].incomes.find(r => r.personId === "primary")?.scheduleCProfit.valueCents;
    return `${profit !== null && profit !== undefined ? `Your profit ${money(profit)}` : "Profit not entered"}${unknown ? ` · ${unknown} unknown` : ""}`;
  }
  if (key === "C") { const m = d.years[0].coverage[0]; return m.enrollmentPremium.valueCents !== null ? `Premium ${money(m.enrollmentPremium.valueCents)}/mo` : "Not entered yet"; }
  const y = d.years[0];
  return y.unsupportedFacts.length ? `${y.unsupportedFacts.length} apply: ${y.unsupportedFacts.map(f => SCOPE_EXCLUSIONS.find(x => x.id === f)?.label.split(" (")[0] ?? f).join(", ")}`
    : y.scopeConfirmed ? "None apply" : "Not answered yet";
}

function Section({ k, title, lead, children, open, onToggle, onContinue, summary }: {
  k: SectionKey; title: string; lead?: string; children: React.ReactNode; open: boolean; onToggle: () => void; onContinue?: () => void; summary: string;
}) {
  return <section className={`section-card ${open ? "" : "collapsed"}`} id={`sec-${k}`} aria-labelledby={`sec-${k}-title`}>
    <button type="button" className="section-toggle" aria-expanded={open} aria-controls={`sec-${k}-body`} onClick={onToggle}>
      <span className="section-n" aria-hidden="true">{k}</span>
      <span className="section-titles"><span id={`sec-${k}-title`} className="section-h">{title}</span>
        {open ? lead && <span className="muted small">{lead}</span> : <span className="muted small">{summary}</span>}</span>
      <ChevronDown size={18} aria-hidden="true" className="chev" />
    </button>
    {/* Kept mounted while closed so "Add this" links and typed text survive. */}
    <div className="section-body" id={`sec-${k}-body`} hidden={!open}>
      {children}
      {onContinue && <div className="row gap"><button type="button" className="btn secondary small" onClick={onContinue}>Continue <ArrowRight size={15} /></button></div>}
    </div>
  </section>;
}

function SimpleSection({ n, title, lead, children }: { n: string; title: string; lead?: string; children: React.ReactNode }) {
  return <section className="section-card" aria-labelledby={`ssec-${n}`}>
    <div className="section-head"><span className="section-n" aria-hidden="true">{n}</span>
      <div><h2 id={`ssec-${n}`}>{title}</h2>{lead && <p className="muted">{lead}</p>}</div></div>
    <div className="section-body">{children}</div>
  </section>;
}

function Loading({ text }: { text: string }) {
  return <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> {text}</p>;
}

/** Demo hero: decision first, or the engine's honest blocked state. */
function DemoResult({ risk, comparison, riskReady, riskStale, compStale, draft, onGoTo, onShowCalc, onUse, saving, onRetry }: {
  risk: Run<RiskAssessment>; comparison: Run<ComparisonResult>; riskReady: ReadyRiskAssessment | null; riskStale: boolean; compStale: boolean;
  draft: Draft; onGoTo: (p: string) => void; onShowCalc: (c: DrawerContent) => void; onUse: (id: string) => void; saving: string | null; onRetry: () => void;
}) {
  const o = comparison.outcome;
  if (!o) return <div className="overview skeleton" aria-busy="true"><Loading text="Calculating this household's options…" /></div>;
  if (o.kind === "invalid") return <ProblemsList title="Before we can compare options" problems={o.problems} draft={draft} onGoTo={onGoTo} />;
  if (o.kind === "error") return <ErrorNotice message={o.message} onRetry={onRetry} />;
  const r = o.result;
  if (r.status !== "ready") return <>
    <BlockedResult result={r} draft={o.input} context="comparison" onGoTo={onGoTo} />
    {riskReady && <RiskResult assessment={riskReady} input={(risk.outcome as { input: CaseInput }).input} stale={riskStale} onShowCalc={onShowCalc} />}
  </>;
  return <>
    {compStale && <p className="stale-banner" role="status">Recalculating with your change…</p>}
    <DecisionOverview comparison={r} input={o.input} risk={riskReady && !riskStale ? riskReady : null} stale={compStale} onShowCalc={onShowCalc} onUse={onUse} busy={saving} />
  </>;
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

function ComparisonArea({ run, stale, draft, onGoTo, onShowCalc, onDownload, onUse, saving, onRetry, risk }: {
  run: Run<ComparisonResult>; stale: boolean; draft: Draft; onGoTo: (p: string) => void; onShowCalc: (c: DrawerContent) => void;
  onDownload: () => void; onUse: (id: string) => void; saving: string | null; onRetry: () => void; risk: ReadyRiskAssessment | null;
}) {
  const o = run.outcome;
  if (!o) return run.pending ? <Loading text="Comparing your options…" /> : <p className="muted empty-hint">Add the project and your limits, then choose <strong>Compare options</strong>.</p>;
  if (o.kind === "invalid") return <ProblemsList title="Before we can compare options" problems={o.problems} draft={draft} onGoTo={onGoTo} />;
  if (o.kind === "error") return <ErrorNotice message={o.message} onRetry={onRetry} />;
  const r = o.result;
  if (r.status !== "ready") return <BlockedResult result={r} draft={o.input} context="comparison" onGoTo={onGoTo} onDownloadData={onDownload} />;
  return <ComparisonView comparison={r} input={o.input} stale={stale} onShowCalc={onShowCalc} onUse={onUse} busyScenarioId={saving} risk={risk} />;
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
    </> : o?.kind === "invalid" ? <p className="small">Needs your answers first</p>
      : o?.kind === "done" && o.result.status !== "ready" ? <p className="small">{o.result.status === "needs_data" ? "Needs a few more facts" : o.result.status === "unsupported" ? "Not supported for this household" : "Calculation unavailable"}</p>
      : <p className="small muted">Not checked yet.</p>}
    <button type="button" className="btn ghost small" onClick={onRun}>{o ? "Recheck" : "Check my subsidy"} <ArrowRight size={14} /></button>
  </div>;
}
