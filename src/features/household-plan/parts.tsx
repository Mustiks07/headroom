"use client";

import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import type { TaxYear } from "@/domain/contracts";
import { effectiveLine, type HouseholdWorkspace, type Project, type ProjectLine, type SepYearStatus } from "@/domain/household-workspace";
import { centsToInput, humanizeDates, money, parseDollarsToCents, shortDate } from "@/features/format";
import { personName } from "@/features/household/draft";

/* ---------- small amount/date inputs for explicit forms ---------- */

export function AmountInput({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  return <div className={`field ${error ? "has-problem" : ""}`}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="money-row"><span className="money-prefix" aria-hidden="true">$</span>
      <input id={id} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} aria-invalid={!!error} /></div>
    {error && <p className="field-error">{error}</p>}
  </div>;
}

export function parseAmount(text: string, allowZero = false): { cents: number | null; error: string | null } {
  const v = parseDollarsToCents(text);
  if (v === "invalid") return { cents: null, error: "Enter a dollar amount, like 4,250 or 4250.00." };
  if (v === null) return { cents: null, error: "Enter an amount." };
  if (!allowZero && v <= 0) return { cents: null, error: "Enter an amount above $0." };
  return { cents: v, error: null };
}

const validDate = (d: string, year?: TaxYear) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && (!year || d.startsWith(`${year}-`) || d.startsWith(`${year + 1}-`));

/* ---------- project card ---------- */

const STATUS_TEXT = { proposed: "Proposal", agreed: "Agreed", cancelled: "Cancelled" } as const;
const STATUS_TONE = { proposed: "neutral", agreed: "good", cancelled: "bad" } as const;

export function ProjectCard({ ws, project, onRecord, onCorrect, onCancelLine, onStatus, onCompare, comparing, onConditions, editConditions = false }: {
  ws: HouseholdWorkspace; project: Project;
  onRecord: (lineId: string, a: { amountCents: number; date: string; sourceLabel: string }) => void;
  onCorrect: (lineId: string, a: { amountCents: number; date: string; reason: string }) => void;
  onCancelLine: (lineId: string) => void;
  onStatus: (status: Project["status"]) => void;
  onCompare: () => void; comparing: boolean;
  onConditions: (c: Pick<Project, "cashAccountingConfirmed" | "timingArrangementConfirmed" | "terms">) => void;
  editConditions?: boolean;
}) {
  const [open, setOpen] = useState<{ lineId: string; mode: "record" | "correct" } | null>(null);
  const [conditions, setConditions] = useState(editConditions);
  return <article id={`project-${project.id}`} className={`project-card status-${project.status}`} aria-labelledby={`p-${project.id}`}>
    <header className="project-head">
      <div>
        <h3 id={`p-${project.id}`}>{project.title}</h3>
        <p className="muted small">{personName(ws.household, project.ownerPersonId) === "You" ? "Your business" : `${personName(ws.household, project.ownerPersonId)}'s business`}
          {project.agreedDecision && project.status === "agreed" ? ` · agreed: ${humanizeDates(project.agreedDecision.label)}` : ""}</p>
      </div>
      <span className={`pill ${STATUS_TONE[project.status]}`}>{STATUS_TEXT[project.status]}</span>
    </header>
    {project.status === "proposed" && <p className="small muted">Unpaid proposal amounts are not in your forecast yet. Any payments already received stay included. Compare the remaining offer on top of your plan.</p>}
    {project.status === "cancelled" && <p className="small muted">Payments already received stay in your forecast; expected ones are dropped.</p>}

    <div className="table-wrap"><table className="lines-table">
      <thead><tr><th scope="col">Payment</th><th scope="col">Expected</th><th scope="col">Actually</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
      <tbody>
        {[...project.receipts.map(l => ({ l, kind: "receipt" as const })), ...project.expenses.map(l => ({ l, kind: "expense" as const }))].map(({ l, kind }) => {
          const e = effectiveLine(l);
          return <tr key={l.id} className={`basis-${e.basis}`}>
            <th scope="row">{kind === "expense" ? "Cost" : "Payment"}{l.label ? ` · ${l.label}` : ""}</th>
            <td className="num">{l.expected ? <>{money(l.expected.amountCents)}<br /><span className="muted small">{shortDate(l.expected.date)}</span></> : "—"}</td>
            <td className="num">{l.actual ? <><strong>{money(l.actual.amountCents)}</strong><br /><span className="muted small">{kind === "expense" ? "paid" : "received"} {shortDate(l.actual.date)}</span>
              {l.corrections.length > 0 && <><br /><span className="muted small">corrected {l.corrections.length}×</span></>}</>
              : l.cancelledAt ? <span className="muted">Cancelled</span> : <span className="muted small">Not yet</span>}</td>
            <td className="line-actions">
              {project.status !== "proposed" && !l.actual && !l.cancelledAt && <button type="button" className="btn small secondary" onClick={() => setOpen({ lineId: l.id, mode: "record" })}>
                <Check size={14} /> {kind === "expense" ? "Record paid" : "Record received"}</button>}
              {l.actual && <button type="button" className="btn small ghost" onClick={() => setOpen({ lineId: l.id, mode: "correct" })}><Pencil size={14} /> Correct</button>}
              {project.status === "agreed" && !l.actual && !l.cancelledAt && <button type="button" className="link-btn" onClick={() => { if (window.confirm("Cancel this expected payment? It will be removed from your forecast.")) onCancelLine(l.id); }}>Cancel payment</button>}
            </td>
          </tr>;
        })}
      </tbody>
    </table></div>
    {open && <LineForm line={[...project.receipts, ...project.expenses].find(l => l.id === open.lineId)!} mode={open.mode}
      onCancel={() => setOpen(null)} onSubmit={v => { if (open.mode === "record") onRecord(open.lineId, v as { amountCents: number; date: string; sourceLabel: string }); else onCorrect(open.lineId, v as { amountCents: number; date: string; reason: string }); setOpen(null); }} />}

    {project.status === "proposed" && (conditions || editConditions
      ? <ConditionsForm project={project} onCancel={() => setConditions(false)} onSave={c => { onConditions(c); setConditions(false); }} />
      : <p className="small muted">Cash-basis accounting: {yn(project.cashAccountingConfirmed)} · Payment dates match when money is available: {yn(project.timingArrangementConfirmed)} · Split possible: {project.terms.canSplitPayment ? "yes" : "no"} · Price negotiable: {project.terms.canRenegotiatePrice ? "yes" : "no"}{" "}
        <button type="button" className="link-btn" onClick={() => setConditions(true)}>Edit</button></p>)}
    <div className="row gap wrap">
      {project.status !== "cancelled" && project.receipts.some(l => !l.actual && !l.cancelledAt && l.expected) && <button type="button" className="btn primary small" onClick={onCompare} aria-pressed={comparing}>{comparing ? "Comparing below" : project.status === "agreed" ? "Review remaining payments" : "Compare options for this project"}</button>}
      {project.status === "proposed" && <button type="button" className="btn ghost small" onClick={() => { if (window.confirm(`Agree to “${project.title}” exactly as offered?`)) onStatus("agreed"); }}>Agree as offered</button>}
      {project.status === "agreed" && <button type="button" className="link-btn" onClick={() => { if (window.confirm(`Cancel “${project.title}”? Payments already received stay in your forecast.`)) onStatus("cancelled"); }}>Cancel this project</button>}
      {project.status === "cancelled" && <button type="button" className="link-btn" onClick={() => onStatus("agreed")}>Undo cancellation</button>}
    </div>
  </article>;
}

const yn = (v: boolean | null) => v === null ? "not answered" : v ? "yes" : "no";

function ConditionsForm({ project, onSave, onCancel }: { project: Project; onCancel: () => void;
  onSave: (c: Pick<Project, "cashAccountingConfirmed" | "timingArrangementConfirmed" | "terms">) => void }) {
  const [cash, setCash] = useState(project.cashAccountingConfirmed);
  const [timing, setTiming] = useState(project.timingArrangementConfirmed);
  const [split, setSplit] = useState(project.terms.canSplitPayment);
  const [latest, setLatest] = useState(project.terms.nextYearPaymentLatestDate ?? "");
  const [nego, setNego] = useState(project.terms.canRenegotiatePrice);
  return <form className="line-form" id={`conditions-${project.id}`} onSubmit={e => { e.preventDefault();
    onSave({ cashAccountingConfirmed: cash, timingArrangementConfirmed: timing, terms: { canSplitPayment: split, canRenegotiatePrice: nego, nextYearPaymentLatestDate: split && latest ? latest : null } }); }}>
    <Tri id={`cash-${project.id}`} label="Does your business use cash-basis accounting?" value={cash} onChange={setCash} />
    <Tri id={`timing-${project.id}`} label="Will the payment dates match when the money is really available to you?" value={timing} onChange={setTiming} />
    <label className="switch small"><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /><span>The client could pay part in 2027</span></label>
    {split && <div className="field"><label className="field-label" htmlFor={`latest-${project.id}`}>Latest date for the 2027 part <span className="optional">optional</span></label>
      <input id={`latest-${project.id}`} type="date" value={latest} onChange={e => setLatest(e.target.value)} /></div>}
    <label className="switch small"><input type="checkbox" checked={nego} onChange={e => setNego(e.target.checked)} /><span>I can negotiate the price</span></label>
    <div className="row gap"><button type="submit" className="btn primary small">Save conditions</button><button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button></div>
  </form>;
}

/** Record or correct an actual amount. Shows what it replaces before it is applied. */
function LineForm({ line, mode, onSubmit, onCancel }: {
  line: ProjectLine; mode: "record" | "correct";
  onSubmit: (v: { amountCents: number; date: string; sourceLabel?: string; reason?: string }) => void; onCancel: () => void;
}) {
  const seed = mode === "correct" ? line.actual! : line.expected;
  const [amount, setAmount] = useState(centsToInput(seed?.amountCents ?? null));
  const [date, setDate] = useState(seed?.date ?? "");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const a = parseAmount(amount);
  const dateOk = validDate(date);
  const noteOk = mode === "record" || note.trim().length > 0;
  const ok = !a.error && dateOk && noteOk;
  return <form className="line-form" onSubmit={e => { e.preventDefault(); setTouched(true); if (ok) onSubmit({ amountCents: a.cents!, date, ...(mode === "record" ? { sourceLabel: note } : { reason: note }) }); }}>
    <p className="small"><strong>{mode === "record" ? "Record what actually happened" : "Correct a wrong record"}</strong></p>
    <div className="grid-3">
      <AmountInput id={`amt-${line.id}`} label="Amount" value={amount} onChange={setAmount} error={touched ? a.error : null} />
      <div className={`field ${touched && !dateOk ? "has-problem" : ""}`}><label className="field-label" htmlFor={`date-${line.id}`}>Date</label>
        <input id={`date-${line.id}`} type="date" value={date} onChange={e => setDate(e.target.value)} />
        {touched && !dateOk && <p className="field-error">Enter the date.</p>}</div>
      <div className={`field ${touched && !noteOk ? "has-problem" : ""}`}><label className="field-label" htmlFor={`note-${line.id}`}>{mode === "record" ? "Where is it recorded? (optional)" : "Why the correction?"}</label>
        <input id={`note-${line.id}`} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={mode === "record" ? "e.g. bank deposit Dec 16" : "e.g. typed the wrong amount"} />
        {touched && !noteOk && <p className="field-error">Say briefly what was wrong.</p>}</div>
    </div>
    {mode === "record" && line.expected && ok && <p className="hint">This replaces the expected {money(line.expected.amountCents)} on {shortDate(line.expected.date)} with {money(a.cents!)} on {shortDate(date)} — it is not added on top.</p>}
    {mode === "correct" && ok && <p className="hint">The earlier record ({money(line.actual!.amountCents)} on {shortDate(line.actual!.date)}) is kept in the history.</p>}
    <div className="row gap"><button type="submit" className="btn primary small">{mode === "record" ? "Save this payment" : "Save the correction"}</button>
      <button type="button" className="btn ghost small" onClick={onCancel}><X size={14} /> Cancel</button></div>
  </form>;
}

/* ---------- add a project ---------- */

export function AddProjectForm({ ws, onAdd, onCancel }: {
  ws: HouseholdWorkspace;
  onAdd: (p: { title: string; ownerPersonId: string; receipts: Array<{ amountCents: number; date: string; label?: string }>; expenses: Array<{ amountCents: number; date: string }>;
    terms: Project["terms"]; cashAccountingConfirmed: boolean | null; timingArrangementConfirmed: boolean | null; sourceLabel: string }) => void;
  onCancel: () => void;
}) {
  const owners = ws.household.people.filter(p => p.role !== "dependent");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(owners[0]?.id ?? "primary");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [cost, setCost] = useState("0");
  const [costDate, setCostDate] = useState("");
  const [split, setSplit] = useState(false);
  const [latest, setLatest] = useState("");
  const [nego, setNego] = useState(false);
  const [cash, setCash] = useState<boolean | null>(null);
  const [timing, setTiming] = useState<boolean | null>(null);
  const [touched, setTouched] = useState(false);
  const p = parseAmount(price); const c = parseAmount(cost, true);
  const errors = { title: title.trim() ? null : "Name the project.", price: p.error, date: validDate(date) && /^202[67]-/.test(date) ? null : "Enter a date in 2026 or 2027.",
    cost: c.error, costDate: (c.cents ?? 0) > 0 && !validDate(costDate) ? "Enter when the costs are paid." : null };
  const ok = Object.values(errors).every(e => !e);
  return <form className="plan-section add-project" onSubmit={e => { e.preventDefault(); setTouched(true); if (!ok) return;
    onAdd({ title: title.trim(), ownerPersonId: owner, receipts: [{ amountCents: p.cents!, date }], expenses: (c.cents ?? 0) > 0 ? [{ amountCents: c.cents!, date: costDate }] : [],
      terms: { canSplitPayment: split, canRenegotiatePrice: nego, nextYearPaymentLatestDate: split && latest ? latest : null }, cashAccountingConfirmed: cash, timingArrangementConfirmed: timing,
      sourceLabel: `Offer for ${title.trim()}` }); }}>
    <h3 className="small-head">Add a new client offer</h3>
    <p className="muted small">It starts as a proposal: Headroom checks it on top of your agreed projects before anything changes.</p>
    <div className="grid-2">
      <div className={`field ${touched && errors.title ? "has-problem" : ""}`}><label className="field-label" htmlFor="np-title">Project name</label>
        <input id="np-title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />{touched && errors.title && <p className="field-error">{errors.title}</p>}</div>
      {owners.length > 1 && <div className="field"><label className="field-label" htmlFor="np-owner">Whose business?</label>
        <select id="np-owner" value={owner} onChange={e => setOwner(e.target.value)}>{owners.map(o => <option key={o.id} value={o.id}>{personName(ws.household, o.id)}</option>)}</select></div>}
    </div>
    <div className="grid-2">
      <AmountInput id="np-price" label="What the client will pay" value={price} onChange={setPrice} error={touched ? errors.price : null} />
      <div className={`field ${touched && errors.date ? "has-problem" : ""}`}><label className="field-label" htmlFor="np-date">When the money would arrive</label>
        <input id="np-date" type="date" value={date} onChange={e => setDate(e.target.value)} />{touched && errors.date && <p className="field-error">{errors.date}</p>}</div>
      <AmountInput id="np-cost" label="Extra costs for this project" value={cost} onChange={setCost} error={touched ? errors.cost : null} />
      {(c.cents ?? 0) > 0 && <div className={`field ${touched && errors.costDate ? "has-problem" : ""}`}><label className="field-label" htmlFor="np-cdate">When you pay the costs</label>
        <input id="np-cdate" type="date" value={costDate} onChange={e => setCostDate(e.target.value)} />{touched && errors.costDate && <p className="field-error">{errors.costDate}</p>}</div>}
    </div>
    <label className="switch small"><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /><span>The client could pay part in 2027</span></label>
    {split && <div className="field"><label className="field-label" htmlFor="np-latest">Latest date for the 2027 part <span className="optional">optional</span></label>
      <input id="np-latest" type="date" value={latest} onChange={e => setLatest(e.target.value)} /></div>}
    <label className="switch small"><input type="checkbox" checked={nego} onChange={e => setNego(e.target.checked)} /><span>I can negotiate the price</span></label>
    <Tri id="np-cash" label="Does your business use cash-basis accounting?" value={cash} onChange={setCash} />
    <Tri id="np-timing" label="Will the payment dates match when the money is really available to you?" value={timing} onChange={setTiming} />
    <div className="row gap"><button type="submit" className="btn primary small"><Plus size={14} /> Add the offer</button><button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function Tri({ id, label, value, onChange }: { id: string; label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return <fieldset className="tri" id={id}><legend className="field-label">{label}</legend>
    <div className="seg small">{([[true, "Yes"], [false, "No"], [null, "Not sure"]] as const).map(([v, t]) =>
      <label key={String(v)} className={value === v ? "on" : ""}><input type="radio" name={id} checked={value === v} onChange={() => onChange(v)} />{t}</label>)}</div>
  </fieldset>;
}

/* ---------- SEP ledger ---------- */

export function SepPanel({ ws, rows, legal, onRecord, onGoal, onBudget, budgetRemaining }: {
  ws: HouseholdWorkspace; rows: SepYearStatus[]; legal: Map<string, number | null>;
  onRecord: (c: { personId: string; taxYear: TaxYear; amountCents: number; paidDate: string; sourceLabel: string }) => void;
  onGoal: (personId: string, year: TaxYear, cents: number) => void;
  onBudget: (cents: number | null, asOf: string) => void;
  budgetRemaining: number | null;
}) {
  const owners = ws.household.people.filter(p => p.role !== "dependent");
  const [form, setForm] = useState(false);
  const [goalEdit, setGoalEdit] = useState<{ personId: string; year: TaxYear; text: string } | null>(null);
  const [personId, setPersonId] = useState(owners[0]?.id ?? "primary");
  const [taxYear, setTaxYear] = useState<TaxYear>(2026);
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [budgetText, setBudgetText] = useState(centsToInput(ws.retirement.futureContributionBudget.amountCents));
  const a = parseAmount(amount);
  const paidOk = /^\d{4}-\d{2}-\d{2}$/.test(paid) && paid >= `${taxYear}-01-01` && paid <= `${taxYear + 1}-10-15`;
  const b = budgetText.trim() === "" ? { cents: null, error: null } : parseAmount(budgetText, true);
  const budget = ws.retirement.futureContributionBudget;

  return <div className="stack">
    {rows.length === 0 && <p className="muted small">No SEP-IRA goal or contribution yet. Choosing an option with a SEP-IRA contribution sets a yearly goal here.</p>}
    {rows.map(r => <div key={`${r.personId}${r.year}`} className="sep-row">
      <p className="tile-k">{personName(ws.household, r.personId) === "You" ? "Your" : `${personName(ws.household, r.personId)}'s`} {r.year} SEP-IRA</p>
      <dl className="sep-figures">
        <div><dt>Yearly goal</dt><dd className="num">{r.targetCents === null ? "No goal set" : money(r.targetCents)}</dd></div>
        <div><dt>Already contributed</dt><dd className="num">{money(r.paidCents)}</dd></div>
        <div><dt>Left to contribute</dt><dd className="num strong">{money(r.remainingCents)}</dd></div>
        {legal.get(`${r.personId}|${r.year}`) != null && <div><dt>Legal maximum</dt><dd className="num">{money(legal.get(`${r.personId}|${r.year}`)!)}</dd></div>}
      </dl>
      {r.targetCents !== null && r.paidCents > r.targetCents && <p className="hint">You've contributed more than the goal. Lowering a goal never undoes money already contributed.</p>}
      <ul className="contrib-list">{ws.retirement.contributions.filter(c => c.personId === r.personId && c.taxYear === r.year).map(c =>
        <li key={c.id}><span>{money(c.amountCents)} paid {shortDate(c.paidDate)}</span><span className="muted small">{ws.evidence.find(e => e.id === c.sourceId)?.label}</span></li>)}</ul>
      {goalEdit?.personId === r.personId && goalEdit.year === r.year ? <form className="row gap wrap" onSubmit={e => { e.preventDefault(); const g = parseAmount(goalEdit.text, true); if (!g.error) { onGoal(r.personId, r.year, g.cents!); setGoalEdit(null); } }}>
        <AmountInput id={`goal-${r.personId}-${r.year}`} label="New yearly goal" value={goalEdit.text} onChange={t => setGoalEdit({ ...goalEdit, text: t })} error={parseAmount(goalEdit.text, true).error && goalEdit.text ? parseAmount(goalEdit.text, true).error : null} />
        <button type="submit" className="btn small primary">Save goal</button><button type="button" className="btn small ghost" onClick={() => setGoalEdit(null)}>Cancel</button>
      </form> : <button type="button" className="link-btn" onClick={() => setGoalEdit({ personId: r.personId, year: r.year, text: centsToInput(r.targetCents) })}>Change the goal</button>}
    </div>)}

    {!form ? <button type="button" className="btn secondary small" onClick={() => setForm(true)}><Plus size={14} /> Record a contribution you made</button>
      : <form className="line-form" onSubmit={e => { e.preventDefault(); setTouched(true); if (a.error || !paidOk) return;
        onRecord({ personId, taxYear, amountCents: a.cents!, paidDate: paid, sourceLabel: note }); setForm(false); setAmount(""); setPaid(""); setNote(""); setTouched(false); }}>
        <p className="small"><strong>A contribution that actually left your account</strong> — enter the amount and date from the confirmation.</p>
        <div className="grid-3">
          {owners.length > 1 && <div className="field"><label className="field-label" htmlFor="c-person">Whose SEP-IRA?</label>
            <select id="c-person" value={personId} onChange={e => setPersonId(e.target.value)}>{owners.map(o => <option key={o.id} value={o.id}>{personName(ws.household, o.id)}</option>)}</select></div>}
          <div className="field"><label className="field-label" htmlFor="c-year">For tax year</label>
            <select id="c-year" value={taxYear} onChange={e => setTaxYear(Number(e.target.value) as TaxYear)}><option value={2026}>2026</option><option value={2027}>2027</option></select></div>
          <AmountInput id="c-amount" label="Amount contributed" value={amount} onChange={setAmount} error={touched ? a.error : null} />
          <div className={`field ${touched && !paidOk ? "has-problem" : ""}`}><label className="field-label" htmlFor="c-date">Date paid</label>
            <input id="c-date" type="date" value={paid} onChange={e => setPaid(e.target.value)} />
            {touched && !paidOk && <p className="field-error">A {taxYear} contribution must be paid between Jan 1, {taxYear} and Oct 15, {taxYear + 1}.</p>}</div>
          <div className="field"><label className="field-label" htmlFor="c-note">Confirmation <span className="optional">optional</span></label>
            <input id="c-note" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. brokerage confirmation #123" /></div>
        </div>
        <div className="row gap"><button type="submit" className="btn primary small">Save contribution</button><button type="button" className="btn ghost small" onClick={() => setForm(false)}>Cancel</button></div>
      </form>}

    <form className="budget" onSubmit={e => { e.preventDefault(); if (!b.error) onBudget(b.cents, new Date().toISOString().slice(0, 10)); }}>
      <AmountInput id="budget" label="Cash set aside for future SEP contributions" value={budgetText} onChange={setBudgetText} error={b.error} />
      <p className="hint">{budget.asOfDate ? `Snapshot as of ${shortDate(budget.asOfDate)}. ` : ""}To update it, enter the cash available today after the contributions you've recorded. Payments made since the snapshot use that cash; older payments already reflected in it are not deducted twice.{budget.amountCents === null ? " Leave empty if you don't know — then no extra contribution is suggested." : ""}
        {budgetRemaining !== null ? ` After goals you've already accepted: ${money(budgetRemaining)} left.` : ""}</p>
      <button type="submit" className="btn small ghost">Save amount</button>
    </form>
  </div>;
}
