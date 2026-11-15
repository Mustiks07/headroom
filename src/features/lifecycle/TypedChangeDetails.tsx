"use client";

import { useState } from "react";
import { ChangeCommandSchema, type ChangeCommand } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import type { TaxYear } from "@/domain/contracts";
import { centsToInput, moneyExact, parseDollarsToCents, shortDate } from "@/features/format";
import { personName } from "@/features/household/draft";
import "./lifecycle.css";

type Action = "update_expected_payment" | "record_receipt" | "record_sep_contribution" | "update_forecast";
const actions: Array<{ value: Action; label: string }> = [
  { value: "update_expected_payment", label: "An expected payment moved or changed" },
  { value: "record_receipt", label: "A client payment arrived" },
  { value: "record_sep_contribution", label: "I paid a SEP-IRA contribution" },
  { value: "update_forecast", label: "An income forecast changed" },
];
const fields = { annualNetProfit: "Full-year business profit", ytdNetProfit: "Business profit received so far", remainingReceipts: "Receipts still expected", remainingExpenses: "Business costs still expected" } as const;
type ForecastField = keyof typeof fields;

/** Explicit fields resolve ambiguity. Typed answers are never appended to text or reparsed. */
export function TypedChangeDetails({ ws, seed = null, onCommands, onCancel }: {
  ws: HouseholdWorkspace; seed?: ChangeCommand | null; onCommands: (commands: ChangeCommand[]) => void; onCancel?: () => void;
}) {
  const initialAction: Action | "" = seed?.type === "record_partial_receipt" || seed?.type === "settle_lower_total" ? "record_receipt"
    : actions.some(a => a.value === seed?.type) ? seed!.type as Action : "";
  const [action, setAction] = useState<Action | "">(initialAction);
  const [projectId, setProjectId] = useState(seed && "projectId" in seed ? seed.projectId : "");
  const [lineId, setLineId] = useState(seed && "lineId" in seed ? seed.lineId : "");
  const [personId, setPersonId] = useState(seed?.type === "record_sep_contribution" || seed?.type === "update_forecast" ? seed.personId : "");
  const [year, setYear] = useState(seed?.type === "record_sep_contribution" ? String(seed.taxYear) : seed?.type === "update_forecast" ? String(seed.year) : "");
  const [field, setField] = useState<ForecastField | "">(seed?.type === "update_forecast" ? seed.field : "");
  const [amount, setAmount] = useState(centsToInput(seed?.type === "update_expected_payment" ? seed.newAmountCents : seed && "amountCents" in seed ? seed.amountCents : null));
  const [date, setDate] = useState(seed?.type === "update_expected_payment" ? seed.newDate ?? "" : seed?.type === "record_sep_contribution" ? seed.paidDate : seed && "date" in seed ? seed.date ?? "" : "");
  const [status, setStatus] = useState<"confirmed" | "estimated" | "">(seed?.type === "update_forecast" ? seed.status : "");
  const [asOf, setAsOf] = useState(seed?.type === "update_forecast" ? seed.asOfDate ?? "" : "");
  const [smallerChoice, setSmallerChoice] = useState<"partial" | "settled" | "">(seed?.type === "record_partial_receipt" ? "partial" : seed?.type === "settle_lower_total" ? "settled" : "");
  const [remainderDate, setRemainderDate] = useState(seed?.type === "record_partial_receipt" ? seed.remainderDate : "");
  const [reason, setReason] = useState(seed?.type === "settle_lower_total" ? seed.reason : "");
  const [error, setError] = useState<string | null>(null);

  const project = ws.projects.find(p => p.id === projectId);
  const availableLines = project?.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected) ?? [];
  const line = availableLines.find(l => l.id === lineId);
  const cents = parseDollarsToCents(amount);
  const smaller = action === "record_receipt" && typeof cents === "number" && !!line?.expected && cents < line.expected.amountCents;
  const forecast = ws.forecasts.find(f => f.personId === personId && String(f.year) === year);
  const allowedFields: ForecastField[] = forecast?.method === "annual_total" ? ["annualNetProfit"] : forecast ? ["ytdNetProfit", "remainingReceipts", "remainingExpenses"] : [];
  const prefix = `typed-change-${ws.id}`;

  function chooseAction(value: Action | "") {
    setAction(value); setProjectId(""); setLineId(""); setPersonId(""); setYear(""); setField("");
    setAmount(""); setDate(""); setStatus(""); setAsOf(""); setSmallerChoice(""); setRemainderDate(""); setReason(""); setError(null);
  }

  function submit() {
    setError(null);
    if (!action) { setError("Choose the kind of change first."); return; }
    if (cents === "invalid") { setError("Enter a dollar amount with no more than two decimal places."); return; }
    let command: ChangeCommand;
    if (action === "update_expected_payment" || action === "record_receipt") {
      if (!project || !line) { setError("Choose the project and the exact expected payment. Recorded payments need a correction, not a new receipt."); return; }
      if (action === "update_expected_payment") {
        if (cents === null && !date) { setError("Enter a new amount, a new date, or both. Leaving a field blank keeps its current value."); return; }
        command = { type: action, projectId, lineId, newAmountCents: cents, newDate: date || null };
      } else {
        if (cents === null || cents <= 0 || !date) { setError("Enter the amount that arrived and its full received date."); return; }
        if (smaller && !smallerChoice) { setError("The amount is smaller than expected. Confirm whether the rest is due or this payment is fully settled."); return; }
        command = smaller && smallerChoice === "partial" ? { type: "record_partial_receipt", projectId, lineId, amountCents: cents, date, remainderDate }
          : smaller && smallerChoice === "settled" ? { type: "settle_lower_total", projectId, lineId, amountCents: cents, date, reason: reason.trim() }
          : { type: "record_receipt", projectId, lineId, amountCents: cents, date };
      }
    } else if (action === "record_sep_contribution") {
      if (!personId || !year || cents === null || cents <= 0 || !date) { setError("Confirm whose contribution it was, its tax year, amount and paid date."); return; }
      command = { type: action, personId, taxYear: Number(year) as TaxYear, amountCents: cents, paidDate: date };
    } else {
      if (!forecast || !field || !allowedFields.includes(field) || !status || cents === null) { setError("Choose the existing forecast, the field, its value and whether it is confirmed or estimated."); return; }
      command = { type: action, personId, year: Number(year) as TaxYear, field, amountCents: cents, status, asOfDate: asOf || null };
    }
    const parsed = ChangeCommandSchema.safeParse(command);
    if (!parsed.success) { setError(parsed.error.issues.some(i => i.path.includes("reason")) ? "Give a short reason for the lower final settlement." : "Check the amount and full dates. Amounts must be positive (a forecast may be zero); use supported 2026–2028 dates."); return; }
    onCommands([parsed.data]);
  }

  return <form className="lc-panel lc-typed-change" onSubmit={e => { e.preventDefault(); submit(); }}>
    <div className="lc-section-heading"><span className="lc-eyebrow">Confirm exactly what changed</span><h3>A few precise details.</h3><p>Your original message stays intact. These fields create a typed change for review; nothing is saved here.</p></div>
    <label className="lc-field" htmlFor={`${prefix}-action`}>What happened?<select id={`${prefix}-action`} value={action} onChange={e => chooseAction(e.target.value as Action | "")}><option value="">Choose a change</option>{actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
    {(action === "record_receipt" || action === "update_expected_payment") && <>
      <label className="lc-field" htmlFor={`${prefix}-project`}>Which project?<select id={`${prefix}-project`} value={projectId} onChange={e => { setProjectId(e.target.value); setLineId(""); setSmallerChoice(""); }}><option value="">Choose the project</option>{ws.projects.filter(p => p.receipts.some(l => !l.actual && !l.cancelledAt && l.expected)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label className="lc-field" htmlFor={`${prefix}-payment`}>Which expected payment?<select id={`${prefix}-payment`} value={lineId} disabled={!projectId} onChange={e => { setLineId(e.target.value); setSmallerChoice(""); }}><option value="">Choose the payment</option>{availableLines.map(l => <option key={l.id} value={l.id}>{l.label ?? "Payment"} · {moneyExact(l.expected!.amountCents)} · {shortDate(l.expected!.date)}</option>)}</select></label>
      {project && !availableLines.length && <p className="notice warn">This project has no unpaid expected payment. A received amount can be corrected from its payment row.</p>}
      {line?.expected && <p className="lc-context">Currently expected: {moneyExact(line.expected.amountCents)} on {shortDate(line.expected.date)}. {action === "update_expected_payment" ? "Leave the new amount or date blank to keep that value." : "Only the amount that actually arrived will be recorded as received."}</p>}
    </>}
    {action === "record_sep_contribution" && <div className="lc-fields">
      <label htmlFor={`${prefix}-person`}>Whose SEP-IRA?<select id={`${prefix}-person`} value={personId} onChange={e => setPersonId(e.target.value)}><option value="">Choose the person</option>{ws.household.people.filter(p => p.role !== "dependent").map(p => <option key={p.id} value={p.id}>{personName(ws.household, p.id)}</option>)}</select></label>
      <label htmlFor={`${prefix}-year`}>For which tax year?<select id={`${prefix}-year`} value={year} onChange={e => setYear(e.target.value)}><option value="">Choose the tax year</option><option value="2026">2026</option><option value="2027">2027</option></select></label>
    </div>}
    {action === "update_forecast" && <>
      <label className="lc-field" htmlFor={`${prefix}-forecast`}>Which existing business forecast?<select id={`${prefix}-forecast`} value={personId && year ? `${personId}|${year}` : ""} onChange={e => { const [person = "", taxYear = ""] = e.target.value.split("|"); setPersonId(person); setYear(taxYear); setField(""); }}><option value="">Choose the person and year</option>{ws.forecasts.map(f => <option key={`${f.personId}|${f.year}`} value={`${f.personId}|${f.year}`}>{personName(ws.household, f.personId)} · {f.year} · {f.method === "annual_total" ? "full-year total" : "year to date plus remaining"}</option>)}</select></label>
      <label className="lc-field" htmlFor={`${prefix}-field`}>Which figure changed?<select id={`${prefix}-field`} value={field} disabled={!forecast} onChange={e => setField(e.target.value as ForecastField | "")}><option value="">Choose the figure</option>{allowedFields.map(f => <option key={f} value={f}>{fields[f]}</option>)}</select></label>
      <label className="lc-field" htmlFor={`${prefix}-status`}>How certain is this value?<select id={`${prefix}-status`} value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="">Choose its basis</option><option value="confirmed">Confirmed by my records</option><option value="estimated">An estimate of what I expect</option></select></label>
      <label className="lc-field" htmlFor={`${prefix}-asof`}>Figures as of <small>Optional. Leave blank if the source has no as-of date.</small><input id={`${prefix}-asof`} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
    </>}
    {action && <div className="lc-fields">
      <label htmlFor={`${prefix}-amount`}>{action === "update_expected_payment" ? "New amount ($), or leave unchanged" : action === "record_receipt" ? "Amount actually received ($)" : action === "record_sep_contribution" ? "Amount actually contributed ($)" : "New forecast amount ($)"}<input id={`${prefix}-amount`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      {action !== "update_forecast" && <label htmlFor={`${prefix}-date`}>{action === "update_expected_payment" ? "New expected date, or leave unchanged" : action === "record_sep_contribution" ? "Date paid" : "Date received"}<input id={`${prefix}-date`} type="date" min="2026-01-01" max="2028-10-16" value={date} onChange={e => setDate(e.target.value)} /></label>}
    </div>}
    {smaller && <>
      <fieldset className="lc-choice"><legend>What happens to the unpaid part?</legend>
        <label><input type="radio" name={`${prefix}-smaller`} checked={smallerChoice === "partial"} onChange={() => setSmallerChoice("partial")} /><span><strong>The rest is still due</strong><small>{moneyExact(line!.expected!.amountCents - (cents as number))} will stay expected on the date you confirm.</small></span></label>
        <label><input type="radio" name={`${prefix}-smaller`} checked={smallerChoice === "settled"} onChange={() => setSmallerChoice("settled")} /><span><strong>Nothing more is due for this payment</strong><small>Explicitly record a lower final settlement.</small></span></label>
      </fieldset>
      {smallerChoice === "partial" && <label className="lc-field" htmlFor={`${prefix}-remainder`}>Full date the remainder is expected<input id={`${prefix}-remainder`} type="date" value={remainderDate} onChange={e => setRemainderDate(e.target.value)} min="2026-01-01" max="2028-10-16" /></label>}
      {smallerChoice === "settled" && <label className="lc-field" htmlFor={`${prefix}-reason`}>Why is the lower amount final?<textarea id={`${prefix}-reason`} maxLength={300} rows={2} value={reason} onChange={e => setReason(e.target.value)} /></label>}
    </>}
    {error && <p className="notice warn" role="alert">{error}</p>}
    <p className="hint">Unknown values stay unknown. A blank amount is never treated as $0. Review checks dates, ownership and the financial effect before anything is saved.</p>
    <div className="lc-actions"><button type="submit" className="btn primary" disabled={!action}>Review this change</button>{onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Back</button>}</div>
  </form>;
}
