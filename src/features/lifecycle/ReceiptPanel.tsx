"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ChangeCommandSchema, type ChangeCommand } from "@/domain/assistance";
import type { HouseholdWorkspace, ProjectLine } from "@/domain/household-workspace";
import { centsToInput, localCalendarDate, moneyExact, parseDollarsToCents, shortDate } from "@/features/format";
import { CommandReview, type LifecycleSaved } from "./CommandReview";
const ReceiptDraftSchema = z.object({ amount: z.string(), date: z.string(), choice: z.enum(["partial", "settled"]).nullable(), remainingDate: z.string(), reason: z.string().max(300) });

export function ReceiptPanel({ ws, projectId, line, mode = "receipt", onSaved, onCancel }: {
  ws: HouseholdWorkspace; projectId: string; line: ProjectLine; mode?: "receipt" | "correction";
  onSaved: LifecycleSaved; onCancel: () => void;
}) {
  const [amount, setAmount] = useState(centsToInput(mode === "correction" ? line.actual?.amountCents ?? null : line.expected?.amountCents ?? null));
  const [date, setDate] = useState(mode === "correction" ? line.actual?.date ?? "" : localCalendarDate());
  const [choice, setChoice] = useState<"partial" | "settled" | null>(null);
  const [remainingDate, setRemainingDate] = useState("");
  const [reason, setReason] = useState("");
  const [command, setCommand] = useState<ChangeCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const amountCents = parseDollarsToCents(amount);
  const smaller = mode === "receipt" && typeof amountCents === "number" && !!line.expected && amountCents < line.expected.amountCents;
  const prefix = `lc-${projectId}-${line.id}`;
  const storageKey = `headroom.lifecycle.receipt.${ws.id}.${projectId}.${line.id}.${mode}`;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? ReceiptDraftSchema.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success) { const d = parsed.data; setAmount(d.amount); setDate(d.date); setChoice(d.choice); setRemainingDate(d.remainingDate); setReason(d.reason); }
    } catch { /* The form still works without draft storage. */ }
    setDraftLoaded(true);
  }, [storageKey]);
  useEffect(() => { if (draftLoaded) { try { localStorage.setItem(storageKey, JSON.stringify({ amount, date, choice, remainingDate, reason })); } catch { /* Workspace save still reports storage failures. */ } } }, [storageKey, draftLoaded, amount, date, choice, remainingDate, reason]);
  function saved(next: HouseholdWorkspace, summary: string) {
    try { localStorage.removeItem(storageKey); } catch { /* Workspace is already saved. */ }
    onSaved(next, summary);
  }

  function review() {
    setError(null);
    if (typeof amountCents !== "number" || amountCents <= 0) { setError("Enter the amount that actually arrived, above $0."); return; }
    if (smaller && !choice) { setError("Choose whether the balance is still due or this is the final settlement."); return; }
    const raw: ChangeCommand = mode === "correction"
      ? { type: "correct_fact", target: { kind: "payment", projectId, lineId: line.id }, amountCents, date, reason: reason.trim() }
      : smaller && choice === "partial"
        ? { type: "record_partial_receipt", projectId, lineId: line.id, amountCents, date, remainderDate: remainingDate }
        : smaller && choice === "settled"
          ? { type: "settle_lower_total", projectId, lineId: line.id, amountCents, date, reason: reason.trim() }
          : { type: "record_receipt", projectId, lineId: line.id, amountCents, date };
    const parsed = ChangeCommandSchema.safeParse(raw);
    if (!parsed.success) { setError(parsed.error.issues.some(i => i.path.includes("reason")) ? "Give a short reason for the correction or lower final settlement." : "Enter valid dates, including the year. Dates must be between January 1, 2026 and October 16, 2028."); return; }
    setCommand(parsed.data);
  }

  return <div className="lc-panel" onKeyDown={e => { if (e.key === "Escape" && !command) { e.preventDefault(); onCancel(); } }}>
    <div className="lc-section-heading"><span className="lc-eyebrow">Money that actually arrived</span><h4 tabIndex={-1} ref={heading}>{mode === "correction" ? "Correct a recorded payment" : "Record a payment"}</h4></div>
    {command ? <CommandReview ws={ws} command={command} sourceText={reason || "Payment confirmed manually"} onSaved={saved} onBack={() => setCommand(null)} />
      : <form onSubmit={e => { e.preventDefault(); review(); }}>
        <p className="lc-context">{mode === "correction" && line.actual ? <>Recorded: <strong>{moneyExact(line.actual.amountCents)}</strong> on {shortDate(line.actual.date)}. The prior record stays in history.</> : line.expected ? <>Expected: <strong>{moneyExact(line.expected.amountCents)}</strong> on {shortDate(line.expected.date)}.</> : "Use the amount and date from your payment confirmation."}</p>
        <div className="lc-fields">
          <label htmlFor={`${prefix}-amount`}>Amount received ($)<input id={`${prefix}-amount`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label htmlFor={`${prefix}-date`}>Date received<input id={`${prefix}-date`} type="date" value={date} onChange={e => setDate(e.target.value)} min="2026-01-01" max="2028-10-16" /></label>
        </div>
        {smaller && <fieldset className="lc-choice"><legend>This is less than the expected payment. What happened?</legend>
          <label><input type="radio" name={`${prefix}-settlement`} checked={choice === "partial"} onChange={() => setChoice("partial")} /><span><strong>Part arrived; the rest is still due</strong><small>Keep {moneyExact(line.expected!.amountCents - (amountCents as number))} as an expected payment.</small></span></label>
          <label><input type="radio" name={`${prefix}-settlement`} checked={choice === "settled"} onChange={() => setChoice("settled")} /><span><strong>This payment is fully settled at a lower total</strong><small>No remainder is created for this payment. Other payment lines stay unchanged.</small></span></label>
        </fieldset>}
        {smaller && choice === "partial" && <label className="lc-field" htmlFor={`${prefix}-remainder`}>When is the remaining payment expected?<input id={`${prefix}-remainder`} type="date" value={remainingDate} onChange={e => setRemainingDate(e.target.value)} min="2026-01-01" max="2028-10-16" /><small>Confirm the full date, including the year. It is a plan, not a received payment.</small></label>}
        {(mode === "correction" || smaller && choice === "settled") && <label className="lc-field" htmlFor={`${prefix}-reason`}>{mode === "correction" ? "What was wrong with the record?" : "Why was the lower amount the final payment?"}<textarea id={`${prefix}-reason`} rows={2} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>}
        {error && <p className="notice warn" role="alert">{error}</p>}
        <div className="lc-actions"><button type="submit" className="btn primary">Review the change</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
      </form>}
  </div>;
}
