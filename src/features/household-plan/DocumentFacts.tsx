"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import type { ExtractionResult } from "@/domain/contracts";
import type { HouseholdWorkspace, WorkspaceEvent } from "@/domain/household-workspace";
import { withEvent } from "@/domain/household-workspace";
import {
  EXTRACTION_FIELDS, applyDocumentFact, extractDocument, getCapabilities, previewDocumentFacts,
  type FactPreview, type FactTarget,
} from "@/lib/client/api";
import { money, shortDate } from "@/features/format";

type Answers = { option: string | null; date: string; taxYear: "" | "2026" | "2027"; asOfDate: string; status: "" | "confirmed" | "estimated"; reason: string; skip: boolean };
interface Doc {
  id: string; name: string;
  state: "waiting_consent" | "reading" | "review" | "unavailable" | "failed" | "done";
  message?: string; warnings: string[]; extraction?: ExtractionResult; facts: FactPreview[]; answers: Record<number, Answers>;
  file?: File; summary?: string;
}

const MAX_BYTES = 3 * 1024 * 1024;
const needsProvider = (f: File) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name) || /^(application\/pdf|image\/)/.test(f.type);
const PERIOD: Record<string, string> = { annual: "full year", year_to_date: "year to date", monthly: "per month", one_time: "one-time", unknown: "period not stated" };
const blank = (): Answers => ({ option: null, date: "", taxYear: "", asOfDate: "", status: "", reason: "", skip: false });

/** Builds the target for applyDocumentFact from the chosen option and the user's answers; null while something is missing. */
function targetOf(f: FactPreview, a: Answers): FactTarget | null {
  const opt = f.options.find(o => o.id === a.option) ?? (f.options.length === 1 ? f.options[0] : null);
  if (!opt) return null;
  const t = { ...opt.target } as Record<string, unknown>;
  const year = (t.year ?? t.taxYear ?? (a.taxYear ? Number(a.taxYear) : null)) as number | null;
  for (const need of opt.needs) {
    if (need === "date") { const d = (t.date as string | undefined) ?? (a.date || f.found.date || ""); if (!d) return null; t.date = d; if (t.kind === "sep_contribution") t.paidDate = d; }
    if (need === "tax_year") { if (!year) return null; }
    if (need === "as_of_date") { if (!a.asOfDate) return null; t.asOfDate = a.asOfDate; }
    if (need === "status") { if (!a.status) return null; t.status = a.status; }
    if (need === "correction_reason") { if (!a.reason.trim()) return null; t.correctionReason = a.reason.trim(); }
  }
  if (t.kind === "forecast") t.year = year;
  if (t.kind === "sep_contribution") { t.taxYear = year; if (!t.paidDate) t.paidDate = (a.date || f.found.date) ?? undefined; if (!t.paidDate) return null; }
  if (t.kind === "payment_received" && !t.date) { const d = a.date || f.found.date; if (!d) return null; t.date = d; }
  if ((t.kind === "forecast" || t.kind === "sep_contribution") && !year) return null;
  return t as unknown as FactTarget;
}

/** A figure is "clear" when there is exactly one sensible destination and nothing to decide. */
const isClear = (f: FactPreview) => !f.blockers.length && !f.alreadyApplied && f.options.length === 1 && targetOf(f, blank()) !== null;

/**
 * Documents → reviewed facts for a household plan. Several files can be read one after another;
 * clear figures can be confirmed together after a summary, anything ambiguous needs its own choice.
 * Uses Claude 3's extractDocument / previewDocumentFacts / applyDocumentFact; saving goes through
 * `onCommit` as ONE revision with a "document imported" history entry.
 */
export function DocumentFacts({ ws, onCommit }: { ws: HouseholdWorkspace; onCommit: (next: HouseholdWorkspace, summary: string) => Promise<boolean> }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [ai, setAi] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void getCapabilities().then(c => setAi(c.aiExtraction)); }, []);

  const patch = (id: string, p: Partial<Doc>) => setDocs(ds => ds.map(d => (d.id === id ? { ...d, ...p } : d)));

  async function read(doc: Doc, consent: boolean) {
    patch(doc.id, { state: "reading" });
    try {
      const extraction = await extractDocument(doc.file!, { consentToProvider: consent });
      if (extraction.status === "unavailable") { patch(doc.id, { state: "unavailable", warnings: extraction.warnings }); return; }
      const facts = previewDocumentFacts(ws, extraction);
      patch(doc.id, { state: "review", extraction, facts, warnings: extraction.warnings, answers: Object.fromEntries(facts.map(f => [f.index, blank()])) });
    } catch (e) { patch(doc.id, { state: "failed", message: e instanceof Error ? e.message : "The file couldn't be read." }); }
  }

  function add(files: FileList | null) {
    if (!files) return;
    const added: Doc[] = [...files].map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, file, warnings: [], facts: [], answers: {},
      state: file.size > MAX_BYTES ? "failed" : needsProvider(file) ? (ai ? "waiting_consent" : "unavailable") : "reading",
      message: file.size > MAX_BYTES ? "This file is larger than 3 MB. Export a smaller file or enter the figures by hand." : undefined }));
    setDocs(ds => [...ds, ...added]);
    if (input.current) input.current.value = "";
    for (const d of added) if (d.state === "reading") void read(d, false);
    for (const d of added) if (d.state === "unavailable") patch(d.id, { warnings: ["Document analysis for PDFs and images isn't switched on in this version. CSV and text files work; you can also enter the figures by hand."] });
  }

  async function apply(doc: Doc, which: "clear" | number) {
    let next = ws;
    const results: string[] = [];
    const events: WorkspaceEvent[] = [];
    const indices = which === "clear" ? doc.facts.filter(isClear).map(f => f.index) : [which];
    for (const i of indices) {
      const f = doc.facts.find(x => x.index === i)!;
      const target = targetOf(f, doc.answers[i] ?? blank());
      const field = doc.extraction!.fields[i];
      if (!target) { results.push(`${label(f)}: choose where it goes first.`); continue; }
      const r = applyDocumentFact(next, field, target);
      if (r.status === "applied") { next = r.workspace; events.push({ ...r.event, id: `evt-doc-${field.evidence.id}-${i}`.slice(0, 100), at: new Date().toISOString() } as WorkspaceEvent); }
      else if (r.status === "duplicate") results.push(`${label(f)}: already recorded — nothing changed.`);
      else results.push(`${label(f)}: ${r.message}`);
    }
    if (!events.length) { patch(doc.id, { summary: results.join(" ") || "Nothing to apply." }); return; }
    for (const e of events) next = withEvent(next, e);
    const ok = await onCommit(next, `Added ${events.length} figure${events.length > 1 ? "s" : ""} from ${doc.name}.`);
    if (ok) {
      const facts = previewDocumentFacts(next, doc.extraction!);
      const left = facts.filter(f => !f.alreadyApplied && !f.blockers.length && !(doc.answers[f.index]?.skip));
      patch(doc.id, { facts, state: left.length ? "review" : "done", summary: [`Saved ${events.length} figure${events.length > 1 ? "s" : ""}.`, ...results].join(" ") });
    } else patch(doc.id, { summary: "Nothing was saved — your choices are kept. Try again." });
  }

  return <section className="plan-section" id="documents" aria-labelledby="docs-title">
    <h2 id="docs-title" className="section-title small">Add documents</h2>
    <p className="muted small">Profit-and-loss reports, pay stubs, Marketplace statements, payment and SEP-IRA confirmations. Headroom proposes figures; nothing is used until you confirm it.
      {ai ? " PDFs and images are sent to the document-analysis service only after you agree for that file." : " This version reads CSV and text files; PDFs and photos need document analysis, which isn't switched on — enter those figures by hand."}</p>
    <div className="row gap wrap">
      <label className="btn secondary small file-btn"><FileUp size={16} /> Choose files
        <input ref={input} type="file" multiple accept={ai ? ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" : ".csv,.txt,text/csv,text/plain"} onChange={e => add(e.target.files)} /></label>
      <a className="link-btn" href="/samples/index.html" target="_blank" rel="noreferrer">Synthetic sample files</a>
    </div>
    {docs.length > 0 && <ul className="doc-queue">{docs.map(doc => <li key={doc.id} className={`doc doc-${doc.state}`}>
      <div className="doc-head"><strong>{doc.name}</strong><span className={`pill ${doc.state === "done" ? "good" : doc.state === "failed" || doc.state === "unavailable" ? "warn" : "neutral"}`}>{STATE_TEXT[doc.state]}</span>
        <button type="button" className="icon-btn" aria-label={`Remove ${doc.name} from this list`} onClick={() => setDocs(ds => ds.filter(d => d.id !== doc.id))}><X size={14} /></button></div>
      {doc.state === "waiting_consent" && <div className="notice small">This file will be sent to the document-analysis service to read its figures. Headroom doesn&apos;t keep the original.
        <div className="row gap"><button type="button" className="btn small primary" onClick={() => void read(doc, true)}>Send this file</button>
          <button type="button" className="btn small ghost" onClick={() => patch(doc.id, { state: "unavailable", warnings: ["Not sent. Enter the figures by hand if you need them."] })}>Don&apos;t send</button></div></div>}
      {doc.state === "reading" && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Reading…</p>}
      {(doc.message || doc.warnings.length > 0) && <ul className="bullets small">{[doc.message, ...doc.warnings].filter(Boolean).map(w => <li key={w}>{w}</li>)}</ul>}
      {doc.summary && <p className="small" role="status">{doc.summary}</p>}
      {doc.state === "review" && <Review doc={doc} onAnswer={(i, a) => patch(doc.id, { answers: { ...doc.answers, [i]: { ...(doc.answers[i] ?? blank()), ...a } } })} onApply={w => void apply(doc, w)} />}
    </li>)}</ul>}
  </section>;
}

const STATE_TEXT: Record<Doc["state"], string> = { waiting_consent: "Waiting for your OK", reading: "Reading", review: "Review", unavailable: "Can't read here", failed: "Couldn't read", done: "Done" };
const label = (f: FactPreview) => (EXTRACTION_FIELDS as Record<string, { label: string }>)[f.path]?.label ?? f.path;

function Review({ doc, onAnswer, onApply }: { doc: Doc; onAnswer: (i: number, a: Partial<Answers>) => void; onApply: (w: "clear" | number) => void }) {
  const clear = doc.facts.filter(isClear);
  const open = doc.facts.filter(f => !isClear(f) && !f.alreadyApplied && !f.blockers.length && !doc.answers[f.index]?.skip);
  const recorded = doc.facts.filter(f => f.alreadyApplied);
  const blocked = doc.facts.filter(f => f.blockers.length && !f.alreadyApplied);
  if (!doc.facts.length) return <p className="small">No figures Headroom can use were found. Enter them by hand.</p>;
  return <div className="stack">
    {clear.length > 0 && <div className="fact-group">
      <p className="small"><strong>{clear.length} clear figure{clear.length > 1 ? "s" : ""}</strong> — one obvious place each:</p>
      <ul className="fact-list">{clear.map(f => <FactLine key={f.index} f={f} destination={f.options[0].label} />)}</ul>
      <button type="button" className="btn small primary" onClick={() => onApply("clear")}><Check size={14} /> Use these {clear.length} figure{clear.length > 1 ? "s" : ""}</button>
    </div>}
    {open.length > 0 && <div className="fact-group">
      <p className="small"><strong>Needs your choice</strong> — Headroom won&apos;t guess these:</p>
      {open.map(f => <Decide key={f.index} f={f} a={doc.answers[f.index] ?? blank()} onAnswer={a => onAnswer(f.index, a)} onApply={() => onApply(f.index)} />)}
    </div>}
    {recorded.length > 0 && <p className="hint">{recorded.length} figure{recorded.length > 1 ? "s were" : " was"} already recorded from this document — nothing is added twice.</p>}
    {blocked.length > 0 && <details className="explain"><summary>Not used ({blocked.length})</summary>
      <ul className="fact-list">{blocked.map(f => <li key={f.index}><span>{label(f)} {f.found.amountCents !== null ? money(f.found.amountCents) : f.found.date ? shortDate(f.found.date) : ""}</span><span className="muted small">{f.blockers.join(" ")}</span></li>)}</ul></details>}
  </div>;
}

function FactLine({ f, destination }: { f: FactPreview; destination: string }) {
  return <li><span><strong>{label(f)}</strong> {f.found.amountCents !== null ? <strong className="num">{money(f.found.amountCents)}</strong> : null}{f.found.date ? ` · ${shortDate(f.found.date)}` : ""}
    {f.found.period ? <span className="muted"> · {PERIOD[f.found.period] ?? f.found.period}</span> : null}{f.found.taxYear ? <span className="muted"> · {f.found.taxYear}</span> : null}</span>
    <span className="muted small">→ {destination}{f.found.excerpt ? <> · “{f.found.excerpt}”</> : null}</span></li>;
}

function Decide({ f, a, onAnswer, onApply }: { f: FactPreview; a: Answers; onAnswer: (a: Partial<Answers>) => void; onApply: () => void }) {
  const opt = f.options.find(o => o.id === a.option) ?? (f.options.length === 1 ? f.options[0] : null);
  const ready = targetOf(f, a) !== null;
  const id = `fact-${f.index}`;
  return <div className="fact-decide">
    <ul className="fact-list"><FactLine f={f} destination={opt ? opt.label : "choose below"} /></ul>
    {f.options.length > 1 && <div className="field"><label className="field-label" htmlFor={`${id}-opt`}>Where does it belong?</label>
      <select id={`${id}-opt`} value={a.option ?? ""} onChange={e => onAnswer({ option: e.target.value || null })}><option value="">Choose…</option>
        {f.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
    {opt && <div className="grid-3">
      {opt.needs.includes("date") && !f.found.date && <div className="field"><label className="field-label" htmlFor={`${id}-date`}>Date</label><input id={`${id}-date`} type="date" value={a.date} onChange={e => onAnswer({ date: e.target.value })} /></div>}
      {opt.needs.includes("tax_year") && <div className="field"><label className="field-label" htmlFor={`${id}-year`}>Tax year</label>
        <select id={`${id}-year`} value={a.taxYear} onChange={e => onAnswer({ taxYear: e.target.value as Answers["taxYear"] })}><option value="">Choose…</option><option value="2026">2026</option><option value="2027">2027</option></select></div>}
      {opt.needs.includes("as_of_date") && <div className="field"><label className="field-label" htmlFor={`${id}-asof`}>Figures run through</label><input id={`${id}-asof`} type="date" value={a.asOfDate} onChange={e => onAnswer({ asOfDate: e.target.value })} /></div>}
      {opt.needs.includes("status") && <div className="field"><label className="field-label" htmlFor={`${id}-status`}>Is it final?</label>
        <select id={`${id}-status`} value={a.status} onChange={e => onAnswer({ status: e.target.value as Answers["status"] })}><option value="">Choose…</option><option value="confirmed">Yes, final</option><option value="estimated">No, an estimate</option></select></div>}
      {opt.needs.includes("correction_reason") && <div className="field"><label className="field-label" htmlFor={`${id}-why`}>Why replace the recorded amount?</label><input id={`${id}-why`} value={a.reason} onChange={e => onAnswer({ reason: e.target.value })} /></div>}
    </div>}
    <div className="row gap"><button type="button" className="btn small primary" disabled={!ready} onClick={onApply}>Use this figure</button>
      <button type="button" className="btn small ghost" onClick={() => onAnswer({ skip: true })}>Skip</button></div>
  </div>;
}
