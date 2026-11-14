import type { ActionPackage, DealVariant, ReadyDealSearch, Reminder } from "@/domain/deal-planning";
import { sepPosition, type HouseholdWorkspace } from "@/domain/household-workspace";

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
