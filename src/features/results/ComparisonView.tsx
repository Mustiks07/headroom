"use client";

import { useMemo, useState } from "react";
import { Check, CircleAlert, FileSearch, Info, Star } from "lucide-react";
import type { CaseInput, ReadyComparison, ScenarioResult, YearResult } from "@/domain/contracts";
import { money, shortDate, signClass, signedMoney } from "@/features/format";
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
    title: s.label, subtitle: "2026 and 2027 tax years, settled when you file in 2027 and 2028.",
    trace: s.years.flatMap(y => y.trace.map(t => ({ ...t, id: `${y.year}-${t.id}`, label: `${y.year} · ${t.label}` }))),
    input, assumptions: s.assumptions,
    meta: { engineVersion: comparison.engineVersion, rulesVersion: comparison.rulesVersion, fingerprint: comparison.calculationFingerprint },
  };
}

export function ComparisonView({ comparison, input, stale, onShowCalc, onUse, busyScenarioId }: {
  comparison: ReadyComparison; input: CaseInput; stale: boolean;
  onShowCalc: (content: DrawerContent) => void;
  onUse?: (scenarioId: string) => void;
  busyScenarioId?: string | null;
}) {
  const scenarios = comparison.scenarios;
  const engineBase = scenarios.find(s => s.id === comparison.baselineScenarioId);
  const accept = scenarios.find(s => s.kind === "accept_now");
  const [choice, setChoice] = useState<BaselineChoice>("engine");
  const base = (choice === "accept" && accept) ? accept : engineBase;
  const recommended = scenarios.find(s => s.id === comparison.recommendedScenarioId) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = scenarios.find(s => s.id === selectedId) ?? recommended ?? scenarios.find(s => s.feasible && s.id !== base?.id) ?? scenarios[0];

  if (!base) return <p className="field-error">The engine result has no baseline scenario, so it can&apos;t be shown.</p>;

  const finding = describeFinding(comparison, base, recommended, accept);

  return <section className={`comparison ${stale ? "is-stale" : ""}`} aria-busy={stale} aria-labelledby="compare-title">
    {stale && <p className="stale-banner" role="status">Your inputs changed. These options are out of date until they recalculate.</p>}
    <div className="baseline-bar">
      <span className="baseline-label"><Info size={15} aria-hidden="true" /> {baselineLabel(base)} · 2026 + 2027</span>
      {accept && engineBase && accept.id !== engineBase.id && <div className="seg small" role="radiogroup" aria-label="Choose the comparison baseline">
        <label className={choice === "engine" ? "on" : ""}><input type="radio" name="baseline" checked={choice === "engine"} onChange={() => setChoice("engine")} />
          {engineBase.kind === "decline" ? "Without this project" : engineBase.label}</label>
        <label className={choice === "accept" ? "on" : ""}><input type="radio" name="baseline" checked={choice === "accept"} onChange={() => setChoice("accept")} />Accept as offered</label>
      </div>}
    </div>

    <div className="finding-block">
      <h3 id="compare-title" className="finding">{finding.title}</h3>
      {!stale && <p className="finding-body">{finding.body}</p>}
      {!stale && comparison.warnings.length > 0 && <ul className="warnings">{comparison.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    </div>

    <div className="scenario-grid">
      {scenarios.map(s => {
        const d = deltaVs(s, base);
        const isBase = s.id === base.id;
        const isRec = s.id === comparison.recommendedScenarioId && s.feasible;
        return <article key={s.id} className={`scenario ${isRec ? "recommended" : ""} ${!s.feasible ? "infeasible" : ""} ${selected?.id === s.id ? "selected" : ""}`}>
          <header>
            <h4>{s.label}</h4>
            {isRec && <span className="pill good"><Star size={13} aria-hidden="true" /> Best within your limits</span>}
            {isBase && <span className="pill neutral">Baseline</span>}
            {!s.feasible && <span className="pill neutral">Not available</span>}
          </header>
          {isBase ? <p className="muted small">Other options are measured against this one.</p> : <>
            <p className="metric-label">Cash after tax-year settlements</p>
            <p className={`metric num ${signClass(d.cash)}`}>{signedMoney(d.cash)}</p>
          </>}
          {s.grossAdditionalRetirementCents > 0 && <p className="retire"><span>Moved into retirement savings</span><strong className="num">{money(s.grossAdditionalRetirementCents)}</strong>
            <small>Pre-tax savings, taxed when withdrawn. Not spendable cash.</small></p>}
          <DecisionSummary s={s} input={input} />
          {s.stress.status !== "not_tested" && <p className={`stress ${s.stress.status}`}>
            {s.stress.status === "within_declared_range" ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            {s.stress.status === "within_declared_range" ? "Holds across your declared range" : `Can fail within your range (worst: ${signedMoney(s.stress.worstCashDeltaCents)})`}
            <span className="muted"> · {s.stress.checkedDescription}</span></p>}
          {!s.feasible && s.infeasibilityReasons.length > 0 && <ul className="reasons">{s.infeasibilityReasons.map(r => <li key={r}>{r}</li>)}</ul>}
          <div className="card-actions">
            <button type="button" className="btn ghost small" aria-pressed={selected?.id === s.id} onClick={() => setSelectedId(s.id)}>Details</button>
            {onUse && s.feasible && <button type="button" className="btn primary small" disabled={stale || !!busyScenarioId} onClick={() => onUse(s.id)}>
              {busyScenarioId === s.id ? "Saving…" : "Use this plan"}</button>}
          </div>
        </article>;
      })}
    </div>

    {selected && <ScenarioDetails s={selected} base={base} comparison={comparison} input={input} stale={stale} onShowCalc={onShowCalc} />}
  </section>;
}

function describeFinding(c: ReadyComparison, base: ScenarioResult, rec: ScenarioResult | null, accept: ScenarioResult | undefined) {
  if (!rec) return { title: "None of the options fit your limits",
    body: "Each option is shown with the reason it doesn't work. Try changing a limit, such as the retirement amount or payment dates." };
  const recDelta = deltaVs(rec, base).cash;
  if (rec.kind === "decline") return { title: "With these figures, not taking the project leaves your family with the most cash",
    body: "That can happen when extra income ends the subsidy. A higher price or different timing may change the answer." };
  if (rec.kind === "accept_now") return recDelta >= 0 || base.id === rec.id
    ? { title: "This project increases the cash your family keeps", body: "No special arrangement is needed. Accepting as offered is the best option within your limits." }
    : { title: "Accepting as offered is the best option within your limits", body: `${baselineLabel(base)}, it changes your cash by ${signedMoney(recDelta)}.` };
  const acceptText = accept && accept.id !== base.id ? ` Accepting as offered: ${signedMoney(deltaVs(accept, base).cash)}.` : "";
  return { title: `${rec.label}: ${signedMoney(recDelta)} cash after both tax years`,
    body: `${baselineLabel(base)}.${acceptText} ${c.scenarios.some(s => !s.feasible) ? "Options outside your limits are shown but not recommended." : ""}`.trim() };
}

function DecisionSummary({ s, input }: { s: ScenarioResult; input: CaseInput }) {
  const d = s.decisions;
  if (s.kind === "decline") return <p className="decision muted small">No project income or costs.</p>;
  return <ul className="decision">
    {s.kind === "renegotiate" && <li><span>Price to ask</span><strong className="num">{money(d.grossRevenueCents)}</strong></li>}
    {d.receipts.map(r => <li key={r.date + r.amountCents}><span>Paid {shortDate(r.date)}</span><strong className="num">{money(r.amountCents)}</strong></li>)}
    {d.additionalSep.filter(x => x.amountCents > 0).map(x => <li key={`${x.year}${x.personId}`}><span>Extra SEP-IRA {x.year} · {personName(input, x.personId)}</span><strong className="num">{money(x.amountCents)}</strong></li>)}
    {d.expenses.filter(x => x.amountCents > 0).map(x => <li key={`e${x.year}`}><span>Project costs {x.year}</span><strong className="num">{money(x.amountCents)}</strong></li>)}
  </ul>;
}

function ScenarioDetails({ s, base, comparison, input, stale, onShowCalc }: {
  s: ScenarioResult; base: ScenarioResult; comparison: ReadyComparison; input: CaseInput; stale: boolean; onShowCalc: (c: DrawerContent) => void;
}) {
  const waterfall = useMemo(() => buildWaterfall(s, base), [s, base]);
  const max = Math.max(1, ...waterfall.map(w => Math.abs(w.cents)));
  return <section className="details" aria-labelledby="details-title">
    <div className="details-head">
      <div><p className="eyebrow">Details</p><h3 id="details-title">{s.label}</h3><p className="muted small">{baselineLabel(base)}</p></div>
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
      <ul className="action-preview">{s.actions.map(a => <li key={a.id}><span>{a.title}</span><span className="muted">{a.dueDate ? `by ${shortDate(a.dueDate)}` : "No fixed date"}</span></li>)}</ul></div>}
    {s.assumptions.length > 0 && <div><h4 className="small-head">Assumptions</h4><ul className="bullets small">{s.assumptions.map(a => <li key={a}>{a}</li>)}</ul></div>}
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
