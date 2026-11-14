"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Download, FileSearch, FlaskConical, History, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { TaxYear } from "@/domain/contracts";
import {
  WORKSPACE_FILE_KIND, effectiveLine, forecastTotal, workspaceToCaseInput,
  type HouseholdProjectionResult, type HouseholdWorkspace, type ProfitForecast, type Project, type WorkspaceComparisonResult,
} from "@/domain/household-workspace";
import { dateTime, humanizeDates, money, shortDate, signClass, signedMoney } from "@/features/format";
import { personName } from "@/features/household/draft";
import { LocalInvalidProvider } from "@/features/household/invalidInputs";
import { CalculationDrawer, type DrawerContent } from "@/features/results/CalculationDrawer";
import { ComparisonView } from "@/features/results/ComparisonView";
import { downloadJson, fileStamp } from "@/features/plan/storage";
import { ForecastEditor } from "./ForecastEditor";
import { checkAgreedProjects, compareProject, projectHousehold, sepRows, type AgreedCheck } from "./engine";
import {
  addProject, agreeToOption, blankForecast, cancelExpected, correctActual, recordActual, recordContribution, setForecast, setFutureBudget,
  setProjectStatus, setSepTarget,
} from "./ops";
import { readDraft, removeDraft, writeDraft } from "./draftStore";
import { AddProjectForm, ProjectCard, SepPanel } from "./parts";

type Calc = { key: string; pending: boolean; projection?: HouseholdProjectionResult; agreed?: AgreedCheck[]; error?: string };
type Notice = { tone: "ok" | "warn"; text: string } | null;

const RISK_TEXT = { below_cliff: "Below the limit", at_risk: "Close to the limit", over_cliff: "Above the limit", no_credit: "No credit expected" } as const;
const RISK_TONE = { below_cliff: "good", at_risk: "warn", over_cliff: "bad", no_credit: "neutral" } as const;

export function HouseholdPlanView({ id }: { id: string }) {
  const router = useRouter();
  const [ws, setWs] = useState<HouseholdWorkspace | null | undefined>(undefined);
  const [notice, setNotice] = useState<Notice>(null);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ key: string; result?: WorkspaceComparisonResult; pending: boolean } | null>(null);
  const [forecastEdit, setForecastEdit] = useState<{ personId: string; year: TaxYear } | null>(null);
  const [adding, setAdding] = useState(false);
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const req = useRef(0);

  useEffect(() => { setWs(readDraft(id)); }, [id]);
  const key = ws ? JSON.stringify([ws.forecasts, ws.projects, ws.retirement, ws.household, ws.planning]) : "";

  useEffect(() => {
    if (!ws) return;
    const n = ++req.current;
    setCalc(c => ({ ...(c ?? {}), key, pending: true }));
    const t = setTimeout(async () => {
      try {
        const [projection, agreed] = await Promise.all([projectHousehold(ws), checkAgreedProjects(ws)]);
        if (n === req.current) setCalc({ key, pending: false, projection, agreed });
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

  const apply = useCallback((fn: (w: HouseholdWorkspace) => HouseholdWorkspace, okText: string) => {
    if (!ws) return false;
    try {
      const next = fn(ws);
      writeDraft(next);
      setWs(next); setNotice({ tone: "ok", text: okText });
      return true;
    } catch (e) {
      setNotice({ tone: "warn", text: `That change wasn't kept: ${e instanceof Error ? e.message : String(e)} Your other figures are unchanged.` });
      return false;
    }
  }, [ws]);

  if (ws === undefined) return <div className="shell page-pad"><p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Opening your household plan…</p></div>;
  if (ws === null) return <div className="shell page-pad"><h1 className="page-title">We couldn&apos;t find this household plan</h1>
    <p className="intro">It may have been deleted, or it was kept in a different browser.</p>
    <div className="row gap"><Link className="btn primary" href="/household">Household plans</Link><Link className="btn ghost" href="/check">Check my subsidy</Link></div></div>;

  const stale = !calc || calc.pending || calc.key !== key;
  const projection = calc?.projection;
  const ready = projection?.status === "ready" ? projection : null;
  const risk = ready?.currentRisk ?? null;
  const owners = ws.household.people.filter(p => p.role !== "dependent");
  const agreedProjects = ws.projects.filter(p => p.status === "agreed");
  const proposals = ws.projects.filter(p => p.status === "proposed");
  const sep = sepRows(ws);
  const next = nextAction(ws);

  return <div className="shell plan-page household-plan">
    <div className="plan-head">
      <div>
        <p className="eyebrow">Household plan{ws.household.isSynthetic ? " · sample household" : ""}</p>
        <h1 className="page-title">{ws.household.title}</h1>
        <p className="save-status small"><span className="dot" aria-hidden="true" />Kept in this browser as a draft · updated {dateTime(ws.updatedAt)}. Not synced to other devices.</p>
      </div>
      <div className="plan-head-actions">
        <button type="button" className="btn primary" onClick={() => { setForecastEdit({ personId: owners[0].id, year: 2026 }); setTimeout(() => document.getElementById("forecast-change")?.scrollIntoView({ behavior: "smooth" }), 30); }}><RefreshCw size={17} /> My income changed</button>
        <button type="button" className="btn secondary" onClick={() => { setAdding(true); setTimeout(() => document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" }), 30); }}><Plus size={17} /> New client offer</button>
      </div>
    </div>
    {ws.household.isSynthetic && <p className="sample-banner compact small"><FlaskConical size={16} aria-hidden="true" /> <span>Synthetic sample household. Plan prices are county candidates or illustrative.</span></p>}
    {notice && <p className={`notice ${notice.tone === "warn" ? "warn" : "ok"}`} role={notice.tone === "warn" ? "alert" : "status"}>{notice.text}</p>}
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
          <p className="tile-k">Next step</p>
          {next ? <><p className="tile-title">{next.title}</p><p className="tile-sub">{next.detail}</p></> : <p className="tile-line">Nothing is due. Add a client offer or update your forecast when something changes.</p>}
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
            {(pp?.components ?? []).map((c, i) => <li key={i}><span>{c.amountCents !== null && c.amountCents < 0 ? "− " : i ? "+ " : ""}{c.label}
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

    {forecastEdit && <ForecastChange ws={ws} target={forecastEdit} currentAgreed={calc?.agreed ?? []} currentProjection={projection}
      onCancel={() => setForecastEdit(null)} onSwitch={setForecastEdit}
      onKeep={f => { if (apply(w => setForecast(w, f, "Updated the profit forecast"), "Forecast updated. Your agreed projects were kept as they are.")) setForecastEdit(null); }} />}

    {/* ---- agreed plan on current facts ---- */}
    {agreedProjects.length > 0 && <section className="plan-section" aria-labelledby="agreed-title">
      <h2 id="agreed-title" className="section-title small">Your agreed projects, checked on today&apos;s figures</h2>
      <p className="muted small">Same amounts and dates you agreed — not re-optimized. New ideas for proposals are shown separately.</p>
      <AgreedList checks={calc?.agreed ?? []} stale={stale} />
    </section>}

    {/* ---- projects ---- */}
    <section className="plan-section" id="projects" aria-labelledby="projects-title">
      <div className="row gap wrap between"><h2 id="projects-title" className="section-title small">Projects and payments</h2>
        {!adding && <button type="button" className="btn ghost small" onClick={() => setAdding(true)}><Plus size={14} /> New client offer</button>}</div>
      {ws.projects.length === 0 && !adding && <p className="muted">No projects yet. Your forecast above covers your usual work; add a specific client offer to see its effect.</p>}
      {adding && <AddProjectForm ws={ws} onCancel={() => setAdding(false)} onAdd={p => {
        let created = "";
        if (apply(w => { const r = addProject(w, p); created = r.projectId; return r.workspace; }, `Added “${p.title}” as a proposal.`)) { setAdding(false); setCompareId(created); }
      }} />}
      <div className="project-list">
        {ws.projects.map(p => <ProjectCard key={p.id} ws={ws} project={p} comparing={compareId === p.id}
          onRecord={(lineId, a) => apply(w => recordActual(w, p.id, lineId, a), "Payment recorded. It replaces the expected amount in your forecast.")}
          onCorrect={(lineId, a) => apply(w => correctActual(w, p.id, lineId, a), "Correction saved. The earlier record stays in the history.")}
          onCancelLine={lineId => apply(w => cancelExpected(w, p.id, lineId), "Expected payment cancelled.")}
          onStatus={s => apply(w => setProjectStatus(w, p.id, s), s === "cancelled" ? "Project cancelled. Received payments stay in the forecast." : "Project status updated.")}
          onCompare={() => { setCompareId(p.id); setTimeout(() => document.getElementById("compare-panel")?.scrollIntoView({ behavior: "smooth" }), 30); }} />)}
      </div>
    </section>

    {compareId && <ComparePanel ws={ws} projectId={compareId} state={compare} stale={!compare || compare.pending || compare.key !== key} onClose={() => setCompareId(null)} onDrawer={setDrawer}
      onAgree={(scenarioId) => {
        const r = compare?.result; if (!r || r.status !== "ready") return;
        const s = r.comparison.scenarios.find(x => x.id === scenarioId); if (!s) return;
        if (s.kind === "decline") { if (apply(w => setProjectStatus(w, compareId, "cancelled"), "Declined. The proposal is marked cancelled; nothing else changed.")) setCompareId(null); return; }
        if (apply(w => agreeToOption(w, compareId, s, r.fingerprint), `Agreed: ${humanizeDates(s.label)}. It's now part of your forecast.`)) setCompareId(null);
      }} />}

    {/* ---- SEP ---- */}
    <section className="plan-section" aria-labelledby="sep-title">
      <h2 id="sep-title" className="section-title small">SEP-IRA contributions</h2>
      <p className="muted small">One yearly goal per person and tax year, shared by all projects. Only contributions you record with an amount and date count as paid.</p>
      <SepPanel ws={ws} rows={sep} legal={new Map()} budgetRemaining={null}
        onRecord={c => apply(w => recordContribution(w, c), "Contribution recorded.")}
        onGoal={(personId, year, cents) => apply(w => setSepTarget(w, personId, year, cents), "Goal updated. Money already contributed is unchanged.")}
        onBudget={(cents, asOf) => apply(w => setFutureBudget(w, cents, asOf), "Saved.")} />
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
        <button type="button" className="btn ghost" onClick={() => downloadJson({ kind: WORKSPACE_FILE_KIND, workspaceVersion: ws.workspaceVersion, exportedAt: new Date().toISOString(), workspace: ws }, `headroom-household-${fileStamp()}.json`)}>
          <Download size={16} /> Download plan data (JSON)</button>
        <p className="hint">Your forecast facts, projects, payments and contributions. The annual income forecast explanation (PDF) is added here once that export is connected.</p>
        <button type="button" className="btn ghost small" onClick={() => { if (window.confirm("Delete this household plan draft from this browser?")) { removeDraft(ws.id); router.push("/household"); } }}><Trash2 size={15} /> Delete this plan</button>
      </section>
    </div>
    <CalculationDrawer content={drawer} onClose={() => setDrawer(null)} />
  </div>;
}

/* ---------- helpers & sub-views ---------- */

function nextAction(ws: HouseholdWorkspace): { title: string; detail: string } | null {
  const lines = ws.projects.filter(p => p.status === "agreed").flatMap(p => p.receipts.map(l => ({ p, l, e: effectiveLine(l) })))
    .filter(x => x.e.basis === "expected" && x.e.date).sort((a, b) => a.e.date!.localeCompare(b.e.date!));
  if (lines[0]) return { title: `Expect ${money(lines[0].e.amountCents)} from “${lines[0].p.title}”`, detail: `Due ${shortDate(lines[0].e.date)}. When it arrives, record the actual amount and date.` };
  for (const t of ws.retirement.targets) {
    const paid = ws.retirement.contributions.filter(c => c.personId === t.personId && c.taxYear === t.year).reduce((s, c) => s + c.amountCents, 0);
    if (t.targetCents > paid) return { title: `Contribute ${money(t.targetCents - paid)} more to the ${t.year} SEP-IRA`, detail: `Goal ${money(t.targetCents)}, contributed ${money(paid)} so far. Deadline: your ${t.year} tax return due date (with extensions).` };
  }
  return null;
}

function AgreedList({ checks, stale }: { checks: AgreedCheck[]; stale: boolean }) {
  if (!checks.length) return <p className="loading-line"><span className="spinner" aria-hidden="true" /> Checking…</p>;
  return <ul className={`agreed-list ${stale ? "is-stale" : ""}`}>{checks.map(({ project, result }) => <li key={project.id}>
    <p className="check-title">{project.title}{project.agreedDecision ? <span className="muted small"> · {humanizeDates(project.agreedDecision.label)}</span> : null}</p>
    {result.status !== "ready" ? <p className="small warn-text">{result.message}</p> : result.agreed ? <>
      <p className="small">Effect of this agreement: <strong className={`num ${signClass(result.agreed.twoYearCashDeltaCents)}`}>{signedMoney(result.agreed.twoYearCashDeltaCents)}</strong> cash after both tax years, compared with not doing it.
        {" "}2026 credit with it: <strong className="num">{money(result.agreed.years[0].ptcCents)}</strong>.</p>
      {result.agreed.years[0].ptcCents === 0 && <p className="notice warn small" role="status">With this agreement your 2026 premium tax credit is $0 on today&apos;s figures.</p>}
      {!result.stillFeasible && <p className="notice warn small">This agreement no longer fits: {result.reasons.join(" ")}</p>}
    </> : <p className="small">{result.reasons.join(" ") || "It can't be calculated on the current figures."}</p>}
  </li>)}</ul>;
}

function WorkspaceBlocked({ result, ws, onFix }: { result: Exclude<HouseholdProjectionResult, { status: "ready" }>; ws: HouseholdWorkspace; onFix: (t: { personId: string; year: TaxYear }) => void }) {
  return <div className={`blocked ${result.status === "needs_data" ? "needs" : result.status}`} role="status">
    <div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" /><div><h3>{result.status === "needs_data" ? "A few facts are needed first" : result.status === "unsupported" ? "Headroom can't give a reliable answer for this yet" : "The calculation isn't available right now"}</h3><p>{result.message}</p></div></div>
    {result.fields.length > 0 && <ul className="missing-list">{result.fields.map(f => { const t = forecastTarget(f.path, ws);
      return <li key={f.path + f.reason}><div><strong>{t ? `${t.year} · ${personName(ws.household, t.personId)} · Business profit forecast` : f.path}</strong><span>{f.reason}</span></div>
        {t && <button type="button" className="btn small secondary" onClick={() => onFix(t)}>Fix this</button>}</li>; })}</ul>}
  </div>;
}

function forecastTarget(path: string, ws: HouseholdWorkspace): { personId: string; year: TaxYear } | null {
  const k = /^forecasts\[([^:\]]+):(\d{4})\]/.exec(path); if (k) return { personId: k[1], year: Number(k[2]) as TaxYear };
  const i = /^forecasts\[?\.?(\d+)\]?/.exec(path); if (i) { const f = ws.forecasts[Number(i[1])]; return f ? { personId: f.personId, year: f.year } : null; }
  return null;
}

/** Forecast change: shows the effect on the AGREED plan first; keeping it never requires a new agreement. */
function ForecastChange({ ws, target, currentAgreed, currentProjection, onCancel, onKeep, onSwitch }: {
  ws: HouseholdWorkspace; target: { personId: string; year: TaxYear }; currentAgreed: AgreedCheck[]; currentProjection?: HouseholdProjectionResult;
  onCancel: () => void; onKeep: (f: ProfitForecast) => void; onSwitch: (t: { personId: string; year: TaxYear }) => void;
}) {
  const existing = ws.forecasts.find(f => f.personId === target.personId && f.year === target.year) ?? blankForecast(target.personId, target.year);
  const [f, setF] = useState<ProfitForecast>(existing);
  const [invalid, setInvalid] = useState(0);
  const [review, setReview] = useState<{ projection: HouseholdProjectionResult; agreed: AgreedCheck[]; forKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(existing); setReview(null); }, [target.personId, target.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const managed = ws.projects.filter(p => p.ownerPersonId === target.personId && p.status !== "proposed").map(p => p.title);
  const fKey = JSON.stringify(f);
  const changed = JSON.stringify(existing) !== fKey;

  async function doReview() {
    setBusy(true);
    const candidate = setForecast(ws, f);
    const [projection, agreed] = await Promise.all([projectHousehold(candidate), checkAgreedProjects(candidate)]);
    setReview({ projection, agreed, forKey: fKey }); setBusy(false);
  }
  const before = currentProjection?.status === "ready" ? currentProjection.currentRisk : null;
  const after = review?.projection.status === "ready" ? review.projection.currentRisk : null;
  const reviewCurrent = review && review.forKey === fKey;

  return <section id="forecast-change" className="plan-section changed" aria-labelledby="fc-title">
    <h2 id="fc-title" className="section-title small">Update the {target.year} profit forecast · {personName(ws.household, target.personId)}</h2>
    <div className="row gap wrap">{ws.household.people.filter(p => p.role !== "dependent").flatMap(p => ([2026, 2027] as TaxYear[]).map(y =>
      <button key={p.id + y} type="button" className={`btn small ${p.id === target.personId && y === target.year ? "secondary" : "ghost"}`} onClick={() => onSwitch({ personId: p.id, year: y })}>{personName(ws.household, p.id)} · {y}</button>))}</div>
    <LocalInvalidProvider onCountChange={setInvalid}>
      <ForecastEditor forecast={f} year={target.year} personLabel={personName(ws.household, target.personId)} evidence={ws.evidence}
        pathBase={`forecast-edit.${target.personId}.${target.year}`} managedProjects={managed} onChange={setF} />
    </LocalInvalidProvider>
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={!changed || invalid > 0 || busy} onClick={doReview}>{busy ? "Checking…" : "Check the effect on my plan"}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Discard</button>
      {invalid > 0 && <span className="field-error">Fix {invalid} amount{invalid > 1 ? "s" : ""} first.</span>}
    </div>
    {review && !reviewCurrent && <p className="stale-banner">You changed the figures again. Check the effect again before keeping them.</p>}
    {reviewCurrent && <div className="change-review">
      {review.projection.status !== "ready" ? <p className="notice warn">{review.projection.message} {review.projection.fields.map(x => x.reason).join(" ")}</p> : <>
        <h3 className="small-head">1 · Your agreed plan on the new forecast</h3>
        <div className="before-after">
          <div><p className="k">Before</p><p className="v num">{before ? money(before.subsidyCents) : "—"}</p><p className="muted small">2026 credit · {before ? RISK_TEXT[before.state] : ""}</p></div>
          <div><p className="k">After</p><p className={`v num ${after && before && after.subsidyCents < before.subsidyCents ? "neg" : ""}`}>{after ? money(after.subsidyCents) : "—"}</p><p className="muted small">2026 credit · {after ? RISK_TEXT[after.state] : ""}</p></div>
        </div>
        {review.agreed.length > 0 && <div className="table-wrap"><table className="years-table compact">
          <thead><tr><th scope="col">Agreed project (same terms)</th><th scope="col">Effect before</th><th scope="col">Effect after</th></tr></thead>
          <tbody>{review.agreed.map(a => { const b = currentAgreed.find(x => x.project.id === a.project.id);
            const cash = (c?: AgreedCheck) => c?.result.status === "ready" && c.result.agreed ? signedMoney(c.result.agreed.twoYearCashDeltaCents) : "—";
            return <tr key={a.project.id}><th scope="row">{a.project.title}</th><td className="num">{cash(b)}</td><td className="num">{cash(a)}</td></tr>; })}</tbody>
        </table></div>}
        {after && before && before.subsidyCents > 0 && after.subsidyCents === 0 && <p className="notice warn" role="status">On the new forecast your agreed plan loses the 2026 premium tax credit. You can still keep this forecast — it records what you expect. Then compare new options for open proposals, or talk to your client about remaining payments.</p>}
        <h3 className="small-head">2 · New options</h3>
        <p className="small muted">Proposals are compared separately after you keep the forecast. Agreed projects stay exactly as agreed.</p>
        <div className="row gap"><button type="button" className="btn primary" onClick={() => onKeep(f)}>Keep this forecast</button></div>
      </>}
    </div>}
  </section>;
}

function ComparePanel({ ws, projectId, state, stale, onClose, onAgree, onDrawer }: {
  ws: HouseholdWorkspace; projectId: string; state: { result?: WorkspaceComparisonResult; pending: boolean } | null; stale: boolean;
  onClose: () => void; onAgree: (scenarioId: string) => void; onDrawer: (c: DrawerContent) => void;
}) {
  const project: Project | undefined = ws.projects.find(p => p.id === projectId);
  const input = useMemo(() => workspaceToCaseInput(ws, { candidateProjectId: projectId }).input, [ws, projectId]);
  if (!project) return null;
  const r = state?.result;
  return <section id="compare-panel" className="plan-section" aria-labelledby="cmp-title">
    <div className="row gap wrap between"><h2 id="cmp-title" className="section-title small">Options for “{project.title}”</h2>
      <button type="button" className="btn ghost small" onClick={onClose}>Close</button></div>
    {!r ? <p className="loading-line"><span className="spinner" aria-hidden="true" /> Comparing on top of your plan…</p>
      : r.status !== "ready" ? <WorkspaceBlocked result={r} ws={ws} onFix={() => document.getElementById("forecast-title")?.scrollIntoView({ behavior: "smooth" })} /> : <>
        <p className="baseline-note"><strong>Compared with: {r.baseline.label}.</strong> {r.baseline.description}</p>
        <ComparisonView comparison={r.comparison} input={input} stale={stale} onShowCalc={onDrawer} onUse={onAgree} useLabel="Agree to this option" />
        <p className="hint"><FileSearch size={13} aria-hidden="true" /> Agreeing adds this project to your forecast with the option&apos;s payments. A SEP-IRA amount in an option raises your yearly goal by that amount — it is not a second full contribution.</p>
      </>}
    <Link href="#projects" className="link-btn">Back to projects <ArrowRight size={13} /></Link>
  </section>;
}
