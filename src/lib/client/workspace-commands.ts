import type { ChangeCommand, ChangeProposal } from "@/domain/assistance";
import { emptyDealPlanning } from "@/domain/deal-planning";
import {
  captureSepBudgetContributions, HouseholdWorkspaceSchema, withEvent, type HouseholdWorkspace, type Project, type ProjectLine, type WorkspaceEvent,
} from "@/domain/household-workspace";
import type { OriginalOffer } from "@/domain/decision-context";
import { engineWorkspaceFingerprint } from "@/lib/engine";
import { HeadroomError } from "./errors";

/**
 * The single implementation of typed workspace commands (round 5). Used for confirmed proposals
 * from text (pattern or AI) and available for manual forms, so both paths apply changes the same
 * way. Pure: returns a new workspace; the caller saves it with commitWorkspaceChange.
 */

export class CommandError extends HeadroomError {
  constructor(code: string, message: string) { super(code, message, 409); this.name = "CommandError"; }
}

const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addEvidence(ws: HouseholdWorkspace, id: string, label: string): string {
  if (!ws.evidence.some(e => e.id === id)) ws.evidence.push({ id, kind: "manual", label: label.slice(0, 200) });
  return id;
}

function line(ws: HouseholdWorkspace, projectId: string, lineId: string): { title: string; l: ProjectLine } {
  const p = ws.projects.find(x => x.id === projectId);
  const l = p && [...p.receipts, ...p.expenses].find(x => x.id === lineId);
  if (!p || !l) throw new CommandError("UNKNOWN_TARGET", "That payment is no longer in the plan.");
  return { title: p.title, l };
}

/** Apply one command to a CLONE; returns the event description and refs. Throws CommandError when not applicable. */
/**
 * The client's offer as it stands in the project lines (price incl. received + still expected).
 * Used once per project: at creation from a confirmed offer, or captured at the first agreement
 * for projects saved before round 5. Never overwritten afterwards.
 */
export function originalOfferFromLines(project: Project, at: string, source: OriginalOffer["source"], confirmation: OriginalOffer["confirmation"]): OriginalOffer | null {
  const lines = project.receipts.filter(l => !l.cancelledAt || l.actual);
  const payments = lines.map(l => l.actual ? { amountCents: l.actual.amountCents, date: l.actual.date } : l.expected ? { amountCents: l.expected.amountCents, date: l.expected.date } : null)
    .filter((x): x is { amountCents: number; date: string } => x !== null && x.amountCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  if (!payments.length) return null;
  return { priceCents: payments.reduce((t, p) => t + p.amountCents, 0), payments, source, confirmation, recordedAt: at };
}

/** Keep the first known offer of a project (no-op when it is already set). Returns true if it was set now. */
export function ensureOriginalOffer(ws: HouseholdWorkspace, projectId: string, at: string, source: OriginalOffer["source"] = { kind: "existing_project", sourceId: null },
  confirmation: OriginalOffer["confirmation"] = "captured", from?: Project): boolean {
  const project = ws.projects.find(p => p.id === projectId);
  if (!project || project.originalOffer) return false;
  const offer = originalOfferFromLines(from ?? project, at, source, confirmation);
  if (!offer) return false;
  project.originalOffer = offer;
  return true;
}

export function applyCommand(ws: HouseholdWorkspace, cmd: ChangeCommand, ctx: { idBase: string; sourceId: string; at: string; origin?: "user_entered" | "document" | "assistant_text" }): { description: string; kind: WorkspaceEvent["kind"]; refs: WorkspaceEvent["refs"] } {
  switch (cmd.type) {
    case "update_expected_payment": {
      const { title, l } = line(ws, cmd.projectId, cmd.lineId);
      if (l.actual) throw new CommandError("ALREADY_RECEIVED", "This payment was already received; correct the recorded amount instead of moving it.");
      if (l.cancelledAt || !l.expected) throw new CommandError("NOT_EXPECTED", "This payment is not expected any more.");
      const before = `${dollars(l.expected.amountCents)} on ${l.expected.date}`;
      l.expected = { amountCents: cmd.newAmountCents ?? l.expected.amountCents, date: cmd.newDate ?? l.expected.date };
      return { kind: "project_updated", refs: { projectId: cmd.projectId, lineId: cmd.lineId },
        description: `Expected payment for “${title}” changed from ${before} to ${dollars(l.expected.amountCents)} on ${l.expected.date}.` };
    }
    case "record_receipt": {
      const { title, l } = line(ws, cmd.projectId, cmd.lineId);
      if (l.actual) {
        if (l.actual.amountCents === cmd.amountCents && l.actual.date === cmd.date) throw new CommandError("ALREADY_RECORDED", "This payment is already recorded with the same amount and date.");
        throw new CommandError("ALREADY_RECEIVED", "This payment already has a recorded amount. Use a correction with a reason to change it.");
      }
      l.actual = { amountCents: cmd.amountCents, date: cmd.date, recordedAt: ctx.at, sourceId: ctx.sourceId };
      l.cancelledAt = null;
      return { kind: "payment_recorded", refs: { projectId: cmd.projectId, lineId: cmd.lineId },
        description: `Received ${dollars(cmd.amountCents)} on ${cmd.date} for “${title}”${l.expected ? ` (expected ${dollars(l.expected.amountCents)} on ${l.expected.date})` : ""}.` };
    }
    case "correct_fact": {
      if (cmd.target.kind === "payment") {
        const { title, l } = line(ws, cmd.target.projectId, cmd.target.lineId);
        if (!l.actual) throw new CommandError("NOTHING_TO_CORRECT", "There is no recorded payment to correct.");
        const prev = { amountCents: l.actual.amountCents, date: l.actual.date };
        l.corrections.push({ at: ctx.at, previousActual: prev, reason: cmd.reason });
        l.actual = { ...l.actual, amountCents: cmd.amountCents, date: cmd.date ?? l.actual.date, recordedAt: ctx.at };
        return { kind: "payment_corrected", refs: { projectId: cmd.target.projectId, lineId: cmd.target.lineId },
          description: `Corrected “${title}”: ${dollars(prev.amountCents)} on ${prev.date} → ${dollars(l.actual.amountCents)} on ${l.actual.date}. ${cmd.reason}` };
      }
      const t = cmd.target;
      const f = ws.forecasts.find(x => x.personId === t.personId && x.year === t.year);
      if (!f || !(t.field in f)) throw new CommandError("UNKNOWN_TARGET", "That forecast figure isn't used for this person and year.");
      (f as Record<string, unknown>)[t.field] = { valueCents: cmd.amountCents, status: "confirmed", sourceId: ctx.sourceId };
      return { kind: "forecast_updated", refs: {}, description: `Corrected the ${t.year} forecast figure to ${dollars(cmd.amountCents)}. ${cmd.reason}` };
    }
    case "record_sep_contribution": {
      if (!ws.household.people.some(p => p.id === cmd.personId && p.role !== "dependent")) throw new CommandError("UNKNOWN_TARGET", "Choose whose SEP-IRA this contribution is for.");
      const id = `sep-${ctx.idBase}`.slice(0, 100);
      if (ws.retirement.contributions.some(c => c.id === id)) throw new CommandError("ALREADY_RECORDED", "This contribution is already recorded.");
      captureSepBudgetContributions(ws);
      const budget = ws.retirement.futureContributionBudget;
      if (budget.asOfDate && cmd.paidDate < budget.asOfDate) budget.includedContributionIds!.push(id);
      ws.retirement.contributions.push({ id, personId: cmd.personId, taxYear: cmd.taxYear, amountCents: cmd.amountCents, paidDate: cmd.paidDate, sourceId: ctx.sourceId, recordedAt: ctx.at });
      return { kind: "sep_contribution_recorded", refs: { contributionId: id }, description: `Recorded a ${cmd.taxYear} SEP-IRA contribution of ${dollars(cmd.amountCents)} paid ${cmd.paidDate}.` };
    }
    case "update_forecast": {
      const f = ws.forecasts.find(x => x.personId === cmd.personId && x.year === cmd.year);
      if (!f || !(cmd.field in f)) throw new CommandError("METHOD_MISMATCH", "This figure doesn't match how the forecast is entered for this person and year. Switch the method in the form first.");
      (f as Record<string, unknown>)[cmd.field] = { valueCents: cmd.amountCents, status: cmd.status, sourceId: ctx.sourceId };
      if (f.method === "year_to_date_plus_remaining" && cmd.field === "ytdNetProfit") {
        if (!cmd.asOfDate) throw new CommandError("AS_OF_REQUIRED", "Say which date the year-to-date figure refers to.");
        f.asOfDate = cmd.asOfDate; f.asOfConfirmed = true;
      }
      return { kind: "forecast_updated", refs: {}, description: `Updated the ${cmd.year} forecast figure to ${dollars(cmd.amountCents)}.` };
    }
    case "add_offered_project": {
      const adults = ws.household.people.filter(p => p.role !== "dependent");
      const owner = cmd.ownerPersonId ?? (adults.length === 1 ? adults[0].id : null);
      if (!owner || !adults.some(a => a.id === owner)) throw new CommandError("OWNER_REQUIRED", "Choose whose business this project belongs to.");
      const received = cmd.received.reduce((t, r) => t + r.amountCents, 0), unpaid = cmd.unpaid.reduce((t, r) => t + r.amountCents, 0);
      if (cmd.totalPriceCents !== null && cmd.totalPriceCents !== received + unpaid) throw new CommandError("PRICE_MISMATCH", "The payments don't add up to the total price. Check the amounts.");
      if (!cmd.unpaid.length && !cmd.received.length) throw new CommandError("NO_PAYMENTS", "Add at least one payment amount and date.");
      const id = `proj-${ctx.idBase}`.slice(0, 100);
      if (ws.projects.some(p => p.id === id)) throw new CommandError("ALREADY_RECORDED", "This project was already added.");
      const mk = (prefix: string, r: { amountCents: number; date: string }, i: number, actual: boolean): ProjectLine => ({ id: `${id}-${prefix}${i + 1}`.slice(0, 100),
        label: `${prefix === "r" ? "Received" : prefix === "u" ? "Payment" : "Expense"} ${i + 1}`, expected: { amountCents: r.amountCents, date: r.date },
        actual: actual ? { amountCents: r.amountCents, date: r.date, recordedAt: ctx.at, sourceId: ctx.sourceId } : null, cancelledAt: null, sourceId: ctx.sourceId, corrections: [] });
      ws.projects.push({ id, title: cmd.title, ownerPersonId: owner, status: "proposed", createdAt: ctx.at, statusChangedAt: ctx.at,
        cashAccountingConfirmed: null, timingArrangementConfirmed: null,
        terms: { canSplitPayment: cmd.scheduleNegotiable ?? false, canRenegotiatePrice: cmd.priceNegotiable ?? false, nextYearPaymentLatestDate: null },
        receipts: [...cmd.received.map((r, i) => mk("r", r, i, true)), ...cmd.unpaid.map((r, i) => mk("u", r, i, false))],
        expenses: cmd.expenses.map((r, i) => mk("e", r, i, false)), agreedDecision: null });
      ensureOriginalOffer(ws, id, ctx.at, { kind: ctx.origin ?? "user_entered", sourceId: ctx.sourceId }, "user_confirmed");
      return { kind: "project_added", refs: { projectId: id }, description: `Added the offer “${cmd.title}” (${dollars(received + unpaid)} total).` };
    }
    case "change_goal": {
      if (!ws.projects.some(p => p.id === cmd.projectId)) throw new CommandError("UNKNOWN_TARGET", "That project is no longer in the plan.");
      ws.dealPlanning ??= emptyDealPlanning();
      const existing = ws.dealPlanning.goals.find(g => g.projectId === cmd.projectId);
      const goal = existing ?? { id: `goal-${cmd.projectId}`.slice(0, 100), projectId: cmd.projectId, minimumTwoYearCashDeltaCents: 0, baseline: "decline_unpaid_terms" as const,
        maxAdditionalSepCents: 0, dateTargets: [], createdAt: ctx.at, updatedAt: ctx.at };
      if (cmd.minimumTwoYearCashDeltaCents !== null) goal.minimumTwoYearCashDeltaCents = cmd.minimumTwoYearCashDeltaCents;
      if (cmd.maxAdditionalSepCents !== null) goal.maxAdditionalSepCents = cmd.maxAdditionalSepCents;
      if (cmd.dateTarget) goal.dateTargets = [{ id: `t-${cmd.dateTarget.byDate}`, ...cmd.dateTarget }];
      goal.updatedAt = ctx.at;
      if (!existing) ws.dealPlanning.goals.push(goal);
      return { kind: "deal_planning_updated", refs: { projectId: cmd.projectId }, description: "Updated the money goal for this project." };
    }
    case "change_terms": {
      const space = ws.dealPlanning?.termSpaces.find(t => t.projectId === cmd.projectId);
      if (!space) throw new CommandError("TERMS_REQUIRED", "Set up the allowed price and payment dates for this project in the form first.");
      if (cmd.priceMinCents !== null) space.price.minCents = cmd.priceMinCents;
      if (cmd.priceMaxCents !== null) space.price.maxCents = cmd.priceMaxCents;
      if (cmd.maxPayments !== null) space.maxPayments = cmd.maxPayments;
      if (cmd.newTermsConfirmed !== null) space.newTermsConfirmed = cmd.newTermsConfirmed;
      if (cmd.latestPaymentDate) {
        const last = [...space.paymentWindows].sort((a, b) => b.latest.localeCompare(a.latest))[0];
        if (cmd.latestPaymentDate < last.earliest) throw new CommandError("INVALID_WINDOW", "The latest payment date is before the allowed payment window starts.");
        last.latest = cmd.latestPaymentDate;
      }
      return { kind: "deal_planning_updated", refs: { projectId: cmd.projectId }, description: "Updated the allowed terms for this project." };
    }
    case "record_partial_receipt": case "settle_lower_total": case "record_client_response":
      throw new CommandError("NOT_AVAILABLE_YET", "This change type is published in the round 6 contract and implemented in the next commit.");
  }
}

/** Opaque, order-independent workspace fingerprint for proposal freshness (engine formula). */
export const proposalBaseFingerprint = (ws: HouseholdWorkspace) => engineWorkspaceFingerprint(ws);

export type ProposalApplyResult = { workspace: HouseholdWorkspace; events: WorkspaceEvent[] };

/**
 * Apply a CONFIRMED proposal: same workspace, same base revision and fingerprint (else
 * PROPOSAL_STALE — preview again), no open ambiguities, every command valid — or nothing.
 * One revision; one event per command with ids derived from the proposal (retries are no-ops).
 */
export async function applyChangeProposal(ws: HouseholdWorkspace, proposal: ChangeProposal, at = new Date().toISOString()): Promise<ProposalApplyResult> {
  if (proposal.ambiguities.length) throw new CommandError("AMBIGUOUS", "Answer the open questions before confirming this change.");
  if (!proposal.commands.length) throw new CommandError("NO_COMMANDS", "There is nothing to apply.");
  const already = proposal.commands.map((_, i) => `evt-${proposal.id}-${i}`.slice(0, 100));
  if (already.every(id => ws.events.some(e => e.id === id))) return { workspace: ws, events: ws.events.filter(e => already.includes(e.id)) };
  if (proposal.base.workspaceId !== ws.id || proposal.base.revision !== ws.revision || proposal.base.fingerprint !== await proposalBaseFingerprint(ws)) {
    throw new CommandError("PROPOSAL_STALE", "Your plan changed since this change was proposed. Review the updated preview before confirming.");
  }
  let next = structuredClone(ws);
  const excerpt = proposal.evidence[0]?.excerpt;
  const sourceId = addEvidence(next, `assist-${proposal.id}`.slice(0, 100),
    `${proposal.provenance === "ai_model" ? "Proposed by the assistant from" : "From"} your message${excerpt ? `: “${excerpt.slice(0, 120)}”` : ""} (confirmed ${at.slice(0, 10)})`);
  const events: WorkspaceEvent[] = [];
  proposal.commands.forEach((cmd, i) => {
    const r = applyCommand(next, cmd, { idBase: `${proposal.id}-${i}`, sourceId, at, origin: proposal.provenance === "manual" ? "user_entered" : "assistant_text" });
    const event: WorkspaceEvent = { id: already[i], at, kind: r.kind, description: r.description.slice(0, 500), refs: r.refs, previousFingerprint: proposal.base.fingerprint, nextFingerprint: null };
    next = withEvent(next, event);
    events.push(event);
  });
  const parsed = HouseholdWorkspaceSchema.safeParse(next);
  if (!parsed.success) throw new CommandError("INVALID_RESULT", parsed.error.issues[0]?.message ?? "This change doesn't fit the plan.");
  return { workspace: parsed.data, events };
}

/**
 * Confirm + save a proposal in one step: apply (with freshness checks) and commit atomically.
 * Retrying after a lost acknowledgement returns the stored revision (same event ids, same content).
 */
export async function commitProposal(repo: import("./workspace-repository").WorkspaceRepository, ws: HouseholdWorkspace, proposal: ChangeProposal) {
  const { commitWorkspaceChange } = await import("./workspace-repository");
  const { workspace, events } = await applyChangeProposal(ws, proposal);
  if (workspace === ws) return { saved: ws, events, alreadyApplied: true };
  const { saved } = await commitWorkspaceChange(repo, ws, workspace, events[0]);
  return { saved, events, alreadyApplied: false };
}
