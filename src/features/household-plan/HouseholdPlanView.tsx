"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Download, FileSearch, FlaskConical, History, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { MoneyFact, TaxYear } from "@/domain/contracts";
import {
  effectiveLine, forecastTotal, workspaceToCaseInput,
  type HouseholdProjectionResult, type HouseholdWorkspace, type OtherIncome, type ProfitForecast, type Project, type WorkspaceComparisonResult, type WorkspaceEvaluationResult,
} from "@/domain/household-workspace";
import { dateTime, humanizeDates, money, shortDate, signClass, signedMoney } from "@/features/format";
import { FIELD_LABELS, personName } from "@/features/household/draft";
import { LocalInvalidProvider } from "@/features/household/invalidInputs";
import { CalculationDrawer, type DrawerContent } from "@/features/results/CalculationDrawer";
import { ComparisonView } from "@/features/results/ComparisonView";
import { downloadBlob, fileStamp } from "@/features/plan/storage";
import { ForecastEditor } from "./ForecastEditor";
import { MoneyField } from "@/components/MoneyField";
import { compareProject, evaluatePlan, fixedPlanOf, projectHousehold, sepRows } from "./engine";
import {
  addProject, agreeToOption, blankForecast, saveDealGoal, setOtherIncome, setProjectConditions, cancelExpected, correctActual, recordActual, recordContribution, setForecast, setFutureBudget,
  setProjectStatus, setSepTarget,
} from "./ops";
import { commit, describeSaveError, whereText, workspaceRepo, CloudSaveFailedError, WorkspaceConflictError } from "./store";
import { exportForecastPdf, exportWorkspaceJson } from "@/lib/client/api";
import { workspaceFingerprint } from "@/domain/household-workspace";
import { ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { AddProjectForm, ProjectCard, SepPanel } from "./parts";
import { attentionItems, type AttentionItem } from "./attention";
import { DealPanel } from "@/features/deal/DealPanel";
import { ChooseTerms } from "@/features/deal/ChooseTerms";
import type { DealVariant, ReadyDealSearch } from "@/domain/deal-planning";

type Calc = { key: string; pending: boolean; projection?: HouseholdProjectionResult; evaluation?: WorkspaceEvaluationResult; error?: string };
type Notice = { tone: "ok" | "warn"; text: string } | null;

const RISK_TEXT = { below_cliff: "Below the limit", at_risk: "Close to the limit", over_cliff: "Above the limit", no_credit: "No credit expected" } as const;
const RISK_TONE = { below_cliff: "good", at_risk: "warn", over_cliff: "bad", no_credit: "neutral" } as const;

export function HouseholdPlanView({ id, justSaved = false }: { id: string; justSaved?: boolean }) {
  const router = useRouter();
  const [ws, setWs] = useState<HouseholdWorkspace | null | undefined>(undefined);
  const [notice, setNotice] = useState<Notice>(justSaved ? { tone: "ok", text: "Household plan saved." } : null);
  const [pending, setPending] = useState<{ next: HouseholdWorkspace; okText: string; error: unknown } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ key: string; result?: WorkspaceComparisonResult; pending: boolean } | null>(null);
  const [forecastEdit, setForecastEdit] = useState<{ personId: string; year: TaxYear } | null>(null);
  const [adding, setAdding] = useState(false);
  const [fixProject, setFixProject] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ variant: DealVariant; result: ReadyDealSearch } | null>(null);
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const req = useRef(0);

  useEffect(() => {
    let live = true;
    workspaceRepo().get(id).then(w => { if (live) setWs(w); }, e => { if (live) { setLoadError(e instanceof Error ? e.message : String(e)); setWs(null); } });
    return () => { live = false; };
  }, [id]);
  const key = ws ? JSON.stringify([ws.forecasts, ws.projects, ws.retirement, ws.household, ws.planning]) : "";

  useEffect(() => {
    if (!ws) return;
    const n = ++req.current;
    setCalc(c => ({ ...(c ?? {}), key, pending: true }));
    const t = setTimeout(async () => {
      try {
        const [projection, evaluation] = await Promise.all([projectHousehold(ws), evaluatePlan(ws)]);
        if (n === req.current) setCalc({ key, pending: false, projection, evaluation });
      } catch (e) { if (n === req.current) setCalc({ key, pending: false, error: e instanceof Error ? e.message : String(e) }); }
    }, 200);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ws || !compareId) { setCompare(null); return; }
    let live = true;
    setCompare(c => ({ ...(c ?? {}), key, pending: true }));
    void compareProject(ws, compareId).then(result => { if (live) setCompare({ key, result, pending: false }); });
    return () => { live = false; };
  }, [key, compareId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One user change = one atomic revision with its history event. Failures keep the change pending, never half-saved. */
  const save = useCallback(async (base: HouseholdWorkspace, next: HouseholdWorkspace, okText: string) => {
    setBusy("save");
    try {
      const saved = await commit(base, next);
      setWs(saved); setPending(null); setNotice({ tone: "ok", text: okText });
      return true;
    } catch (e) {
      if (e instanceof WorkspaceConflictError) { if (e.current) setWs(e.current); setPending(null); }
      else setPending({ next, okText, error: e });
      setNotice({ tone: "warn", text: describeSaveError(e) });
      return false;
    } finally { setBusy(null); }
  }, []);

  const apply = useCallback(async (fn: (w: HouseholdWorkspace) => HouseholdWorkspace, okText: string) => {
    if (!ws) return false;
    if (pending) { setNotice({ tone: "warn", text: "Save or discard the change that didn't go through first." }); return false; }
    let next: HouseholdWorkspace;
    try { next = fn(ws); } catch (e) { setNotice({ tone: "warn", text: `That change wasn't made: ${e instanceof Error ? e.message : String(e)}` }); return false; }
    return save(ws, next, okText);
  }, [ws, pending, save]);

  if (ws === undefined) return <div className="shell page-pad"><p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Opening your household plan…</p></div>;
  if (ws === null) return <div className="shell page-pad"><h1 className="page-title">We couldn&apos;t find this household plan</h1>
    <p className="intro">{loadError ?? "It may have been deleted, or it was saved in a different browser. Plans aren't synced between devices."}</p>
    <div className="row gap"><Link className="btn primary" href="/household">Household plans</Link><Link className="btn ghost" href="/check">Check my subsidy</Link></div></div>;

  const stale = !calc || calc.pending || calc.key !== key;
  const projection = calc?.projection;
  const ready = projection?.status === "ready" ? projection : null;
  const risk = ready?.currentRisk ?? null;
  const owners = ws.household.people.filter(p => p.role !== "dependent");
  const agreedProjects = ws.projects.filter(p => p.status === "agreed");
  const proposals = ws.projects.filter(p => p.status === "proposed");
  const sep = sepRows(ws, calc?.evaluation);
  const evaluation = calc?.evaluation?.status === "ready" ? calc.evaluation : null;
  const attention = attentionItems(ws, calc?.evaluation);
  function onAttention(a: AttentionItem) {
    const go = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    if (a.action?.kind === "compare" && a.action.projectId) { setDealId(a.action.projectId); go("deal-panel"); }
    else if (a.action?.kind === "record_payment" && a.action.projectId) go(`project-${a.action.projectId}`);
    else if (a.action?.kind === "sep") go("sep-title");
    else if (a.action?.kind === "review_income") { setForecastEdit({ personId: owners[0].id, year: 2026 }); go("forecast-change"); }
  }

  return <div className="shell plan-page household-plan">
    <div className="plan-head">
      <div>
        <p className="eyebrow">Household plan{ws.household.isSynthetic ? " · sample household" : ""}</p>
        <h1 className="page-title">{ws.household.title}</h1>
        <p className="save-status small"><span className="dot" aria-hidden="true" />{whereText(ws)} Revision {ws.revision} · updated {dateTime(ws.updatedAt)}</p>
      </div>
      <div className="plan-head-actions">
        <button type="button" className="btn primary" onClick={() => { setForecastEdit({ personId: owners[0].id, year: 2026 }); setTimeout(() => document.getElementById("forecast-change")?.scrollIntoView({ behavior: "smooth" }), 30); }}><RefreshCw size={17} /> My income changed</button>
        <button type="button" className="btn secondary" onClick={() => { setAdding(true); setTimeout(() => document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" }), 30); }}><Plus size={17} /> New client offer</button>
      </div>
    </div>
    {ws.household.isSynthetic && <p className="sample-banner compact small"><FlaskConical size={16} aria-hidden="true" /> <span>Synthetic sample household. Plan prices are county candidates or illustrative.</span></p>}
    {notice && <p className={`notice ${notice.tone === "warn" ? "warn" : "ok"}`} role={notice.tone === "warn" ? "alert" : "status"}>{notice.text}</p>}
    {pending && <div className="notice warn" role="group" aria-label="Unsaved change">
      <strong>One change isn&apos;t saved yet.</strong> The figures below are the last saved revision ({ws.revision}).
      <div className="row gap wrap">
        <button type="button" className="btn small primary" disabled={busy === "save"} onClick={() => void save(ws, pending.next, pending.okText)}>{busy === "save" ? "Saving…" : "Try again"}</button>
        {pending.error instanceof CloudSaveFailedError && <button type="button" className="btn small secondary" onClick={async () => {
          try { const copy = await workspaceRepo().saveLocally(pending.next); router.push(`/household/${encodeURIComponent(copy.id)}?saved=1`); }
          catch (e) { setNotice({ tone: "warn", text: describeSaveError(e) }); } }}>Save a copy in this browser</button>}
        <button type="button" className="btn small ghost" onClick={() => { setPending(null); setNotice(null); }}>Discard the change</button>
      </div></div>}
    {ws.origin.kind === "migrated_v1" && ws.origin.unconfirmed.length > 0 && <div className="notice warn" role="note"><strong>Please confirm from your records:</strong>
      <ul className="bullets small">{ws.origin.unconfirmed.map(u => <li key={u}>{u}</li>)}</ul>
      <p className="small">Earlier “done” ticks and planned SEP amounts are not treated as payments until you record the actual amount and date.</p></div>}

    {/* ---- where you stand ---- */}
    <section className={`overview ${stale ? "is-stale" : ""}`} aria-labelledby="stand-title" aria-busy={stale}>
      <h2 id="stand-title" className="visually-hidden">Where you stand</h2>
      {calc?.error && <p className="notice warn" role="alert">The calculation failed: {calc.error}</p>}
      {projection && projection.status !== "ready" && <WorkspaceBlocked result={projection} ws={ws} onFix={p => setForecastEdit(p)} />}
      <div className="overview-grid">
        <div className="tile">
          <p className="tile-k">Subsidy now · 2026</p>
          {risk ? <>
            <p className="tile-big num">{money(risk.subsidyCents)}<span className="tile-unit">/year</span></p>
            <p className="tile-sub"><span className={`pill ${RISK_TONE[risk.state]}`}>{RISK_TEXT[risk.state]}</span></p>
            <p className="tile-line">Income for the subsidy <strong className="num">{money(risk.forecastMagiCents)}</strong> of <strong className="num">{money(risk.thresholdMagiCents)}</strong> limit</p>
          </> : <p className="tile-line muted">{stale ? "Calculating…" : "Waiting for the facts listed above."}</p>}
        </div>
        <div className="tile">
          <p className="tile-k">Expected 2026 business profit</p>
          {owners.map(o => { const pp = ready?.years.find(y => y.year === 2026)?.people.find(p => p.personId === o.id); const t = pp?.total;
            return <div key={o.id}>{owners.length > 1 && <p className="tile-sub">{personName(ws.household, o.id)}</p>}
              <p className="tile-big num">{t ? (t.valueCents === null ? "Unknown" : money(t.valueCents)) : "—"}</p>
              {t?.range && <p className="tile-sub">range {money(t.range.lowCents)}–{money(t.range.highCents)}</p>}</div>; })}
          <p className="tile-line">Includes {agreedProjects.length ? `${agreedProjects.length} agreed project${agreedProjects.length > 1 ? "s" : ""}` : "no projects yet"}{proposals.length ? `; ${proposals.length} proposal${proposals.length > 1 ? "s" : ""} not included` : ""}</p>
        </div>
        <div className="tile tile-rec">
          <p className="tile-k">What needs attention next</p>
          {attention.filter(a => a.tone !== "done").length === 0 ? <p className="tile-line">Nothing is due. Add a client offer or update your forecast when something changes.</p>
            : <ul className="attention">{attention.filter(a => a.tone !== "done").slice(0, 3).map(a => <li key={a.id} className={`att-${a.tone}`}>
              <p className="tile-title">{a.title}</p><p className="tile-sub">{a.detail}</p>
              {a.action && <button type="button" className="link-btn" onClick={() => onAttention(a)}>{a.action.label}</button>}</li>)}</ul>}
          {attention.some(a => a.tone === "done") && <p className="tile-sub done-line">✓ {attention.filter(a => a.tone === "done")[0].detail}</p>}
        </div>
      </div>
      {ready && (ready.assumptions.length > 0 || ready.warnings.length > 0) && <details className="explain"><summary>Conditions and calculation notes ({ready.assumptions.length + ready.warnings.length})</summary>
        <ul className="bullets small">{[...ready.assumptions, ...ready.warnings].map(n => <li key={n}>{n}</li>)}</ul></details>}
    </section>

    {/* ---- forecast composition ---- */}
    <section className="plan-section" aria-labelledby="forecast-title">
      <h2 id="forecast-title" className="section-title small">How your 2026 profit forecast is built</h2>
      {owners.map(o => {
        const pp = ready?.years.find(y => y.year === 2026)?.people.find(p => p.personId === o.id);
        const f = ws.forecasts.find(x => x.personId === o.id && x.year === 2026);
        return <div key={o.id} className="composition wide">
          {owners.length > 1 && <p className="tile-k">{personName(ws.household, o.id)}</p>}
          {!f ? <p className="small">No forecast yet.</p> : <ul>
            {(pp?.components ?? []).map((c, i) => <li key={i}><span>{c.amountCents !== null && c.amountCents < 0 ? "− " : i ? "+ " : ""}{humanizeDates(c.label)}
              {c.basis && <span className={`basis-tag ${c.basis}`}>{c.basis === "actual" ? "received" : "expected"}</span>}
              <span className="muted small"> · {c.sourceIds.map(s => ws.evidence.find(e => e.id === s)?.label ?? s).join(", ")}</span></span>
              <span className="num">{c.amountCents === null ? <em className="unknown-text">unknown</em> : money(Math.abs(c.amountCents))}{c.status === "estimated" ? " est." : ""}</span></li>)}
            <li className="total"><span>2026 profit used for the subsidy check</span><span className="num">{pp ? (pp.total.valueCents === null ? "unknown" : money(pp.total.valueCents)) : money(forecastTotal(f).valueCents)}</span></li>
          </ul>}
          {f?.method === "year_to_date_plus_remaining" && <p className="hint">Profit so far is through {shortDate(f.asOfDate)}; expenses already paid are inside it and aren&apos;t subtracted again.</p>}
          <button type="button" className="link-btn" onClick={() => setForecastEdit({ personId: o.id, year: 2026 })}>Change this forecast</button>
        </div>;
      })}
      <p className="hint">2027 is only needed when comparing options that reach into next year.{" "}
        <button type="button" className="link-btn" onClick={() => setForecastEdit({ personId: owners[0].id, year: 2027 })}>Edit the 2027 forecast</button></p>
    </section>

    {forecastEdit && <ForecastChange ws={ws} target={forecastEdit} currentEvaluation={calc?.evaluation} currentProjection={projection}
      onKeepOther={(year, row) => { void apply(w => setOtherIncome(w, year, row), "Income updated. Your agreed projects were kept as they are.").then(ok => { if (ok) setForecastEdit(null); }); }}
      onCancel={() => setForecastEdit(null)} onSwitch={setForecastEdit}
      onKeep={f => { void apply(w => setForecast(w, f, "Updated the profit forecast"), "Forecast updated. Your agreed projects were kept as they are.").then(ok => { if (ok) setForecastEdit(null); }); }} />}

    {/* ---- agreed plan on current facts ---- */}
    {agreedProjects.length > 0 && <section className="plan-section" aria-labelledby="agreed-title">
      <h2 id="agreed-title" className="section-title small">Your agreed projects, checked on today&apos;s figures</h2>
      <p className="muted small">Same amounts and dates you agreed — not re-optimized. New ideas for proposals are shown separately.</p>
      <FixedPlan evaluation={calc?.evaluation} stale={stale} />
    </section>}

    {/* ---- projects ---- */}
    <section className="plan-section" id="projects" aria-labelledby="projects-title">
      <div className="row gap wrap between"><h2 id="projects-title" className="section-title small">Projects and payments</h2>
        {!adding && <button type="button" className="btn ghost small" onClick={() => setAdding(true)}><Plus size={14} /> New client offer</button>}</div>
      {ws.projects.length === 0 && !adding && <p className="muted">No projects yet. Your forecast above covers your usual work; add a specific client offer to see its effect.</p>}
      {adding && <AddProjectForm ws={ws} onCancel={() => setAdding(false)} onAdd={p => {
        let created = "";
        void apply(w => { const r = addProject(w, p); created = r.projectId; return r.workspace; }, `Added “${p.title}” as a proposal.`).then(ok => { if (ok) { setAdding(false); setCompareId(created); } });
      }} />}
      <div className="project-list">
        {ws.projects.map(p => <ProjectCard key={p.id} ws={ws} project={p} comparing={compareId === p.id}
          onRecord={(lineId, a) => void apply(w => recordActual(w, p.id, lineId, a), "Payment recorded. It replaces the expected amount in your forecast.")}
          onCorrect={(lineId, a) => void apply(w => correctActual(w, p.id, lineId, a), "Correction saved. The earlier record stays in the history.")}
          onCancelLine={lineId => void apply(w => cancelExpected(w, p.id, lineId), "Expected payment cancelled.")}
          editConditions={fixProject === p.id}
          onFindTerms={() => { setDealId(p.id); setChosen(null); setTimeout(() => document.getElementById("deal-panel")?.scrollIntoView({ behavior: "smooth" }), 30); }}
          onConditions={c => { setFixProject(null); void apply(w => setProjectConditions(w, p.id, c), "Conditions saved."); }}
          onStatus={s => void apply(w => setProjectStatus(w, p.id, s), s === "cancelled" ? "Project cancelled. Received payments stay in the forecast." : "Project status updated.")}
          onCompare={() => { setCompareId(p.id); setTimeout(() => document.getElementById("compare-panel")?.scrollIntoView({ behavior: "smooth" }), 30); }} />)}
      </div>
    </section>

    {dealId && ws.projects.some(p => p.id === dealId) && <DealPanel key={dealId} ws={ws} project={ws.projects.find(p => p.id === dealId)!}
      onClose={() => { setDealId(null); setChosen(null); }} onGoToForecast={() => { setForecastEdit({ personId: owners[0].id, year: 2026 }); setTimeout(() => document.getElementById("forecast-change")?.scrollIntoView({ behavior: "smooth" }), 30); }}
      onSaveGoal={async built => {
        if (pending) { setNotice({ tone: "warn", text: "Save or discard the change that didn't go through first." }); return null; }
        try { const saved = await commit(ws, saveDealGoal(ws, built.goal, built.space, built.cash)); setWs(saved); return saved; }
        catch (e) { setNotice({ tone: "warn", text: describeSaveError(e) }); if (e instanceof WorkspaceConflictError && e.current) setWs(e.current); return null; }
      }}
      onChoose={(variant, result) => { setChosen({ variant, result }); setTimeout(() => document.getElementById("choose-terms")?.scrollIntoView({ behavior: "smooth" }), 30); }} />}
    {chosen && dealId && <ChooseTerms ws={ws} projectId={dealId} variant={chosen.variant} result={chosen.result} onCancel={() => setChosen(null)} />}

    {compareId && <ComparePanel ws={ws} projectId={compareId} state={compare}
      onFixProject={() => { setFixProject(compareId); setTimeout(() => document.getElementById(`conditions-${compareId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }} stale={!compare || compare.pending || compare.key !== key} onClose={() => setCompareId(null)} onDrawer={setDrawer}
      onAgree={(scenarioId) => {
        const r = compare?.result; if (!r || r.status !== "ready") return;
        const s = r.comparison.scenarios.find(x => x.id === scenarioId); if (!s) return;
        const done = (ok: boolean) => { if (ok) setCompareId(null); };
        if (s.kind === "decline") { void apply(w => setProjectStatus(w, compareId, "cancelled"), "Declined. The proposal is marked cancelled; nothing else changed.").then(done); return; }
        void apply(w => agreeToOption(w, compareId, s, r.fingerprint), `Agreed: ${humanizeDates(s.label)}. It's now part of your forecast.`).then(done);
      }} />}

    {/* ---- SEP ---- */}
    <section className="plan-section" aria-labelledby="sep-title">
      <h2 id="sep-title" className="section-title small">SEP-IRA contributions</h2>
      <p className="muted small">One yearly goal per person and tax year, shared by all projects. Only contributions you record with an amount and date count as paid.</p>
      <SepPanel ws={ws} rows={sep} legal={new Map(sep.map(r => [`${r.personId}|${r.year}`, r.legalLimitCents]))} budgetRemaining={evaluation?.futureContributionBudgetRemainingCents ?? null}
        onRecord={c => void apply(w => recordContribution(w, c), "Contribution recorded.")}
        onGoal={(personId, year, cents) => void apply(w => setSepTarget(w, personId, year, cents), "Goal updated. Money already contributed is unchanged.")}
        onBudget={(cents, asOf) => void apply(w => setFutureBudget(w, cents, asOf), "Saved.")} />
    </section>

    {/* ---- export + history ---- */}
    <div className="plan-grid">
      <section className="plan-section" aria-labelledby="history-title">
        <h2 id="history-title" className="section-title small"><History size={18} aria-hidden="true" /> History</h2>
        <ol className="history">{[...ws.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map(e => <li key={e.id}>
          <span className="muted small">{dateTime(e.at)}</span><span>{humanizeDates(e.description)}</span></li>)}</ol>
      </section>
      <section className="plan-section" aria-labelledby="export-title">
        <h2 id="export-title" className="section-title small">Export</h2>
        <p className="muted small">An <strong>annual income forecast explanation</strong>: how each profit forecast is built, what is confirmed vs estimated, agreed project payments, SEP-IRA status, sources and missing information. Useful for your accountant or when updating your Marketplace estimate — Headroom doesn&apos;t send it anywhere, and it isn&apos;t an official form.</p>
        <div className="row gap wrap">{([2026, 2027] as TaxYear[]).map(y => <button key={y} type="button" className={`btn ${y === 2026 ? "secondary" : "ghost small"}`} disabled={!!pending || stale || busy === `pdf${y}`}
          onClick={async () => { setBusy(`pdf${y}`);
            try { downloadBlob(await exportForecastPdf(ws, y, await workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION)), `headroom-forecast-${y}-${fileStamp()}.pdf`); setNotice({ tone: "ok", text: `${y} forecast explanation downloaded.` }); }
            catch (e) { setNotice({ tone: "warn", text: `The PDF couldn't be created: ${e instanceof Error ? e.message : String(e)}` }); }
            setBusy(null); }}><Download size={16} /> {busy === `pdf${y}` ? "Preparing…" : `${y} forecast explanation (PDF)`}</button>)}</div>
        {(pending || stale) && <p className="hint">Available once the latest change is saved and calculated.</p>}
        <button type="button" className="btn ghost small" onClick={() => downloadBlob(exportWorkspaceJson(ws), `headroom-household-${fileStamp()}.json`)}><Download size={15} /> Plan data (JSON, restorable)</button>
        <button type="button" className="btn ghost small" onClick={async () => { if (!window.confirm("Delete this household plan? Its revisions are removed too.")) return;
          try { await workspaceRepo().remove(ws.id); router.push("/household?deleted=1"); } catch (e) { setNotice({ tone: "warn", text: `It couldn't be deleted: ${e instanceof Error ? e.message : String(e)}` }); } }}><Trash2 size={15} /> Delete this plan</button>
      </section>
    </div>
    <CalculationDrawer content={drawer} onClose={() => setDrawer(null)} />
  </div>;
}

/* ---------- helpers & sub-views ---------- */

/** The plan as agreed on today's facts (Claude 2's evaluateHouseholdWorkspace) — never re-optimized. */
function FixedPlan({ evaluation, stale }: { evaluation?: WorkspaceEvaluationResult; stale: boolean }) {
  if (!evaluation) return <p className="loading-line"><span className="spinner" aria-hidden="true" /> Checking…</p>;
  if (evaluation.status !== "ready") return <p className="notice warn">{evaluation.message} {evaluation.fields.slice(0, 3).map(f => f.reason).join(" ")}</p>;
  const fp = fixedPlanOf(evaluation);
  const a = evaluation.agreed;
  return <div className={`agreed-list ${stale ? "is-stale" : ""}`}>
    {a.result && <p className="small">What&apos;s still open (payments not yet received and SEP-IRA money still to contribute) adds <strong className={`num ${signClass(a.result.twoYearCashDeltaCents)}`}>{signedMoney(a.result.twoYearCashDeltaCents)}</strong> cash after both tax years, compared with only what has already happened.</p>}
    {fp && <div className="table-wrap"><table className="years-table compact">
      <thead><tr><th scope="col">Plan as agreed</th>{fp.years.map(y => <th scope="col" key={y.year}>{y.year}</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">Income counted for the subsidy</th>{fp.years.map(y => <td key={y.year} className="num">{y.risk ? `${money(y.risk.magiCents)} of ${money(y.risk.thresholdMagiCents)}` : "—"}</td>)}</tr>
        <tr><th scope="row">Premium tax credit</th>{fp.years.map(y => <td key={y.year} className="num">{y.risk ? money(y.risk.ptcCents) : "—"}</td>)}</tr>
        <tr><th scope="row">Settlement when you file</th>{fp.years.map(y => <td key={y.year} className="num">{!y.risk ? "—" : y.risk.settlementCents === 0 ? "None" : y.risk.settlementCents > 0 ? `Repay ${money(y.risk.settlementCents)}` : `Extra ${money(-y.risk.settlementCents)}`}</td>)}</tr>
        <tr><th scope="row">SEP-IRA legal maximum</th>{fp.years.map(y => <td key={y.year} className="num">{y.legalSepLimitCents === null ? "—" : money(y.legalSepLimitCents)}</td>)}</tr>
      </tbody></table></div>}
    {a.creditLostYears.length > 0 && <p className="notice warn small" role="status">As agreed, the open payments push {a.creditLostYears.join(" and ")} household income above the limit: that year&apos;s premium tax credit is lost. Keeping your facts accurate is still right — compare options for open proposals or talk to your client about payments that haven&apos;t happened yet.</p>}
    {!a.stillFeasible && <p className="notice warn small">The plan as agreed no longer fits: {a.reasons.map(humanizeDates).join(" ")}</p>}
    {fp?.pendingYears.map(y => <p key={y.year} className="hint">{y.year} isn&apos;t calculated yet: {y.fields[0]?.reason ?? "facts are missing"}</p>)}
    {fp && fp.notChecked.length > 0 && <p className="hint">Not checked: {fp.notChecked.join(" ")}</p>}
  </div>;
}

function WorkspaceBlocked({ result, ws, onFix, onFixProject }: { result: Exclude<HouseholdProjectionResult, { status: "ready" }>; ws: HouseholdWorkspace;
  onFix: (t: { personId: string; year: TaxYear }) => void; onFixProject?: () => void }) {
  return <div className={`blocked ${result.status === "needs_data" ? "needs" : result.status}`} role="status">
    <div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" /><div><h3>{result.status === "needs_data" ? "A few facts are needed first" : result.status === "unsupported" ? "Headroom can't give a reliable answer for this yet" : "The calculation isn't available right now"}</h3><p>{result.message}</p></div></div>
    {result.fields.length > 0 && <ul className="missing-list">{result.fields.filter((f, i, all) => all.findIndex(x => x.reason === f.reason) === i).map(f => { const t = forecastTarget(f.path, ws);
      const projectField = /^(opportunity|constraints|projects)/.test(f.path);
      return <li key={f.path + f.reason}><div><strong>{t ? `${t.year} · ${personName(ws.household, t.personId)} · Business profit forecast` : projectField ? "Project details" : describeWorkspacePath(f.path, ws)}</strong><span>{f.reason}</span></div>
        {t && <button type="button" className="btn small secondary" onClick={() => onFix(t)}>Fix this</button>}
        {!t && projectField && onFixProject && <button type="button" className="btn small secondary" onClick={onFixProject}>Fix this</button>}</li>; })}</ul>}
  </div>;
}

function describeWorkspacePath(path: string, ws?: HouseholdWorkspace): string {
  const m = /^household\.years\[(\d)\]\.otherIncomes\[(\d+)\]\.(\w+)/.exec(path);
  if (m && ws) { const y = ws.household.years[Number(m[1])]; const row = y?.otherIncomes[Number(m[2])];
    return `${y?.year ?? ""} · ${row ? personName(ws.household, row.personId) : "Person"} · ${FIELD_LABELS[m[3]] ?? m[3]}`; }
  if (/^retirement/.test(path)) return "SEP-IRA records";
  return path.replace(/^years\.(\d)\./, (_, i) => `${i === "0" ? 2026 : 2027} · `).replace(/[.[\]]+/g, " · ");
}

function forecastTarget(path: string, ws: HouseholdWorkspace): { personId: string; year: TaxYear } | null {
  const k = /^forecasts\[([^:\]]+):(\d{4})\]/.exec(path); if (k) return { personId: k[1], year: Number(k[2]) as TaxYear };
  const i = /^forecasts\[?\.?(\d+)\]?/.exec(path); if (i) { const f = ws.forecasts[Number(i[1])]; return f ? { personId: f.personId, year: f.year } : null; }
  const o = /^household\.years\[(\d)\]\.otherIncomes\[(\d+)\]/.exec(path);
  if (o) { const y = ws.household.years[Number(o[1])]; const row = y?.otherIncomes[Number(o[2])]; return row ? { personId: row.personId, year: y.year } : null; }
  return null;
}

const OTHER_FIELDS: Array<[keyof OtherIncome, string, string]> = [
  ["grossWages", "Gross pay", "Year-to-date from the latest pay stub plus expected remaining paychecks."],
  ["payrollPretaxDeductions", "Pre-tax payroll deductions", "401(k), HSA and similar."],
  ["w2Box1", "Taxable wages (W-2 box 1)", "Estimate from pay stubs; no 2026 W-2 needed."],
  ["socialSecurityWages", "Social Security wages (box 3)", ""],
  ["medicareWages", "Medicare wages (box 5)", ""],
  ["taxableInterest", "Taxable interest", ""],
  ["taxExemptInterest", "Tax-exempt interest", "Still counts toward subsidy income."],
];

/**
 * “My income changed”: business profit (forecast) or other income (wages, interest). The effect
 * on the plan AS AGREED is shown first; keeping the new figures never requires a new agreement.
 */
function ForecastChange({ ws, target, currentEvaluation, currentProjection, onCancel, onKeep, onKeepOther, onSwitch }: {
  ws: HouseholdWorkspace; target: { personId: string; year: TaxYear }; currentEvaluation?: WorkspaceEvaluationResult; currentProjection?: HouseholdProjectionResult;
  onCancel: () => void; onKeep: (f: ProfitForecast) => void; onKeepOther: (year: TaxYear, row: OtherIncome) => void; onSwitch: (t: { personId: string; year: TaxYear }) => void;
}) {
  const [kind, setKind] = useState<"profit" | "other">("profit");
  const existing = ws.forecasts.find(f => f.personId === target.personId && f.year === target.year) ?? blankForecast(target.personId, target.year);
  const yi = ws.household.years.findIndex(y => y.year === target.year);
  const existingOther = ws.household.years[yi]?.otherIncomes.find(r => r.personId === target.personId);
  const [f, setF] = useState<ProfitForecast>(existing);
  const [other, setOther] = useState<OtherIncome | undefined>(existingOther);
  const [invalid, setInvalid] = useState(0);
  const [review, setReview] = useState<{ projection: HouseholdProjectionResult; evaluation: WorkspaceEvaluationResult; forKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(existing); setOther(existingOther); setReview(null); }, [target.personId, target.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const managed = ws.projects.filter(p => p.ownerPersonId === target.personId && p.status !== "proposed").map(p => p.title);
  const editKey = JSON.stringify(kind === "profit" ? f : other);
  const changed = kind === "profit" ? JSON.stringify(existing) !== editKey : JSON.stringify(existingOther) !== editKey;
  const candidate = () => kind === "profit" ? setForecast(ws, f) : setOtherIncome(ws, target.year, other!);

  async function doReview() {
    setBusy(true);
    const c = candidate();
    const [projection, evaluation] = await Promise.all([projectHousehold(c), evaluatePlan(c)]);
    setReview({ projection, evaluation, forKey: editKey }); setBusy(false);
  }
  const before = currentProjection?.status === "ready" ? currentProjection.currentRisk : null;
  const after = review?.projection.status === "ready" ? review.projection.currentRisk : null;
  const reviewCurrent = review && review.forKey === editKey;
  const ev = (e?: WorkspaceEvaluationResult) => e?.status === "ready" ? e : null;
  const beforeEval = ev(currentEvaluation), afterEval = ev(review?.evaluation);

  return <section id="forecast-change" className="plan-section changed" aria-labelledby="fc-title">
    <h2 id="fc-title" className="section-title small">My income changed · {personName(ws.household, target.personId)} · {target.year}</h2>
    <div className="row gap wrap">{ws.household.people.filter(p => p.role !== "dependent").flatMap(p => ([2026, 2027] as TaxYear[]).map(y =>
      <button key={p.id + y} type="button" className={`btn small ${p.id === target.personId && y === target.year ? "secondary" : "ghost"}`} aria-pressed={p.id === target.personId && y === target.year} onClick={() => onSwitch({ personId: p.id, year: y })}>{personName(ws.household, p.id)} · {y}</button>))}</div>
    <div className="seg" role="radiogroup" aria-label="Which income changed?">
      <label className={kind === "profit" ? "on" : ""}><input type="radio" checked={kind === "profit"} onChange={() => { setKind("profit"); setReview(null); }} />Business profit</label>
      <label className={kind === "other" ? "on" : ""}><input type="radio" checked={kind === "other"} onChange={() => { setKind("other"); setReview(null); }} />Wages or interest</label>
    </div>
    <LocalInvalidProvider onCountChange={setInvalid}>
      {kind === "profit" ? <ForecastEditor forecast={f} year={target.year} personLabel={personName(ws.household, target.personId)} evidence={ws.evidence}
        pathBase={`forecast-edit.${target.personId}.${target.year}`} managedProjects={managed} onChange={setF} />
        : other ? <div className="grid-2">{OTHER_FIELDS.map(([k, label, hint]) => <MoneyField key={k} path={`other-edit.${target.personId}.${target.year}.${k}`} label={label} hint={hint || undefined}
          fact={other[k] as MoneyFact} evidence={ws.evidence} noneLabel="None" onChange={fact => setOther({ ...other, [k]: fact })} />)}</div>
        : <p className="muted">No income row for this person and year.</p>}
    </LocalInvalidProvider>
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={!changed || invalid > 0 || busy} onClick={doReview}>{busy ? "Checking…" : "Check the effect on my plan"}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Discard</button>
      {invalid > 0 && <span className="field-error">Fix {invalid} amount{invalid > 1 ? "s" : ""} first.</span>}
    </div>
    {review && !reviewCurrent && <p className="stale-banner">You changed the figures again. Check the effect again before keeping them.</p>}
    {reviewCurrent && <div className="change-review">
      {review.projection.status !== "ready" ? <p className="notice warn">{review.projection.message} {review.projection.fields.map(x => x.reason).join(" ")}</p> : <>
        <h3 className="small-head">1 · Your plan as agreed, on the new figures</h3>
        <div className="before-after">
          <div><p className="k">Before</p><p className="v num">{before ? money(before.subsidyCents) : "—"}</p><p className="muted small">2026 credit · {before ? RISK_TEXT[before.state] : ""}</p></div>
          <div><p className="k">After</p><p className={`v num ${after && before && after.subsidyCents < before.subsidyCents ? "neg" : ""}`}>{after ? money(after.subsidyCents) : "—"}</p><p className="muted small">2026 credit · {after ? RISK_TEXT[after.state] : ""}</p></div>
        </div>
        {(beforeEval?.agreed.result || afterEval?.agreed.result) && <p className="small">Open agreements (payments not yet received, SEP-IRA still to contribute): {beforeEval?.agreed.result ? signedMoney(beforeEval.agreed.result.twoYearCashDeltaCents) : "—"} → <strong>{afterEval?.agreed.result ? signedMoney(afterEval.agreed.result.twoYearCashDeltaCents) : "—"}</strong> cash after both tax years. Same amounts and dates.</p>}
        {afterEval && afterEval.agreed.creditLostYears.length > 0 && <p className="notice warn" role="status">On the new figures your plan as agreed loses the {afterEval.agreed.creditLostYears.join(" and ")} premium tax credit. You can still keep these figures — they record what you expect. Then compare options for open proposals, or talk to your client about payments that haven&apos;t happened yet.</p>}
        {afterEval && !afterEval.agreed.stillFeasible && <p className="notice warn">{afterEval.agreed.reasons.map(humanizeDates).join(" ")}</p>}
        <h3 className="small-head">2 · New options</h3>
        <p className="small muted">Open proposals are compared separately after you keep the figures. Agreed projects stay exactly as agreed.</p>
        <div className="row gap"><button type="button" className="btn primary" onClick={() => kind === "profit" ? onKeep(f) : onKeepOther(target.year, other!)}>Keep these figures</button></div>
      </>}
    </div>}
  </section>;
}

function ComparePanel({ ws, projectId, state, stale, onClose, onAgree, onDrawer, onFixProject }: {
  ws: HouseholdWorkspace; projectId: string; state: { result?: WorkspaceComparisonResult; pending: boolean } | null; stale: boolean;
  onClose: () => void; onAgree: (scenarioId: string) => void; onDrawer: (c: DrawerContent) => void; onFixProject: () => void;
}) {
  const project: Project | undefined = ws.projects.find(p => p.id === projectId);
  const input = useMemo(() => workspaceToCaseInput(ws, { candidateProjectId: projectId }).input, [ws, projectId]);
  if (!project) return null;
  const r = state?.result;
  return <section id="compare-panel" className="plan-section" aria-labelledby="cmp-title">
    <div className="row gap wrap between"><h2 id="cmp-title" className="section-title small">Options for “{project.title}”</h2>
      <button type="button" className="btn ghost small" onClick={onClose}>Close</button></div>
    {!r ? <p className="loading-line"><span className="spinner" aria-hidden="true" /> Comparing on top of your plan…</p>
      : r.status !== "ready" ? <WorkspaceBlocked result={r} ws={ws} onFix={() => document.getElementById("forecast-title")?.scrollIntoView({ behavior: "smooth" })}
        onFixProject={onFixProject} /> : <>
        <p className="baseline-note"><strong>Compared with: {r.baseline.label}.</strong> {r.baseline.description}</p>
        <ComparisonView comparison={r.comparison} input={input} stale={stale} onShowCalc={onDrawer} onUse={onAgree} useLabel="Agree to this option" />
        <p className="hint"><FileSearch size={13} aria-hidden="true" /> Agreeing adds this project to your forecast with the option&apos;s payments. A SEP-IRA amount in an option raises your yearly goal by that amount — it is not a second full contribution.</p>
      </>}
    <Link href="#projects" className="link-btn">Back to projects <ArrowRight size={13} /></Link>
  </section>;
}
