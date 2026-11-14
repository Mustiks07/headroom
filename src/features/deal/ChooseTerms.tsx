"use client";

import type { DealVariant, ReadyDealSearch } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { humanizeDates, money, shortDate, signedMoney } from "@/features/format";

/**
 * Chosen terms → action package. Choosing here is not the client's agreement; the package (client
 * draft, calendar, PDF) comes from Claude 3's hooks and is wired when they are exported.
 */
export function ChooseTerms({ ws, projectId, variant, result, onCancel }: {
  ws: HouseholdWorkspace; projectId: string; variant: DealVariant; result: ReadyDealSearch; onCancel: () => void;
}) {
  const project = ws.projects.find(p => p.id === projectId);
  return <section id="choose-terms" className="plan-section changed" aria-labelledby="choose-title">
    <h2 id="choose-title" className="section-title small">Your chosen terms for “{project?.title}”</h2>
    <p className="small"><strong>{humanizeDates(variant.label)}</strong> — ask {money(variant.terms.priceCents)}; {variant.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join(", ")}.
      {" "}{signedMoney(variant.twoYearCashDeltaCents)} cash after both tax years vs. {result.baseline.label.toLowerCase()}.</p>
    <p className="hint">Nothing is sent to your client, and choosing terms here isn&apos;t the client&apos;s agreement.</p>
    <button type="button" className="btn ghost small" onClick={onCancel}>Back to the options</button>
  </section>;
}
