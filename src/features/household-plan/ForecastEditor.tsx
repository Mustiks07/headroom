"use client";

import type { MoneyFact, TaxYear } from "@/domain/contracts";
import { forecastFacts, forecastTotal, type ProfitForecast } from "@/domain/household-workspace";
import { MoneyField, TriState } from "@/components/MoneyField";
import { DateField } from "@/features/household/projectEditors";
import { fieldId, type Evidence } from "@/features/household/draft";
import { money, shortDate } from "@/features/format";

const LABEL: Record<string, string> = {
  annualNetProfit: "Whole-year profit estimate", ytdNetProfit: "Net profit so far", remainingReceipts: "Client payments still expected", remainingExpenses: "Business expenses still expected",
};

/**
 * One business-profit forecast per person and year: either a whole-year estimate, or
 * profit so far + payments still expected − expenses still expected. Exactly one method is active.
 * The total comes from the shared contract helper (forecastTotal), never from UI arithmetic.
 */
export function ForecastEditor({ forecast, year, personLabel, evidence, onChange, pathBase, problemAt, managedProjects, idAnchor }: {
  forecast: ProfitForecast; year: TaxYear; personLabel: string; evidence: Evidence[];
  onChange: (f: ProfitForecast) => void; pathBase: string; problemAt?: (path: string) => string | undefined;
  /** Titles of projects managed in this plan for this owner; asks whether the forecast leaves them out. */
  managedProjects: string[];
  /** Extra DOM id (e.g. the v1 scheduleCProfit path) so "Add this" links land here. */
  idAnchor?: string;
}) {
  const sourceId = "manual-entry";
  const unknown = (): MoneyFact => ({ valueCents: null, status: "unknown", sourceId });
  const hasValues = forecastFacts(forecast).some(p => p.fact.valueCents !== null);
  const total = forecastTotal(forecast);
  const p = (k: string) => problemAt?.(`${pathBase}.${k}`);

  function switchMethod(method: ProfitForecast["method"]) {
    if (method === forecast.method) return;
    if (hasValues && !window.confirm("Switch how this forecast is entered? The figures entered the other way will be removed, so nothing is counted twice.")) return;
    const base = { personId: forecast.personId, year, excludesManagedProjects: forecast.excludesManagedProjects };
    onChange(method === "annual_total" ? { ...base, method, annualNetProfit: unknown() }
      : { ...base, method, asOfDate: `${year}-09-30`, asOfConfirmed: false, ytdNetProfit: unknown(), remainingReceipts: unknown(), remainingExpenses: unknown() });
  }

  const after = forecast.method === "year_to_date_plus_remaining" ? shortDate(forecast.asOfDate) : null;
  return <div className="forecast" id={idAnchor ? fieldId(idAnchor) : undefined}>
    <fieldset className="field">
      <legend className="field-label">{personLabel === "You" ? "Your" : `${personLabel}'s`} {year} business profit — how do you want to enter it?</legend>
      <div className="seg">
        <label className={forecast.method === "annual_total" ? "on" : ""}><input type="radio" checked={forecast.method === "annual_total"} onChange={() => switchMethod("annual_total")} />One whole-year estimate</label>
        <label className={forecast.method === "year_to_date_plus_remaining" ? "on" : ""}><input type="radio" checked={forecast.method === "year_to_date_plus_remaining"} onChange={() => switchMethod("year_to_date_plus_remaining")} />So far this year + the rest of the year</label>
      </div>
    </fieldset>

    {forecast.method === "annual_total" ? <MoneyField path={`${pathBase}.annualNetProfit`} label={`Net profit for all of ${year}`} fact={forecast.annualNetProfit} evidence={evidence}
      hint={`January 1 – December 31, ${year}, after business expenses. Where to find it: your bookkeeping profit so far plus what you expect for the rest of the year.`}
      noneLabel="No business" problem={p("annualNetProfit")} onChange={f => onChange({ ...forecast, annualNetProfit: f })} />
      : <div className="stack">
        <div className="grid-2">
          <DateField path={`${pathBase}.asOfDate`} label="Your figures so far run through" value={forecast.asOfDate} problem={p("asOfDate")}
            hint="Usually the end of the last month in your bookkeeping." onChange={v => onChange({ ...forecast, asOfDate: v, asOfConfirmed: false })} />
          <label className="check confirm-check"><input type="checkbox" checked={forecast.asOfConfirmed} onChange={e => onChange({ ...forecast, asOfConfirmed: e.target.checked })} />
            My profit-so-far figure covers January 1 through this date</label>
        </div>
        <MoneyField path={`${pathBase}.ytdNetProfit`} label={`Net profit so far (Jan 1 – ${shortDate(forecast.asOfDate)})`} fact={forecast.ytdNetProfit} evidence={evidence}
          hint="From your profit-and-loss report: income received minus expenses already paid. Those expenses are not subtracted again below."
          problem={p("ytdNetProfit")} onChange={f => onChange({ ...forecast, ytdNetProfit: f })} />
        <div className="grid-2">
          <MoneyField path={`${pathBase}.remainingReceipts`} label={`Client payments still expected (after ${after} – Dec 31)`} fact={forecast.remainingReceipts} evidence={evidence}
            hint="Money you expect to receive, before expenses." noneLabel="None" problem={p("remainingReceipts")} onChange={f => onChange({ ...forecast, remainingReceipts: f })} />
          <MoneyField path={`${pathBase}.remainingExpenses`} label="Business expenses still expected" fact={forecast.remainingExpenses} evidence={evidence}
            hint="Deductible costs you still expect to pay this year." noneLabel="None" problem={p("remainingExpenses")} onChange={f => onChange({ ...forecast, remainingExpenses: f })} />
        </div>
      </div>}

    {managedProjects.length > 0 && <TriState id={fieldId(`${pathBase}.excludesManagedProjects`)}
      label={`Do these figures leave out ${managedProjects.map(t => `“${t}”`).join(" and ")}?`}
      hint="Projects tracked in Headroom are added separately with their own payments. If the figures already include them, they would be counted twice."
      yes="Yes, left out" no="No, they're included" value={forecast.excludesManagedProjects} problem={p("excludesManagedProjects")}
      onChange={v => onChange({ ...forecast, excludesManagedProjects: v })} />}
    {forecast.excludesManagedProjects === false && <p className="notice warn small">Take those projects&apos; payments out of the figures above (or enter the forecast without them), then answer “Yes”. Headroom won&apos;t calculate until this is clear.</p>}

    <div className="composition" aria-label={`How the ${year} profit is built`}>
      <p className="tile-k">How this adds up</p>
      <ul>
        {forecastFacts(forecast).map(part => <li key={part.key}>
          <span>{part.sign < 0 ? "− " : forecast.method === "year_to_date_plus_remaining" && part.key !== "ytdNetProfit" ? "+ " : ""}{LABEL[part.key]}</span>
          <span className="num">{part.fact.valueCents === null ? <em className="unknown-text">unknown</em> : money(part.fact.valueCents)}{part.fact.status === "estimated" ? " est." : ""}</span>
        </li>)}
        <li className="total"><span>{year} profit forecast{managedProjects.length ? " (without the projects)" : ""}</span>
          <span className="num">{total.valueCents === null ? <em className="unknown-text">unknown</em> : <>{money(total.valueCents)}{total.range ? <small> ({money(total.range.lowCents)}–{money(total.range.highCents)})</small> : null}</>}</span></li>
      </ul>
      {total.valueCents === null && <p className="hint warn">The subsidy check waits until every part is entered — an unknown part is never treated as $0.</p>}
    </div>
  </div>;
}
