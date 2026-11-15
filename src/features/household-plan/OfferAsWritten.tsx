"use client";

import { useEffect, useState } from "react";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { evaluateOfferAsOffered } from "@/lib/engine";
import { Readiness } from "@/features/assist/Readiness";
import { humanizeDates, money, shortDate, signedMoney } from "@/features/format";

/** The first decision is the offer exactly as entered; cross-year optimization is a separate action. */
export function OfferAsWritten({ ws, projectId, onAnswer, onSubmit, onFindTerms, onRecordResponse, onImport }: {
  ws: HouseholdWorkspace; projectId: string; onAnswer: (path: string) => void;
  onSubmit: (next: HouseholdWorkspace, summary: string) => Promise<boolean>;
  onFindTerms: () => void; onRecordResponse: () => void;
  onImport: () => void;
}) {
  const [run, setRun] = useState<{ workspaceId: string; projectId: string; revision: number; result?: Awaited<ReturnType<typeof evaluateOfferAsOffered>>; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    void evaluateOfferAsOffered(ws, projectId).then(result => { if (live) setRun({ workspaceId: ws.id, projectId, revision: ws.revision, result }); },
      error => { if (live) setRun({ workspaceId: ws.id, projectId, revision: ws.revision, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [ws, projectId]);
  const project = ws.projects.find(p => p.id === projectId);
  if (!project) return null;
  const current = run?.workspaceId === ws.id && run?.projectId === projectId && run?.revision === ws.revision;
  const r = current ? run?.result : undefined;
  const ready = r?.status === "ready" ? r : null;
  const open = project.receipts.filter(p => p.expected && !p.actual && !p.cancelledAt);
  const original = project.originalOffer;
  return <section className="offer-answer" id="offer-answer" aria-labelledby="offer-answer-title">
    <div className="work-heading"><p className="eyebrow">Your offer · as written</p>
      <h2 id="offer-answer-title">What does this offer leave you?</h2><p>{project.title}</p></div>
    {run?.error && current && <p className="notice warn" role="alert">The calculation couldn&apos;t finish. {run.error} Your saved terms are unchanged.</p>}
    {!current && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" />Checking this offer against your latest facts…</p>}
    {ready ? <div className="joined-result">
      <div className="joined-outcome">
        <p className="eyebrow">{ready.verdict === "review_terms" ? "Review the terms" : ready.verdict === "keep_agreed_terms" ? "Your agreed terms" : "Works as offered"}</p>
        <p className="outcome-number num">{signedMoney(ready.cashChangeCents)}</p>
        <h3>Extra cash after tax settlement</h3>
        {ready.results.some(result => result.precision !== "exact") && <p className="small">Planning estimate · depends on the confirmed facts and estimates in your plan.</p>}
        <p>Compared with {ready.baseline.label.toLowerCase()}.</p>
        <p className="small">{ready.years.map(y => y.year).join(" + ")} tax year{ready.years.length > 1 ? "s" : ""} · final settlement in {Math.max(...ready.years.map(y => y.year)) + 1}. This is a cash change, not your bank balance.</p>
      </div>
      <div className="joined-terms"><p className="eyebrow">The client&apos;s current terms</p>
        <h3>{money(ready.unpaidCents)} still to be paid</h3>
        <dl className="payment-ledger">{open.map(p => <div key={p.id}><dt>{shortDate(p.expected!.date)}</dt><dd className="num">{money(p.expected!.amountCents)}</dd></div>)}</dl>
        <p className="hint">Expected payments. Nothing here is recorded as received.</p>
        {ready.receivedCents > 0 && <p>Already received: <strong>{money(ready.receivedCents)}</strong>, included on both sides of the comparison.</p>}
        <ul className="bullets small">{ready.reasons.map(t => <li key={t}>{humanizeDates(t)}</li>)}</ul>
        <div className="row gap wrap"><button className="btn primary" type="button" onClick={onFindTerms}>{ready.verdict === "review_terms" ? "Find workable terms" : "Compare other terms"}</button><button className="btn secondary" type="button" onClick={onRecordResponse}>Record client response</button></div>
      </div>
    </div> : <Readiness focused onImport={onImport} ws={ws} intent="new_offer" projectId={projectId} onAnswer={onAnswer} onSubmit={onSubmit} />}
    {ready && <>
      <details className="offer-breakdown"><summary>Show the calculation</summary>
        <p className="small">{ready.baseline.description} Every figure below is a change caused by the unpaid offer.</p>
        <div className="table-wrap"><table className="years-table"><thead><tr><th>Change</th>{ready.years.map(y => <th key={y.year}>{y.year}</th>)}</tr></thead><tbody>
          {([['Client payments', 'receiptsCents', 1], ['Project costs', 'expensesCents', -1], ['Self-employment tax', 'selfEmploymentTaxChangeCents', -1], ['Federal income tax', 'incomeTaxChangeCents', -1], ['Premium tax credit', 'premiumTaxCreditChangeCents', 1], ['Extra cash after settlement', 'cashChangeCents', 1]] as const).map(([label, key, sign]) => <tr key={key}><th scope="row">{label}</th>{ready.years.map(y => <td className="num" key={y.year}>{signedMoney(y[key] * sign)}</td>)}</tr>)}
        </tbody></table></div><p className="hint">{ready.engineVersion} · {ready.rulesVersion} · saved revision {ws.revision}</p>
      </details>
      {!!ready.warnings.length && <details className="explain"><summary>Conditions behind this answer</summary><ul className="bullets small">{ready.warnings.map(w => <li key={w}>{humanizeDates(w)}</li>)}</ul></details>}
    </>}
    {original && <p className="hint">The original offer is preserved in this plan. Later negotiations and receipts have their own history.</p>}
  </section>;
}
