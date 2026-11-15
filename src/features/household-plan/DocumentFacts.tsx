"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, Plus, X } from "lucide-react";
import { ImportDraftSchema, type ImportDraft } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import {
  commitImportGroup, emptyImportDraft, extractDocument, getCapabilities, mergeIntoDraft, toExtractedFacts, trackEvent,
  type ExtractionResponse, type WorkspaceRepository,
} from "@/lib/client/api";
import { localCalendarDate } from "@/features/format";
import { ImportReview } from "@/features/imports/ImportReview";
import { isPriorYearOnlyWarning } from "@/features/imports/review-model";
import "@/features/imports/imports.css";

interface QueuedDocument {
  id: string; name: string; file?: File; documentId?: string;
  state: "consent" | "reading" | "ready" | "failed" | "unavailable";
  messages: string[];
}
interface Props {
  ws: HouseholdWorkspace;
  repo: WorkspaceRepository;
  onApplied: (saved: HouseholdWorkspace, summary: string) => void;
  disabled?: boolean;
}
const MAX_BYTES = 3 * 1024 * 1024;
const STATE_LABEL: Record<QueuedDocument["state"], string> = { consent: "Your permission needed", reading: "Reading", ready: "Ready for review", failed: "Could not read", unavailable: "Not sent" };
const needsProvider = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

/** All files feed one common review and one atomic, revision-checked persistence command. */
export function DocumentFacts({ ws, repo, onApplied, disabled = false }: Props) {
  const [docs, setDocs] = useState<QueuedDocument[]>([]);
  const [draft, setDraft] = useState<ImportDraft>(() => emptyImportDraft(`documents-${ws.id}`.slice(0, 120)));
  const [ai, setAi] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [referenceOnlyDocuments, setReferenceOnlyDocuments] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const readHashes = useRef(new Set<string>());
  const draftRef = useRef(draft);
  const key = `headroom:document-review:${ws.id}`;
  useEffect(() => { void getCapabilities().then(c => setAi(c.aiExtraction)); }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
      const parsed = ImportDraftSchema.safeParse(stored?.draft ?? stored);
      if (parsed.success) {
        draftRef.current = parsed.data; setDraft(parsed.data); readHashes.current = new Set(parsed.data.documents.map(d => d.documentId));
        if (stored?.referenceOnlyDocuments && typeof stored.referenceOnlyDocuments === "object") setReferenceOnlyDocuments(Object.fromEntries(Object.entries(stored.referenceOnlyDocuments).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
      }
    } catch { /* Local review is optional; do not block documents. */ }
    setRestored(true);
  }, [key]);
  useEffect(() => { if (restored) try { sessionStorage.setItem(key, JSON.stringify({ draft, referenceOnlyDocuments })); } catch { /* File contents never enter this store. */ } }, [draft, referenceOnlyDocuments, key, restored]);

  const patch = (id: string, changes: Partial<QueuedDocument>) => setDocs(old => old.map(d => d.id === id ? { ...d, ...changes } : d));
  async function read(doc: QueuedDocument, consent: boolean) {
    if (!doc.file) return;
    patch(doc.id, { state: "reading", messages: [] });
    try {
      const response = await extractDocument(doc.file, { consentToProvider: consent }) as ExtractionResponse;
      if (response.status === "unavailable") { patch(doc.id, { state: "failed", messages: response.warnings }); return; }
      const hash = response.document?.documentId ?? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await doc.file.arrayBuffer()))).map(b => b.toString(16).padStart(2, "0")).join("");
      if (readHashes.current.has(hash)) { patch(doc.id, { state: "ready", messages: ["This exact document is already in this review. Nothing was added twice."] }); return; }
      const facts = response.facts ?? toExtractedFacts(response, hash, response.document?.kind, consent ? "ai_model" : "deterministic_text");
      const provenance = facts.some(f => f.provenance === "ai_model") ? "ai_model" as const : "deterministic_text" as const;
      if (!facts.length) { patch(doc.id, { state: "failed", messages: [...response.warnings, "No supported figures were found. Paste labelled text or enter the figures directly in your plan."] }); return; }
      const document = { documentId: hash, kind: response.document?.kind ?? facts[0].documentKind, label: doc.name.slice(0, 200), addedAt: new Date().toISOString(), provenance };
      const merged = mergeIntoDraft(draftRef.current, facts, document);
      // Resolve conflicts after explicit person/year/month/project targets, never an unknown-person slot.
      const parsed = ImportDraftSchema.safeParse({ ...merged.draft, facts: merged.draft.facts.map(f => ({ ...f, review: f.review === "conflict" ? "extracted" : f.review, conflictsWith: [] })) });
      if (!parsed.success) { patch(doc.id, { state: "failed", messages: ["This document would exceed the review limit or contains an unreadable figure. Finish the current group, then retry with the relevant pages or text."] }); return; }
      const priorYearWarning = response.warnings.find(isPriorYearOnlyWarning);
      if (priorYearWarning) setReferenceOnlyDocuments(old => ({ ...old, [hash]: priorYearWarning }));
      readHashes.current.add(hash); draftRef.current = parsed.data; setDraft(parsed.data);
      patch(doc.id, { state: "ready", documentId: hash, messages: response.warnings });
    } catch (e) { patch(doc.id, { state: "failed", messages: [e instanceof Error ? e.message : "This file could not be read. Your other documents are still here."] }); }
  }

  function add(files: File[]) {
    setNotice("");
    const occupied = draft.documents.length + docs.filter(d => d.state === "reading" || d.state === "consent").length;
    if (occupied + files.length > 20) { setNotice("Review at most 20 documents together. Finish this group before adding more."); return; }
    const added = files.map((file): QueuedDocument => {
      const supported = /\.(pdf|txt|csv)$/i.test(file.name);
      const invalid = !supported || file.size > MAX_BYTES;
      return { id: crypto.randomUUID(), name: file.name, file, state: invalid ? "failed" : needsProvider(file) && ai ? "consent" : "reading",
        messages: !supported ? ["Use a PDF with selectable text, CSV or TXT. Scans and photos are not supported here; paste their text or enter figures by hand."] : file.size > MAX_BYTES ? ["This file is larger than 3 MB. Export a smaller file or paste the relevant text."] : [] };
    });
    setDocs(old => [...old, ...added]);
    if (input.current) input.current.value = "";
    for (const doc of added) if (doc.state === "reading") void read(doc, false);
  }
  function remove(doc: QueuedDocument) {
    setDocs(old => old.filter(d => d.id !== doc.id));
    if (doc.documentId) { readHashes.current.delete(doc.documentId); const next = { ...draftRef.current, documents: draftRef.current.documents.filter(d => d.documentId !== doc.documentId), facts: draftRef.current.facts.filter(f => f.documentId !== doc.documentId) }; draftRef.current = next; setDraft(next); }
  }

  return <section className="plan-section import-section" id="document-facts" aria-labelledby="docs-title"><span id="documents" />
    <div className="import-section-title"><div><span className="import-eyebrow">Less retyping. More certainty.</span><h2 id="docs-title" className="section-title small">Bring the source with you.</h2><p className="muted">Add income, insurance or payment documents. Review them together before anything changes.</p></div><FileUp size={32} aria-hidden="true" /></div>
    <div className="import-entry-actions"><label className={`btn secondary file-btn ${saving || disabled ? "disabled" : ""}`}><Plus size={18} /> Add documents<input ref={input} type="file" multiple accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" disabled={saving || disabled} onChange={e => add(Array.from(e.target.files ?? []))} /></label><button type="button" className="btn ghost" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}>Paste document text</button><a className="link-btn small" href="/samples/index.html" target="_blank" rel="noreferrer">Supported formats</a></div>
    <p className="import-upload-note">Text PDFs, CSV and TXT can be read without AI. {ai ? "AI analysis of a PDF requires your separate permission." : "Built-in reading finds clearly labelled figures."} Original files are not kept.</p>
    {pasteOpen && <form className="import-paste" onSubmit={e => { e.preventDefault(); if (pasted.trim()) add([new File([pasted], "Pasted document.txt", { type: "text/plain" })]); }}><label htmlFor={`paste-${ws.id}`}>Paste labelled figures from your document</label><p className="small muted">Keep each label, amount, period and year together, for example: “Annual net profit 2026: $55,000”. Unlabelled prose may need manual entry.</p><textarea id={`paste-${ws.id}`} rows={5} maxLength={20000} value={pasted} onChange={e => setPasted(e.target.value)} /><button className="btn secondary small" disabled={!pasted.trim() || saving || disabled}>Read this text</button></form>}
    {notice && <p className="import-notice" role="status">{notice}</p>}
    {docs.length > 0 && <ul className="import-queue">{docs.map(doc => <li key={doc.id}><div className="import-queue-row"><strong>{doc.name}</strong><span className={`import-state ${doc.state === "failed" || doc.state === "consent" ? "needs-answer" : ""}`}>{STATE_LABEL[doc.state]}</span><button type="button" className="icon-btn" disabled={saving || doc.state === "reading"} aria-label={`Remove ${doc.name} from review`} onClick={() => remove(doc)}><X size={17} /></button></div>
      {doc.state === "consent" && <div className="import-consent"><p>You can read this PDF&apos;s text without AI, or allow its readable text to be sent to the document-analysis provider. Headroom does not store the original file.</p><div className="row gap wrap"><button type="button" className="btn primary small" onClick={() => void read(doc, true)}>Allow AI analysis of this file</button><button type="button" className="btn secondary small" onClick={() => void read(doc, false)}>Read text without AI</button></div></div>}
      {doc.state === "reading" && <p role="status" className="small"><span className="spinner" aria-hidden="true" /> Reading this document…</p>}
      {doc.messages.length > 0 && <ul className="import-file-notes">{doc.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {doc.state === "failed" && doc.file && <button className="btn ghost small" disabled={saving} onClick={() => needsProvider(doc.file!) && ai ? patch(doc.id, { state: "consent" }) : void read(doc, false)}>Try reading again</button>}
    </li>)}</ul>}
    {draft.facts.length > 0 && <><ImportReview ws={ws} draft={draft} referenceOnlyDocuments={referenceOnlyDocuments} storageKey={`${key}:choices`} disabled={saving || disabled || docs.some(d => d.state === "reading")} onApply={async (review, decisions) => {
      setSaving(true);
      try {
        const { result, saved } = await commitImportGroup(repo, ws, review, decisions, { userDate: localCalendarDate() });
        if (result.status === "applied") {
          if (!saved) throw new Error("The save completed but the updated plan could not be reopened. Reload this page before making another change.");
          onApplied(saved, `Saved ${result.applied} document figure${result.applied === 1 ? "" : "s"} together.`);
          void trackEvent("review_completed", { dataKind: ws.household.isSynthetic ? "sample" : "own", inputPath: "document" });
        } else if (result.status === "stale") { const current = await repo.get(ws.id); if (current) onApplied(current, "Loaded the latest plan. Review your document group again."); }
        return result;
      } finally { setSaving(false); }
    }} /><div className="import-reset"><span>Review choices stay in this tab. The original files are not stored.</span><button className="btn ghost small" disabled={saving || docs.some(d => d.state === "reading")} onClick={() => { const empty = emptyImportDraft(`documents-${ws.id}`.slice(0, 120)); draftRef.current = empty; setDraft(empty); setDocs([]); setReferenceOnlyDocuments({}); readHashes.current.clear(); try { sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:choices`); } catch { /* State cleared here. */ } }}>Clear this review</button></div></>}
  </section>;
}
