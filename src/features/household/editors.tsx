"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { MoneyFact } from "@/domain/contracts";
import { MoneyField, TriState } from "@/components/MoneyField";
import { MONTHS } from "@/features/format";
import { ForecastEditor } from "@/features/household-plan/ForecastEditor";
import {
  INTEREST_FIELDS, SCOPE_EXCLUSIONS, SUPPORTED_STATES, US_STATES, WAGE_FIELDS, adults, confirmedZero, fieldId,
  forecastFor, personName, pruneInvalid, setForecastInDraft, syncHousehold, unknownFact, type Draft, type FilingStatus, type IncomeField,
} from "./draft";

export type Update = (mutate: (draft: Draft) => void) => void;
export type ProblemAt = (path: string) => string | undefined;

/* ---------------- Household basics ---------------- */

export function HouseholdBasics({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  const unsupportedState = draft.state && !SUPPORTED_STATES.includes(draft.state);
  const dependents = draft.people.filter(p => p.role === "dependent");

  function setFiling(status: FilingStatus) {
    update(d => {
      d.filingStatus = status;
      const hasSpouse = d.people.some(p => p.role === "spouse");
      if (status === "mfj" && !hasSpouse) {
        d.people.splice(1, 0, { id: "spouse", role: "spouse", ageAt2026Start: null, qualifyingChildForCtc: false });
        for (const year of d.years) if (!year.coveredPersonIds.includes("spouse")) year.coveredPersonIds.push("spouse");
      }
      if (status !== "mfj" && hasSpouse) d.people = d.people.filter(p => p.role !== "spouse");
      syncHousehold(d);
    });
  }

  function addDependent() {
    update(d => {
      let n = 1;
      while (d.people.some(p => p.id === `child-${n}`)) n++;
      const id = `child-${n}`;
      d.people.push({ id, role: "dependent", ageAt2026Start: null, qualifyingChildForCtc: null });
      for (const year of d.years) year.coveredPersonIds.push(id);
      syncHousehold(d);
    });
  }

  return <div className="stack">
    <div className="grid-2">
      <div className={`field ${problemAt("state") ? "has-problem" : ""}`}>
        <label className="field-label" htmlFor={fieldId("state")}>State you live in</label>
        <select id={fieldId("state")} value={draft.state ?? ""} onChange={e => update(d => { d.state = e.target.value || null; })}>
          <option value="">Choose a state…</option>
          <optgroup label="Supported in this version">
            {US_STATES.filter(([c]) => SUPPORTED_STATES.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </optgroup>
          <optgroup label="Not supported yet">
            {US_STATES.filter(([c]) => !SUPPORTED_STATES.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </optgroup>
        </select>
        {unsupportedState && <p className="hint warn">Headroom currently covers Texas, Florida and Tennessee (no state income tax). You can still enter your data; the calculation will explain what it can't cover.</p>}
        {problemAt("state") && <p className="field-error">{problemAt("state")}</p>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={fieldId("countyFips")}>County code <span className="optional">optional</span></label>
        <input id={fieldId("countyFips")} inputMode="numeric" maxLength={5} placeholder="5-digit FIPS, e.g. 47037" value={draft.countyFips ?? ""}
          onChange={e => { const v = e.target.value.replace(/\D/g, ""); update(d => { d.countyFips = v.length === 5 ? v : v === "" ? null : d.countyFips; }); }} />
        <p className="hint">Only used to label county plan estimates. Your Marketplace benchmark premium matters more.</p>
      </div>
    </div>

    <fieldset className={`field ${problemAt("filingStatus") ? "has-problem" : ""}`} id={fieldId("filingStatus")}>
      <legend className="field-label">How do you file your 2026 tax return?</legend>
      <div className="seg">
        {([["single", "Single"], ["mfj", "Married filing jointly"], ["other", "Something else"]] as const).map(([v, text]) =>
          <label key={v} className={draft.filingStatus === v ? "on" : ""}>
            <input type="radio" name="filing" checked={draft.filingStatus === v} onChange={() => setFiling(v)} />{text}
          </label>)}
      </div>
      {draft.filingStatus === "other" && <p className="hint warn">Head of household and married filing separately aren&apos;t supported yet. The calculation will say so instead of guessing.</p>}
      {problemAt("filingStatus") && <p className="field-error">{problemAt("filingStatus")}</p>}
    </fieldset>

    <div className="people">
      <p className="field-label">People on your tax return</p>
      {draft.people.map((person, index) => {
        const path = `people.${index}.ageAt2026Start`;
        return <div className={`person-row ${problemAt(path) ? "has-problem" : ""}`} key={person.id}>
          <span className="person-name">{personName(draft, person.id)}</span>
          <label className="inline-field">Age on Jan 1, 2026
            <input id={fieldId(path)} type="number" min={0} max={100} inputMode="numeric" value={person.ageAt2026Start ?? ""}
              onChange={e => { const v = e.target.value; update(d => { const n = Number(v); d.people[index].ageAt2026Start = v === "" || !Number.isInteger(n) || n < 0 || n > 100 ? null : n; }); }} />
          </label>
          {person.role === "dependent" && <>
            <label className="inline-field">Child tax credit
              <select value={person.qualifyingChildForCtc === null ? "" : String(person.qualifyingChildForCtc)}
                onChange={e => update(d => { d.people[index].qualifyingChildForCtc = e.target.value === "" ? null : e.target.value === "true"; })}>
                <option value="">Not sure</option><option value="true">Qualifies</option><option value="false">Doesn&apos;t qualify</option>
              </select>
            </label>
            <button type="button" className="icon-btn" aria-label={`Remove ${personName(draft, person.id)}`}
              onClick={() => update(d => { d.people = d.people.filter(p => p.id !== person.id); syncHousehold(d); })}><Trash2 size={16} /></button>
          </>}
          {problemAt(path) && <p className="field-error">{problemAt(path)}</p>}
        </div>;
      })}
      <button type="button" className="btn ghost small" onClick={addDependent}><Plus size={16} /> Add a dependent</button>
      {dependents.length > 0 && <p className="hint">Dependents are the children or relatives you claim on your return.</p>}
    </div>
  </div>;
}

/* ---------------- Income ---------------- */

const fieldHints: Partial<Record<IncomeField, string>> = {
  scheduleCProfit: "Whole-year 2026 profit: what clients pay minus business expenses. Where to find it: profit so far in your bookkeeping, plus what you expect by December 31. Not the same as bank deposits.",
  grossWages: "Total pay before deductions: year-to-date from your latest pay stub plus expected remaining paychecks.",
  payrollPretaxDeductions: "401(k), HSA, cafeteria-plan and similar deductions taken before tax.",
  w2Box1: "Taxable wages. You don't need a 2026 W-2 yet — estimate from pay stubs.",
  socialSecurityWages: "Usually gross pay minus cafeteria-plan deductions. On a pay stub: Social Security / OASDI wages.",
  medicareWages: "On a pay stub: Medicare wages. Often equal to Social Security wages.",
  taxableInterest: "Bank and savings interest for the year.",
  taxExemptInterest: "Municipal bond interest. It still counts toward subsidy income.",
  existingSepContribution: "Only what you already plan to contribute. Headroom suggests any extra amount separately.",
};

export function IncomeEditor({ draft, update, problemAt, yearIndex, personId }: {
  draft: Draft; update: Update; problemAt: ProblemAt; yearIndex: 0 | 1; personId: string;
}) {
  const rowIndex = draft.years[yearIndex].incomes.findIndex(r => r.personId === personId);
  const row = draft.years[yearIndex].incomes[rowIndex];
  if (!row) return null;
  const base = `years.${yearIndex}.incomes.${rowIndex}`;
  const name = personName(draft, personId);
  const isConfirmedZero = (f: MoneyFact) => f.valueCents === 0 && f.status === "confirmed";
  const noWages = WAGE_FIELDS.every(k => isConfirmedZero(row[k]));
  const noInterest = INTEREST_FIELDS.every(k => isConfirmedZero(row[k]));

  const set = (key: IncomeField, fact: MoneyFact) => update(d => { d.years[yearIndex].incomes[rowIndex][key] = fact; });
  const setGroup = (keys: readonly IncomeField[], make: () => MoneyFact) =>
    update(d => { for (const k of keys) { d.years[yearIndex].incomes[rowIndex][k] = make(); pruneInvalid(d, `${base}.${k}`); } });
  const field = (key: IncomeField, label: string, noneLabel?: string) =>
    <MoneyField key={key} path={`${base}.${key}`} label={label} hint={fieldHints[key]} fact={row[key]} evidence={draft.evidence}
      onChange={f => set(key, f)} noneLabel={noneLabel} problem={problemAt(`${base}.${key}`)} />;

  return <div className="income-card">
    <h4>{name}</h4>
    <ForecastEditor forecast={forecastFor(draft, personId, draft.years[yearIndex].year)} year={draft.years[yearIndex].year} personLabel={name} evidence={draft.evidence}
      pathBase={`ui.forecasts.${personId}.${draft.years[yearIndex].year}`} idAnchor={`${base}.scheduleCProfit`}
      problemAt={path => problemAt(path) ?? (path.endsWith("excludesManagedProjects") || path.endsWith("annualNetProfit") || path.endsWith("ytdNetProfit") ? problemAt(`${base}.scheduleCProfit`) : undefined)}
      managedProjects={draft.ui.projectStarted && draft.opportunity.ownerPersonId === personId ? [draft.opportunity.title] : []}
      onChange={f => update(d => setForecastInDraft(d, f))} />

    <div className="subgroup">
      <div className="subgroup-head">
        <p className="field-label">Job income (W-2 wages)</p>
        <div className="seg small">
          <label className={!noWages ? "on" : ""}><input type="radio" name={`${base}-wages`} checked={!noWages}
            onChange={() => setGroup(WAGE_FIELDS, () => unknownFact())} />Has W-2 wages</label>
          <label className={noWages ? "on" : ""}><input type="radio" name={`${base}-wages`} checked={noWages}
            onChange={() => setGroup(WAGE_FIELDS, () => confirmedZero())} />No W-2 wages</label>
        </div>
      </div>
      {noWages ? <p className="hint">Confirmed: {name.toLowerCase() === "you" ? "you have" : `${name.toLowerCase()} has`} no W-2 wages in {draft.years[yearIndex].year}.</p>
        : <div className="grid-2">
          {field("grossWages", "Gross pay")}
          {field("payrollPretaxDeductions", "Pre-tax payroll deductions", "None")}
          {field("w2Box1", "Taxable wages (W-2 box 1)")}
          {field("socialSecurityWages", "Social Security wages (box 3)")}
          {field("medicareWages", "Medicare wages (box 5)")}
        </div>}
    </div>

    <div className="subgroup">
      <div className="subgroup-head">
        <p className="field-label">Interest income</p>
        <div className="seg small">
          <label className={!noInterest ? "on" : ""}><input type="radio" name={`${base}-int`} checked={!noInterest}
            onChange={() => setGroup(INTEREST_FIELDS, () => unknownFact())} />Has interest</label>
          <label className={noInterest ? "on" : ""}><input type="radio" name={`${base}-int`} checked={noInterest}
            onChange={() => setGroup(INTEREST_FIELDS, () => confirmedZero())} />No interest</label>
        </div>
      </div>
      {!noInterest && <div className="grid-2">
        {field("taxableInterest", "Taxable interest", "None")}
        {field("taxExemptInterest", "Tax-exempt interest", "None")}
      </div>}
    </div>

    <div className="subgroup">{field("existingSepContribution", "SEP-IRA contribution already planned", "None")}</div>
  </div>;
}

/* ---------------- Coverage ---------------- */

const COVERAGE_KEYS = ["enrollmentPremium", "benchmarkPremium", "advancePtc"] as const;
type CoverageKey = typeof COVERAGE_KEYS[number];
const sameFact = (a: MoneyFact, b: MoneyFact) => a.valueCents === b.valueCents && a.status === b.status;

export function CoverageEditor({ draft, update, problemAt, yearIndex }: { draft: Draft; update: Update; problemAt: ProblemAt; yearIndex: 0 | 1 }) {
  const year = draft.years[yearIndex];
  const months = year.coverage;
  const constant = months.every(m => COVERAGE_KEYS.every(k => sameFact(m[k], months[0][k]))
    && m.ptcEligibilityConfirmed === months[0].ptcEligibilityConfirmed && m.sehiEligibilityConfirmed === months[0].sehiEligibilityConfirmed);
  const [byMonth, setByMonth] = useState(!constant);
  const base = `years.${yearIndex}`;
  const monthProblem = (key: string) => {
    for (let i = 0; i < 12; i++) { const p = problemAt(`${base}.coverage.${i}.${key}`); if (p) return p; }
    return problemAt(`${base}.coverage`);
  };

  const setAll = (key: CoverageKey, fact: MoneyFact) => update(d => { for (const m of d.years[yearIndex].coverage) m[key] = { ...fact }; });
  const setFlag = (key: "ptcEligibilityConfirmed" | "sehiEligibilityConfirmed", v: boolean | null) =>
    update(d => { for (const m of d.years[yearIndex].coverage) m[key] = v; });

  const labels: Record<CoverageKey, [string, string, string?]> = {
    enrollmentPremium: ["Full monthly premium", "The plan's price before any credit. Where to find it: your Marketplace account under “My plans”, or the plan's monthly premium on your insurer's statement."],
    benchmarkPremium: ["Benchmark premium (second-lowest-cost silver plan)", "Where to find it: your Marketplace eligibility notice, or HealthCare.gov's plan preview for your household (the second-cheapest Silver plan). Headroom doesn't look this up."],
    advancePtc: ["Advance credit paid each month", "Where to find it: “premium tax credit” or “APTC” per month in your Marketplace account. Your bill is the premium minus this.", "None"],
  };

  return <div className="stack">
    <fieldset className="field" id={fieldId(`${base}.coveredPersonIds`)}>
      <legend className="field-label">Who is covered by the Marketplace plan in {year.year}?</legend>
      <div className="checks">
        {draft.people.map(p => <label key={p.id} className="check">
          <input type="checkbox" checked={year.coveredPersonIds.includes(p.id)} onChange={e => update(d => {
            const y = d.years[yearIndex];
            y.coveredPersonIds = e.target.checked ? [...y.coveredPersonIds, p.id] : y.coveredPersonIds.filter(id => id !== p.id);
          })} />{personName(draft, p.id)}</label>)}
      </div>
      <p className="hint">The people on your tax return and the people on the plan can differ, for example when a child has CHIP.</p>
      {problemAt(`${base}.coveredPersonIds`) && <p className="field-error">{problemAt(`${base}.coveredPersonIds`)}</p>}
    </fieldset>

    {!byMonth ? <div className="grid-3">
      {COVERAGE_KEYS.map(key => <MoneyField key={key} path={`${base}.coverage.0.${key}`} label={labels[key][0]} hint={labels[key][1]}
        noneLabel={labels[key][2]} fact={months[0][key]} evidence={draft.evidence} onChange={f => setAll(key, f)} problem={monthProblem(key)} />)}
    </div> : <div className="month-table" role="group" aria-label={`Monthly coverage for ${year.year}`}>
      <div className="month-row head"><span>Month</span><span>Premium</span><span>Benchmark</span><span>Advance credit</span></div>
      {months.map((m, i) => <div className="month-row" key={m.month}>
        <span>{MONTHS[i].slice(0, 3)}</span>
        {COVERAGE_KEYS.map(key => <MoneyField key={key} compact path={`${base}.coverage.${i}.${key}`} label={`${MONTHS[i]} ${labels[key][0].toLowerCase()}`}
          fact={m[key]} evidence={draft.evidence} problem={problemAt(`${base}.coverage.${i}.${key}`)}
          onChange={f => update(d => { d.years[yearIndex].coverage[i][key] = f; })} />)}
      </div>)}
    </div>}
    <div className="row gap">
      <button type="button" className="link-btn" onClick={() => {
        if (byMonth) update(d => {
          const first = d.years[yearIndex].coverage[0];
          for (const m of d.years[yearIndex].coverage) for (const k of COVERAGE_KEYS) m[k] = { ...first[k] };
          for (let i = 1; i < 12; i++) pruneInvalid(d, `${base}.coverage.${i}`);
        });
        setByMonth(v => !v);
      }}>{byMonth ? "Use January's amounts for every month" : "Amounts change during the year? Enter month by month"}</button>
    </div>
    {byMonth && <p className="hint warn">Coverage that changes during the year needs a month-by-month calculation. If the engine can&apos;t do that for your case yet, it will say so rather than estimate.</p>}

    <div className="grid-2">
      <div className="field">
        <label className="field-label" htmlFor={fieldId(`${base}.benchmarkStatus`)}>Where does the benchmark premium come from?</label>
        <select id={fieldId(`${base}.benchmarkStatus`)} value={year.benchmarkStatus} onChange={e => update(d => { d.years[yearIndex].benchmarkStatus = e.target.value as typeof year.benchmarkStatus; })}>
          <option value="unknown">I don&apos;t know yet</option>
          <option value="marketplace_confirmed">My Marketplace notice or HealthCare.gov</option>
          <option value="county_candidate">A county-level estimate</option>
          <option value="illustrative">An illustrative number</option>
        </select>
        {problemAt(`${base}.benchmarkStatus`) && <p className="field-error">{problemAt(`${base}.benchmarkStatus`)}</p>}
      </div>
    </div>
    <TriState id={fieldId(`${base}.coverage.0.ptcEligibilityConfirmed`)} label="Is everyone on the plan eligible for the premium tax credit all year?"
      hint="Not eligible if someone has Medicaid/CHIP, Medicare, or an affordable employer health-plan offer."
      value={months[0].ptcEligibilityConfirmed} onChange={v => setFlag("ptcEligibilityConfirmed", v)} problem={monthProblem("ptcEligibilityConfirmed")} />
    <TriState id={fieldId(`${base}.coverage.0.sehiEligibilityConfirmed`)} label="Could you deduct these premiums as self-employed health insurance?"
      hint="Usually yes if your business has a profit and neither of you could join an employer-subsidized health plan that month."
      value={months[0].sehiEligibilityConfirmed} onChange={v => setFlag("sehiEligibilityConfirmed", v)} problem={monthProblem("sehiEligibilityConfirmed")} />
  </div>;
}

/* ---------------- Scope ---------------- */

export function ScopeEditor({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  const facts = draft.years[0].unsupportedFacts;
  const confirmed = draft.years[0].scopeConfirmed;
  const problem = problemAt("years.0.scopeConfirmed") ?? problemAt("years.1.scopeConfirmed") ?? problemAt("years.0.unsupportedFacts");
  const toggle = (id: string, on: boolean) => update(d => {
    for (const y of d.years) {
      y.unsupportedFacts = on ? [...new Set([...y.unsupportedFacts, id])] : y.unsupportedFacts.filter(f => f !== id);
      y.scopeConfirmed = y.unsupportedFacts.length > 0 ? false : null;
    }
  });
  return <fieldset className={`field ${problem ? "has-problem" : ""}`} id={fieldId("years.0.scopeConfirmed")}>
    <legend className="field-label">Do any of these apply to your household in 2026 or 2027?</legend>
    <div className="checks column">
      {SCOPE_EXCLUSIONS.map(item => <label className="check" key={item.id}>
        <input type="checkbox" checked={facts.includes(item.id)} onChange={e => toggle(item.id, e.target.checked)} />{item.label}
      </label>)}
    </div>
    {facts.length === 0 && <div className="row gap wrap">
      <button type="button" className={`btn small ${confirmed ? "ghost" : "secondary"}`} aria-pressed={confirmed === true}
        onClick={() => update(d => { for (const y of d.years) { y.scopeConfirmed = true; y.unsupportedFacts = []; } })}>
        {confirmed ? "✓ Confirmed: none of these apply" : "None of these apply to us"}</button>
      {confirmed && <button type="button" className="link-btn" onClick={() => update(d => { for (const y of d.years) y.scopeConfirmed = null; })}>Undo</button>}
    </div>}
    {facts.length > 0 && <p className="hint warn">Headroom won&apos;t estimate a result that leaves these out. You&apos;ll see what isn&apos;t covered and can download the data you entered.</p>}
    {problem && <p className="field-error">{problem}</p>}
  </fieldset>;
}

export { adults };
