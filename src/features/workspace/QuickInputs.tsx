"use client";

import type { MoneyFact } from "@/domain/contracts";
import { MoneyField } from "@/components/MoneyField";
import { MANUAL_SOURCE_ID, personName, type Draft } from "@/features/household/draft";
import { DateField } from "@/features/household/projectEditors";
import type { ProblemAt, Update } from "@/features/household/editors";

const plain = (cents: number): MoneyFact => ({ valueCents: cents, status: "confirmed", sourceId: MANUAL_SOURCE_ID });

/**
 * The handful of figures that move a sample result the most. Each one edits
 * the same draft as the full form; the result recalculates automatically.
 */
export function QuickInputs({ draft, update, problemAt }: { draft: Draft; update: Update; problemAt: ProblemAt }) {
  const o = draft.opportunity;
  const c = draft.constraints;
  const ownerRow = draft.years[0].incomes.findIndex(r => r.personId === o.ownerPersonId);
  const profitPath = `years.0.incomes.${ownerRow}.scheduleCProfit`;
  return <div className="quick">
    <p className="eyebrow">Try changing</p>
    <MoneyField plain required path="opportunity.grossRevenueCents" label="Project price" fact={plain(o.grossRevenueCents)} evidence={draft.evidence}
      problem={problemAt("opportunity.grossRevenueCents")} onChange={f => update(d => { d.opportunity.grossRevenueCents = f.valueCents ?? 0; })} />
    <DateField path="opportunity.plannedReceiptDate" label="Payment arrives" value={o.plannedReceiptDate} problem={problemAt("opportunity.plannedReceiptDate")}
      onChange={v => update(d => { d.opportunity.plannedReceiptDate = v; })} />
    {ownerRow >= 0 && <MoneyField path={profitPath} label={`${personName(draft, o.ownerPersonId) === "You" ? "Your" : "Owner's"} 2026 business profit without the project`}
      fact={draft.years[0].incomes[ownerRow].scheduleCProfit} evidence={draft.evidence} problem={problemAt(profitPath)}
      onChange={f => update(d => { d.years[0].incomes[ownerRow].scheduleCProfit = f; })} />}
    <MoneyField plain required path="constraints.maxAdditionalSepCents" label="Most I can put into retirement" fact={plain(c.maxAdditionalSepCents)} evidence={draft.evidence}
      problem={problemAt("constraints.maxAdditionalSepCents")} onChange={f => update(d => { d.constraints.maxAdditionalSepCents = f.valueCents ?? 0; })} />
    <label className="switch small"><input type="checkbox" checked={c.canSplitPayment} onChange={e => update(d => { d.constraints.canSplitPayment = e.target.checked; })} />
      <span>Client can pay part in 2027</span></label>
    {c.canSplitPayment && <DateField path="constraints.nextYearPaymentLatestDate" label="Latest date for the 2027 part" nullable value={c.nextYearPaymentLatestDate}
      problem={problemAt("constraints.nextYearPaymentLatestDate")} onChange={v => update(d => { d.constraints.nextYearPaymentLatestDate = v || null; })} />}
    <label className="switch small"><input type="checkbox" checked={c.canRenegotiatePrice} onChange={e => update(d => { d.constraints.canRenegotiatePrice = e.target.checked; })} />
      <span>I can negotiate the price</span></label>
  </div>;
}
