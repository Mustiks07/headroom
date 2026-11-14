import type { IssuedCalendarEvent } from "@/domain/assistance";
import type { ActionPackage, DealVariant, ReadyDealSearch, Reminder } from "@/domain/deal-planning";
import { sepPosition, type HouseholdWorkspace } from "@/domain/household-workspace";
import type { DecisionContext } from "@/domain/decision-context";
import { originalOfferFromLines } from "./workspace-commands";

/**
 * Deterministic builders for the action package (round 4). No money is calculated here: every
 * amount comes from the engine's ReadyDealSearch variant or from recorded workspace facts.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (cents: number) => usd.format(cents / 100);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Stable calendar UID per workspace + project + action (re-exports update the same event). */
export function reminderUid(workspaceId: string, projectId: string, actionId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${clean(workspaceId)}.${clean(projectId)}.${clean(actionId)}@headroom.plan`;
}

export interface ClientDraft { subject: string; body: string; includesHouseholdDetails: boolean; generatedAt: string }

/**
 * Message the USER may send to the client. Contains only the asked price and payment schedule.
 * Household income, subsidy and taxes are never included; `includeHouseholdDetails` only adds a
 * generic reason sentence without any amounts. Nothing is sent by Headroom.
 */
export function buildClientDraft(ws: HouseholdWorkspace, variant: DealVariant, projectId: string,
  options: { includeHouseholdDetails?: boolean; now?: Date } = {}): ClientDraft {
  const project = ws.projects.find(p => p.id === projectId);
  const title = project?.title ?? "the project";
  const received = (project?.receipts ?? []).filter(l => l.actual).map(l => l.actual!);
  const receivedTotal = received.reduce((t, r) => t + r.amountCents, 0);
  const lines = [
    "Hello,",
    "",
    `Thank you for the offer for ${title}. I'd like to propose the following terms:`,
    "",
    `- Total price: ${money(variant.terms.priceCents)}${receivedTotal ? ` (including ${money(receivedTotal)} already received)` : ""}`,
  ];
  if (variant.terms.payments.length === 1) {
    const p = variant.terms.payments[0];
    lines.push(`- Payment: ${money(p.amountCents)}, to be paid on ${longDate(p.date)}`);
  } else {
    variant.terms.payments.forEach((p, i) => lines.push(`- Payment ${i + 1}: ${money(p.amountCents)}, to be paid on ${longDate(p.date)}`));
  }
  if (options.includeHouseholdDetails) {
    lines.push("", "This schedule helps me plan my taxes and health-insurance costs for the year.");
  }
  lines.push("", "Please let me know whether these terms work for you, or suggest changes.", "", "Thank you,");
  return {
    subject: `Proposed payment terms for ${title}`.slice(0, 200),
    body: lines.join("\n"),
    includesHouseholdDetails: !!options.includeHouseholdDetails,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}

/** Notes shown to the user next to the draft (never part of the client message). */
export function clientDraftNotes(variant: DealVariant): string[] {
  const notes = [
    "Headroom does not send this message. Choosing terms here is not the client's agreement — record it only after the client confirms.",
    "An invoice date alone does not move income to another year; what counts is when the money is actually paid or made available to you.",
  ];
  if (variant.terms.payments.some(p => p.date.startsWith("2027-"))) {
    notes.push("Payments dated in 2027 should not be paid, credited or made available to you before those dates.");
  }
  return notes;
}

/** Reminders for the variant's NEW actions; keeps UIDs stable, bumps SEQUENCE on changes and keeps done/cancelled status. */
export function buildReminders(ws: HouseholdWorkspace, projectId: string, variant: DealVariant): Reminder[] {
  const previous = new Map<string, Reminder>();
  for (const pkg of ws.dealPlanning?.packages ?? []) if (pkg.projectId === projectId) for (const r of pkg.reminders) {
    const seen = previous.get(r.uid);
    if (!seen || r.sequence >= seen.sequence) previous.set(r.uid, r);
  }
  return variant.actions.map(a => {
    const uid = reminderUid(ws.id, projectId, a.id);
    const before = previous.get(uid);
    const changed = !!before && (before.title !== a.title || before.date !== a.dueDate || before.condition !== a.dueCondition);
    return {
      uid, actionId: a.id, title: a.title, date: a.dueDate, condition: a.dueDate ? null : (a.dueCondition ?? "Date not known yet — add it when it is confirmed."),
      sequence: before ? before.sequence + (changed ? 1 : 0) : 0,
      status: before?.status === "done" && !changed ? "done" : "open",
      sourceIds: a.sourceIds,
    };
  });
}

/** Plain-English note for a tax professional; amounts copied from the engine variant and workspace facts. */
export function buildSpecialistNote(ws: HouseholdWorkspace, result: ReadyDealSearch, variant: DealVariant): string {
  const project = ws.projects.find(p => p.id === result.projectId);
  const lines = [
    `Headroom decision summary — ${project?.title ?? result.projectId} (${ws.household.title}${ws.household.isSynthetic ? ", synthetic example" : ""})`,
    `Compared with: ${result.baseline.label}. ${result.baseline.description}`,
    `Chosen terms: total asked price ${money(variant.terms.priceCents)}; remaining payments ${variant.terms.payments.map(p => `${money(p.amountCents)} on ${p.date}`).join(", ") || "no further payments"}.`,
    variant.terms.additionalSep ? `Additional SEP-IRA contribution: ${money(variant.terms.additionalSep.amountCents)} for ${variant.terms.additionalSep.year}.` : "No additional SEP-IRA contribution.",
    `Change in spendable cash after final settlement of 2026 and 2027: ${money(variant.twoYearCashDeltaCents)}. Retirement added (separate, not spendable): ${money(variant.retirementAddedCents)}.`,
    ...variant.aca.map(a => `${a.year}: ACA household income ${money(a.magiCents)}, premium tax credit ${money(a.ptcCents)}${a.creditLost ? " (credit lost)" : ""}.`),
  ];
  for (const year of [2026, 2027] as const) for (const person of ws.household.people) {
    const s = sepPosition(ws, person.id, year);
    if (s.targetCents !== null || s.paidCents) lines.push(`${year} SEP for ${person.role}: goal ${s.targetCents === null ? "none" : money(s.targetCents)}, paid ${money(s.paidCents)}, remaining ${money(s.remainingCents)}.`);
  }
  lines.push(`Calculation: ${result.engineVersion} / ${result.rulesVersion}; fingerprint ${result.searchFingerprint}. Planning estimate, not a tax return or an official form.`);
  return lines.join("\n");
}

/** Build an action package from a FRESH ready search result. The caller saves it in the workspace. */
/** Σ unpaid payments must equal total price − already received (contract invariant). */
export function termsAddUp(ws: HouseholdWorkspace, projectId: string, variant: DealVariant): boolean {
  const received = (ws.projects.find(p => p.id === projectId)?.receipts ?? []).reduce((t, l) => t + (l.actual?.amountCents ?? 0), 0);
  return variant.terms.payments.reduce((t, p) => t + p.amountCents, 0) === variant.terms.priceCents - received;
}

const PURPOSE_REASON: Record<DealVariant["purpose"], string> = {
  simplest: "The smallest change to the offered terms that meets your goal.",
  as_offered: "The offer as it stands already meets your goal.",
  most_cash: "The most cash among the calculated options; it needs the client to agree to the changed terms.",
  earliest_money: "Gets the money to you earliest among the calculated options.",
  most_retirement: "Adds the most to retirement savings among the calculated options.",
  lowest_risk: "Leaves the most room before a premium tax credit is lost.",
};

/**
 * What the choice was compared with: baseline, horizon, the calculated options with the engine's own
 * comparisons, and deterministic recommendation reasons (engine purpose + engine warnings). Copies
 * engine figures; computes nothing.
 */
function originalOfferOf(ws: HouseholdWorkspace, projectId: string) {
  const project = ws.projects.find(p => p.id === projectId);
  if (!project) return null;
  return project.originalOffer ?? originalOfferFromLines(project, ws.updatedAt, { kind: "existing_project", sourceId: null }, "captured");
}

export function buildDecisionContext(ws: HouseholdWorkspace, result: ReadyDealSearch, chosenVariantId: string): DecisionContext {
  const clip = (t: string) => (t.length <= 400 ? t : `${t.slice(0, 399)}…`);
  const recommended = result.variants.find(v => v.id === result.recommendedVariantId) ?? null;
  const reasons: string[] = [];
  if (recommended) reasons.push(`Recommended: ${PURPOSE_REASON[recommended.purpose]}`);
  if (recommended && recommended.id !== chosenVariantId) reasons.push("You chose a different calculated option than the recommended one.");
  reasons.push(...result.warnings.map(clip));
  return {
    baseline: { kind: result.baseline.kind, label: result.baseline.label.slice(0, 200), description: result.baseline.description.slice(0, 600) },
    horizon: { ...result.horizon },
    alternatives: result.variants.slice(0, 3).map(v => ({ variantId: v.id, label: v.label.slice(0, 200), purpose: v.purpose, priceCents: v.terms.priceCents,
      twoYearCashDeltaCents: v.twoYearCashDeltaCents, comparisons: v.comparisons ?? null, holds: v.robustness?.holds ?? null,
      chosen: v.id === chosenVariantId, recommended: v.id === result.recommendedVariantId })),
    recommendedVariantId: result.recommendedVariantId,
    recommendationReasons: reasons.slice(0, 8),
    originalOffer: originalOfferOf(ws, result.projectId),
  };
}

export function buildActionPackage(ws: HouseholdWorkspace, result: ReadyDealSearch, variantId: string,
  options: { includeHouseholdDetails?: boolean; now?: Date; id?: string } = {}): ActionPackage {
  const variant = result.variants.find(v => v.id === variantId);
  if (!variant) throw new Error("Choose one of the calculated variants.");
  if (!termsAddUp(ws, result.projectId, variant)) throw new Error("The variant's payments don't add up to its price minus the money already received.");
  const now = options.now ?? new Date();
  return {
    id: options.id ?? `pkg-${result.projectId}-${result.searchFingerprint.slice(0, 12)}-${variant.id}`.slice(0, 100),
    createdAt: now.toISOString(),
    workspaceRevision: ws.revision,
    searchFingerprint: result.searchFingerprint,
    engineVersion: result.engineVersion,
    rulesVersion: result.rulesVersion,
    goalId: result.goalId,
    projectId: result.projectId,
    variant,
    clientDraft: buildClientDraft(ws, variant, result.projectId, { includeHouseholdDetails: options.includeHouseholdDetails, now }),
    reminders: buildReminders(ws, result.projectId, variant),
    specialistNote: buildSpecialistNote(ws, result, variant),
    status: "draft",
    decisionContext: buildDecisionContext(ws, result, variant.id),
  };
}

/* ------------------------------------------------------------------ iCalendar (RFC 5545) */

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");
const nextDay = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold content lines at 75 octets (UTF-8), continuation lines start with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (bytes.encode(current + ch).length > limit) { out.push(current); current = ch; }
    else current += ch;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

/**
 * Calendar of the package's OPEN dated reminders as all-day events (no timezone ambiguity).
 * Done/cancelled reminders and reminders without a date are not added. Same UID + SEQUENCE on
 * re-export, so calendars update instead of duplicating.
 */
export function buildCalendar(ws: HouseholdWorkspace, pkg: ActionPackage, now = new Date()): string {
  const project = ws.projects.find(p => p.id === pkg.projectId);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Headroom//Plan actions 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Headroom – ${project?.title ?? "plan"}`)}`];
  for (const r of pkg.reminders) {
    if (r.status !== "open" || !r.date) continue;
    lines.push("BEGIN:VEVENT", `UID:${r.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${icsDate(r.date)}`, `DTEND;VALUE=DATE:${nextDay(r.date)}`,
      `SEQUENCE:${r.sequence}`, `SUMMARY:${escapeText(r.title)}`,
      `DESCRIPTION:${escapeText(`${project ? `Project: ${project.title}. ` : ""}From your Headroom plan (calculation ${pkg.searchFingerprint.slice(0, 12)}). Planning reminder, not an official deadline notice.`)}`,
      "STATUS:CONFIRMED", "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(r.title)}`, "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ current agreed-plan calendar (round 5) */


export interface PlanCalendarEvent { uid: string; date: string; title: string; description: string }

/** Due date of the individual return for a tax year (no extension). SEP can be later only with a filed extension (IRS Pub. 560). */
const RETURN_DUE: Record<number, string> = { 2026: "2027-04-15", 2027: "2028-04-17" };

/**
 * What is still relevant NOW: open expected payments of agreed projects, open package actions
 * (except payment receipts, already covered), and remaining SEP-IRA goals. Received payments,
 * paid SEP, cancelled lines and done/superseded actions are not included.
 */
export function currentPlanEvents(ws: HouseholdWorkspace): PlanCalendarEvent[] {
  const events: PlanCalendarEvent[] = [];
  const uid = (...parts: string[]) => `${parts.map(p => p.replace(/[^A-Za-z0-9._-]/g, "-")).join(".")}@headroom.plan`;
  for (const p of ws.projects) {
    if (p.status !== "agreed") continue;
    for (const l of p.receipts) {
      if (l.actual || l.cancelledAt || !l.expected) continue;
      events.push({ uid: uid(ws.id, p.id, l.id, "receipt"), date: l.expected.date, title: `Expect ${money(l.expected.amountCents)} from “${p.title}”`,
        description: "Agreed payment date. When it arrives, record the actual amount and date in Headroom." });
    }
  }
  for (const pkg of ws.dealPlanning?.packages ?? []) {
    if (pkg.status === "superseded") continue;
    for (const r of pkg.reminders) {
      const action = pkg.variant.actions.find(a => a.id === r.actionId);
      if (r.status !== "open" || !r.date || action?.kind === "receive_payment") continue;
      events.push({ uid: r.uid, date: r.date, title: r.title, description: "Action from your saved terms in Headroom. Planning reminder, not an official deadline notice." });
    }
  }
  for (const year of [2026, 2027] as const) for (const person of ws.household.people) {
    const s = sepPosition(ws, person.id, year);
    if (s.targetCents === null || s.remainingCents <= 0) continue;
    events.push({ uid: uid(ws.id, "sep", person.id, String(year)), date: RETURN_DUE[year],
      title: `SEP-IRA: ${money(s.remainingCents)} of your ${year} goal still to contribute${person.role === "spouse" ? " (spouse)" : ""}`,
      description: `${year} SEP-IRA contributions are due by the due date of your ${year} return; a later date applies only if you file an extension (IRS Publication 560). Record the contribution in Headroom when you make it.` });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

/**
 * Calendar of the CURRENT plan. Events issued before keep their UID; a changed date/title gets
 * SEQUENCE + 1; events that no longer apply are sent as STATUS:CANCELLED (SEQUENCE + 1) so that
 * calendars honouring UID/SEQUENCE remove them on re-import. Returns the ICS text and the updated
 * issued list, which the caller saves (see exportCurrentCalendar).
 */
export function buildCurrentCalendar(ws: HouseholdWorkspace, now = new Date()): { ics: string; issued: IssuedCalendarEvent[]; active: number; cancelled: number } {
  const previous = new Map((ws.dealPlanning?.calendar?.issued ?? []).map(e => [e.uid, e]));
  const current = currentPlanEvents(ws);
  const at = now.toISOString();
  const issued: IssuedCalendarEvent[] = [];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Headroom//Current plan 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Headroom plan"];
  const vevent = (e: { uid: string; date: string; title: string; description: string }, sequence: number, status: "CONFIRMED" | "CANCELLED") => {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SEQUENCE:${sequence}`, `SUMMARY:${escapeText(status === "CANCELLED" ? `Cancelled: ${e.title}` : e.title)}`, `DESCRIPTION:${escapeText(e.description)}`,
      `STATUS:${status}`, "TRANSP:TRANSPARENT");
    if (status === "CONFIRMED") lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, "TRIGGER:-P1D", "END:VALARM");
    lines.push("END:VEVENT");
  };
  let cancelled = 0;
  for (const e of current) {
    const prev = previous.get(e.uid);
    const sequence = !prev ? 0 : prev.status === "cancelled" || prev.date !== e.date || prev.title !== e.title ? prev.sequence + 1 : prev.sequence;
    vevent(e, sequence, "CONFIRMED");
    issued.push({ uid: e.uid, sequence, date: e.date, title: e.title.slice(0, 300), status: "active", issuedAt: at });
  }
  const currentUids = new Set(current.map(e => e.uid));
  for (const prev of previous.values()) {
    if (currentUids.has(prev.uid)) continue;
    const sequence = prev.status === "cancelled" ? prev.sequence : prev.sequence + 1;
    // Keep sending the cancellation for a while so a later import still removes it.
    const ageDays = (now.getTime() - new Date(`${prev.date}T00:00:00Z`).getTime()) / 86_400_000;
    if (ageDays > 60) continue;
    vevent({ uid: prev.uid, date: prev.date, title: prev.title, description: "This plan action no longer applies (paid, moved or cancelled in Headroom)." }, sequence, "CANCELLED");
    issued.push({ ...prev, sequence, status: "cancelled", issuedAt: at });
    cancelled++;
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(fold).join("\r\n") + "\r\n", issued: issued.slice(0, 300), active: current.length, cancelled };
}

/** Honest note for the export button: downloaded files never update by themselves. */
export const CALENDAR_IMPORT_NOTE = "Downloaded calendar files don't update by themselves. Download again after changes: Apple Calendar and Outlook update or cancel events with the same ID; Google Calendar's file import may add duplicates and ignore cancellations, so delete outdated events there yourself.";
