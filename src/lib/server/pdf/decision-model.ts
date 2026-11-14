import type { ActionPackage, CashContext, DealGoal, DealVariant, ReadyDealSearch } from "@/domain/deal-planning";
import { remainingSepCash, sepPosition, type HouseholdWorkspace } from "@/domain/household-workspace";
import { resolveSource } from "@/domain/sources";
import { workspaceToCaseInput } from "@/domain/household-workspace";
import { money, type Block, type ReportModel } from "./report-model";

const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "-" : ""}${money(Math.abs(c))}`;
const TARGET_KIND: Record<string, string> = {
  project_receipts: "Money received from this project (before taxes)",
  project_available_cash: "This project's contribution to money available",
  household_balance: "Household bank balance",
};
const FLOW_KIND: Record<string, string> = {
  project_receipt: "Project payment", project_expense: "Project expense", sep_contribution: "SEP-IRA contribution",
  tax_reserve: "Set aside for taxes (estimate)", tax_settlement: "Tax / credit settlement (estimate)", household_flow: "Other household flow",
};
const PURPOSE: Record<string, string> = {
  simplest: "it has the simplest terms that still meet your goal", most_cash: "it leaves the most spendable cash",
  earliest_money: "it brings money in earliest", most_retirement: "it adds the most to retirement while meeting your cash goal",
  lowest_risk: "it keeps the widest margin before the goal or the credit is missed", as_offered: "it matches the client's offer",
};
const BASIS: Record<string, string> = { fixed: "Already happened", proposed: "These terms", estimated: "Estimate" };

export interface DecisionReportInput {
  ws: HouseholdWorkspace; pkg: ActionPackage; goal: DealGoal; cash: CashContext | null;
  result: ReadyDealSearch; variant: DealVariant; generatedAt: Date;
}

/**
 * Decision package: goal, baseline, chosen terms, money by date (with completeness), cash after
 * settlement and retirement separately, SEP paid/remaining, tax/subsidy effects, actions, sources.
 * Every money figure is copied from the FRESH engine variant or recorded workspace facts.
 */
export function buildDecisionModel({ ws, pkg, goal, cash, result, variant, generatedAt }: DecisionReportInput): ReportModel {
  const project = ws.projects.find(p => p.id === pkg.projectId);
  const title = project?.title ?? pkg.projectId;
  const input = workspaceToCaseInput(ws).input;
  const src = (id: string) => resolveSource(input, id)?.label ?? id;
  const blocks: Block[] = [];

  blocks.push({ type: "paragraph", tone: "notice", text:
    "Explanation of the deal terms you chose, for discussion with your client and a tax professional. It is a planning estimate, not an official tax form or a Marketplace decision. " +
    (pkg.status === "client_agreed" ? "You recorded that the client agreed to these terms. " : "The client has NOT agreed to these terms unless you record that they did. ") +
    "Headroom has not sent anything to anyone." + (ws.household.isSynthetic ? " This package uses a SYNTHETIC example household." : "") });
  blocks.push({ type: "keyValues", rows: [
    ["Household / project", `${ws.household.title} / ${title}`],
    ["Status", { draft: "Chosen in Headroom (not yet shared)", terms_shared_by_user: "You shared these terms with the client", client_agreed: "You recorded the client's agreement", superseded: "Replaced" }[pkg.status]],
    ["Generated", `${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Plan revision", String(ws.revision)],
    ["Engine version / rules version", `${result.engineVersion} / ${result.rulesVersion}`],
    ["Calculation fingerprint", result.searchFingerprint],
  ] });

  blocks.push({ type: "heading", text: "Your goal" });
  blocks.push({ type: "keyValues", rows: [
    ["Keep at least this much more spendable cash (2026 + 2027, after final settlement)", money(goal.minimumTwoYearCashDeltaCents)],
    ["Compared with", `${result.baseline.label}. ${result.baseline.description}`],
    ["Most extra SEP-IRA contribution you allowed", goal.maxAdditionalSepCents === null ? "Limited by your SEP cash and the legal limit" : money(goal.maxAdditionalSepCents)],
    ...goal.dateTargets.map(t => [`By ${t.byDate}: ${TARGET_KIND[t.kind]}`, `at least ${money(t.minimumCents)}`] as [string, string]),
  ] });

  blocks.push({ type: "heading", text: "Chosen terms" });
  const received = (project?.receipts ?? []).filter(l => l.actual);
  blocks.push({ type: "table", columns: [{ title: "Item", width: 0.5 }, { title: "Date", width: 0.2 }, { title: "Amount", width: 0.3, align: "right" }],
    rows: [
      ["Total price asked", "-", money(variant.terms.priceCents)],
      ...received.map(l => [`Already received: ${l.label ?? "payment"} (fixed)`, l.actual!.date, money(l.actual!.amountCents)]),
      ...variant.terms.payments.map((p, i) => [`Payment ${i + 1} under these terms`, p.date, money(p.amountCents)]),
      ...(variant.terms.additionalSep ? [[`Additional SEP-IRA contribution for ${variant.terms.additionalSep.year}`, "-", money(variant.terms.additionalSep.amountCents)]] : []),
    ] });
  blocks.push({ type: "paragraph", tone: "muted", text: `Option: ${variant.label}. Shown because ${PURPOSE[variant.purpose]}${variant.differenceFromBestCents ? `; ${money(Math.abs(variant.differenceFromBestCents))} less cash than the best option shown, in exchange for simpler terms` : ""}.` });

  blocks.push({ type: "heading", text: "Result after both tax years" });
  blocks.push({ type: "keyValues", rows: [
    [`Change in spendable cash vs. "${result.baseline.label}"`, signed(variant.twoYearCashDeltaCents)],
    ["Added to retirement (separate; not spendable cash, taxed when withdrawn)", money(variant.retirementAddedCents)],
    ["Checked with the exact year calculation", variant.verifiedExact ? "Yes" : "No"],
    ["Search space", `${result.search.note} Price step ${money(result.search.priceStepCents)}; ${result.search.evaluated} combinations evaluated; ${result.search.exhaustiveWithinSpace ? "every combination in the allowed space was checked" : "approximate search — not a proof of the best possible terms"}.`],
  ] });
  if (variant.dateTargets.length) {
    blocks.push({ type: "table", columns: [{ title: "Date goal", width: 0.4 }, { title: "Reached", width: 0.2, align: "right" }, { title: "Met", width: 0.1 }, { title: "Explanation", width: 0.3 }],
      rows: variant.dateTargets.map(t => { const g = goal.dateTargets.find(x => x.id === t.targetId);
        return [g ? `${TARGET_KIND[g.kind]} by ${g.byDate}` : t.targetId, t.achievedCents === null ? "Not assessed" : money(t.achievedCents), t.met === null ? "-" : t.met ? "Yes" : "No", t.explanation]; }) });
  }

  blocks.push({ type: "heading", text: "Money by date" });
  blocks.push({ type: "paragraph", text: result.cashCompleteness === "household_complete"
    ? `Household cash: complete from ${cash?.completeness.from} through ${cash?.completeness.through}, starting from a balance of ${cash?.snapshot ? money(cash.snapshot.balanceCents) : "-"} on ${cash?.snapshot?.date}; ${money(cash?.reserveCents ?? 0)} reserve kept untouched.`
    : result.cashCompleteness === "household_incomplete"
      ? "Your household cash picture is incomplete, so no household balance is promised. Only this project's money is shown."
      : "Only this project's money is shown; your household bank balance was not assessed." });
  blocks.push({ type: "table", columns: [{ title: "Date", width: 0.15 }, { title: "What", width: 0.4 }, { title: "Basis", width: 0.2 }, { title: "Amount", width: 0.25, align: "right" }],
    rows: variant.datedFlows.length ? [...variant.datedFlows].sort((a, b) => a.date.localeCompare(b.date)).map(f => [f.date, f.label || FLOW_KIND[f.kind], BASIS[f.basis], signed(f.amountCents)]) : [["-", "No dated flows", "-", "-"]] });
  blocks.push({ type: "paragraph", tone: "muted", text: "Dated amounts are a cash schedule, not legally computed quarterly estimated tax payments. Settlement amounts are estimates for when the returns are filed." });

  blocks.push({ type: "heading", text: "Health-insurance credit and taxes by year" });
  blocks.push({ type: "table", columns: [{ title: "Year", width: 0.15 }, { title: "Income for the subsidy (ACA MAGI)", width: 0.35, align: "right" }, { title: "Premium tax credit", width: 0.3, align: "right" }, { title: "Credit lost?", width: 0.2 }],
    rows: variant.aca.map(a => [String(a.year), money(a.magiCents), money(a.ptcCents), a.creditLost ? "Yes" : "No"]) });

  const sepRows = ws.household.people.flatMap(p => ([2026, 2027] as const).map(y => ({ p, y, s: sepPosition(ws, p.id, y) }))).filter(r => r.s.targetCents !== null || r.s.paidCents);
  blocks.push({ type: "heading", text: "SEP-IRA contributions" });
  blocks.push({ type: "table", columns: [{ title: "Owner / year", width: 0.3 }, { title: "Goal", width: 0.23, align: "right" }, { title: "Paid", width: 0.23, align: "right" }, { title: "Remaining", width: 0.24, align: "right" }],
    rows: sepRows.length ? sepRows.map(r => [`${r.p.role === "primary" ? "You" : r.p.role} ${r.y}`, r.s.targetCents === null ? "No goal" : money(r.s.targetCents), money(r.s.paidCents), money(r.s.remainingCents)]) : [["No SEP goals", "-", "-", "-"]] });
  const sepCash = remainingSepCash(ws);
  if (variant.terms.additionalSep) blocks.push({ type: "paragraph", text: `These terms add ${money(variant.terms.additionalSep.amountCents)} to the ${variant.terms.additionalSep.year} SEP-IRA goal. It is not paid yet; record the contribution when you make it.` });
  blocks.push({ type: "paragraph", tone: "muted", text: `Money you set aside for future SEP contributions, after payments since your snapshot: ${sepCash === null ? "not entered" : money(sepCash)}. Retirement money is not spendable cash.` });

  blocks.push({ type: "heading", text: "Constraints checked" });
  blocks.push({ type: "table", columns: [{ title: "Constraint", width: 0.3 }, { title: "Met", width: 0.1 }, { title: "Detail", width: 0.6 }],
    rows: variant.constraints.length ? variant.constraints.map(c => [`${c.id.charAt(0).toUpperCase()}${c.id.slice(1).replace(/_/g, " ")}`, c.satisfied ? "Yes" : "No", c.detail]) : [["-", "-", "No constraints reported"]] });

  blocks.push({ type: "heading", text: "Next actions" });
  blocks.push({ type: "table", columns: [{ title: "Action", width: 0.5 }, { title: "When", width: 0.3 }, { title: "Status", width: 0.2 }],
    rows: pkg.reminders.length ? pkg.reminders.map(r => [r.title, r.date ?? r.condition ?? "-", r.status]) : [["No new actions", "-", "-"]] });

  if (pkg.clientDraft) {
    blocks.push({ type: "heading", text: "Draft message to your client (not sent)" });
    blocks.push({ type: "paragraph", text: `Subject: ${pkg.clientDraft.subject}` });
    for (const para of pkg.clientDraft.body.split("\n")) if (para.trim()) blocks.push({ type: "paragraph", text: para });
  }

  const ids = [...new Set(variant.actions.flatMap(a => a.sourceIds))];
  blocks.push({ type: "heading", text: "Sources and warnings" });
  blocks.push({ type: "bullets", items: [...ids.map(id => `[${id}] ${src(id)}`), ...result.warnings].length ? [...ids.map(id => `[${id}] ${src(id)}`), ...result.warnings] : ["No additional sources."] });

  return { title: "Decision package", subtitle: `${title} - ${ws.household.title}`, fingerprint: result.searchFingerprint, blocks };
}
