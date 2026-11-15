/**
 * Current actions (round 6): a projection of saved workspace facts — not an editable reminder list.
 * Recording the fact (receipt, contribution, client response) is what completes an action.
 * Dates are the user's local calendar date (YYYY-MM-DD); no invented urgency or risk score.
 */
import type { CurrentAction } from "@/domain/actions";
import { sepPosition, type HouseholdWorkspace } from "@/domain/household-workspace";
import { calendarUid } from "./deal-exports";
import { packageCurrency } from "./deal-state";
import { RETURN_DUE } from "./filing-dates";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isRemainder = (id: string, label?: string) => /-rest(-\d+)?$/.test(id) || /^Rest of\b/.test(label ?? "");

export async function currentActions(ws: HouseholdWorkspace, userDate: string): Promise<CurrentAction[]> {
  const out: CurrentAction[] = [];
  const push = (a: Omit<CurrentAction, "overdue"> & { overdue?: boolean }) => out.push({ overdue: false, ...a, title: a.title.slice(0, 300) });

  for (const p of ws.projects) {
    if (p.status === "agreed") for (const l of p.receipts) {
      if (!l.expected && !l.actual) continue;
      const remainder = isRemainder(l.id, l.label);
      const base = { kind: remainder ? "partial_remainder" as const : "expected_payment" as const, refs: { projectId: p.id, lineId: l.id },
        source: { kind: "expected_payment" as const, id: l.id }, condition: null, id: calendarUid(ws.id, p.id, l.id, "receipt") };
      if (l.actual) { push({ ...base, title: `Received ${money(l.actual.amountCents)} from “${p.title}”`, dueDate: l.expected?.date ?? l.actual.date, status: "completed", completedOn: l.actual.date }); continue; }
      if (l.cancelledAt) { push({ ...base, title: `No longer expected: ${money(l.expected!.amountCents)} from “${p.title}”`, dueDate: l.expected!.date, status: "superseded", completedOn: null }); continue; }
      const overdue = l.expected!.date < userDate;
      push({ ...base, kind: overdue ? "overdue_payment" : base.kind, overdue, status: "pending", completedOn: null, dueDate: l.expected!.date,
        title: `${overdue ? "Overdue: " : ""}Expect ${remainder ? "the remaining " : ""}${money(l.expected!.amountCents)} from “${p.title}”` });
    }
    if (p.status === "proposed") {
      const counter = (p.offerVersions ?? []).find(v => v.kind === "client_counteroffer" && v.status === "open");
      const shared = ws.dealPlanning?.packages.find(k => k.projectId === p.id && k.status === "terms_shared_by_user");
      if (counter) push({ id: `act.${ws.id}.${p.id}.counter.v${counter.version}`, kind: "open_decision", title: `Review the client's counteroffer for “${p.title}” (${money(counter.priceCents)})`,
        dueDate: null, condition: "Check the result, then record that you accept, decline or counter.", status: "pending", completedOn: null,
        refs: { projectId: p.id }, source: { kind: "offer_version", id: `${p.id}-v${counter.version}` } });
      else if (shared) push({ id: `act.${ws.id}.${p.id}.response.${shared.id}`, kind: "client_response_pending", title: `Waiting for the client's answer on “${p.title}”`,
        dueDate: null, condition: "When the client replies, record accepted, declined or their counteroffer.", status: "pending", completedOn: null,
        refs: { projectId: p.id, packageId: shared.id }, source: { kind: "agreed_package", id: shared.id } });
      else push({ id: `act.${ws.id}.${p.id}.decide`, kind: "open_decision", title: `Decide on the offer “${p.title}”`, dueDate: null,
        condition: "Check what accepting it leaves you, or find terms that meet your goal.", status: "pending", completedOn: null, refs: { projectId: p.id }, source: { kind: "workspace_fact", id: p.id } });
    }
  }

  for (const pkg of ws.dealPlanning?.packages ?? []) {
    if (pkg.status === "draft" || pkg.status === "terms_shared_by_user") {
      const fresh = await packageCurrency(ws, pkg);
      if (!fresh.current) push({ id: `act.${ws.id}.${pkg.id}.review`, kind: "review_after_change", title: "Review saved terms: your plan changed since they were calculated",
        dueDate: null, condition: fresh.reason, status: "pending", completedOn: null, refs: { projectId: pkg.projectId, packageId: pkg.id }, source: { kind: "agreed_package", id: pkg.id } });
    }
    if (pkg.status !== "client_agreed") continue;
    for (const r of pkg.reminders) {
      const action = pkg.variant.actions.find(a => a.id === r.actionId);
      if (action?.kind === "receive_payment") continue; // the payment itself is tracked from the project lines
      push({ id: r.uid, kind: "package_reminder", title: r.title, dueDate: r.date, condition: r.date ? null : r.condition,
        status: r.status === "open" ? "pending" : r.status === "done" ? "completed" : "superseded", completedOn: null,
        overdue: r.status === "open" && !!r.date && r.date < userDate, refs: { projectId: pkg.projectId, packageId: pkg.id }, source: { kind: "agreed_package", id: pkg.id } });
    }
  }

  for (const year of [2026, 2027] as const) for (const person of ws.household.people) {
    const s = sepPosition(ws, person.id, year);
    if (s.targetCents === null || s.targetCents === 0) continue;
    const last = ws.retirement.contributions.filter(c => c.personId === person.id && c.taxYear === year).map(c => c.paidDate).sort().at(-1) ?? null;
    push({ id: calendarUid(ws.id, "sep", person.id, String(year)), kind: "sep_remaining", dueDate: RETURN_DUE[year], refs: { personId: person.id, year },
      source: { kind: "sep_goal", id: ws.retirement.targets.find(t => t.personId === person.id && t.year === year)!.id },
      condition: "Due by the return due date; later only with an extension (IRS Publication 560).",
      ...(s.remainingCents > 0
        ? { title: `SEP-IRA: ${money(s.remainingCents)} of the ${year} goal still to contribute${person.role === "spouse" ? " (spouse)" : ""}`, status: "pending" as const, completedOn: null }
        : { title: `SEP-IRA ${year} goal reached${person.role === "spouse" ? " (spouse)" : ""}`, status: "completed" as const, completedOn: last }) });
  }

  // Facts still estimated that the current-year result depends on.
  for (const f of ws.forecasts.filter(x => x.year === 2026)) {
    const fact = f.method === "annual_total" ? f.annualNetProfit : f.ytdNetProfit;
    if (fact.status === "confirmed") continue;
    push({ id: `act.${ws.id}.forecast.${f.personId}.2026`, kind: "unconfirmed_fact", title: `Confirm the 2026 profit figure${ws.household.people.find(p => p.id === f.personId)?.role === "spouse" ? " for your spouse" : ""}`,
      dueDate: null, condition: fact.status === "unknown" ? "Needed for the current-year result." : "It is an estimate; update it when your books show the actual figure.",
      status: "pending", completedOn: null, refs: { personId: f.personId, year: 2026 }, source: { kind: "workspace_fact", id: `forecast-${f.personId}-2026` } });
  }
  if (ws.household.years[0].benchmarkStatus !== "marketplace_confirmed") push({ id: `act.${ws.id}.benchmark.2026`, kind: "unconfirmed_fact", title: "Check the 2026 benchmark premium on your Marketplace notice",
    dueDate: null, condition: "The current figure is not from your own notice.", status: "pending", completedOn: null, refs: { year: 2026 }, source: { kind: "workspace_fact", id: "benchmark-2026" } });

  const rank = { pending: 0, completed: 1, superseded: 2 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id));
}
