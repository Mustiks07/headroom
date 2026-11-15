import "server-only";
import { z } from "zod";
import { CashContextSchema, dealSearchFingerprint, DealGoalSchema, DealTermsSpaceSchema, DealVariantSchema, type CashContext, type DealGoal, type DealVariant } from "@/domain/deal-planning";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import type { DecisionRecord } from "@/domain/assistance";
import { engineWorkspaceFingerprint, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { HttpError } from "../http";
import { money, type Block, type ReportModel } from "./report-model";

export const RecordExportBodySchema = z.object({ workspace: z.unknown(), recordId: z.string().min(1).max(120) });

export interface LoadedRecord {
  ws: HouseholdWorkspace; record: DecisionRecord; snapshot: HouseholdWorkspace; goal: DealGoal; variant: DealVariant; cash: CashContext | null;
  /** verified = same engine/rules and the fingerprint recomputed from the record's own snapshot matches; archived = older engine/rules, shown as recorded. */
  integrity: "verified" | "archived";
}

/** Validate the stored record against its own decision-time snapshot (never against today's facts). */
export async function loadDecisionRecord(raw: unknown, recordId: string): Promise<LoadedRecord> {
  let ws: HouseholdWorkspace;
  try { ws = validateWorkspace(raw); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
  const record = ws.dealPlanning?.decisionRecords?.find(r => r.id === recordId);
  if (!record) throw new HttpError(404, "RECORD_NOT_FOUND", "This decision record is not in the plan.");
  const snapshot = HouseholdWorkspaceSchema.safeParse(record.workspaceSnapshot);
  const goal = DealGoalSchema.safeParse(record.goal), space = DealTermsSpaceSchema.safeParse(record.termSpace), variant = DealVariantSchema.safeParse(record.variant);
  const cash = record.cashContext === null ? { success: true as const, data: null } : CashContextSchema.safeParse(record.cashContext);
  if (!snapshot.success || !goal.success || !space.success || !variant.success || !cash.success) {
    throw new HttpError(409, "RECORD_INTEGRITY", "This decision record is damaged and can't be exported.");
  }
  let integrity: LoadedRecord["integrity"] = "archived";
  if (record.engineVersion === ENGINE_VERSION && record.rulesVersion === RULES_VERSION) {
    const fp = await dealSearchFingerprint(await engineWorkspaceFingerprint(snapshot.data), goal.data, space.data, cash.data, ENGINE_VERSION, RULES_VERSION);
    if (fp !== record.searchFingerprint) throw new HttpError(409, "RECORD_INTEGRITY", "This decision record doesn't match its own saved inputs and can't be exported.");
    integrity = "verified";
  }
  return { ws, record, snapshot: snapshot.data, goal: goal.data, variant: variant.data, cash: cash.data, integrity };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "-" : ""}${money(Math.abs(c))}`;

/** Historical decision PDF: what was decided, with the figures as calculated THEN, plus facts recorded since. */
export function buildDecisionRecordModel({ ws, record, snapshot, goal, variant, integrity }: LoadedRecord, generatedAt: Date): ReportModel {
  const project = snapshot.projects.find(p => p.id === record.projectId);
  const title = project?.title ?? record.projectId;
  const blocks: Block[] = [];
  blocks.push({ type: "paragraph", tone: "notice", text:
    `Decision recorded on ${day(record.recordedAt)}; figures as of plan revision ${record.workspaceRevision} (calculation ${record.searchFingerprint.slice(0, 12)}, ${record.engineVersion} / ${record.rulesVersion}). ` +
    "This is the record of what was decided then, not a fresh recommendation. Your current plan may show different figures. " +
    (integrity === "verified" ? "The record was checked against its own saved inputs." : "It was calculated with an earlier version of Headroom's rules and is shown exactly as recorded.") +
    (snapshot.household.isSynthetic ? " SYNTHETIC example household." : "") });
  blocks.push({ type: "keyValues", rows: [
    ["Household / project", `${snapshot.household.title} / ${title}`],
    ["Recorded status", record.status === "client_agreed" ? "You recorded that the client agreed" : "You recorded that you shared these terms"],
    ["Export generated", `${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Calculation fingerprint (at decision)", record.searchFingerprint],
  ] });
  blocks.push({ type: "heading", text: "The goal at the time" });
  blocks.push({ type: "keyValues", rows: [
    ["Keep at least this much more spendable cash (2026 + 2027, after settlement)", money(goal.minimumTwoYearCashDeltaCents)],
    ["Most extra SEP-IRA contribution allowed", goal.maxAdditionalSepCents === null ? "Limited by SEP cash and law" : money(goal.maxAdditionalSepCents)],
    ...goal.dateTargets.map(t => [`By ${t.byDate} (${t.kind.replace(/_/g, " ")})`, `at least ${money(t.minimumCents)}`] as [string, string]),
  ] });
  blocks.push({ type: "heading", text: "Terms decided" });
  const receivedThen = (project?.receipts ?? []).filter(l => l.actual);
  blocks.push({ type: "table", columns: [{ title: "Item", width: 0.5 }, { title: "Date", width: 0.2 }, { title: "Amount", width: 0.3, align: "right" }], rows: [
    ["Total price", "-", money(variant.terms.priceCents)],
    ...receivedThen.map(l => [`Already received then: ${l.label ?? "payment"}`, l.actual!.date, money(l.actual!.amountCents)]),
    ...variant.terms.payments.map((p, i) => [`Payment ${i + 1}`, p.date, money(p.amountCents)]),
    ...(variant.terms.additionalSep ? [[`Additional SEP-IRA for ${variant.terms.additionalSep.year}`, "-", money(variant.terms.additionalSep.amountCents)]] : []),
  ] });
  const ctx = record.decisionContext;
  if (ctx) {
    blocks.push({ type: "heading", text: "Original offer and what was compared" });
    const offer = ctx.originalOffer;
    blocks.push({ type: "keyValues", rows: [
      ["Client's original offer", offer ? `${money(offer.priceCents)}: ${offer.payments.map(p => `${money(p.amountCents)}${p.date ? ` on ${p.date}` : " (date unknown)"}`).join(", ")}` : "Not recorded"],
      ["Offer source", offer ? `${offer.source.kind.replace(/_/g, " ")}${offer.confirmation === "captured" ? " (read from the saved project, not re-confirmed)" : " (confirmed by you)"}` : "-"],
      ["Baseline of the comparison", ctx.baseline.label],
      ["Horizon", `${ctx.horizon.from} to ${ctx.horizon.through}; tax settlement through ${ctx.horizon.settlementThrough}`],
    ] });
    if (ctx.alternatives.length) blocks.push({ type: "table", columns: [{ title: "Option (then)", width: 0.46 }, { title: "Price", width: 0.16, align: "right" }, { title: "Cash vs baseline", width: 0.19, align: "right" }, { title: "vs the offer", width: 0.19, align: "right" }],
      rows: ctx.alternatives.map(a => [`${a.label}${a.chosen ? " - chosen" : ""}${a.recommended ? " - recommended" : ""}`, money(a.priceCents), signed(a.twoYearCashDeltaCents),
        a.comparisons?.versusOfferedCents == null ? "-" : signed(a.comparisons.versusOfferedCents)]) });
    if (ctx.recommendationReasons.length) blocks.push({ type: "bullets", items: ctx.recommendationReasons });
  }
  blocks.push({ type: "heading", text: "Figures as calculated then" });
  blocks.push({ type: "keyValues", rows: [
    [`Change in spendable cash after both tax years (vs. ${goal.baseline === "accept_as_offered" ? "accepting the offer as it stood" : "the plan without the unpaid terms"})`, signed(variant.twoYearCashDeltaCents)],
    ["Added to retirement (separate; not spendable cash)", money(variant.retirementAddedCents)],
    ...variant.aca.map(a => [`${a.year}: income for the subsidy / premium tax credit`, `${money(a.magiCents)} / ${money(a.ptcCents)}${a.creditLost ? " (credit lost)" : ""}`] as [string, string]),
  ] });
  blocks.push({ type: "table", columns: [{ title: "Date", width: 0.18 }, { title: "Money by date (then)", width: 0.52 }, { title: "Amount", width: 0.3, align: "right" }],
    rows: variant.datedFlows.length ? [...variant.datedFlows].sort((a, b) => a.date.localeCompare(b.date)).map(f => [f.date, `${f.label} (${f.basis})`, signed(f.amountCents)]) : [["-", "No dated flows", "-"]] });

  // Facts recorded AFTER the decision for this project (not recalculated here).
  const now = ws.projects.find(p => p.id === record.projectId);
  const isRest = (id: string) => /-rest(-\d+)?$/.test(id);
  const fromTerms = (id: string) => !isRest(id) && variant.terms.payments.some(p => id.includes(p.id));
  const since = (now?.receipts ?? []).filter(l => l.actual && !receivedThen.some(t => t.id === l.id));
  const moved = (now?.receipts ?? []).filter(l => !l.actual && !l.cancelledAt && l.expected && fromTerms(l.id) &&
    !variant.terms.payments.some(p => l.id.includes(p.id) && p.date === l.expected!.date && p.amountCents === l.expected!.amountCents));
  const added = (now?.receipts ?? []).filter(l => !l.actual && !l.cancelledAt && l.expected && !fromTerms(l.id) && !(project?.receipts ?? []).some(t => t.id === l.id));
  const dropped = (now?.receipts ?? []).filter(l => l.cancelledAt && !l.actual && l.expected && l.cancelledAt > record.recordedAt);
  const versions = (now?.offerVersions ?? []).filter(v => v.recordedAt > record.recordedAt);
  const items = [
    ...since.map(l => l.expected && l.actual!.amountCents < l.expected.amountCents
      ? `Received ${money(l.actual!.amountCents)} of the expected ${money(l.expected.amountCents)} on ${l.actual!.date}.`
      : `Received ${money(l.actual!.amountCents)} on ${l.actual!.date}${l.expected ? ` (expected ${money(l.expected.amountCents)} on ${l.expected.date})` : ""}.`),
    ...moved.map(l => `An agreed payment now expects ${money(l.expected!.amountCents)} on ${l.expected!.date}.`),
    ...added.map(l => isRest(l.id) ? `The rest of that payment, ${money(l.expected!.amountCents)}, is now expected on ${l.expected!.date}.`
      : `Now also expected: ${money(l.expected!.amountCents)} on ${l.expected!.date}${l.label ? ` (${l.label.toLowerCase()})` : ""}.`),
    ...dropped.map(l => `No longer expected: ${money(l.expected!.amountCents)} on ${l.expected!.date}.`),
    ...versions.map(v => v.kind === "client_counteroffer" ? `Client counteroffer recorded ${day(v.recordedAt)}: ${money(v.priceCents)} in total (${v.status}).`
      : v.kind === "accepted_terms" ? `Terms recorded as accepted ${day(v.recordedAt)}: ${money(v.priceCents)} in total.` : `Terms version ${v.version} recorded ${day(v.recordedAt)} (${v.status}).`),
    ...(now?.status === "cancelled" ? ["The project is now recorded as declined; money already received stays recorded."] : []),
  ];
  blocks.push({ type: "heading", text: "Recorded since the decision" });
  blocks.push({ type: "bullets", items: [
    ...(items.length ? items : ["Nothing new recorded for this project."]),
    "Open your plan in Headroom for the current figures; they are recalculated separately from this record.",
  ] });
  return { title: "Decision record", subtitle: `${title} - recorded ${day(record.recordedAt)}`, fingerprint: record.searchFingerprint, blocks };
}
