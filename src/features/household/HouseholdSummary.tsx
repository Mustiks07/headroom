"use client";

import { Pencil } from "lucide-react";
import type { MoneyFact } from "@/domain/contracts";
import { money } from "@/features/format";
import { WAGE_FIELDS, adults, personName, stateName, type Draft } from "./draft";

const FILING = { single: "Single", mfj: "Married filing jointly", other: "Other filing status" } as const;

function factText(f: MoneyFact) {
  if (f.status === "unknown") return f.range ? `Unknown (${money(f.range.lowCents)}–${money(f.range.highCents)})` : "Unknown";
  return `${money(f.valueCents)}${f.status === "estimated" ? " est." : ""}`;
}

/** Compact, always-visible recap of the inputs (not results). */
export function HouseholdSummary({ draft, onEdit }: { draft: Draft; onEdit: () => void }) {
  const y = draft.years[0];
  const month = y.coverage[0];
  const constant = y.coverage.every(m => m.enrollmentPremium.valueCents === month.enrollmentPremium.valueCents && m.advancePtc.valueCents === month.advancePtc.valueCents);
  const unknownCount = draft.years[0].incomes.reduce((n, row) => n + Object.values(row).filter(v => typeof v === "object" && v && (v as MoneyFact).status === "unknown").length, 0)
    + [month.enrollmentPremium, month.benchmarkPremium, month.advancePtc].filter(f => f.status === "unknown").length;

  return <details className="summary-card" open>
    <summary><span className="eyebrow">Household summary</span></summary>
    <dl className="summary-list">
      <div><dt>Where</dt><dd>{stateName(draft.state)}</dd></div>
      <div><dt>Filing</dt><dd>{draft.filingStatus ? FILING[draft.filingStatus] : "Not set"}</dd></div>
      <div><dt>People</dt><dd>{draft.people.map(p => `${personName(draft, p.id)}${p.ageAt2026Start !== null ? ` (${p.ageAt2026Start})` : ""}`).join(", ")}</dd></div>
      <div><dt>Covered</dt><dd>{y.coveredPersonIds.length} of {draft.people.length}</dd></div>
      {adults(draft).map(p => {
        const row = y.incomes.find(r => r.personId === p.id);
        if (!row) return null;
        const noWages = WAGE_FIELDS.every(k => row[k].status === "confirmed" && row[k].valueCents === 0);
        return <div key={p.id}><dt>{personName(draft, p.id)} · 2026</dt>
          <dd>Profit {factText(row.scheduleCProfit)}{noWages ? "" : ` · Wages ${factText(row.w2Box1)}`}</dd></div>;
      })}
      <div><dt>Premium</dt><dd>{constant ? `${factText(month.enrollmentPremium)}/mo` : "Varies by month"}</dd></div>
      {draft.ui.projectStarted && <div><dt>Project</dt><dd>{draft.opportunity.title} · {money(draft.opportunity.grossRevenueCents)}</dd></div>}
    </dl>
    {unknownCount > 0 && <p className="hint">{unknownCount} 2026 figure{unknownCount === 1 ? " is" : "s are"} still unknown. That&apos;s fine if they don&apos;t matter — the check will tell you if one does.</p>}
    <button type="button" className="link-btn" onClick={onEdit}><Pencil size={13} /> Edit household</button>
  </details>;
}
