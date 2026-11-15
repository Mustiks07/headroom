"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { HouseholdWorkspace, Project } from "@/domain/household-workspace";
import { effectiveLine } from "@/domain/household-workspace";
import { centsToInput, localCalendarDate, money, shortDate } from "@/features/format";
import { AmountInput, parseAmount } from "@/features/household-plan/parts";

/** What the person can change about the goal, kept as typed text until it is valid. */
export interface GoalDraft {
  keepAtLeast: string;
  sepMax: string;
  byDate: { on: boolean; date: string; amount: string; kind: "project_receipts" | "project_available_cash" | "household_balance" };
  price: { min: string; max: string };
  windows: { latestDate: string; maxParts: number };
  clientOpen: boolean | null;
  cash: { balance: string; asOf: string; reserve: string; complete: boolean };
}

export function defaultGoal(project: Project): GoalDraft {
  const total = project.receipts.map(effectiveLine).reduce((s, e) => s + e.amountCents, 0);
  const firstDate = project.receipts.map(effectiveLine).filter(e => e.basis === "expected" && e.date).map(e => e.date!).sort()[0] ?? "";
  return {
    keepAtLeast: "", sepMax: "0",
    byDate: { on: false, date: firstDate, amount: "", kind: "project_receipts" },
    price: { min: centsToInput(total || null), max: centsToInput(total || null) },
    windows: { latestDate: project.terms.nextYearPaymentLatestDate ?? "", maxParts: project.terms.canSplitPayment ? 2 : 1 },
    clientOpen: project.terms.canSplitPayment || project.terms.canRenegotiatePrice ? true : null,
    cash: { balance: "", asOf: localCalendarDate(), reserve: "0", complete: false },
  };
}

export type GoalProblems = Partial<Record<"keepAtLeast" | "sepMax" | "date" | "amount" | "priceMin" | "priceMax" | "latest" | "balance" | "reserve" | "complete", string>>;

/** Shape/format checks only; whether a goal is reachable is the engine's answer. */
export function goalProblems(g: GoalDraft): GoalProblems {
  const p: GoalProblems = {};
  const amt = (t: string, allowEmpty: boolean, key: keyof GoalProblems) => {
    if (allowEmpty && t.trim() === "") return;
    const r = parseAmount(t, true); if (r.error) p[key] = r.error;
  };
  amt(g.keepAtLeast, true, "keepAtLeast"); amt(g.sepMax, false, "sepMax");
  amt(g.price.min, false, "priceMin"); amt(g.price.max, false, "priceMax");
  const lo = parseAmount(g.price.min, true).cents, hi = parseAmount(g.price.max, true).cents;
  if (!p.priceMin && !p.priceMax && lo !== null && hi !== null && lo > hi) p.priceMax = "The highest price must not be below the lowest.";
  if (g.byDate.on) {
    if (!/^20(26|27)-\d{2}-\d{2}$/.test(g.byDate.date)) p.date = "Choose a date in 2026 or 2027.";
    amt(g.byDate.amount, false, "amount");
    if (g.byDate.kind === "household_balance") {
      amt(g.cash.balance, false, "balance"); amt(g.cash.reserve, false, "reserve");
    }
  }
  if (g.windows.latestDate && !/^20(26|27)-\d{2}-\d{2}$/.test(g.windows.latestDate)) p.latest = "Choose a date in 2026 or 2027.";
  return p;
}

const KIND_TEXT = {
  project_receipts: ["Paid by the client", "Money from this client arrives by the date — before taxes."],
  project_available_cash: ["This project's money we can use", "What this project adds to the cash you can use by the date, after money you'd set aside for taxes and SEP."],
  household_balance: ["Our total balance", "Your household bank balance on the date. Needs your current balance and the bigger money movements until then."],
} as const;

/**
 * Goal-first form: how much to keep after both tax years, the SEP-IRA limit and an optional
 * money-by-date goal whose meaning is chosen explicitly. Advanced limits open on request.
 */
export function GoalForm({ ws, project, goal, onChange, problems, touched, fixedReceived }: {
  ws: HouseholdWorkspace; project: Project; goal: GoalDraft; onChange: (g: GoalDraft) => void; problems: GoalProblems; touched: boolean;
  fixedReceived: Array<{ amountCents: number; date: string }>;
}) {
  const [more, setMore] = useState(false);
  const show = (k: keyof GoalProblems) => touched ? problems[k] ?? null : null;
  const set = (patch: Partial<GoalDraft>) => onChange({ ...goal, ...patch });
  void ws;
  return <div className="goal-form">
    {fixedReceived.length > 0 && <p className="fixed-note">Already received and fixed: {fixedReceived.map(r => `${money(r.amountCents)} on ${shortDate(r.date)}`).join(", ")}. Only the payments that haven&apos;t happened yet can change.</p>}
    <div className="grid-2">
      <AmountInput id="goal-keep" label="Keep at least this much more, after both tax years" value={goal.keepAtLeast} onChange={v => set({ keepAtLeast: v })} error={show("keepAtLeast")} />
      <AmountInput id="goal-sep" label="Most extra I can put into a SEP-IRA" value={goal.sepMax} onChange={v => set({ sepMax: v })} error={show("sepMax")} />
    </div>
    <p className="hint">“After both tax years” means the cash your family keeps once the 2026 and 2027 returns are settled — leave it empty for “as much as possible”. Retirement money is never counted as cash.</p>

    <label className="switch"><input type="checkbox" checked={goal.byDate.on} onChange={e => set({ byDate: { ...goal.byDate, on: e.target.checked } })} /><span>I need money by a certain date</span></label>
    {goal.byDate.on && <div className="by-date">
      <fieldset className="field"><legend className="field-label">What should the date goal measure?</legend>
        <div className="kind-choice">{(Object.keys(KIND_TEXT) as Array<keyof typeof KIND_TEXT>).map(k => <label key={k} className={`kind ${goal.byDate.kind === k ? "on" : ""}`}>
          <input type="radio" name="goal-kind" checked={goal.byDate.kind === k} onChange={() => set({ byDate: { ...goal.byDate, kind: k } })} />
          <strong>{KIND_TEXT[k][0]}</strong><span className="muted small">{KIND_TEXT[k][1]}</span></label>)}</div>
      </fieldset>
      <div className="grid-2">
        <div className={`field ${show("date") ? "has-problem" : ""}`}><label className="field-label" htmlFor="goal-date">By</label>
          <input id="goal-date" type="date" value={goal.byDate.date} onChange={e => set({ byDate: { ...goal.byDate, date: e.target.value } })} />{show("date") && <p className="field-error">{show("date")}</p>}</div>
        <AmountInput id="goal-amount" label={goal.byDate.kind === "household_balance" ? "Balance at least" : "At least"} value={goal.byDate.amount} onChange={v => set({ byDate: { ...goal.byDate, amount: v } })} error={show("amount")} />
      </div>
      {goal.byDate.kind === "household_balance" && <div className="cash-context">
        <p className="small"><strong>Your cash today</strong> — only what&apos;s needed for this date. Headroom won&apos;t claim you can cover every bill unless you confirm the picture is complete.</p>
        <div className="grid-3">
          <AmountInput id="cash-balance" label="Bank balance now" value={goal.cash.balance} onChange={v => set({ cash: { ...goal.cash, balance: v } })} error={show("balance")} />
          <div className="field"><label className="field-label" htmlFor="cash-asof">As of</label><input id="cash-asof" type="date" value={goal.cash.asOf} onChange={e => set({ cash: { ...goal.cash, asOf: e.target.value } })} /></div>
          <AmountInput id="cash-reserve" label="Keep untouched (reserve)" value={goal.cash.reserve} onChange={v => set({ cash: { ...goal.cash, reserve: v } })} error={show("reserve")} />
        </div>
        <label className="check"><input type="checkbox" checked={goal.cash.complete} onChange={e => set({ cash: { ...goal.cash, complete: e.target.checked } })} />
          This balance and the payments in my plan cover all large money in and out until the date.</label>
        {!goal.cash.complete && <p className="hint warn">Without this confirmation Headroom shows only this project&apos;s money and won&apos;t say whether the balance goal is met.</p>}
      </div>}
    </div>}

    <button type="button" className="link-btn" aria-expanded={more} onClick={() => setMore(m => !m)}><ChevronDown size={14} /> {more ? "Fewer limits" : "Price and payment limits"}</button>
    {more && <div className="stack">
      <div className="grid-2">
        <AmountInput id="goal-price-min" label="Lowest total project price I'd ask" value={goal.price.min} onChange={v => set({ price: { ...goal.price, min: v } })} error={show("priceMin")} />
        <AmountInput id="goal-price-max" label="Highest total project price I'd ask" value={goal.price.max} onChange={v => set({ price: { ...goal.price, max: v } })} error={show("priceMax")} />
      </div>
      <div className="grid-2">
        <div className={`field ${show("latest") ? "has-problem" : ""}`}><label className="field-label" htmlFor="goal-latest">Latest acceptable payment date</label>
          <input id="goal-latest" type="date" value={goal.windows.latestDate} onChange={e => set({ windows: { ...goal.windows, latestDate: e.target.value } })} />{show("latest") && <p className="field-error">{show("latest")}</p>}</div>
        <div className="field"><label className="field-label" htmlFor="goal-parts">Payments the client could make</label>
          <select id="goal-parts" value={goal.windows.maxParts} onChange={e => set({ windows: { ...goal.windows, maxParts: Number(e.target.value) } })}>
            <option value={1}>One payment</option><option value={2}>Up to two payments</option><option value={3}>Up to three payments</option></select></div>
      </div>
      <fieldset className="tri"><legend className="field-label">Has the client said new terms are possible?</legend>
        <div className="seg small">{([[true, "Yes"], [false, "No — only as offered"], [null, "Not asked yet"]] as const).map(([v, t]) =>
          <label key={String(v)} className={goal.clientOpen === v ? "on" : ""}><input type="radio" name="goal-open" checked={goal.clientOpen === v} onChange={() => set({ clientOpen: v })} />{t}</label>)}</div>
        <p className="hint">Headroom only suggests terms; nothing counts as agreed until the client says yes.</p></fieldset>
      <p className="muted small">{project.title}: total price includes money already received. Only the unpaid remainder can be rescheduled.</p>
    </div>}
  </div>;
}
