"use client";

import { useRef, useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import type { ExtractionResult } from "@/domain/contracts";
import { extractDocument } from "@/lib/client/api";
import { moneyExact } from "@/features/format";
import { describePath, getAt, isMoneyFact, setAt, type Draft } from "./draft";
import type { Update } from "./editors";

type Field = ExtractionResult["fields"][number];
type State =
  | { kind: "idle" }
  | { kind: "reading"; name: string }
  | { kind: "unavailable"; warnings: string[] }
  | { kind: "error"; message: string }
  | { kind: "review"; name: string; fields: Field[]; warnings: string[]; decided: Record<number, "applied" | "skipped"> };

const MAX_BYTES = 3 * 1024 * 1024;

/** Turns a proposed value into what the target path holds, or explains why it can't. */
function prepare(field: Field, draft: Draft): { ok: true; value: unknown } | { ok: false; reason: string } {
  const current = getAt(draft, field.path);
  if (current === undefined) return { ok: false, reason: "This field isn't part of your household form." };
  if (isMoneyFact(current)) {
    const cents = typeof field.proposedValue === "number" ? field.proposedValue
      : isMoneyFact(field.proposedValue) ? field.proposedValue.valueCents : null;
    if (cents === null || !Number.isSafeInteger(cents)) return { ok: false, reason: "The document value isn't a clear amount." };
    return { ok: true, value: { valueCents: cents, status: "confirmed", sourceId: field.evidence.id } };
  }
  if (typeof current === typeof field.proposedValue || current === null) return { ok: true, value: field.proposedValue };
  return { ok: false, reason: "The document value doesn't match this field." };
}

function showValue(field: Field) {
  const v = field.proposedValue;
  if (typeof v === "number" && Number.isInteger(v)) return moneyExact(v);
  if (isMoneyFact(v)) return v.valueCents === null ? "Unknown" : moneyExact(v.valueCents);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function DocumentImport({ draft, update }: { draft: Draft; update: Update }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { setState({ kind: "error", message: "This file is larger than 3 MB. Try a smaller export, or enter the figures manually." }); return; }
    setState({ kind: "reading", name: file.name });
    try {
      const result = await extractDocument(file);
      if (result.status === "unavailable") setState({ kind: "unavailable", warnings: result.warnings });
      else setState({ kind: "review", name: file.name, fields: result.fields, warnings: result.warnings, decided: {} });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "The document couldn't be read." });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function apply(index: number) {
    if (state.kind !== "review") return;
    const field = state.fields[index];
    const prepared = prepare(field, draft);
    if (!prepared.ok) return;
    update(d => {
      if (setAt(d, field.path, prepared.value) && !d.evidence.some(e => e.id === field.evidence.id)) d.evidence.push(field.evidence);
    });
    setState({ ...state, decided: { ...state.decided, [index]: "applied" } });
  }

  return <div className="doc-import">
    <div className="doc-head">
      <div>
        <h3 className="small-head">Import a pay stub or statement <span className="optional">optional</span></h3>
        <p className="hint">Headroom proposes figures from the document; nothing is used until you approve each one. Manual entry works just as well. For 2026, use pay stubs or year-to-date reports — you don&apos;t need a 2026 W-2 or 1095-A.</p>
      </div>
      <label className="btn secondary small file-btn">
        <FileUp size={16} /> Choose a file
        <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,application/pdf,image/*,text/csv,text/plain"
          onChange={e => onFile(e.target.files?.[0])} disabled={state.kind === "reading"} />
      </label>
    </div>
    <p className="hint">The file is sent to Headroom&apos;s server only to read these figures. Don&apos;t upload documents showing a full Social Security or bank account number.</p>

    {state.kind === "reading" && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Reading {state.name}…</p>}
    {state.kind === "unavailable" && <div className="notice warn" role="status">
      <strong>Document analysis is unavailable. Enter the figures manually.</strong>
      {state.warnings.length > 0 && <ul className="bullets small">{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    </div>}
    {state.kind === "error" && <div className="notice warn" role="alert"><strong>We couldn&apos;t read that file.</strong> {state.message} Your entries are unchanged.</div>}
    {state.kind === "review" && <div className="review">
      <p className="small"><strong>Review figures from {state.name}</strong></p>
      {state.fields.length === 0 && <p className="hint">No usable figures were found. Enter them manually below.</p>}
      {state.warnings.length > 0 && <ul className="warnings">{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <ul className="review-list">
        {state.fields.map((field, i) => {
          const prepared = prepare(field, draft);
          const year = /^years\.(\d)/.exec(field.path.replace(/\[(\d)\]/g, ".$1"));
          const targetYear = year ? draft.years[Number(year[1])]?.year : undefined;
          const yearMismatch = field.evidence.taxYear && targetYear && field.evidence.taxYear !== targetYear;
          const decided = state.decided[i];
          return <li key={field.path + i} className={decided ? `decided ${decided}` : ""}>
            <div className="review-main">
              <span className="review-path">{describePath(field.path, draft)}</span>
              <strong className="num">{showValue(field)}</strong>
            </div>
            <p className="muted small">{field.evidence.label}{field.evidence.page ? ` · page ${field.evidence.page}` : ""}{field.evidence.taxYear ? ` · tax year ${field.evidence.taxYear}` : ""}</p>
            {field.evidence.excerpt && <blockquote>{field.evidence.excerpt}</blockquote>}
            {yearMismatch && <p className="hint warn">This document is for {field.evidence.taxYear}, but the field is for {targetYear}. Only apply it if the figure really belongs to {targetYear}.</p>}
            {!prepared.ok && <p className="hint warn">{prepared.reason}</p>}
            {decided ? <p className="small">{decided === "applied" ? "✓ Applied as a confirmed figure" : "Skipped"}</p>
              : <div className="row gap">
                <button type="button" className="btn small primary" disabled={!prepared.ok} onClick={() => apply(i)}><Check size={14} /> Use this figure</button>
                <button type="button" className="btn small ghost" onClick={() => setState({ ...state, decided: { ...state.decided, [i]: "skipped" } })}><X size={14} /> Skip</button>
              </div>}
          </li>;
        })}
      </ul>
    </div>}
  </div>;
}
