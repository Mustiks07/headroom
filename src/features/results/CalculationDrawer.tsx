"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CaseInput, MoneyFact, TraceItem } from "@/domain/contracts";
import { resolveSource } from "@/domain/sources";
import { MONTHS, moneyExact, shortFingerprint } from "@/features/format";
import { describePath, getAt, isMoneyFact, normalizePath } from "@/features/household/draft";

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
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!content) return;
    lastFocus.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Keep keyboard focus inside the dialog while it is open.
      const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0]; const last = focusables[focusables.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
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
  const sourceFor = (id: string) => resolveSource(input, id);

  return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
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
              <span className="num">{item.amountCents === null ? "See explanation" : moneyExact(item.amountCents)}</span>
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
  const n = normalizePath(path);
  if (n.includes(".*.")) return <WildcardValue path={n} input={input} />;
  const value = getAt(input, path);
  const label = describePath(path, input);
  if (isMoneyFact(value)) return <>{label}: <FactText fact={value} input={input} /></>;
  if (value === undefined) return <>{label}</>;
  const shown = typeof value === "number" && /Cents$/.test(path) ? moneyExact(value)
    : typeof value === "boolean" ? (value ? "Yes" : "No") : value === null ? "Not answered" : Array.isArray(value) ? `${value.length} item(s)` : typeof value === "object" ? "" : String(value);
  return <>{label}{shown && <>: <strong>{shown}</strong></>}</>;
}

function FactText({ fact, input }: { fact: MoneyFact; input: CaseInput }) {
  const ev = resolveSource(input, fact.sourceId);
  return <><strong className="num">{fact.valueCents === null ? "Unknown" : moneyExact(fact.valueCents)}</strong>
    <span className="muted"> · {STATUS_TEXT[fact.status]}{fact.range ? ` (range ${moneyExact(fact.range.lowCents)}–${moneyExact(fact.range.highCents)})` : ""} · {ev ? ev.label : fact.sourceId}</span></>;
}

/** Expands engine paths such as years[0].coverage[*].enrollmentPremium into the actual monthly inputs. */
function WildcardValue({ path, input }: { path: string; input: CaseInput }) {
  const [head, tail] = path.split(".*.");
  const list = getAt(input, head);
  if (!Array.isArray(list)) return <>{describePath(path, input)}</>;
  const values = list.map((_, i) => getAt(input, `${head}.${i}.${tail}`));
  const label = describePath(path.replace(".*.", ".0."), input).replace(/^(\d{4} · )January · /, "$1");
  const same = values.every(v => JSON.stringify(v) === JSON.stringify(values[0]));
  const show = (v: unknown) => isMoneyFact(v) ? <FactText fact={v} input={input} /> : <strong>{v === null ? "Not answered" : v === true ? "Yes" : v === false ? "No" : String(v)}</strong>;
  if (same) return <>{label}, every month: {show(values[0])}</>;
  return <details className="month-values"><summary>{label}: varies by month</summary>
    <ul>{values.map((v, i) => <li key={i}>{MONTHS[i]}: {show(v)}</li>)}</ul></details>;
}
