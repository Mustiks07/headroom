import type { CaseInput } from "@/domain/contracts";
import { demoCases } from "@/fixtures/cases";
import { money } from "@/features/format";
import { stateName } from "@/features/household/draft";

const KICKERS: Record<string, { kicker: string; question: string }> = {
  "family-cliff": { kicker: "Family near the subsidy limit", question: "Should they take the project — and how should it be paid?" },
  "ordinary-gig": { kicker: "An ordinary profitable project", question: "No cliff in sight. Does anything special need to happen?" },
  "missing-spouse-income": { kicker: "Spouse income unknown", question: "What exactly is missing, and does it change the answer?" },
};

/** Describes a sample from its INPUT facts only (never from results). */
export function describeSample(input: CaseInput) {
  const meta = KICKERS[input.id] ?? { kicker: input.title, question: "" };
  const kids = input.people.filter(p => p.role === "dependent").length;
  const who = input.filingStatus === "mfj" ? `Married couple${kids ? ` with ${kids === 1 ? "one child" : `${kids} children`}` : ""}` : `Single${kids ? ` parent` : " freelancer"}`;
  const profit = input.years[0].incomes.find(r => r.personId === input.opportunity.ownerPersonId)?.scheduleCProfit.valueCents ?? null;
  const facts = [`${who} in ${stateName(input.state)}`, profit !== null ? `${money(profit)} business profit forecast` : null,
    `${money(input.opportunity.grossRevenueCents)} project offer`].filter(Boolean) as string[];
  return { ...meta, title: input.title, facts };
}

export const samples = demoCases.map(c => ({ id: c.id, ...describeSample(c) }));
