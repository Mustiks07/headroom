import type { AgreedPlanEvaluation } from "@/lib/engine";
import { money, shortDate, signedMoney } from "@/features/format";

/** Evaluate the saved amounts and dates before showing newly optimized proposals. */
export function AgreedPlanImpact({ evaluation }: { evaluation: AgreedPlanEvaluation | null | undefined }) {
  if (!evaluation) return null;
  return <section className="plan-section" aria-labelledby="agreed-impact-title">
    <h3 id="agreed-impact-title" className="small-head">Your agreed payments, checked again</h3>
    <p className="muted small">These are the amounts and dates you saved. New options below may use different arrangements.</p>
    {evaluation.status !== "ready" ? <p className="notice warn">{evaluation.message}</p> : <>
      {evaluation.agreed && <>
        <ul className="small">
          {evaluation.agreed.decisions.receipts.map((r, i) => <li key={i}>Receive {money(r.amountCents)} on {shortDate(r.date)}</li>)}
          {evaluation.agreed.decisions.additionalSep.filter(s => s.amountCents > 0).map((s, i) => <li key={`sep-${i}`}>SEP-IRA for {s.year}: {money(s.amountCents)}</li>)}
        </ul>
        <p><strong>{signedMoney(evaluation.agreed.twoYearCashDeltaCents)}</strong> cash after both tax years, compared with not taking this project under the updated household forecast.</p>
      </>}
      {evaluation.creditLostYears.length > 0 && <p className="notice warn" role="status">Your agreed plan now loses the {evaluation.creditLostYears.join(" and ")} health-insurance subsidy.</p>}
      {!evaluation.stillFeasible && <p className="notice warn">The saved arrangements no longer fit: {evaluation.reasons.join(" ")}</p>}
      {evaluation.changes.length > 0 && <div className="table-wrap"><table className="years-table compact">
        <thead><tr><th scope="col">Same agreed arrangements</th><th scope="col">Saved result</th><th scope="col">Updated result</th></tr></thead>
        <tbody>{evaluation.changes.map((c, i) => <tr key={i}><th scope="row">{c.label}</th><td className="num">{money(c.previousCents)}</td><td className="num">{money(c.currentCents)}</td></tr>)}</tbody>
      </table></div>}
      {evaluation.warnings.length > 0 && <details className="explain"><summary>Conditions for the agreed plan</summary><ul className="small">{evaluation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
    </>}
  </section>;
}
