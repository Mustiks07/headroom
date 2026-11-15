"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, FileText } from "lucide-react";
import type { ExtractedFact, ImportDraft } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import type { ImportApplyResult, ImportDecision } from "@/domain/imports";
import { applyImportGroup, EXTRACTION_FIELDS } from "@/lib/client/api";
import { MONTHS, localCalendarDate, moneyExact, parseDollarsToCents } from "@/features/format";
import { decisionFor, existingValue, reviewChoice, reviewedDraft, sourceConflicts, targetFor, type ReviewChoice } from "./review-model";
import "./imports.css";

export interface ImportReviewProps {
  ws: HouseholdWorkspace;
  draft: ImportDraft;
  onApply: (draft: ImportDraft, decisions: ImportDecision[]) => Promise<ImportApplyResult>;
  storageKey?: string;
  disabled?: boolean;
  referenceOnlyDocuments?: Record<string, string>;
}
const label = (f: ExtractedFact) => (EXTRACTION_FIELDS as Record<string, { label: string }>)[f.field]?.label ?? "Document figure";
const printed = (f: ExtractedFact) => f.valueAsPrinted || (f.value.kind === "money" ? moneyExact(f.value.amountCents) : f.value.kind === "date" ? f.value.date : f.value.text);
const periodLabel: Record<string, string> = { annual: "Full year", year_to_date: "Year to date", monthly: "Monthly", one_time: "One payment", unknown: "Period not stated" };

/** One shared, revision-bound review for every document in an import group. */
export function ImportReview({ ws, draft, onApply, storageKey, disabled = false, referenceOnlyDocuments = {} }: ImportReviewProps) {
  const [answers, setAnswers] = useState<Record<string, ReviewChoice>>({});
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<Array<{ factId: string; message: string }>>([]);
  const [completed, setCompleted] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(ws.revision);
  const [restored, setRestored] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => { setSourceOpen(window.matchMedia("(min-width: 641px)").matches); }, []);
  useEffect(() => { setCompleted(false); setMessage(""); }, [draft.facts.length]);

  useEffect(() => {
    if (storageKey) try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { answers?: Record<string, ReviewChoice>; revision?: number } | null;
      if (saved?.answers) setAnswers(saved.answers);
      if (typeof saved?.revision === "number") setReviewRevision(saved.revision);
    } catch { /* A blocked browser store does not block review. */ }
    setRestored(true);
  }, [storageKey]);
  useEffect(() => {
    if (storageKey && restored) try { sessionStorage.setItem(storageKey, JSON.stringify({ answers, revision: reviewRevision })); } catch { /* Remains available in memory. */ }
  }, [answers, reviewRevision, restored, storageKey]);

  const choices = useMemo(() => Object.fromEntries(draft.facts.map(f => [f.id, reviewChoice(f, draft, answers[f.id], referenceOnlyDocuments)])), [draft, answers, referenceOnlyDocuments]);
  const conflicts = useMemo(() => sourceConflicts(draft, choices), [draft, choices]);
  const decisions = draft.facts.flatMap(f => { const d = decisionFor(f, choices[f.id], ws); return d ? [d] : []; });
  const missing = draft.facts.filter(f => choices[f.id].mode === "use" && !decisionFor(f, choices[f.id], ws));
  const selected = draft.facts.find(f => f.id === active) ?? draft.facts[0];
  const stale = ws.revision !== reviewRevision;
  const preflight = !missing.length && !conflicts.length && decisions.length ? applyImportGroup(ws, reviewedDraft(draft, choices), decisions, { userDate: localCalendarDate() }).result : null;
  const allIssues = preflight?.status === "rejected" ? preflight.issues : issues;
  const selectedIssue = allIssues.filter(i => i.factId === selected?.id);
  const canApply = !disabled && !busy && !completed && !stale && !missing.length && !conflicts.length && !allIssues.length && decisions.length > 0;

  function update(id: string, patch: Partial<ReviewChoice>) {
    setAnswers(old => ({ ...old, [id]: { ...choices[id], ...patch } }));
    setIssues(old => old.filter(i => i.factId !== id)); setMessage(""); setCompleted(false);
  }
  function chooseSource(id: string, ids: string[]) {
    setAnswers(old => {
      const next = { ...old };
      for (const other of ids) next[other] = { ...choices[other], mode: other === id ? "use" : "skip", resolves: other === id ? [...new Set([...choices[other].resolves, ...ids.filter(x => x !== id)])] : choices[other].resolves };
      return next;
    });
    setActive(id); setIssues([]); setMessage("");
  }
  async function apply() {
    if (!canApply) return;
    setBusy(true); setIssues([]); setMessage("");
    try {
      const result = await onApply(reviewedDraft(draft, choices), decisions);
      if (result.status === "applied") { setCompleted(true); setMessage(`Saved together: ${result.applied} figure${result.applied === 1 ? "" : "s"}, ${result.referenceOnly} reference${result.referenceOnly === 1 ? "" : "s"}. Your plan is now revision ${result.revision}.`); }
      else if (result.status === "nothing_new") { setCompleted(true); setMessage(result.reason); }
      else if (result.status === "stale") setMessage("Your plan changed while you reviewed these documents. Review against the latest plan before applying.");
      else { setIssues(result.issues); setMessage("Nothing was saved. Review the marked figures, then confirm the group again."); setActive(result.issues[0]?.factId ?? null); }
    } catch (e) { setMessage(`We couldn't finish this request. ${e instanceof Error ? e.message : "Check your connection and retry. Your review choices are kept."}`); }
    finally { setBusy(false); }
  }

  if (!draft.facts.length) return null;
  return <div className="import-review">
    <div className="import-review-heading"><div><span className="import-eyebrow">Review together</span><h3>Let&apos;s get the facts right.</h3></div><span className="import-count">{draft.documents.length} source{draft.documents.length === 1 ? "" : "s"} · {draft.facts.length} figure{draft.facts.length === 1 ? "" : "s"}</span></div>
    {stale && !completed && <div className="import-notice" role="status"><strong>Your plan changed since this review started.</strong><p>Check each destination against revision {ws.revision}. Your source documents and choices are still here.</p><button className="btn secondary small" onClick={() => { setReviewRevision(ws.revision); setIssues([]); setMessage(""); }}>Review against this revision</button></div>}
    <div className="import-workbench">
      <aside className="import-source-rail" aria-label="Document source">
        <details className="import-source-disclosure" open={sourceOpen} onToggle={e => setSourceOpen(e.currentTarget.open)}><summary><FileText size={18} /> Source for this figure <ChevronDown size={16} /></summary>
          <div className="import-source-paper">
            <span className="import-eyebrow">{selected?.source.label || "Document"}{selected?.source.page ? ` · page ${selected.source.page}` : ""}</span>
            <p className="import-source-value">{selected ? printed(selected) : "Select a figure"}</p>
            {selected?.source.excerpt ? <blockquote>{selected.source.excerpt}</blockquote> : <p className="small muted">No source excerpt was returned. Check the figure against your original file.</p>}
            {selected?.value.kind === "money" && <p className="import-source-meta">{periodLabel[selected.value.period]} · {selected.taxYear ?? "Year not stated"}</p>}
            {selected && referenceOnlyDocuments[selected.documentId] && <p className="import-notice">{referenceOnlyDocuments[selected.documentId]} Kept as a reference; enter a current-year estimate separately.</p>}
            <p className="import-source-meta">{selected?.provenance === "ai_model" ? "Read by document analysis. Your review is required." : "Read from document text. Your review is required."}</p>
          </div>
        </details>
        <p className="import-privacy">Original files are not stored. Confirmed figures keep a short source reference.</p>
        <div className="import-source-index" aria-label="Sources in this review">{draft.documents.map(d => <button key={d.documentId} type="button" className={selected?.documentId === d.documentId ? "selected" : ""} onClick={() => setActive(draft.facts.find(f => f.documentId === d.documentId)?.id ?? null)}><FileText size={15} /><span>{d.label}</span></button>)}</div>
      </aside>
      <fieldset className="import-facts" aria-label="Review document facts" disabled={busy || disabled}>
        <p className="small muted">Choose whose figure it is and where it belongs. Unknowns stay unknown.</p>
        <div className="import-ledger">{draft.facts.map(f => {
          const c = choices[f.id]; const ready = !!decisionFor(f, c, ws); const isActive = selected?.id === f.id;
          const value = c.correcting ? parseDollarsToCents(c.correction) : null;
          const error = allIssues.some(i => i.factId === f.id);
          return <div className={`import-ledger-entry ${isActive ? "is-active" : ""}`} key={f.id}>
            <button type="button" className="import-fact-row" aria-expanded={isActive} aria-controls={`review-${safeId(f.id)}`} onClick={() => setActive(f.id)}>
              <span><strong>{label(f)}</strong><small>{f.source.label}</small></span>
              <span className="import-row-value">{c.correcting && typeof value === "number" ? moneyExact(value) : printed(f)}{c.correcting && <small>Corrected · original kept</small>}</span>
              <span className={`import-state ${error || (!ready && c.mode === "use") ? "needs-answer" : ""}`}>{error ? "Check figure" : c.mode === "skip" ? "Left out" : c.mode === "reference" ? "Reference only" : ready ? "Ready to confirm" : "Needs your answer"}</span>
            </button>
            {isActive && <div className="import-editor" id={`review-${safeId(f.id)}`}>
              <div className="import-field"><label htmlFor={`use-${safeId(f.id)}`}>Use this figure</label><select id={`use-${safeId(f.id)}`} value={c.mode} onChange={e => update(f.id, { mode: e.target.value as ReviewChoice["mode"] })}>{!referenceOnlyDocuments[f.documentId] && <option value="use">Update my plan</option>}<option value="reference">Keep as a source reference only</option><option value="skip">Leave it out — don&apos;t change my plan</option></select></div>
              {referenceOnlyDocuments[f.documentId] && <p className="import-notice">This source is from a prior year. It cannot confirm 2026 or 2027 income or insurance. Enter your current-year estimate separately.</p>}
              {c.mode === "use" && <TargetEditor fact={f} choice={c} ws={ws} onChange={p => update(f.id, p)} />}
              {c.mode === "reference" && <p className="small muted">This source is kept for context. It won&apos;t change income, insurance or payments.</p>}
              {c.mode === "skip" && <p className="small muted">Your existing plan stays unchanged for this figure. You can return and use it later.</p>}
              {selectedIssue.length > 0 && <ul className="import-errors" role="alert">{selectedIssue.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
            </div>}
          </div>;
        })}</div>
        {conflicts.map((conflict, i) => <section className="import-conflict" key={i} aria-label="Choose a source"><strong>Different sources, one destination.</strong><p>{conflict.message}</p><div className="import-conflict-options">{conflict.ids.map(id => { const f = draft.facts.find(x => x.id === id)!; return <button className="import-conflict-option" key={id} onClick={() => chooseSource(id, conflict.ids)}><span>{f.source.label}</span><strong>{printed(f)}</strong><span>Use this source <ArrowRight size={15} /></span></button>; })}</div></section>)}
        {message && <div className={`import-notice ${completed ? "is-complete" : ""}`} role="status">{completed && <Check size={18} />}<span>{message}</span></div>}
        <div className="import-confirm"><p id="import-apply-reason">{completed ? "Earlier sources and decision history are preserved." : missing.length ? `${missing.length} figure${missing.length === 1 ? " needs" : "s need"} an answer. Review them or leave them out.` : conflicts.length ? "Choose one source for each shared destination." : allIssues.length ? `${new Set(allIssues.map(i => i.factId)).size} figure(s) need a correction. Open the marked rows; nothing has been saved.` : "Nothing changes until you confirm. This group saves together, or not at all."}</p><button type="button" className="btn primary" disabled={!canApply} aria-describedby="import-apply-reason" onClick={() => void apply()}>{busy ? "Checking and saving…" : completed ? "Review saved" : `Confirm ${decisions.length} figure${decisions.length === 1 ? "" : "s"}`}<ArrowRight size={17} /></button></div>
      </fieldset>
    </div>
  </div>;
}

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "-");
function TargetEditor({ fact: f, choice: c, ws, onChange }: { fact: ExtractedFact; choice: ReviewChoice; ws: HouseholdWorkspace; onChange: (p: Partial<ReviewChoice>) => void }) {
  const id = safeId(f.id); const isCoverage = f.field.startsWith("coverage.");
  const isReceipt = f.field === "project.paymentReceived"; const isSep = f.field === "income.existingSepContribution";
  const isOffer = f.field === "opportunity.grossRevenueCents"; const isProfit = f.field === "income.scheduleCProfit";
  const personal = f.field.startsWith("income.") || isOffer;
  const amount = c.correcting ? parseDollarsToCents(c.correction) : f.value.kind === "money" ? f.value.amountCents : null;
  const project = ws.projects.find(p => p.id === c.projectId); const line = project?.receipts.find(l => l.id === c.lineId);
  const prior = existingValue(ws, targetFor(f, c));
  if (f.documentKind === "prior_year_tax_return") return <p className="import-notice">A filed return is context for a past year. Keep it as a reference; enter a current-year estimate in your income forecast.</p>;
  if (f.value.kind !== "money" || f.field === "opportunity.incrementalExpensesCents") return <p className="import-notice">Keep this as source context. Enter project costs and terms in the offer review so they stay linked to the right project.</p>;
  return <div className="import-target">
    {prior !== null && <p className="import-current">Currently in your plan <strong>{moneyExact(prior)}</strong> → proposed <strong>{typeof amount === "number" ? moneyExact(amount) : "Enter an amount"}</strong><span>Earlier decision records keep their original sources.</span></p>}
    <div className="import-fields">
      {personal && <Field id={`${id}-person`} label="Whose amount is this?"><select id={`${id}-person`} value={c.personId} onChange={e => onChange({ personId: e.target.value })}><option value="">Choose a person</option>{ws.household.people.filter(p => p.role !== "dependent").map(p => <option key={p.id} value={p.id}>{p.role === "primary" ? "You" : "Your spouse"}</option>)}</select></Field>}
      {!isOffer && !isReceipt && <Field id={`${id}-year`} label={isSep ? "Contribution tax year" : "Tax year"}><select id={`${id}-year`} value={c.year} disabled={f.taxYear !== null} onChange={e => onChange({ year: e.target.value })}><option value="">Choose the year</option><option value="2026">2026</option><option value="2027">2027</option></select></Field>}
      {!isOffer && !isReceipt && !isSep && <Field id={`${id}-period`} label="What period does it cover?"><select id={`${id}-period`} value={c.period} disabled={f.value.period !== "unknown" || f.documentKind === "w2"} onChange={e => onChange({ period: e.target.value })}><option value="unknown">Not stated — choose</option><option value="annual">Full-year amount</option><option value="year_to_date">Year to date</option><option value="monthly">One monthly amount</option><option value="one_time">One payment</option></select></Field>}
      {isProfit && c.period === "year_to_date" && <Field id={`${id}-through`} label="Profit through this date"><input id={`${id}-through`} type="date" value={c.asOfDate} onChange={e => onChange({ asOfDate: e.target.value })} /></Field>}
      {isProfit && <Field id={`${id}-status`} label="How certain is this figure?"><select id={`${id}-status`} value={c.status} onChange={e => onChange({ status: e.target.value as ReviewChoice["status"] })}><option value="">Choose a status</option><option value="confirmed">Confirmed for this period</option><option value="estimated">My estimate for this period</option></select></Field>}
      {isOffer && <Field id={`${id}-title`} label="Project name"><input id={`${id}-title`} maxLength={200} value={c.title} onChange={e => onChange({ title: e.target.value })} /></Field>}
      {(isOffer || isReceipt || isSep) && <Field id={`${id}-date`} label={isOffer ? "Expected payment date" : isSep ? "Date actually contributed" : "Date actually received"}><input id={`${id}-date`} type="date" value={c.date} onChange={e => onChange({ date: e.target.value })} /></Field>}
    </div>
    {isCoverage && <fieldset className="import-months"><legend>Which months have this same monthly amount?</legend><div>{MONTHS.map((m, i) => <label key={m}><input type="checkbox" checked={c.months.includes(i + 1)} onChange={e => onChange({ months: e.target.checked ? [...c.months, i + 1].sort((a, b) => a - b) : c.months.filter(x => x !== i + 1), monthsConfirmed: false })} />{m.slice(0, 3)}</label>)}</div><label className="import-check"><input type="checkbox" checked={c.monthsConfirmed} onChange={e => onChange({ monthsConfirmed: e.target.checked })} />I checked the source: this amount applies to each selected month.</label></fieldset>}
    {isCoverage && c.period !== "monthly" && <p className="import-notice">An annual total cannot fill each month unchanged. Enter the actual monthly amount from your statement below and confirm the months. Headroom does not divide this figure automatically.</p>}
    {!isProfit && !isCoverage && !isSep && !isReceipt && !isOffer && c.period !== "annual" && <p className="import-notice">This is not a full-year figure. Keep it as a reference, then enter a full-year estimate in your income profile. Headroom will not multiply a pay stub or label it confirmed.</p>}
    {isProfit && c.period === "year_to_date" && <p className="small muted">This updates profit so far. Remaining receipts and expenses stay separate and may still need your answer.</p>}
    {isProfit && <label className="import-check"><input type="checkbox" checked={!!c.excludesManagedProjects} onChange={e => onChange({ excludesManagedProjects: e.target.checked })} />This profit leaves out receipts and expenses from projects already managed in Headroom.</label>}
    {isOffer && <><label className="import-check"><input type="checkbox" checked={!!c.singleExpectedPayment} onChange={e => onChange({ singleExpectedPayment: e.target.checked })} />The full project price is one expected payment on the date above. None has been received.</label><label className="import-check"><input type="checkbox" checked={!!c.noAdditionalProjectCosts} onChange={e => onChange({ noAdditionalProjectCosts: e.target.checked })} />I confirm this project has no additional costs.</label><p className="small muted">Multiple payments, costs or an unknown cost? Keep this as a reference and <a href="/check?start=project">review the full offer</a> before adding it.</p></>}
    {(isProfit || isCoverage || (personal && !isSep && !isOffer)) && <label className="import-check"><input type="checkbox" checked={c.resolves.includes("workspace")} onChange={e => onChange({ resolves: e.target.checked ? [...new Set([...c.resolves, "workspace"])] : c.resolves.filter(x => x !== "workspace") })} />Use this source if my saved figure differs. Keep the earlier source and decisions in history.{isProfit ? " If this changes the annual/YTD method, unprovided amounts stay unknown." : ""}</label>}
    {isReceipt && <div className="import-fields">
      <Field id={`${id}-project`} label="Which project paid you?"><select id={`${id}-project`} value={c.projectId} onChange={e => onChange({ projectId: e.target.value, lineId: "", receiptMode: "" })}><option value="">Choose a project</option>{ws.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
      <Field id={`${id}-line`} label="Which payment?"><select id={`${id}-line`} value={c.lineId} onChange={e => onChange({ lineId: e.target.value, receiptMode: "" })}><option value="">Choose a payment</option>{project?.receipts.filter(l => !l.cancelledAt).map(l => <option key={l.id} value={l.id}>{l.label ?? "Payment"} · {moneyExact(l.actual?.amountCents ?? l.expected?.amountCents)} · {l.actual?.date ?? l.expected?.date}</option>)}</select></Field>
      <Field id={`${id}-receipt-kind`} label="What does this payment mean?"><select id={`${id}-receipt-kind`} value={c.receiptMode} onChange={e => onChange({ receiptMode: e.target.value as ReviewChoice["receiptMode"] })}><option value="">Choose what happened</option>{!line?.actual && <option value="actual">The full expected payment arrived</option>}{!line?.actual && <option value="partial">Part arrived; the rest is still due</option>}{line?.actual && <option value="correct">Correct an already recorded receipt</option>}</select></Field>
      {c.receiptMode === "partial" && <Field id={`${id}-remainder`} label="When is the rest expected?"><input id={`${id}-remainder`} type="date" value={c.remainderDate} onChange={e => onChange({ remainderDate: e.target.value })} /></Field>}
      {c.receiptMode === "correct" && <Field id={`${id}-reason`} label="Why is the recorded receipt wrong?"><input id={`${id}-reason`} maxLength={300} value={c.reason} onChange={e => onChange({ reason: e.target.value })} /></Field>}
    </div>}
    {isReceipt && c.receiptMode === "actual" && line?.expected && typeof amount === "number" && amount !== line.expected.amountCents && <p className="import-notice">This amount differs from the expected payment. Choose a partial payment if money is still due. If the client settled a different final total, record that through “What changed?” so the agreed terms and remainder are explicitly updated.</p>}
    <label className="import-check"><input type="checkbox" checked={c.correcting} onChange={e => onChange({ correcting: e.target.checked, monthlyCorrection: false })} />Correct the extracted amount</label>
    {c.correcting && <div className="import-fields"><Field id={`${id}-correction`} label="Correct amount (USD)"><input id={`${id}-correction`} inputMode="decimal" value={c.correction} onChange={e => onChange({ correction: e.target.value })} /></Field>{isCoverage && c.period !== "monthly" && <label className="import-check"><input type="checkbox" checked={c.monthlyCorrection} onChange={e => onChange({ monthlyCorrection: e.target.checked })} />This corrected figure is the amount for one month, not an annual total.</label>}</div>}
  </div>;
}
function Field({ id, label: text, children }: { id: string; label: string; children: React.ReactNode }) { return <div className="import-field"><label htmlFor={id}>{text}</label>{children}</div>; }
