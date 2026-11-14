"use client";

import { useEffect, useId, useState } from "react";
import type { MoneyFact } from "@/domain/contracts";
import { centsToInput, parseDollarsToCents } from "@/features/format";
import { MANUAL_SOURCE_ID, fieldId, type Evidence } from "@/features/household/draft";
import { useInvalidInputs } from "@/features/household/invalidInputs";

interface Props {
  path: string;
  label: string;
  hint?: string;
  fact: MoneyFact;
  evidence: Evidence[];
  onChange: (fact: MoneyFact) => void;
  /** Label for the explicit zero shortcut, e.g. "None". Omit to hide. */
  noneLabel?: string;
  compact?: boolean;
  /** A plain contract amount without confidence/source (project price, limits). */
  plain?: boolean;
  /** For plain amounts: an empty box is an error rather than zero. */
  required?: boolean;
  problem?: string;
}

/**
 * One money fact: value, confidence (estimate/confirmed/unknown), optional
 * declared range and its source. Clearing the box makes the fact unknown —
 * it never becomes zero unless the person picks the explicit "None" option.
 */
export function MoneyField({ path, label, hint, fact, evidence, onChange, noneLabel, compact, plain, required, problem }: Props) {
  const id = fieldId(path);
  const hintId = useId();
  const invalid = useInvalidInputs();
  const stored = invalid?.get(path);
  const [text, setText] = useState(stored?.text ?? centsToInput(fact.valueCents));
  const [localError, setLocalError] = useState<string | null>(null);
  const rangeKey = `${path}#range`;
  const rangeError = invalid?.get(rangeKey);
  // One invalid entry holds both typed ends, so a restored draft shows exactly what was typed.
  const [lowText, setLowText] = useState(rangeError?.low ?? centsToInput(fact.range?.lowCents ?? null));
  const [highText, setHighText] = useState(rangeError?.high ?? centsToInput(fact.range?.highCents ?? null));
  const [showRange, setShowRange] = useState(!!fact.range || !!rangeError);
  const supportsRange = /\.(scheduleCProfit|taxableInterest|taxExemptInterest)$/.test(path);
  const error = stored?.message ?? localError;

  // Follow outside changes (copy buttons, document import, "None") unless the box holds unfixed text.
  useEffect(() => {
    if (invalid?.get(path)) return;
    const parsed = parseDollarsToCents(text);
    if (parsed !== fact.valueCents) setText(centsToInput(fact.valueCents));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fact.valueCents]);

  const source = evidence.find(e => e.id === fact.sourceId);
  const sourceText = !source ? `Source: ${fact.sourceId}` : source.kind === "synthetic" ? "Sample data"
    : source.kind === "document" ? `From ${source.label}` : source.kind === "manual" ? "Entered by you" : source.label;

  function flag(key: string, raw: string, message: string, parts?: { low: string; high: string }) {
    if (invalid) invalid.set(key, { text: raw, message, ...parts }); else setLocalError(message);
  }
  function clear(key: string) { if (invalid) invalid.set(key, null); setLocalError(null); }

  /** Every keystroke is either a valid fact sent to the draft, or a recorded invalid entry — never a silently kept old value. */
  function commit(raw: string) {
    setText(raw);
    const parsed = parseDollarsToCents(raw);
    if (parsed === "invalid") { flag(path, raw, "Enter a dollar amount, like 4,250 or 4250.00"); return; }
    if (parsed === null && (plain && required)) { flag(path, raw, "Enter an amount (type 0 if there is none)"); return; }
    if (parsed !== null && fact.range && (parsed < fact.range.lowCents || parsed > fact.range.highCents)) {
      flag(path, raw, `This amount is outside your range (${centsToInput(fact.range.lowCents)}–${centsToInput(fact.range.highCents)}). Change the amount or the range`); return;
    }
    clear(path);
    if (parsed === null) { onChange({ valueCents: null, status: "unknown", sourceId: MANUAL_SOURCE_ID, ...(fact.range ? { range: fact.range } : {}) }); return; }
    onChange({ valueCents: parsed, status: fact.status === "unknown" ? "estimated" : fact.status, sourceId: MANUAL_SOURCE_ID, ...(fact.range ? { range: fact.range } : {}) });
  }

  function commitRange(nextLow: string, nextHigh: string) {
    setLowText(nextLow); setHighText(nextHigh);
    const lo = parseDollarsToCents(nextLow); const hi = parseDollarsToCents(nextHigh);
    if (lo === "invalid" || hi === "invalid") { flag(rangeKey, `${nextLow} – ${nextHigh}`, "Enter the range as two dollar amounts", { low: nextLow, high: nextHigh }); return; }
    if (lo === null && hi === null) { clear(rangeKey); if (fact.range) { const { range: _r, ...rest } = fact; void _r; onChange(rest); } return; }
    if (lo === null || hi === null) { flag(rangeKey, `${nextLow} – ${nextHigh}`, "Enter both the low and the high end of the range", { low: nextLow, high: nextHigh }); return; }
    if (lo > hi) { flag(rangeKey, `${nextLow} – ${nextHigh}`, "The low end of the range must not be above the high end", { low: nextLow, high: nextHigh }); return; }
    if (fact.valueCents !== null && (fact.valueCents < lo || fact.valueCents > hi)) { flag(rangeKey, `${nextLow} – ${nextHigh}`, "Your estimate must sit inside the range", { low: nextLow, high: nextHigh }); return; }
    clear(rangeKey);
    onChange({ ...fact, sourceId: MANUAL_SOURCE_ID, range: { lowCents: lo, highCents: hi } });
  }

  function removeRange() {
    clear(rangeKey); setLowText(""); setHighText("");
    const { range: _r, ...rest } = fact; void _r; onChange(rest); setShowRange(false);
  }

  const describedBy = [hint ? hintId : null, error || problem ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;

  return <div className={`money ${compact ? "compact" : ""} ${problem || error || rangeError ? "has-problem" : ""}`} data-status={fact.status}>
    <label htmlFor={id} className="field-label">{label}</label>
    <div className="money-row">
      <span className="money-prefix" aria-hidden="true">$</span>
      <input id={id} inputMode="decimal" autoComplete="off" value={text} placeholder={plain ? "0" : "Unknown"}
        aria-invalid={!!error || !!problem} aria-describedby={describedBy}
        onChange={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }} />
      {plain ? null : fact.status === "unknown"
        ? <span className="status-pill unknown">Unknown</span>
        : <select aria-label={`How sure are you about ${label.toLowerCase()}?`} className="status-select" value={fact.status}
          onChange={e => onChange({ ...fact, status: e.target.value as "estimated" | "confirmed" })}>
          <option value="estimated">Estimate</option>
          <option value="confirmed">Confirmed</option>
        </select>}
      {noneLabel && !(fact.valueCents === 0 && fact.status === "confirmed") &&
        <button type="button" className="chip-btn" onClick={() => { setText("0"); clear(path); clear(rangeKey); onChange({ valueCents: 0, status: "confirmed", sourceId: MANUAL_SOURCE_ID }); }}>{noneLabel}</button>}
    </div>
    {!compact && !plain && <div className="money-meta">
      <span className="source-chip" title={source?.excerpt}>{sourceText}</span>
      {(supportsRange || fact.range) && <button type="button" className="link-btn" aria-expanded={showRange} onClick={() => setShowRange(v => !v)}>
        {showRange ? "Hide range" : fact.range ? "Edit range" : "Not sure? Add a range"}</button>}
    </div>}
    {hint && <p className="hint" id={hintId}>{hint}</p>}
    {showRange && !compact && !plain && <div className="range-row">
      <label>Low <span className="money-prefix">$</span><input inputMode="decimal" value={lowText} onChange={e => commitRange(e.target.value, highText)} aria-invalid={!!rangeError} aria-label={`${label}: low end of range`} /></label>
      <label>High <span className="money-prefix">$</span><input inputMode="decimal" value={highText} onChange={e => commitRange(lowText, e.target.value)} aria-invalid={!!rangeError} aria-label={`${label}: high end of range`} /></label>
      {(fact.range || rangeError) && <button type="button" className="link-btn" onClick={removeRange}>Remove range</button>}
      <p className="hint">A range is the span you want Headroom to check, not a probability.</p>
    </div>}
    {rangeError && <p className="field-error" role="alert">{rangeError.message}. The calculation waits until this is fixed.</p>}
    {(error || problem) && <p className="field-error" id={`${id}-err`} role={error ? "alert" : undefined}>{error ? `${error}. The calculation waits until this is fixed.` : problem}</p>}
  </div>;
}

/** Yes / No / Not sure for nullable booleans. */
export function TriState({ id, label, hint, value, onChange, yes = "Yes", no = "No", problem }: {
  id: string; label: string; hint?: string; value: boolean | null; onChange: (v: boolean | null) => void; yes?: string; no?: string; problem?: string;
}) {
  const name = useId();
  return <fieldset className={`tri ${problem ? "has-problem" : ""}`} id={id}>
    <legend className="field-label">{label}</legend>
    <div className="seg" role="radiogroup">
      {([[true, yes], [false, no], [null, "Not sure"]] as const).map(([v, text]) =>
        <label key={String(v)} className={value === v ? "on" : ""}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />{text}
        </label>)}
    </div>
    {hint && <p className="hint">{hint}</p>}
    {problem && <p className="field-error">{problem}</p>}
  </fieldset>;
}
