import { effectiveLine, remainingSepCash, sepPosition, type HouseholdWorkspace, type WorkspaceEvaluationResult } from "@/domain/household-workspace";
import { humanizeDates, money, shortDate } from "@/features/format";

export interface AttentionItem {
  id: string;
  tone: "due" | "decide" | "warn" | "done";
  title: string;
  detail: string;
  /** What the button does on the plan page. */
  action?: { kind: "record_payment" | "compare" | "sep" | "review_income" | "packages"; projectId?: string; label: string };
}

/**
 * What needs attention next — built only from saved facts and the engine's evaluation of the plan
 * as agreed. No new amounts are calculated here; dates are compared with today for wording only.
 */
export function attentionItems(ws: HouseholdWorkspace, evaluation: WorkspaceEvaluationResult | undefined, today = new Date().toISOString().slice(0, 10)): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Agreed payments that are due (or overdue) without a recorded actual.
  const open = ws.projects.filter(p => p.status === "agreed").flatMap(p => p.receipts.map(l => ({ p, l, e: effectiveLine(l) })))
    .filter(x => x.e.basis === "expected" && x.e.date).sort((a, b) => a.e.date!.localeCompare(b.e.date!));
  for (const x of open.filter(x => x.e.date! <= today)) items.push({ id: `due-${x.l.id}`, tone: "due",
    title: `Did ${money(x.e.amountCents)} from “${x.p.title}” arrive?`, detail: `It was expected ${shortDate(x.e.date)}. Record the actual amount and date, or correct the expectation.`,
    action: { kind: "record_payment", projectId: x.p.id, label: "Record it" } });
  const upcoming = open.find(x => x.e.date! > today);
  if (upcoming) items.push({ id: `next-${upcoming.l.id}`, tone: "due", title: `Expect ${money(upcoming.e.amountCents)} from “${upcoming.p.title}”`,
    detail: `Due ${shortDate(upcoming.e.date)}. When it arrives, record the actual amount and date.`, action: { kind: "record_payment", projectId: upcoming.p.id, label: "Go to payment" } });

  // The plan as agreed no longer works on today's figures.
  if (evaluation?.status === "ready") {
    if (evaluation.agreed.creditLostYears.length) items.push({ id: "credit-lost", tone: "warn", title: `Your plan as agreed loses the ${evaluation.agreed.creditLostYears.join(" and ")} premium tax credit`,
      detail: "Review payments that haven't happened yet, or check whether your income forecast is still right.", action: { kind: "review_income", label: "Review income" } });
    const risk = evaluation.projection.currentRisk;
    if (risk && risk.state === "over_cliff" && !evaluation.agreed.creditLostYears.includes(risk.year)) items.push({ id: "over-limit", tone: "warn",
      title: `Your ${risk.year} forecast is above the subsidy limit`, detail: `Income for the subsidy ${money(risk.forecastMagiCents)} is over the ${money(risk.thresholdMagiCents)} limit, so the ${risk.year} premium tax credit ends. Check the forecast, or look for terms on payments that haven't happened yet.`,
      action: { kind: "review_income", label: "Review income" } });
    else if (risk && risk.state === "at_risk") items.push({ id: "near-limit", tone: "warn", title: `Your ${risk.year} forecast is close to the subsidy limit`,
      detail: risk.additionalProfitHeadroomCents !== null ? `About ${money(risk.additionalProfitHeadroomCents)} more profit would end the credit. Check new offers before agreeing.` : "Check new offers before agreeing." });
    if (!evaluation.agreed.stillFeasible) items.push({ id: "infeasible", tone: "warn", title: "Part of your plan as agreed doesn't fit any more",
      detail: evaluation.agreed.reasons.map(humanizeDates).join(" ") });
  }

  // SEP-IRA still to contribute, and whether the set-aside cash covers it.
  const cash = remainingSepCash(ws);
  for (const t of ws.retirement.targets) {
    const pos = sepPosition(ws, t.personId, t.year);
    if (pos.remainingCents <= 0) continue;
    items.push({ id: `sep-${t.personId}-${t.year}`, tone: cash !== null && cash < pos.remainingCents ? "warn" : "due",
      title: `Contribute ${money(pos.remainingCents)} more to the ${t.year} SEP-IRA`,
      detail: `Goal ${money(t.targetCents)}, contributed ${money(pos.paidCents)}.${cash === null ? " No set-aside cash amount is entered." : cash < pos.remainingCents ? ` Cash set aside for it: ${money(cash)} — less than what's left.` : ""} Deadline: your ${t.year} tax return due date (with extensions).`,
      action: { kind: "sep", label: "Record a contribution" } });
  }

  // Open, dated actions from chosen terms (not yet marked done by the user).
  for (const pkg of (ws.dealPlanning?.packages ?? []).filter(p => p.status !== "superseded")) {
    const title = ws.projects.find(p => p.id === pkg.projectId)?.title ?? "a project";
    if (pkg.status === "draft") items.push({ id: `share-${pkg.id}`, tone: "decide", title: `Send the chosen terms for “${title}” to the client`,
      detail: "Headroom doesn't send anything. When you've sent them, mark it in Chosen terms.", action: { kind: "packages", label: "Open chosen terms" } });
    // Payments to receive are already listed from the project's own lines (and disappear once recorded).
    const kindOf = (r: { actionId: string }) => pkg.variant.actions.find(a => a.id === r.actionId)?.kind;
    // SEP contributions are already listed from the retirement goal above; sending terms from the draft item.
    const covered = (r: { actionId: string }) => { const k = kindOf(r); return k === "receive_payment" || (k === "sep_contribution" && ws.retirement.targets.length > 0) || (k === "send_terms" && pkg.status === "draft"); };
    for (const r of pkg.reminders.filter(r => r.status === "open" && r.date && r.date <= addDays(today, 14) && !covered(r)).slice(0, 2))
      items.push({ id: `rem-${r.uid}`, tone: "due", title: humanizeDates(r.title), detail: `By ${shortDate(r.date)} · from the terms for “${title}”.`, action: { kind: "packages", label: "Open chosen terms" } });
  }

  // Offers waiting for a decision.
  for (const p of ws.projects.filter(p => p.status === "proposed")) items.push({ id: `decide-${p.id}`, tone: "decide", title: `Decide on “${p.title}”`,
    detail: "See which terms fit your goal before you answer the client.", action: { kind: "compare", projectId: p.id, label: "Find terms" } });

  // Earlier marks that still need real amounts/dates.
  if (ws.origin.kind === "migrated_v1" && ws.origin.unconfirmed.length) items.push({ id: "unconfirmed", tone: "warn",
    title: `${ws.origin.unconfirmed.length} earlier mark${ws.origin.unconfirmed.length > 1 ? "s" : ""} to confirm`, detail: "Record actual amounts and dates; old “done” ticks aren't treated as payments." });

  // What was recently done (recorded facts), so progress is visible.
  const done = [...ws.events].filter(e => e.kind === "payment_recorded" || e.kind === "sep_contribution_recorded").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
  for (const e of done) items.push({ id: `done-${e.id}`, tone: "done", title: "Done", detail: humanizeDates(e.description) });
  // One entry per thing: the same id or the same open title is shown once.
  const seen = new Set<string>();
  return items.filter(i => { const key = i.tone === "done" ? i.id : i.title.toLowerCase(); if (seen.has(i.id) || seen.has(key)) return false; seen.add(i.id); seen.add(key); return true; });
}

function addDays(iso: string, n: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
