"use client";

import { useMemo, useState } from "react";
import type { ReadinessIntent } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { assessInputReadiness } from "@/lib/engine";
import { humanizeDates, money } from "@/features/format";
import { BenchmarkHelp } from "@/features/insurance/BenchmarkHelp";
import { parseAmount } from "@/features/household-plan/parts";
import { trackEvent } from "@/lib/client/api";
import { answerPaths, needsEditor, type ReadinessAnswer } from "./answers";

type Q = ReturnType<typeof assessInputReadiness>["questions"][number];

const TASK: Record<ReadinessIntent, string> = {
  current_year_subsidy: "this year's subsidy check", new_offer: "checking this offer", two_year_terms: "finding terms across 2026 and 2027", agreed_plan_review: "checking your agreed plan",
};

/**
 * Only the questions this task needs (Claude 2's assessInputReadiness), 1–3 at a time, each with
 * its reason. "I don't know yet" keeps the fact unknown — it is never filled with $0.
 */
export function Readiness({ ws, intent, projectId, onAnswer, onSubmit, focused = false, onImport }: {
  ws: HouseholdWorkspace; intent: ReadinessIntent; projectId?: string; onAnswer: (path: string) => void;
  focused?: boolean; onImport?: () => void;
  /** Saves the answered copy as one revision; resolves false when nothing was saved. */
  onSubmit: (next: HouseholdWorkspace, summary: string) => Promise<boolean>;
}) {
  const r = useMemo(() => assessInputReadiness(ws, intent, null, projectId ? { projectId } : {}), [ws, intent, projectId]);
  const [later, setLater] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  if (r.status === "ready") return r.precision === "range_changes_answer" || r.precision === "range_not_yet_checked"
    ? <p className="hint">{humanizeDates(r.precisionNote)}</p> : null;
  if (r.status === "unsupported") return <div className="notice warn small" role="status"><strong>Headroom can&apos;t calculate {TASK[intent]} for this situation.</strong>
    <ul className="bullets small">{r.unsupported.map(u => <li key={u.code + u.path}>{humanizeDates(u.reason)}</li>)}</ul>
    <p>Your facts stay saved and can be exported for a tax professional.</p></div>;
  const open = [...r.questions].sort((a, b) => a.priority - b.priority).filter(q => !later.includes(q.id));
  const selected = open.find(q => q.id === focusId) ?? open[0];
  const shown = focused ? (selected ? [selected] : []) : open.slice(0, 3);
  return <div className="readiness" role="status">
    <p className="small"><strong>{r.questions.length} thing{r.questions.length === 1 ? "" : "s"} to confirm for {TASK[intent]}</strong>
      {r.notNeeded.length > 0 && <span className="muted"> · not needed now: {r.notNeeded.map(humanizeDates).join("; ")}</span>}</p>
    {onImport && <button className="btn secondary small" type="button" onClick={onImport}>Add a document instead of typing</button>}
    <ul className="question-list">{shown.map(q => <li key={q.id}>
      <p className="check-title">{humanizeDates(q.question)}</p>
      <p className="muted small">{humanizeDates(q.reason)}{q.documentHint ? ` Where to find it: ${humanizeDates(q.documentHint)}.` : ""}</p>
      <AnswerControl q={q} ws={ws} onEditor={() => onAnswer(q.path)} onSubmit={async (next, label) => {
        const ok = await onSubmit(next, label);
        if (ok) void trackEvent("missing_question_resolved", { dataKind: ws.household.isSynthetic ? "sample" : "own", inputPath: "manual" });
        return ok;
      }} />
      {(q.id.startsWith("coverage:benchmarkPremium:") || q.id.startsWith("benchmark:")) && (q.year === 2026 || q.year === 2027) &&
        <BenchmarkHelp ws={ws} year={q.year} onUse={async (cents, status, label) => {
          const yi = q.year === 2027 ? 1 : 0;
          const summary = `Benchmark premium ${q.year}: ${money(cents)} a month (${label})`;
          let next: HouseholdWorkspace;
          try { next = answerPaths(ws, [`household.years[${yi}].coverage[*].benchmarkPremium`], { kind: "money", cents }, q.year, summary); }
          catch { return false; }
          next.household.years[yi].benchmarkStatus = status;
          for (const m of next.household.years[yi].coverage) m.benchmarkPremium = { ...m.benchmarkPremium, status: status === "county_candidate" ? "estimated" : "confirmed" };
          const ok = await onSubmit(next, summary);
          if (ok) void trackEvent("missing_question_resolved", { dataKind: ws.household.isSynthetic ? "sample" : "own", inputPath: "manual" });
          return ok;
        }} onSaveCounty={async fips => {
          try { return await onSubmit(answerPaths(ws, ["household.countyFips"], { kind: "choice", value: fips }, null, "County for the benchmark lookup"), "County saved. Now look up the county estimate."); }
          catch { return false; }
        }} />}
      {q.allowUnknown && <button type="button" className="link-btn" onClick={() => setLater([...later, q.id])}>I don&apos;t know yet</button>}
    </li>)}</ul>
    {open.length === 0 && later.length > 0 && <p className="hint">You&apos;ve left {later.length} question{later.length > 1 ? "s" : ""} for later. The result waits for them — nothing unknown is treated as $0.</p>}
    {later.length > 0 && <button className="btn secondary small" type="button" onClick={() => setLater([])}>Review questions left for later ({later.length})</button>}
    {focused && open.length > 1 && <details className="remaining-questions"><summary>See the other {open.length - 1} question{open.length > 2 ? "s" : ""}</summary><ol>{open.filter(q => q.id !== selected?.id).map(q => <li key={q.id}><button className="link-btn" type="button" onClick={() => setFocusId(q.id)}>{humanizeDates(q.question)}</button></li>)}</ol></details>}
  </div>;
}

/** One answer control per question kind. Amounts are typed; nothing is pre-filled or defaulted. */
function AnswerControl({ q, ws, onEditor, onSubmit }: { q: Q; ws: HouseholdWorkspace; onEditor: () => void; onSubmit: (next: HouseholdWorkspace, label: string) => Promise<boolean> }) {
  const d = q.answerDetail;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = humanizeDates(q.question).replace(/\s*\(Found in[\s\S]*$/, "").slice(0, 160);
  async function send(answer: ReadinessAnswer, said: string) {
    setError(null); setBusy(true);
    try { const next = answerPaths(ws, q.paths, answer, q.year, `${short} — ${said}`); await onSubmit(next, `${short} — ${said}`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  if (needsEditor(q.paths, d.kind) || d.kind === "date" || d.kind === "integer" || d.kind === "range" || d.kind === "review")
    return <div className="row gap"><button type="button" className="btn small secondary" onClick={onEditor}>Answer</button></div>;
  if (d.kind === "boolean") return <div className="answer-row">
    <button type="button" className="btn small secondary" disabled={busy} onClick={() => void send({ kind: "boolean", value: true }, "yes")}>Yes</button>
    <button type="button" className="btn small secondary" disabled={busy} onClick={() => void send({ kind: "boolean", value: false }, "no")}>No</button>
    <span className="muted small">Yes means: {humanizeDates(d.yesMeans)}</span>
    {error && <p className="field-error" role="alert">{error}</p>}</div>;
  if (d.kind === "choice") return <div className="answer-row">
    {d.options.map(o => <button key={o.value} type="button" className="btn small secondary" disabled={busy} onClick={() => void send({ kind: "choice", value: o.value }, o.label)}>{o.label}</button>)}
    {error && <p className="field-error" role="alert">{error}</p>}</div>;
  const fields = d.kind === "money_fields" ? d.fields : [{ path: q.path, label: d.period === "monthly" ? "Amount per month" : "Amount for the year" }];
  return <form className="answer-row" onSubmit={e => { e.preventDefault();
    const parsed: Record<string, number> = {};
    for (const f of fields) { const t = (vals[f.path] ?? "").trim(); if (!t) continue;
      const r = parseAmount(t, d.confirmedZeroAllowed); if (r.error || r.cents === null) { setError(`${f.label}: ${r.error ?? "enter an amount"}`); return; } parsed[f.path] = r.cents; }
    if (!Object.keys(parsed).length) { setError("Enter an amount, or choose “I don't know yet”."); return; }
    if (d.kind === "money_fields") void send({ kind: "money_fields", values: parsed }, fields.filter(f => f.path in parsed).map(f => `${f.label} $${(parsed[f.path] / 100).toLocaleString("en-US")}`).join(", "));
    else void send({ kind: "money", cents: parsed[q.path] }, `$${(parsed[q.path] / 100).toLocaleString("en-US")}${d.period === "monthly" ? " a month" : ""}`);
  }}>
    {fields.map(f => <label key={f.path} className="answer-field"><span className="small">{f.label}</span>
      <span className="money-row"><span className="money-prefix" aria-hidden="true">$</span><input inputMode="decimal" value={vals[f.path] ?? ""} onChange={e => setVals({ ...vals, [f.path]: e.target.value })} /></span></label>)}
    <button type="submit" className="btn small secondary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    {d.confirmedZeroAllowed && <span className="muted small">If it&apos;s truly none, enter 0.</span>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </form>;
}
