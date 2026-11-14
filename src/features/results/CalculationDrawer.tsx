"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CaseInput, TraceItem } from "@/domain/contracts";
import { moneyExact, shortFingerprint } from "@/features/format";
import { describePath, getAt, isMoneyFact } from "@/features/household/draft";

export interface DrawerContent {
  title: string;
  subtitle?: string;
  trace: TraceItem[];
  /** The exact input that produced this result (never the live, edited draft). */
  input: CaseInput;
  meta: { engineVersion: string; rulesVersion: string; fingerprint: string };
  assumptions?: string[];
}

const STATUS_TEXT = { confirmed: "Confirmed", estimated: "Estimate", unknown: "Unknown" } as const;

/** "Show the calculation": number → input fields → rule/source. */
export function CalculationDrawer({ content, onClose }: { content: DrawerContent | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!content) return;
    lastFocus.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      (lastFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [content, onClose]);

  if (!content) return null;
  const { input } = content;
  const sourceFor = (id: string) => input.evidence.find(e => e.id === id);

  return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header className="drawer-head">
        <div>
          <p className="eyebrow">Show the calculation</p>
          <h2 id="drawer-title">{content.title}</h2>
          {content.subtitle && <p className="muted small">{content.subtitle}</p>}
        </div>
        <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close the calculation details"><X size={20} /></button>
      </header>
      <div className="drawer-body">
        {content.trace.length === 0 && <p className="muted">The engine returned no step-by-step trace for this result.</p>}
        <ol className="trace">
          {content.trace.map(item => <li key={item.id} className="trace-item">
            <div className="trace-top">
              <strong>{item.label}</strong>
              <span className="num">{item.amountCents === null ? "Not computed" : moneyExact(item.amountCents)}</span>
            </div>
            {item.explanation && <p>{item.explanation}</p>}
            {item.inputPaths.length > 0 && <div className="trace-sub">
              <p className="trace-subhead">From your inputs</p>
              <ul>{item.inputPaths.map(path => <li key={path}><InputValue path={path} input={input} /></li>)}</ul>
            </div>}
            {item.sourceIds.length > 0 && <div className="trace-sub">
              <p className="trace-subhead">Sources and rules</p>
              <ul>{item.sourceIds.map(id => {
                const ev = sourceFor(id);
                if (!ev) return <li key={id}>Rule reference <code>{id}</code></li>;
                return <li key={id}>
                  <span className="kind-tag">{ev.kind === "synthetic" ? "Sample" : ev.kind === "manual" ? "You" : ev.kind.toUpperCase()}</span>
                  {ev.url ? <a href={ev.url} target="_blank" rel="noreferrer">{ev.label}</a> : ev.label}
                  {ev.taxYear && <span className="muted"> · tax year {ev.taxYear}</span>}
                  {ev.page && <span className="muted"> · page {ev.page}</span>}
                  {ev.excerpt && <blockquote>{ev.excerpt}</blockquote>}
                </li>;
              })}</ul>
            </div>}
          </li>)}
        </ol>
        {content.assumptions && content.assumptions.length > 0 && <section>
          <h3 className="small-head">Assumptions</h3>
          <ul className="bullets">{content.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
        </section>}
        <dl className="meta-list">
          <div><dt>Engine</dt><dd>{content.meta.engineVersion}</dd></div>
          <div><dt>Rules</dt><dd>{content.meta.rulesVersion}</dd></div>
          <div><dt>Fingerprint</dt><dd title={content.meta.fingerprint}>{shortFingerprint(content.meta.fingerprint)}</dd></div>
        </dl>
        {input.isSynthetic && <p className="hint">This is a synthetic sample household. Plan prices are county candidates or illustrative, not quotes for a real address.</p>}
      </div>
    </aside>
  </div>;
}

function InputValue({ path, input }: { path: string; input: CaseInput }) {
  const value = getAt(input, path);
  const label = describePath(path, input);
  if (isMoneyFact(value)) {
    const ev = input.evidence.find(e => e.id === value.sourceId);
    return <>{label}: <strong className="num">{value.valueCents === null ? "Unknown" : moneyExact(value.valueCents)}</strong>
      <span className="muted"> · {STATUS_TEXT[value.status]}{value.range ? ` (range ${moneyExact(value.range.lowCents)}–${moneyExact(value.range.highCents)})` : ""} · {ev ? ev.label : value.sourceId}</span></>;
  }
  if (value === undefined) return <>{label}</>;
  const shown = typeof value === "number" && /Cents$/.test(path) ? moneyExact(value)
    : typeof value === "boolean" ? (value ? "Yes" : "No") : value === null ? "Not answered" : Array.isArray(value) ? `${value.length} item(s)` : typeof value === "object" ? "" : String(value);
  return <>{label}{shown && <>: <strong>{shown}</strong></>}</>;
}
