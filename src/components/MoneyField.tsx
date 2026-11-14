"use client";

import { useEffect, useId, useState } from "react";
import type { MoneyFact } from "@/domain/contracts";
import { centsToInput, parseDollarsToCents } from "@/features/format";
import { MANUAL_SOURCE_ID, fieldId, type Evidence } from "@/features/household/draft";

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
  problem?: string;
}

/**
 * One money fact: value, confidence (estimate/confirmed/unknown), optional
 * declared range and its source. Clearing the box makes the fact unknown —
 * it never becomes zero unless the person picks the explicit "None" option.
 */
export function MoneyField({ path, label, hint, fact, evidence, onChange, noneLabel, compact, plain, problem }: Props) {
  const id = fieldId(path);
  const hintId = useId();
  const [text, setText] = useState(centsToInput(fact.valueCents));
  const [error, setError] = useState<string | null>(null);
  const [showRange, setShowRange] = useState(!!fact.range);

  useEffect(() => {
    const parsed = parseDollarsToCents(text);
    if (parsed !== fact.valueCents && !(parsed === "invalid")) setText(centsToInput(fact.valueCents));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fact.valueCents]);

  const source = evidence.find(e => e.id === fact.sourceId);
  const sourceText = !source ? `Source: ${fact.sourceId}` : source.kind === "synthetic" ? "Sample data"
    : source.kind === "document" ? `From ${source.label}` : source.kind === "manual" ? "Entered by you" : source.label;

  function commit(raw: string) {
    setText(raw);
    const parsed = parseDollarsToCents(raw);
    if (parsed === "invalid") { setError("Enter a dollar amount, like 4,250 or 4250.00."); return; }
    setError(null);
    if (parsed === null) { onChange({ valueCents: null, status: "unknown", sourceId: MANUAL_SOURCE_ID, ...(fact.range ? { range: fact.range } : {}) }); return; }
    const range = fact.range && parsed >= fact.range.lowCents && parsed <= fact.range.highCents ? fact.range : undefined;
    onChange({ valueCents: parsed, status: fact.status === "unknown" ? "estimated" : fact.status, sourceId: MANUAL_SOURCE_ID, ...(range ? { range } : {}) });
  }

  function setRange(which: "lowCents" | "highCents", raw: string) {
    const parsed = parseDollarsToCents(raw);
    if (parsed === "invalid") return;
    const current = fact.range ?? { lowCents: fact.valueCents ?? 0, highCents: fact.valueCents ?? 0 };
    if (parsed === null) return;
    const next = { ...current, [which]: parsed };
    if (next.lowCents > next.highCents) { setError("The low end of the range must not be above the high end."); return; }
    if (fact.valueCents !== null && (fact.valueCents < next.lowCents || fact.valueCents > next.highCents)) {
      setError("Your estimate must sit inside the range."); return;
    }
    setError(null);
    onChange({ ...fact, sourceId: MANUAL_SOURCE_ID, range: next });
  }

  const describedBy = [hint ? hintId : null, error || problem ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;

  return <div className={`money ${compact ? "compact" : ""} ${problem ? "has-problem" : ""}`} data-status={fact.status}>
    <label htmlFor={id} className="field-label">{label}</label>
    <div className="money-row">
      <span className="money-prefix" aria-hidden="true">$</span>
      <input id={id} inputMode="decimal" autoComplete="off" value={text} placeholder={plain ? "0" : "Unknown"}
        aria-invalid={!!error || !!problem} aria-describedby={describedBy}
        onChange={e => setText(e.target.value)} onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }} />
      {plain ? null : fact.status === "unknown"
        ? <span className="status-pill unknown">Unknown</span>
        : <select aria-label={`How sure are you about ${label.toLowerCase()}?`} className="status-select" value={fact.status}
          onChange={e => onChange({ ...fact, status: e.target.value as "estimated" | "confirmed" })}>
          <option value="estimated">Estimate</option>
          <option value="confirmed">Confirmed</option>
        </select>}
      {noneLabel && !(fact.valueCents === 0 && fact.status === "confirmed") &&
        <button type="button" className="chip-btn" onClick={() => { setText("0"); setError(null); onChange({ valueCents: 0, status: "confirmed", sourceId: MANUAL_SOURCE_ID }); }}>{noneLabel}</button>}
    </div>
    {!compact && !plain && <div className="money-meta">
      <span className="source-chip" title={source?.excerpt}>{sourceText}</span>
      <button type="button" className="link-btn" aria-expanded={showRange} onClick={() => setShowRange(v => !v)}>
        {showRange ? "Hide range" : fact.range ? "Edit range" : "Not sure? Add a range"}</button>
    </div>}
    {hint && <p className="hint" id={hintId}>{hint}</p>}
    {showRange && !compact && !plain && <div className="range-row">
      <label>Low <span className="money-prefix">$</span><input inputMode="decimal" defaultValue={centsToInput(fact.range?.lowCents ?? null)} onBlur={e => setRange("lowCents", e.target.value)} aria-label={`${label}: low end of range`} /></label>
      <label>High <span className="money-prefix">$</span><input inputMode="decimal" defaultValue={centsToInput(fact.range?.highCents ?? null)} onBlur={e => setRange("highCents", e.target.value)} aria-label={`${label}: high end of range`} /></label>
      {fact.range && <button type="button" className="link-btn" onClick={() => { const { range: _r, ...rest } = fact; void _r; onChange(rest); setShowRange(false); }}>Remove range</button>}
      <p className="hint">A range is the span you want Headroom to check, not a probability.</p>
    </div>}
    {(error || problem) && <p className="field-error" id={`${id}-err`} role={error ? "alert" : undefined}>{error ?? problem}</p>}
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
