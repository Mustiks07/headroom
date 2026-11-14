"use client";

import type { MoneyFact } from "@/domain/contracts";
import { MoneyField, TriState } from "@/components/MoneyField";
import { CURRENT_FORECAST_TITLE, INCOME_FIELDS, MANUAL_SOURCE_ID, adults, fieldId, personName, type Draft } from "./draft";
import { CoverageEditor, IncomeEditor, type ProblemAt, type Update } from "./editors";

/** Money values that live as plain integer cents in the contract (no status). */
function plainFact(cents: number, known: boolean): MoneyFact {
  return known ? { valueCents: cents, status: "confirmed", sourceId: MANUAL_SOURCE_ID } : { valueCents: null, status: "unknown", sourceId: MANUAL_SOURCE_ID };
}

export function ProjectEditor({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  const o = draft.opportunity;
  const started = draft.ui.projectStarted;
  const owners = adults(draft);
  return <div className="stack">
    <div className="grid-2">
      <div className="field">
        <label className="field-label" htmlFor={fieldId("opportunity.title")}>Project name</label>
        <input id={fieldId("opportunity.title")} maxLength={200} placeholder="e.g. December design project"
          value={o.title === CURRENT_FORECAST_TITLE ? "" : o.title}
          onChange={e => { const v = e.target.value; update(d => { d.opportunity.title = v.trim() ? v : CURRENT_FORECAST_TITLE; d.ui.projectStarted = d.ui.projectStarted || v.trim() !== ""; }); }} />
      </div>
      {owners.length > 1 && <div className="field">
        <label className="field-label" htmlFor={fieldId("opportunity.ownerPersonId")}>Whose business takes the project?</label>
        <select id={fieldId("opportunity.ownerPersonId")} value={o.ownerPersonId} onChange={e => update(d => { d.opportunity.ownerPersonId = e.target.value; })}>
          {owners.map(p => <option key={p.id} value={p.id}>{personName(draft, p.id)}</option>)}
        </select>
      </div>}
    </div>
    <div className="grid-2">
      <MoneyField plain path="opportunity.grossRevenueCents" label="What the client will pay" hint="The full price before your costs. This is not the same as profit."
        fact={plainFact(o.grossRevenueCents, started && o.grossRevenueCents > 0)} evidence={draft.evidence} problem={problemAt("opportunity.grossRevenueCents")}
        onChange={f => update(d => { d.opportunity.grossRevenueCents = f.valueCents ?? 0; d.ui.projectStarted = true; if (d.opportunity.title === CURRENT_FORECAST_TITLE && f.valueCents) d.opportunity.title = "New project"; })} />
      <MoneyField plain path="opportunity.incrementalExpensesCents" label="Extra costs to do the project" hint="Subcontractors, materials, software bought for this job." noneLabel="No extra costs"
        fact={plainFact(o.incrementalExpensesCents, true)} evidence={draft.evidence} problem={problemAt("opportunity.incrementalExpensesCents")}
        onChange={f => update(d => { d.opportunity.incrementalExpensesCents = f.valueCents ?? 0; })} />
    </div>
    <div className="grid-2">
      <DateField path="opportunity.plannedReceiptDate" label="When will the money actually arrive?" value={o.plannedReceiptDate} problem={problemAt("opportunity.plannedReceiptDate")}
        hint="The day you receive the payment, not the invoice date." onChange={v => update(d => { d.opportunity.plannedReceiptDate = v; })} />
      <DateField path="opportunity.expensePaymentDate" label="When will you pay the costs?" value={o.expensePaymentDate} problem={problemAt("opportunity.expensePaymentDate")}
        onChange={v => update(d => { d.opportunity.expensePaymentDate = v; })} />
    </div>
    <TriState id={fieldId("opportunity.cashAccountingConfirmed")} label="Does your business use cash-basis accounting?"
      hint="Most sole proprietors do: income counts when it's received. Payment-timing options need this."
      value={o.cashAccountingConfirmed} problem={problemAt("opportunity.cashAccountingConfirmed")} onChange={v => update(d => { d.opportunity.cashAccountingConfirmed = v; })} />
    <TriState id={fieldId("opportunity.timingArrangementConfirmed")} label="Will the payment dates above match when the money is really available to you?"
      hint="Dating an invoice in January doesn't move income by itself. A later payment only counts later if you truly can't receive the money earlier."
      value={o.timingArrangementConfirmed} problem={problemAt("opportunity.timingArrangementConfirmed")} onChange={v => update(d => { d.opportunity.timingArrangementConfirmed = v; })} />
  </div>;
}

export function DateField({ path, label, value, onChange, hint, problem, nullable }: {
  path: string; label: string; value: string | null; onChange: (v: string) => void; hint?: string; problem?: string; nullable?: boolean;
}) {
  const id = fieldId(path);
  return <div className={`field ${problem ? "has-problem" : ""}`}>
    <label className="field-label" htmlFor={id}>{label}{nullable && <span className="optional"> optional</span>}</label>
    <input id={id} type="date" min="2026-01-01" max="2027-12-31" value={value ?? ""} onChange={e => onChange(e.target.value)} aria-invalid={!!problem} />
    {hint && <p className="hint">{hint}</p>}
    {problem && <p className="field-error">{problem}</p>}
  </div>;
}

export function LimitsEditor({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  const c = draft.constraints;
  return <div className="stack">
    <div className="grid-2">
      <MoneyField plain path="constraints.maxAdditionalSepCents" label="Maximum I can put into retirement" noneLabel="Nothing"
        hint="Extra SEP-IRA money you could actually set aside from this year's cash. Headroom won't suggest more."
        fact={plainFact(c.maxAdditionalSepCents, true)} evidence={draft.evidence} problem={problemAt("constraints.maxAdditionalSepCents")}
        onChange={f => update(d => { d.constraints.maxAdditionalSepCents = f.valueCents ?? 0; })} />
      <MoneyField plain path="constraints.minimumDesiredCashGainCents" label="Minimum extra cash I want from this project" noneLabel="No minimum"
        hint="Used for the price-negotiation target. Your time isn't priced in automatically."
        fact={plainFact(c.minimumDesiredCashGainCents, true)} evidence={draft.evidence} problem={problemAt("constraints.minimumDesiredCashGainCents")}
        onChange={f => update(d => { d.constraints.minimumDesiredCashGainCents = f.valueCents ?? 0; })} />
    </div>
    <div className="toggle-row">
      <label className="switch"><input type="checkbox" checked={c.canSplitPayment} onChange={e => update(d => { d.constraints.canSplitPayment = e.target.checked; })} />
        <span>Can the client split the payment between 2026 and 2027?</span></label>
      {c.canSplitPayment && <DateField path="constraints.nextYearPaymentLatestDate" label="Latest acceptable date for the 2027 part" nullable value={c.nextYearPaymentLatestDate}
        problem={problemAt("constraints.nextYearPaymentLatestDate")} onChange={v => update(d => { d.constraints.nextYearPaymentLatestDate = v || null; })} />}
    </div>
    <div className="toggle-row">
      <label className="switch"><input type="checkbox" checked={c.canRenegotiatePrice} onChange={e => update(d => { d.constraints.canRenegotiatePrice = e.target.checked; })} />
        <span>Can I negotiate the price?</span></label>
    </div>
    <fieldset className="field">
      <legend className="field-label">What matters most?</legend>
      <div className="seg">
        <label className={c.objective === "spendable_cash" ? "on" : ""}><input type="radio" name="objective" checked={c.objective === "spendable_cash"}
          onChange={() => update(d => { d.constraints.objective = "spendable_cash"; })} />Most cash to spend</label>
        <label className={c.objective === "retirement_and_cash" ? "on" : ""}><input type="radio" name="objective" checked={c.objective === "retirement_and_cash"}
          onChange={() => update(d => { d.constraints.objective = "retirement_and_cash"; })} />Retirement savings and cash</label>
      </div>
      <p className="hint">Retirement money is always shown separately from cash you can spend.</p>
    </fieldset>
    <p className="hint">What if income changes? Add a range to any income forecast (“Not sure? Add a range”) and Headroom checks the options across that range.</p>
  </div>;
}

/** 2027 facts: only asked for when a two-year comparison needs them. */
export function NextYearEditor({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  function copyIncome() {
    update(d => {
      const [y26, y27] = d.years;
      y27.incomes = y26.incomes.map(row => {
        const next = structuredClone(row);
        for (const key of INCOME_FIELDS) next[key] = asEstimate(next[key]);
        return next;
      });
    });
  }
  function copyCoverage() {
    update(d => {
      const [y26, y27] = d.years;
      y27.coveredPersonIds = [...y26.coveredPersonIds];
      y27.coverage = y26.coverage.map(m => ({ ...structuredClone(m),
        enrollmentPremium: asEstimate(m.enrollmentPremium), benchmarkPremium: asEstimate(m.benchmarkPremium), advancePtc: asEstimate(m.advancePtc) }));
      y27.benchmarkStatus = y26.benchmarkStatus === "marketplace_confirmed" ? "illustrative" : y26.benchmarkStatus;
    });
  }
  return <div className="stack">
    <p className="lede">The 2027 forecast matters when part of the money could arrive in 2027, or when the project changes next year&apos;s subsidy. Headroom doesn&apos;t copy 2026 into 2027 on its own.</p>
    <div className="row gap wrap">
      <button type="button" className="btn ghost small" onClick={copyIncome}>Start 2027 income from my 2026 figures</button>
      <button type="button" className="btn ghost small" onClick={copyCoverage}>Start 2027 coverage from 2026</button>
    </div>
    <p className="hint">Copied amounts are marked as estimates. 2027 premiums are usually different — check them during open enrollment.</p>
    <h4 className="subhead">2027 income forecast</h4>
    {adults(draft).map(p => <IncomeEditor key={p.id} draft={draft} update={update} problemAt={problemAt} yearIndex={1} personId={p.id} />)}
    <h4 className="subhead">2027 health coverage</h4>
    <CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={1} />
  </div>;
}

function asEstimate(f: MoneyFact): MoneyFact {
  return f.status === "confirmed" && f.valueCents !== 0 ? { ...f, status: "estimated", sourceId: MANUAL_SOURCE_ID } : { ...f };
}
