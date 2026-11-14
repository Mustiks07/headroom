"use client";

import { useMemo, useState } from "react";
import { Check, CircleAlert, FileSearch, Info, Star } from "lucide-react";
import type { CaseInput, ReadyComparison, ReadyRiskAssessment, ScenarioResult, YearResult } from "@/domain/contracts";
import { humanizeDates, money, shortDate, signClass, signedMoney } from "@/features/format";
import { personName } from "@/features/household/draft";
import type { DrawerContent } from "./CalculationDrawer";

type BaselineChoice = "engine" | "accept";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const yearSum = (s: ScenarioResult, pick: (y: YearResult) => number) => sum(s.years.map(pick));

export function baselineLabel(s: ScenarioResult | undefined): string {
  if (!s) return "Compared with the baseline";
  if (s.kind === "decline") return "Compared with not taking this project";
  if (s.kind === "accept_now") return "Compared with accepting as offered";
  return `Compared with “${s.label}”`;
}

/** Display-only rebasing: both numbers come from the same engine result. */
export function deltaVs(s: ScenarioResult, base: ScenarioResult) {
  return {
    cash: s.twoYearCashDeltaCents - base.twoYearCashDeltaCents,
    retirement: s.grossAdditionalRetirementCents - base.grossAdditionalRetirementCents,
  };
}

export function scenarioTrace(s: ScenarioResult, comparison: ReadyComparison, input: CaseInput): DrawerContent {
  return {
    title: humanizeDates(s.label), subtitle: "2026 and 2027 tax years, settled when you file in 2027 and 2028.",
    trace: s.years.flatMap(y => y.trace.map(t => ({ ...t, id: `${y.year}-${t.id}`, label: `${y.year} · ${t.label}` }))),
    input, assumptions: s.assumptions,
    meta: { engineVersion: comparison.engineVersion, rulesVersion: comparison.rulesVersion, fingerprint: comparison.calculationFingerprint },
  };
}

export function ComparisonView({ comparison, input, stale, onShowCalc, onUse, busyScenarioId, risk, hideOverview, useLabel = "Use this plan", currentId }: {
  comparison: ReadyComparison; input: CaseInput; stale: boolean;
  onShowCalc: (content: DrawerContent) => void;
  onUse?: (scenarioId: string) => void;
  busyScenarioId?: string | null;
  risk?: ReadyRiskAssessment | null;
  hideOverview?: boolean;
  useLabel?: string;
  currentId?: string;
}) {
  const scenarios = comparison.scenarios;
  const base = scenarios.find(s => s.id === comparison.baselineScenarioId);
  const accept = scenarios.find(s => s.kind === "accept_now");
  const recommended = scenarios.find(s => s.id === comparison.recommendedScenarioId && s.feasible) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = scenarios.find(s => s.id === selectedId) ?? recommended ?? scenarios.find(s => s.feasible && s.id !== base?.id) ?? scenarios[0];

  if (!base) return <p className="field-error">The engine result has no baseline scenario, so it can&apos;t be shown.</p>;

  return <section className={`comparison ${stale ? "is-stale" : ""}`} aria-busy={stale} aria-labelledby="compare-title">
    {stale && <p className="stale-banner" role="status">Your inputs changed. These options are out of date until they recalculate.</p>}
    {!hideOverview && <DecisionOverview comparison={comparison} input={input} risk={risk ?? null} stale={stale} onShowCalc={onShowCalc} onUse={onUse} busy={busyScenarioId} />}

    <div className="options-head">
      <h3 id="compare-title" className="small-head">All options</h3>
      <p className="muted small">Each card shows cash after both tax years settle (2026 + 2027) — first compared with not taking the project, then with accepting it as offered. Retirement savings are shown separately.</p>
    </div>
    <div className="scenario-grid">
      {scenarios.map(s => {
        const isBase = s.id === base.id;
        const isRec = s.id === recommended?.id;
        const vsDecline = deltaVs(s, base);
        const vsAccept = accept && s.id !== accept.id && !isBase ? deltaVs(s, accept) : null;
        return <article key={s.id} className={`scenario ${isRec ? "recommended" : ""} ${!s.feasible ? "infeasible" : ""} ${selected?.id === s.id ? "selected" : ""}`}>
          <header>
            <h4>{humanizeDates(s.label)}</h4>
            {isRec && <span className="pill good"><Star size={13} aria-hidden="true" /> Best found within your limits</span>}
            {s.id === currentId && <span className="pill neutral">In your plan</span>}
            {!s.feasible && <span className="pill bad">Not available</span>}
          </header>
          {isBase ? <p className="muted small">Your current forecast without this project. Other options are measured against it.</p> : <>
            <div className="delta-line">
              <span className="metric-label">Compared with not taking it</span>
              <span className={`metric num ${signClass(vsDecline.cash)}`}>{signedMoney(vsDecline.cash)}</span>
            </div>
            {vsAccept && <div className="delta-line second">
              <span className="metric-label">Compared with accepting as offered</span>
              <span className={`num ${signClass(vsAccept.cash)}`}>{signedMoney(vsAccept.cash)}</span>
            </div>}
          </>}
          {s.grossAdditionalRetirementCents > 0 && <p className="retire"><span>Also moved into retirement savings</span><strong className="num">{money(s.grossAdditionalRetirementCents)}</strong>
            <small>Not counted in the cash above. Taxed when withdrawn later.</small></p>}
          <PaymentSummary s={s} input={input} />
          {s.stress.status !== "not_tested" && <p className={`stress ${s.stress.status}`}>
            {s.stress.status === "within_declared_range" ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            {s.stress.status === "within_declared_range" ? "Holds across your declared range" : `Can fail within your range (worst: ${signedMoney(s.stress.worstCashDeltaCents)})`}
            <span className="muted"> · {s.stress.checkedDescription}</span></p>}
          {!s.feasible && <div className="reasons"><strong>Why it isn&apos;t available:</strong>
            <ul>{(s.infeasibilityReasons.length ? s.infeasibilityReasons : ["It doesn't fit the limits you set."]).map(r => <li key={r}>{humanizeDates(r)}</li>)}</ul></div>}
          <div className="card-actions">
            <button type="button" className="btn ghost small" aria-pressed={selected?.id === s.id} onClick={() => setSelectedId(s.id)}>Details</button>
            {onUse && s.feasible && s.id !== currentId && <button type="button" className="btn primary small" disabled={stale || !!busyScenarioId} onClick={() => onUse(s.id)}>
              {busyScenarioId === s.id ? "Saving…" : useLabel}</button>}
          </div>
        </article>;
      })}
    </div>

    {selected && <ScenarioDetails s={selected} base={base} comparison={comparison} input={input} stale={stale} onShowCalc={onShowCalc} />}
  </section>;
}

/** Notes that qualify the inputs themselves (sample data, benchmark source, draft tables). */
const DATA_NOTE = /synthetic|benchmark|illustrative/i;
const SEARCH_NOTE = /searched|grid|worst-case gap/i;

/**
 * Result-first summary: the subsidy today, what accepting as offered does,
 * and the best feasible option found. Every number is an engine field or a
 * difference of two engine fields from the same result.
 */
export function DecisionOverview({ comparison, input, risk, stale, onShowCalc, onUse, busy }: {
  comparison: ReadyComparison; input: CaseInput; risk: ReadyRiskAssessment | null; stale: boolean;
  onShowCalc: (c: DrawerContent) => void; onUse?: (id: string) => void; busy?: string | null;
}) {
  const base = comparison.scenarios.find(s => s.id === comparison.baselineScenarioId);
  const accept = comparison.scenarios.find(s => s.kind === "accept_now");
  const rec = comparison.scenarios.find(s => s.id === comparison.recommendedScenarioId && s.feasible) ?? null;
  if (!base) return null;
  const acceptDelta = accept ? deltaVs(accept, base).cash : null;
  const lostCredit = accept ? accept.years.map((y, i) => ({ year: y.year, before: base.years[i].ptcCents, after: y.ptcCents })).filter(x => x.after < x.before) : [];
  const repay = accept ? accept.years.filter(y => y.aptcSettlementCents > 0) : [];
  const searchNote = rec?.assumptions.find(a => SEARCH_NOTE.test(a));
  const gap = searchNote ? /gap\s*≤\s*(\$[\d,]+)/.exec(searchNote)?.[1] : undefined;
  const nextSteps = rec ? [...rec.actions].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).slice(0, 2) : [];
  const dataNotes = [...comparison.warnings, ...(risk?.warnings ?? [])].filter((w, i, all) => DATA_NOTE.test(w) && all.indexOf(w) === i);
  const allNotes = [...new Set([...comparison.warnings, ...(rec?.assumptions ?? [])])];
  const r = risk?.risk;

  const recDelta = rec ? deltaVs(rec, base).cash : null;
  const recVsAccept = rec && accept && rec.id !== accept.id ? deltaVs(rec, accept).cash : null;
  const verdict = verdictText(acceptDelta, rec, recDelta);

  return <div className={`overview ${stale ? "is-stale" : ""}`}>
    <p className="verdict">{verdict}</p>
    <div className="overview-grid">
      <div className="tile">
        <p className="tile-k">Subsidy now · {r?.year ?? base.years[0].year}</p>
        {r ? <>
          <p className="tile-big num">{money(r.subsidyCents)}<span className="tile-unit">/year</span></p>
          <p className="tile-sub"><span className={`pill ${RISK_TONE[r.state]}`}>{RISK_TEXT[r.state]}</span></p>
          <p className="tile-line">Income for the subsidy <strong className="num">{money(r.forecastMagiCents)}</strong> of <strong className="num">{money(r.thresholdMagiCents)}</strong> limit</p>
        </> : <><p className="tile-big num">{money(base.years[0].ptcCents)}<span className="tile-unit">/year</span></p>
          <p className="tile-sub">premium tax credit without the project</p></>}
      </div>
      {accept && acceptDelta !== null && <div className="tile">
        <p className="tile-k">Accept as offered</p>
        <p className={`tile-big num ${signClass(acceptDelta)}`}>{signedMoney(acceptDelta)}</p>
        <p className="tile-sub">vs. not taking the project</p>
        {lostCredit.slice(0, 1).map(l => <p key={l.year} className="tile-line">{l.year} credit <span className="num">{money(l.before)}</span> → <strong className="num">{money(l.after)}</strong></p>)}
        {repay.slice(0, 1).map(y => <p key={y.year} className="tile-line warn-text">Repay <strong className="num">{money(y.aptcSettlementCents)}</strong> when you file in {y.year + 1}</p>)}
      </div>}
      <div className={`tile ${rec ? "tile-rec" : ""}`}>
        <p className="tile-k">Best within your limits</p>
        {!rec ? <p className="tile-line">No option fits your limits. The cards below explain why.</p> : <>
          <p className={`tile-big num ${signClass(recDelta)}`}>{rec.kind === "decline" ? "$0" : signedMoney(recDelta)}</p>
          <p className="tile-sub">{shortOptionName(rec)}{rec.kind !== "decline" ? " · vs. not taking it" : ""}</p>
          {recVsAccept !== null && rec.kind !== "decline" && <p className="tile-line"><strong className={`num ${signClass(recVsAccept)}`}>{signedMoney(recVsAccept)}</strong> vs. accepting as offered</p>}
          {rec.grossAdditionalRetirementCents > 0 && <p className="tile-line">+ <strong className="num">{money(rec.grossAdditionalRetirementCents)}</strong> retirement savings, kept separate</p>}
        </>}
      </div>
    </div>
    {rec && <div className="overview-actions">
      {onUse && <button type="button" className="btn primary" disabled={stale || !!busy} onClick={() => onUse(rec.id)}>{busy === rec.id ? "Saving…" : `Use “${shortOptionName(rec)}”`}</button>}
      <button type="button" className="btn ghost small" disabled={stale} onClick={() => onShowCalc(scenarioTrace(rec, comparison, input))}><FileSearch size={15} /> Show the calculation</button>
      <a className="link-btn" href="#compare-area">See all options</a>
    </div>}
    <p className="baseline-help muted small">Amounts are cash your family keeps after the 2026 and 2027 tax returns settle — not a bank balance. “vs. not taking the project” is the project&apos;s whole effect; “vs. accepting as offered” is what the arrangement adds. Retirement savings are never counted as cash.</p>
    {dataNotes.length > 0 && <p className="data-notes" role="note"><Info size={14} aria-hidden="true" /> {dataNotes.map(n => humanizeDates(n)).join(" ")}</p>}
    {rec && <details className="explain">
      <summary>What you would do{nextSteps.length ? ` (${rec.actions.length} step${rec.actions.length === 1 ? "" : "s"})` : ""} and its conditions</summary>
      <p className="small"><strong>{humanizeDates(rec.label)}</strong></p>
      {nextSteps.length > 0 && <ul className="bullets small">{[...rec.actions].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).map(a =>
        <li key={a.id}>{humanizeDates(a.title)}{a.dueDate && <span className="muted"> · by {shortDate(a.dueDate)}</span>}</li>)}</ul>}
      {searchNote && <p className="hint">“Best” comes from a bounded search, not an exact optimum{gap ? <> — within about <strong>{gap}</strong> of the exact best</> : ""}.</p>}
      <ul className="bullets small">{allNotes.map(n => <li key={n}>{humanizeDates(n)}</li>)}</ul>
    </details>}
  </div>;
}

/** Short, plain name for an option kind; the engine's full label is shown in details. */
export function shortOptionName(s: ScenarioResult): string {
  return ({ decline: "Decline the project", accept_now: "Accept as offered", sep_minimum: "Accept + SEP-IRA",
    sep_buffer: "Accept + larger SEP-IRA", split_payment: "Split the payment", renegotiate: "Ask for a higher price" } as const)[s.kind] ?? s.label;
}

function verdictText(acceptDelta: number | null, rec: ScenarioResult | null, recDelta: number | null): string {
  if (!rec) return "None of the options fits your limits yet.";
  const acc = acceptDelta === null ? "" : acceptDelta < 0 ? `Taking this project as offered leaves your family ${signedMoney(acceptDelta).replace("−", "")} worse off. `
    : `Taking this project as offered adds ${signedMoney(acceptDelta)}. `;
  if (rec.kind === "accept_now") return `${acc}No special arrangement is needed.`;
  if (rec.kind === "decline") return `${acc}With these figures, not taking it keeps the most cash.`;
  return `${acc}${shortOptionName(rec)} instead: ${signedMoney(recDelta)}.`;
}

const RISK_TEXT = { below_cliff: "Below the limit", at_risk: "Close to the limit", over_cliff: "Above the limit", no_credit: "No credit expected" } as const;
const RISK_TONE = { below_cliff: "good", at_risk: "warn", over_cliff: "bad", no_credit: "neutral" } as const;

function PaymentSummary({ s, input }: { s: ScenarioResult; input: CaseInput }) {
  const d = s.decisions;
  if (s.kind === "decline") return null;
  return <div className="decision">
    {s.kind === "renegotiate" && <p>Ask the client for <strong className="num">{money(d.grossRevenueCents)}</strong> instead of {money(input.opportunity.grossRevenueCents)}.</p>}
    {d.receipts.length > 0 && <p>You receive {d.receipts.map((r, i) => <span key={r.date + r.amountCents}>{i > 0 ? (i === d.receipts.length - 1 ? " and " : ", ") : ""}<strong className="num">{money(r.amountCents)}</strong> on {shortDate(r.date)}</span>)}.</p>}
    {d.additionalSep.filter(x => x.amountCents > 0).map(x => <p key={`${x.year}${x.personId}`}>{personName(input, x.personId) === "You" ? "You put" : `${personName(input, x.personId)} puts`} <strong className="num">{money(x.amountCents)}</strong> into a SEP-IRA for {x.year}.</p>)}
    {d.expenses.filter(x => x.amountCents > 0).map(x => <p key={`e${x.year}`}>Project costs paid in {x.year}: <strong className="num">{money(x.amountCents)}</strong></p>)}
  </div>;
}

function ScenarioDetails({ s, base, comparison, input, stale, onShowCalc }: {
  s: ScenarioResult; base: ScenarioResult; comparison: ReadyComparison; input: CaseInput; stale: boolean; onShowCalc: (c: DrawerContent) => void;
}) {
  const waterfall = useMemo(() => buildWaterfall(s, base), [s, base]);
  const max = Math.max(1, ...waterfall.map(w => Math.abs(w.cents)));
  return <section className="details" aria-labelledby="details-title">
    <div className="details-head">
      <div><p className="eyebrow">Details</p><h3 id="details-title">{humanizeDates(s.label)}</h3><p className="muted small">{baselineLabel(base)}</p></div>
      <button type="button" className="btn ghost small" disabled={stale} onClick={() => onShowCalc(scenarioTrace(s, comparison, input))}><FileSearch size={16} /> Show the calculation</button>
    </div>
    {s.id !== base.id && <div className="waterfall" role="table" aria-label="How the cash change adds up">
      {waterfall.map(row => <div role="row" key={row.label} className={`wf-row ${row.total ? "total" : ""}`}>
        <span role="cell" className="wf-label">{row.label}</span>
        <span role="cell" className="wf-bar-wrap" aria-hidden="true"><span className={`wf-bar ${signClass(row.cents)}`} style={{ width: `${(Math.abs(row.cents) / max) * 100}%` }} /></span>
        <span role="cell" className={`wf-value num ${signClass(row.cents)}`}>{signedMoney(row.cents)}</span>
      </div>)}
    </div>}

    <div className="table-wrap">
      <table className="years-table">
        <caption>Both tax years for this option</caption>
        <thead><tr><th scope="col">Item</th>{s.years.map(y => <th scope="col" key={y.year}>{y.year}</th>)}</tr></thead>
        <tbody>
          {YEAR_ROWS.map(([label, pick, sign]) => <tr key={label}>
            <th scope="row">{label}</th>
            {s.years.map((y, i) => {
              const delta = pick(y) - pick(base.years[i]);
              return <td key={y.year}><span className="num">{sign === "settle" ? settleText(pick(y)) : money(pick(y))}</span>
                {s.id !== base.id && delta !== 0 && <small className="num muted"> {signedMoney(delta)}</small>}</td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="hint"><strong>When is this settled?</strong> 2026 taxes and premium credit are settled when you file in 2027; 2027&apos;s when you file in 2028. “Cash after tax-year settlements” counts both — it is not a bank balance on any one day.</p>

    {s.actions.length > 0 && <div><h4 className="small-head">What you would do</h4>
      <ul className="action-preview">{s.actions.map(a => <li key={a.id}><span>{humanizeDates(a.title)}</span><span className="muted">{a.dueDate ? `by ${shortDate(a.dueDate)}` : "No fixed date"}</span></li>)}</ul></div>}
    {s.assumptions.length > 0 && <div><h4 className="small-head">Assumptions</h4><ul className="bullets small">{s.assumptions.map(a => <li key={a}>{humanizeDates(a)}</li>)}</ul></div>}
  </section>;
}

const YEAR_ROWS: Array<[string, (y: YearResult) => number, "money" | "settle"]> = [
  ["Income counted for the subsidy (MAGI)", y => y.magiCents, "money"],
  ["Premium tax credit", y => y.ptcCents, "money"],
  ["Advance credit paid to insurer", y => y.aptcCents, "money"],
  ["Settlement when you file", y => y.aptcSettlementCents, "settle"],
  ["Federal income tax", y => y.federalIncomeTaxCents, "money"],
  ["Self-employment tax", y => y.selfEmploymentTaxCents, "money"],
  ["Employee payroll taxes", y => y.employeeFicaCents, "money"],
  ["Self-employed health insurance deduction", y => y.sehiDeductionCents, "money"],
  ["Moved into retirement savings", y => y.additionalRetirementCents, "money"],
  ["Household cash after tax-year settlement", y => y.spendableAfterSettlementCents, "money"],
];

function settleText(cents: number) {
  if (cents === 0) return "None";
  return cents > 0 ? `Repay ${money(cents)}` : `Extra ${money(-cents)}`;
}

/** Each row is a difference of two engine outputs; any remainder is shown, not hidden. */
function buildWaterfall(s: ScenarioResult, base: ScenarioResult) {
  const rows: Array<{ label: string; cents: number; total?: boolean }> = [];
  const gross = s.decisions.grossRevenueCents - base.decisions.grossRevenueCents;
  const costs = sum(s.decisions.expenses.map(e => e.amountCents)) - sum(base.decisions.expenses.map(e => e.amountCents));
  const retirement = s.grossAdditionalRetirementCents - base.grossAdditionalRetirementCents;
  const incomeTax = yearSum(s, y => y.federalIncomeTaxCents) - yearSum(base, y => y.federalIncomeTaxCents);
  const seTax = yearSum(s, y => y.selfEmploymentTaxCents) - yearSum(base, y => y.selfEmploymentTaxCents);
  const fica = yearSum(s, y => y.employeeFicaCents) - yearSum(base, y => y.employeeFicaCents);
  const ptc = yearSum(s, y => y.ptcCents) - yearSum(base, y => y.ptcCents);
  const cash = s.twoYearCashDeltaCents - base.twoYearCashDeltaCents;
  rows.push({ label: "Project income", cents: gross });
  if (costs) rows.push({ label: "Project costs", cents: -costs });
  if (retirement) rows.push({ label: "Moved into retirement savings", cents: -retirement });
  rows.push({ label: "Federal income tax", cents: -incomeTax });
  rows.push({ label: "Self-employment tax", cents: -seTax });
  if (fica) rows.push({ label: "Employee payroll taxes", cents: -fica });
  rows.push({ label: "Premium tax credit (after settlement)", cents: ptc });
  const remainder = cash - sum(rows.map(r => r.cents));
  if (Math.abs(remainder) >= 100) rows.push({ label: "Other effects in the calculation", cents: remainder });
  rows.push({ label: "Cash after tax-year settlements", cents: cash, total: true });
  return rows;
}
