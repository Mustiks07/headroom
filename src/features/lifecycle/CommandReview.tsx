"use client";

import { useEffect, useId, useState } from "react";
import type { ChangeCommand, ChangeProposal } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { previewChange, type EngineChangePreview } from "@/lib/engine";
import { evaluateClientResponse, type ClientResponse, type ClientResponseEvaluation } from "@/lib/engine/assist/negotiation";
import { METRIC_LABEL } from "@/lib/engine/descriptors";
import { applyChangeProposal, commitProposal, CommandError, manualProposal } from "@/lib/client/api";
import { workspaceRepo } from "@/features/household-plan/store";
import { humanizeDates, localCalendarDate, money, shortDate, signedMoney } from "@/features/format";
import "./lifecycle.css";

export type LifecycleSaved = (saved: HouseholdWorkspace, summary: string) => void;

/** One preview/commit path for manual lifecycle controls and provider-extracted terms. */
export function CommandReview({ ws, command, additionalCommands, responseLimits, sourceText, onSaved, onBack }: {
  ws: HouseholdWorkspace; command: ChangeCommand; sourceText?: string;
  additionalCommands?: ChangeCommand[]; responseLimits?: ClientResponse["limits"];
  onSaved: LifecycleSaved; onBack: () => void;
}) {
  const [review, setReview] = useState<{ proposal: ChangeProposal; preview: EngineChangePreview } | null>(null);
  const [responseResult, setResponseResult] = useState<ClientResponseEvaluation | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const headingId = useId();
  // A changed plan invalidates the existing review immediately, before another calculation runs.
  const stale = review !== null && (review.proposal.base.workspaceId !== ws.id || review.proposal.base.revision !== ws.revision);

  useEffect(() => {
    let active = true;
    setReview(null); setError(null); setResponseResult(null); setResponseError(null);
    void (async () => {
      try {
        const proposal = await manualProposal(ws, `lifecycle-${crypto.randomUUID()}`, [command, ...(additionalCommands ?? [])]);
        if (sourceText) proposal.evidence = [{ documentId: null, excerpt: sourceText.slice(0, 200) }];
        const preview = await previewChange(ws, proposal, { userDate: localCalendarDate(), apply: (w, p) => applyChangeProposal(w, p) });
        if (!active) return;
        if (!("proposalId" in preview)) throw new Error(preview.message);
        setReview({ proposal, preview });
        if (command.type === "record_client_response") {
          const project = ws.projects.find(p => p.id === command.projectId);
          const received = project?.receipts.filter(l => l.actual).reduce((sum, l) => sum + l.actual!.amountCents, 0) ?? 0;
          try {
            const result = await evaluateClientResponse(ws, {
              id: proposal.id, projectId: command.projectId, recordedAt: proposal.createdAt, sourceId: `response-${proposal.id}`,
              kind: command.response === "countered" ? "counteroffer" : command.response === "rejected" ? "declined" : "accepted",
              terms: command.counter ? { priceCents: command.counter.totalPriceCents ?? received + command.counter.unpaid.reduce((sum, p) => sum + p.amountCents, 0), payments: command.counter.unpaid } : null,
              limits: responseLimits ?? null, refundCents: null, cancellationCostCents: null,
            }, localCalendarDate());
            if (active) {
              if ("kind" in result) setResponseResult(result);
              else setResponseError(result.message);
            }
          } catch (e) { if (active) setResponseError(e instanceof Error ? e.message : "The response can be recorded, but its financial effect is not available yet."); }
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "The change could not be checked. Your entries are kept."); }
    })();
    return () => { active = false; };
    // The user must explicitly review again after a revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, additionalCommands, responseLimits, sourceText, retry]);

  async function save() {
    if (!review || stale || review.preview.status !== "ready" || !review.preview.changes.length) return;
    setBusy(true); setError(null);
    try {
      const repo = workspaceRepo();
      const out = await commitProposal(repo, ws, review.proposal);
      const authoritative = await repo.get(ws.id) ?? out.saved;
      if (!authoritative) throw new Error("The saved plan could not be reopened. Your change is kept for retry.");
      onSaved(authoritative, out.alreadyApplied ? "This change was already saved. Nothing was added twice." : "Change saved. Your payments, actions and current figures now use the new facts.");
    } catch (e) {
      setError(e instanceof CommandError && e.code === "PROPOSAL_STALE"
        ? "Your plan changed. Review the current figures again before applying this change."
        : e instanceof Error ? e.message : "The change was not saved. Your entries are kept.");
    } finally { setBusy(false); }
  }

  const pv = review?.preview;
  return <section className="lc-review" aria-labelledby={headingId} aria-busy={!review && !error || busy} onKeyDown={e => { if (e.key === "Escape" && !busy) { e.preventDefault(); e.stopPropagation(); onBack(); } }}>
    <div className="lc-section-heading"><span className="lc-eyebrow">Review before saving</span><h4 id={headingId}>Here is what changes.</h4></div>
    {!review && !error && <p role="status">Checking the new facts against your current plan…</p>}
    {stale && <p className="notice warn" role="status">Your plan changed after this preview. These figures are no longer current.</p>}
    {error && <p className="notice warn" role="alert">{error}</p>}
    {pv && <>
      <div className="lc-change-list">{pv.changes.map((change, i) => <div className="lc-change" key={`${change.path}-${i}`}>
        <h5>{humanizeDates(change.label)}</h5><div><span>Before</span><p>{change.before ? humanizeDates(change.before) : "Not recorded"}</p></div>
        <div><span>After</span><p>{humanizeDates(change.after)}</p></div>
      </div>)}</div>
      {command.type !== "record_client_response" && pv.after?.cashDeltaCents !== null && pv.after?.cashDeltaCents !== undefined && !stale && <div className="lc-impact">
        <span>Change in spendable cash after tax settlement</span><strong>{signedMoney(pv.after.cashDeltaCents)}</strong><p>{pv.after.baselineLabel}</p>
      </div>}
      {command.type !== "record_client_response" && <div className="lc-year-list">{pv.years.filter(y => y.before || y.after).map(y => <div key={y.year}>
        <strong>{y.year} health-insurance credit</strong><span>{y.before ? money(y.before.subsidyCents) : "Not calculated"} <span aria-label="changes to">→</span> {y.after ? money(y.after.subsidyCents) : "Not calculated"}</span>
        <small>Tax settlement: {y.before ? settlement(y.before.settlementCents) : "not calculated"} → {y.after ? settlement(y.after.settlementCents) : "not calculated"}</small>
      </div>)}</div>}
      {command.type === "record_client_response" && !stale && <div className="lc-response-results">
        {responseError && <p className="notice warn">{responseError}</p>}
        {!responseResult && !responseError && <p role="status">Checking the client’s terms against the offer and your plan…</p>}
        {responseResult?.results.map((result, i) => <div className={i === 0 ? "lc-impact" : "lc-result-row"} key={`${result.metric}-${result.basis.kind}-${i}`}>
          <span>{METRIC_LABEL[result.metric]}</span><strong>{result.amountCents === null ? "Not calculated" : result.basis.kind === "none" ? money(result.amountCents) : signedMoney(result.amountCents)}</strong>
          <p>Compared with: {result.basis.label}</p>
          {result.horizon && <small>{shortDate(result.horizon.from)}–{shortDate(result.horizon.through)} · settled through {shortDate(result.horizon.settlementThrough)}</small>}
          {result.date && <small>By {shortDate(result.date)}</small>}
          {result.precision !== "exact" && <small>{result.precision.replaceAll("_", " ")}</small>}
          {result.conditions.map(c => <small key={c}>{c}</small>)}
        </div>)}
        {responseResult?.questions.length ? <div className="lc-limits"><strong>Still needed for a financial answer</strong><ul>{responseResult.questions.map(q => <li key={q.key}>{q.question} {q.reason}</li>)}</ul></div> : null}
        {responseResult?.meetsGoal === false && <p className="notice warn">This response does not meet your saved goal. You can record what the client said and look for another option.</p>}
        {responseResult?.notes.map(note => <p className="hint" key={note}>{note}</p>)}
      </div>}
      {pv.agreedChecks.filter(c => c.after && !c.after.met).map(c => <p key={c.projectId} className="notice warn">The changed terms no longer meet the saved goal for this project.</p>)}
      {pv.staleDependencies.length > 0 && <p className="hint">Saved decisions keep their history. Current options and calendar actions affected by this change need to be reviewed again.</p>}
      {pv.blockers.length > 0 && <div className="lc-limits"><strong>{pv.status === "ready" ? "Facts can be saved; these figures still need information" : "Resolve this before applying"}</strong><ul>{pv.blockers.map(b => <li key={`${b.path}-${b.reason}`}>{humanizeDates(b.reason)}</li>)}</ul></div>}
      {pv.notes.length > 0 && <details><summary>Calculation notes</summary><ul>{pv.notes.map(n => <li key={n}>{humanizeDates(n)}</li>)}</ul></details>}
      {!pv.changes.length && <p role="status">This is already in your plan. There is nothing to add.</p>}
    </>}
    <p className="hint">Nothing changes until you confirm. Proposed payments remain expected; only a recorded receipt counts as money received.</p>
    <div className="lc-actions">
      <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !pv || pv.status !== "ready" || !pv.changes.length || stale || command.type === "record_client_response" && !responseResult && !responseError}>{busy ? "Saving…" : "Confirm and save"}</button>
      {(stale || error) && <button type="button" className="btn secondary" disabled={busy} onClick={() => setRetry(n => n + 1)}>Review again</button>}
      <button type="button" className="btn ghost" disabled={busy} onClick={onBack}>Back to edit</button>
    </div>
  </section>;
}

const settlement = (cents: number) => cents === 0 ? "no adjustment" : cents > 0 ? `repay ${money(cents)}` : `receive ${money(-cents)}`;
