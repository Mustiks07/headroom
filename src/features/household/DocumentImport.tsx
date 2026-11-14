"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import type { ExtractionResult } from "@/domain/contracts";
import { EXTRACTION_FIELDS, extractDocument, getCapabilities, type ExtractionFieldPath, type ProposedFieldValue } from "@/lib/client/api";
import { moneyExact } from "@/features/format";
import { adults, describePath, fieldId, getAt, isMoneyFact, personName, setAt, type Draft } from "./draft";
import type { Update } from "./editors";

type Field = ExtractionResult["fields"][number];
/**
 * Where and how the user wants a proposed figure used: tax year, person (income), whether it is a
 * final fact or a forecast, and — for year-to-date/unstated income — an explicit decision.
 */
type Target = { yearIndex: number; personId: string; status: "confirmed" | "estimated"; partialUse: "starting_point" | "full_year" | null };
type State =
  | { kind: "idle" }
  | { kind: "consent"; file: File }
  | { kind: "reading"; name: string }
  | { kind: "unavailable"; warnings: string[] }
  | { kind: "error"; message: string }
  | { kind: "review"; name: string; fields: Field[]; warnings: string[]; decided: Record<number, "applied" | "skipped">; targets: Record<number, Target> };

const MAX_BYTES = 3 * 1024 * 1024;
const PERIOD_LABEL: Record<string, string> = { annual: "full year", year_to_date: "year to date", monthly: "per month", one_time: "one-time", unknown: "period not stated" };

const isGeneric = (path: string): path is ExtractionFieldPath => Object.prototype.hasOwnProperty.call(EXTRACTION_FIELDS, path);
const isProposed = (v: unknown): v is ProposedFieldValue => !!v && typeof v === "object" && "kind" in v &&
  ["money", "date", "text"].includes(String((v as { kind: unknown }).kind));
const needsProvider = (file: File) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name) || /^(application\/pdf|image\/)/.test(file.type);

/** Concrete contract paths a proposed field writes to (several for monthly coverage). */
function targetPaths(field: Field, target: Target, draft: Draft): string[] {
  if (!isGeneric(field.path)) return [field.path];
  const [group, key] = field.path.split(".");
  if (group === "income") {
    const row = draft.years[target.yearIndex]?.incomes.findIndex(r => r.personId === target.personId) ?? -1;
    return row < 0 ? [] : [`years.${target.yearIndex}.incomes.${row}.${key}`];
  }
  if (group === "coverage") return Array.from({ length: 12 }, (_, m) => `years.${target.yearIndex}.coverage.${m}.${key}`);
  return [field.path];
}

/** Turns a proposed value into what the target path holds, or explains why it can't. */
function prepare(field: Field, target: Target, draft: Draft): { ok: true; paths: string[]; value: unknown; note?: string } | { ok: false; reason: string } {
  const paths = targetPaths(field, target, draft);
  const current = paths.length ? getAt(draft, paths[0]) : undefined;
  if (current === undefined) return { ok: false, reason: "This field isn't part of your household form." };
  const v = field.proposedValue;
  if (isProposed(v)) {
    if (v.kind === "money") {
      const isCoverage = field.path.startsWith("coverage.");
      if (isCoverage && (v.period === "annual" || v.period === "year_to_date")) return { ok: false, reason: "This isn't a monthly amount. Enter the monthly figure manually." };
      if (field.path.startsWith("income.") && v.period === "monthly") return { ok: false, reason: "This is a monthly amount. Enter your full-year figure manually." };
      if (isMoneyFact(current)) {
        const partial = field.path.startsWith("income.") && v.period !== "annual";
        if (partial && !target.partialUse) return { ok: false, reason: "Choose how to use this amount first." };
        // A year-to-date or unstated-period amount is never a confirmed full-year fact.
        const status = partial ? "estimated" : target.status;
        return { ok: true, paths, value: { valueCents: v.amountCents, status, sourceId: field.evidence.id },
          note: partial ? (target.partialUse === "starting_point"
            ? "Saved as an estimate. The field will open so you can raise it to your full-year forecast."
            : "Saved as your full-year forecast (an estimate).") : undefined };
      }
      if (typeof current === "number") return { ok: true, paths, value: v.amountCents };
      return { ok: false, reason: "The document value doesn't match this field." };
    }
    if (v.kind === "date") return typeof current === "string" || current === null ? { ok: true, paths, value: v.date } : { ok: false, reason: "The document value doesn't match this field." };
    return typeof current === "string" ? { ok: true, paths, value: v.text } : { ok: false, reason: "The document value doesn't match this field." };
  }
  // Plain contract values (integer cents or a MoneyFact) at a concrete path.
  if (isMoneyFact(current)) {
    const cents = typeof v === "number" ? v : isMoneyFact(v) ? v.valueCents : null;
    if (cents === null || !Number.isSafeInteger(cents)) return { ok: false, reason: "The document value isn't a clear amount." };
    return { ok: true, paths, value: { valueCents: cents, status: "confirmed", sourceId: field.evidence.id } };
  }
  if (typeof current === typeof v || current === null) return { ok: true, paths, value: v };
  return { ok: false, reason: "The document value doesn't match this field." };
}

function showValue(field: Field) {
  const v = field.proposedValue;
  if (isProposed(v)) return v.kind === "money" ? `${moneyExact(v.amountCents)} (${PERIOD_LABEL[v.period] ?? v.period})` : v.kind === "date" ? v.date : v.text;
  if (typeof v === "number" && Number.isInteger(v)) return moneyExact(v);
  if (isMoneyFact(v)) return v.valueCents === null ? "Unknown" : moneyExact(v.valueCents);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function label(field: Field, target: Target, draft: Draft) {
  if (!isGeneric(field.path)) return describePath(field.path, draft);
  const base = EXTRACTION_FIELDS[field.path].label;
  const year = draft.years[target.yearIndex]?.year;
  if (field.path.startsWith("income.")) return `${year} · ${personName(draft, target.personId)} · ${base}`;
  if (field.path.startsWith("coverage.")) return `${year} · ${base} (every month)`;
  return `New project · ${base}`;
}

function defaultTarget(field: Field, draft: Draft): Target {
  const yearIndex = Math.max(0, draft.years.findIndex(y => y.year === field.evidence.taxYear));
  // Income for a year in progress is a forecast unless the user says it is final; Marketplace
  // monthly amounts printed on a notice are facts.
  const status = field.path.startsWith("income.") ? "estimated" : "confirmed";
  return { yearIndex, personId: adults(draft)[0]?.id ?? "primary", status, partialUse: null };
}

const isPartialIncome = (field: Field) => field.path.startsWith("income.") && isProposed(field.proposedValue) &&
  field.proposedValue.kind === "money" && field.proposedValue.period !== "annual";

export function DocumentImport({ draft, update }: { draft: Draft; update: Update }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [aiAvailable, setAiAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void getCapabilities().then(c => setAiAvailable(c.aiExtraction)); }, []);

  async function read(file: File, consentToProvider: boolean) {
    setState({ kind: "reading", name: file.name });
    try {
      const result = await extractDocument(file, { consentToProvider });
      if (result.status === "unavailable") setState({ kind: "unavailable", warnings: result.warnings });
      else setState({ kind: "review", name: file.name, fields: result.fields, warnings: result.warnings, decided: {},
        targets: Object.fromEntries(result.fields.map((f, i) => [i, defaultTarget(f, draft)])) });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "The document couldn't be read." });
    }
  }

  async function onFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) { setState({ kind: "error", message: "This file is larger than 3 MB. Try a smaller export, or enter the figures manually." }); return; }
    // PDFs and images go to the external document-analysis provider: ask first.
    if (needsProvider(file) && aiAvailable) { setState({ kind: "consent", file }); return; }
    await read(file, false);
  }

  function apply(index: number) {
    if (state.kind !== "review") return;
    const field = state.fields[index];
    const prepared = prepare(field, state.targets[index], draft);
    if (!prepared.ok) return;
    const focusPath = isPartialIncome(field) && state.targets[index].partialUse === "starting_point" ? prepared.paths[0] : null;
    update(d => {
      let changed = false;
      for (const path of prepared.paths) changed = setAt(d, path, isMoneyFact(prepared.value) ? { ...prepared.value } : prepared.value) || changed;
      if (changed && !d.evidence.some(e => e.id === field.evidence.id)) d.evidence.push(field.evidence);
    });
    setState({ ...state, decided: { ...state.decided, [index]: "applied" } });
    if (focusPath) setTimeout(() => {
      const el = document.getElementById(fieldId(focusPath));
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      ((el?.matches("input,select") ? el : el?.querySelector("input,select")) as HTMLElement | null)?.focus({ preventScroll: true });
    }, 50);
  }

  function retarget(index: number, patch: Partial<Target>) {
    if (state.kind !== "review") return;
    setState({ ...state, targets: { ...state.targets, [index]: { ...state.targets[index], ...patch } } });
  }

  return <div className="doc-import">
    <div className="doc-head">
      <div>
        <h3 className="small-head">Import a pay stub or statement <span className="optional">optional</span></h3>
        <p className="hint">Headroom proposes figures from the document; nothing is used until you approve each one. Manual entry works just as well. For 2026, use pay stubs or year-to-date reports — you don&apos;t need a 2026 W-2 or 1095-A.</p>
      </div>
      <label className="btn secondary small file-btn">
        <FileUp size={16} /> Choose a file
        <input ref={inputRef} type="file" accept={aiAvailable ? ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,application/pdf,image/*,text/csv,text/plain" : ".csv,.txt,text/csv,text/plain"}
          onChange={e => onFile(e.target.files?.[0])} disabled={state.kind === "reading"} />
      </label>
    </div>
    <p className="hint">CSV and text files are read on Headroom&apos;s server. {aiAvailable
      ? "PDFs and images are read by an AI document-analysis provider, only after you agree."
      : "Reading PDFs and images isn't available in this version — enter those figures manually."} Files aren&apos;t stored. Don&apos;t upload documents showing a full Social Security or bank account number.</p>

    {state.kind === "consent" && <div className="notice" role="group" aria-labelledby="consent-title">
      <strong id="consent-title">Send {state.file.name} for analysis?</strong>
      <p className="small">The whole file ({Math.ceil(state.file.size / 1024)} KB) will be sent to Anthropic, Headroom&apos;s document-analysis provider, to read printed figures. Headroom doesn&apos;t store the file, and you&apos;ll review every figure before it is used.</p>
      <div className="row gap">
        <button type="button" className="btn small primary" onClick={() => read(state.file, true)}>Send and read figures</button>
        <button type="button" className="btn small ghost" onClick={() => setState({ kind: "idle" })}>Cancel</button>
      </div>
    </div>}
    {state.kind === "reading" && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Reading {state.name}…</p>}
    {state.kind === "unavailable" && <div className="notice warn" role="status">
      <strong>Document analysis is unavailable. Enter the figures manually.</strong>
      {state.warnings.filter(w => !/^Document analysis is unavailable/.test(w)).length > 0 &&
        <ul className="bullets small">{state.warnings.filter(w => !/^Document analysis is unavailable/.test(w)).map(w => <li key={w}>{w}</li>)}</ul>}
    </div>}
    {state.kind === "error" && <div className="notice warn" role="alert"><strong>We couldn&apos;t read that file.</strong> {state.message} Your entries are unchanged.</div>}
    {state.kind === "review" && <div className="review">
      <p className="small"><strong>Review figures from {state.name}</strong></p>
      {state.fields.length === 0 && <p className="hint">No usable figures were found. Enter them manually below.</p>}
      {state.warnings.length > 0 && <ul className="warnings">{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <ul className="review-list">
        {state.fields.map((field, i) => {
          const target = state.targets[i];
          const prepared = prepare(field, target, draft);
          const generic = isGeneric(field.path);
          const year = generic ? { 1: String(target.yearIndex) } : /^years\.(\d)/.exec(field.path.replace(/\[(\d)\]/g, ".$1"));
          const targetYear = year ? draft.years[Number(year[1])]?.year : undefined;
          const yearMismatch = field.evidence.taxYear && targetYear && field.evidence.taxYear !== targetYear;
          const decided = state.decided[i];
          return <li key={field.path + i} className={decided ? `decided ${decided}` : ""}>
            <div className="review-main">
              <span className="review-path">{label(field, target, draft)}</span>
              <strong className="num">{showValue(field)}</strong>
            </div>
            <p className="muted small">{field.evidence.label}{field.evidence.page ? ` · page ${field.evidence.page}` : ""}{field.evidence.taxYear ? ` · tax year ${field.evidence.taxYear}` : ""}</p>
            {field.evidence.excerpt && <blockquote>{field.evidence.excerpt}</blockquote>}
            {generic && !decided && !field.path.startsWith("opportunity.") && <div className="row gap wrap small">
              <label>Tax year{" "}
                <select value={target.yearIndex} onChange={e => retarget(i, { yearIndex: Number(e.target.value) })}>
                  {draft.years.map((y, yi) => <option key={y.year} value={yi}>{y.year}</option>)}
                </select></label>
              {field.path.startsWith("income.") && adults(draft).length > 1 && <label>Person{" "}
                <select value={target.personId} onChange={e => retarget(i, { personId: e.target.value })}>
                  {adults(draft).map(p => <option key={p.id} value={p.id}>{personName(draft, p.id)}</option>)}
                </select></label>}
              {isMoneyFact(getAt(draft, targetPaths(field, target, draft)[0] ?? "")) && !isPartialIncome(field) && <label>This figure is{" "}
                <select value={target.status} onChange={e => retarget(i, { status: e.target.value as Target["status"] })}>
                  <option value="confirmed">a final, confirmed amount</option>
                  <option value="estimated">an estimate / forecast</option>
                </select></label>}
            </div>}
            {generic && !decided && isPartialIncome(field) && <fieldset className="small">
              <legend>{(field.proposedValue as { period: string }).period === "year_to_date" ? "This is a year-to-date amount, not your full year." : "The document doesn't say this covers the full year."} How should it be used?</legend>
              <label className="option-row"><input type="radio" name={`partial-${i}`} checked={target.partialUse === "starting_point"}
                onChange={() => retarget(i, { partialUse: "starting_point" })} /> As a starting point — I&apos;ll raise it to my full-year forecast</label>
              <label className="option-row"><input type="radio" name={`partial-${i}`} checked={target.partialUse === "full_year"}
                onChange={() => retarget(i, { partialUse: "full_year" })} /> It already is my full-year forecast</label>
            </fieldset>}
            {yearMismatch && <p className="hint warn">This document is for {field.evidence.taxYear}, but the field is for {targetYear}. Only apply it if the figure really belongs to {targetYear}.</p>}
            {prepared.ok && prepared.note && !decided && <p className="hint">{prepared.note}</p>}
            {!prepared.ok && <p className="hint warn">{prepared.reason}</p>}
            {decided ? <p className="small">{decided === "applied" ? "✓ Applied" : "Skipped"}</p>
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
