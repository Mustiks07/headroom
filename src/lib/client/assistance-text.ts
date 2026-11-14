import type { AssistanceContext, AssistanceRequest, ChangeCommand, ChangeProposal } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { parseDate, parseUsdToCents } from "./extraction-fields";

/** Minimal provider/parser context: ids, titles, statuses, dated expected payments. No income, SEP, premiums or documents. */
export function buildAssistanceContext(ws: HouseholdWorkspace): AssistanceContext {
  return {
    people: ws.household.people.map(p => ({ id: p.id, role: p.role })),
    projects: ws.projects.map(p => ({ id: p.id, title: p.title, status: p.status, lines: [
      ...p.receipts.map(l => ({ l, kind: "receipt" as const })), ...p.expenses.map(l => ({ l, kind: "expense" as const })),
    ].slice(0, 20).map(({ l, kind }) => ({ id: l.id, kind, label: l.label ?? null, expectedAmountCents: l.expected?.amountCents ?? null,
      expectedDate: l.expected?.date ?? null, received: !!l.actual, cancelled: !!l.cancelledAt })) })),
    forecasts: ws.forecasts.map(f => ({ personId: f.personId, year: f.year, method: f.method })),
    goals: (ws.dealPlanning?.goals ?? []).map(g => ({ id: g.id, projectId: g.projectId })),
  };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Resolve a written date against the USER's calendar date (already in their time zone).
 * Absolute dates are parsed as written; "January 8" without a year takes the next occurrence on
 * or after the user's date; relative words are recorded so the confirmation can show them.
 */
export function resolveDate(text: string, userDate: string): { date: string; phrase: string; relative: boolean } | null {
  const t = text.toLowerCase();
  const abs = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i.exec(text);
  if (abs) { const d = parseDate(abs[1].replace(/(\d)(st|nd|rd|th)/i, "$1").replace(/sept/i, "sep")); if (d) return { date: d, phrase: abs[1], relative: false }; }
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);
  if (md) {
    const month = MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()) + 1, day = Number(md[2]);
    for (const year of [Number(userDate.slice(0, 4)), Number(userDate.slice(0, 4)) + 1]) {
      const d = parseDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      if (d && d >= userDate) return { date: d, phrase: md[0], relative: true };
    }
  }
  if (/\btoday\b/.test(t)) return { date: userDate, phrase: "today", relative: true };
  if (/\byesterday\b/.test(t)) return { date: addDays(userDate, -1), phrase: "yesterday", relative: true };
  if (/\btomorrow\b/.test(t)) return { date: addDays(userDate, 1), phrase: "tomorrow", relative: true };
  const inDays = /\bin (\d{1,3}) days?\b/.exec(t);
  if (inDays) return { date: addDays(userDate, Number(inDays[1])), phrase: inDays[0], relative: true };
  const wd = /\b(next|this|last)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]), today = new Date(`${userDate}T12:00:00Z`).getUTCDay();
    let diff = (target - today + 7) % 7;
    if (wd[1] === "last") diff = diff === 0 ? -7 : diff - 7; else if (wd[1] === "next" && diff === 0) diff = 7;
    return { date: addDays(userDate, diff), phrase: wd[0].trim(), relative: true };
  }
  return null;
}

/** "$3,000", "$3,000.50", "3000 dollars", "$3k" → cents (deterministic; never from a model). */
export function findAmountCents(text: string): number | null {
  const k = /\$\s?(\d+(?:\.\d+)?)\s?k\b/i.exec(text);
  if (k) { const cents = Math.round(Number(k[1]) * 100_000); return Number.isSafeInteger(cents) ? cents : null; }
  const m = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)\b/i.exec(text);
  return m ? parseUsdToCents(m[1] ?? m[2]) : null;
}

type Line = AssistanceContext["projects"][number]["lines"][number] & { projectId: string; projectTitle: string };

function openReceipts(ctx: AssistanceContext, text: string): Line[] {
  const all = ctx.projects.filter(p => p.status !== "cancelled").flatMap(p => p.lines.filter(l => l.kind === "receipt" && !l.received && !l.cancelled)
    .map(l => ({ ...l, projectId: p.id, projectTitle: p.title })));
  const t = text.toLowerCase();
  const named = all.filter(l => l.projectTitle.toLowerCase().split(/\W+/).filter(w => w.length > 3).some(w => t.includes(w)));
  let pool = named.length ? named : all;
  // "remaining / final / rest / balance" points at projects that are already partly paid.
  if (/\b(remaining|final|rest|balance|second|last)\b/.test(t)) {
    const partlyPaid = new Set(ctx.projects.filter(p => p.lines.some(l => l.kind === "receipt" && l.received)).map(p => p.id));
    const narrowed = pool.filter(l => partlyPaid.has(l.projectId));
    if (narrowed.length) pool = narrowed;
  }
  return pool;
}

const lineLabel = (l: Line) => `${l.projectTitle} — ${l.label ?? "payment"}${l.expectedAmountCents !== null ? ` ($${(l.expectedAmountCents / 100).toFixed(2)}` : " ("}${l.expectedDate ? ` expected ${l.expectedDate})` : ")"}`;

/**
 * Deterministic understanding of common updates (works without any provider). Anything it can't
 * map unambiguously becomes an ambiguity question; nothing is guessed from a similar amount.
 */
export function proposeFromPatterns(req: AssistanceRequest, id: string, now = new Date().toISOString()): ChangeProposal {
  const text = req.text.trim();
  const t = text.toLowerCase();
  const commands: ChangeCommand[] = [];
  const ambiguities: ChangeProposal["ambiguities"] = [];
  const resolvedDates: ChangeProposal["resolvedDates"] = [];
  const date = resolveDate(text, req.userDate);
  if (date?.relative) resolvedDates.push({ phrase: date.phrase, date: date.date });
  const amount = findAmountCents(text);
  const adults = req.context.people.filter(p => p.role !== "dependent");
  const pickLine = (lines: Line[], question: string, build: (l: Line) => ChangeCommand) => {
    if (lines.length === 1) commands.push(build(lines[0]));
    else if (lines.length > 1) ambiguities.push({ id: "which_payment", question, options: lines.slice(0, 10).map(l => ({ id: `${l.projectId}::${l.id}`, label: lineLabel(l) })) });
    else ambiguities.push({ id: "no_payment", question: "No open expected payment matches. Add the project or payment in the form first.", options: [] });
  };

  if (/\b(sep|retirement)\b/.test(t) && /\b(paid|contributed|put|deposited|made)\b/.test(t)) {
    if (amount === null) ambiguities.push({ id: "amount", question: "How much did you contribute?", options: [] });
    if (!date) ambiguities.push({ id: "date", question: "On which date was the contribution paid?", options: [] });
    const year = /\bfor (2026|2027)\b/.exec(t)?.[1];
    const taxYear = year ? Number(year) as 2026 | 2027 : date && date.date.slice(5) > "04-15" && date.date <= "2027-12-31" ? Number(date.date.slice(0, 4)) as 2026 | 2027 : null;
    if (!taxYear) ambiguities.push({ id: "tax_year", question: "Which tax year is this SEP-IRA contribution for?", options: [{ id: "2026", label: "2026" }, { id: "2027", label: "2027" }] });
    const person = adults.length === 1 ? adults[0].id : /\b(spouse|wife|husband|partner)\b/.test(t) ? adults.find(a => a.role === "spouse")?.id ?? null : /\b(my|i)\b/.test(t) ? adults.find(a => a.role === "primary")?.id ?? null : null;
    if (!person) ambiguities.push({ id: "person", question: "Whose SEP-IRA was this?", options: adults.map(a => ({ id: a.id, label: a.role === "primary" ? "You" : "Your spouse" })) });
    if (amount !== null && date && taxYear && person) commands.push({ type: "record_sep_contribution", personId: person, taxYear, amountCents: amount, paidDate: date.date });
  } else if (/\b(moved|move|rescheduled|reschedule|postponed|delayed|pushed|changed|now due|will pay)\b/.test(t) && /\b(payment|invoice|balance|installment)\b/.test(t)) {
    if (!date) ambiguities.push({ id: "date", question: "What is the new payment date?", options: [] });
    else pickLine(openReceipts(req.context, text), "Which payment moved?", l => ({ type: "update_expected_payment", projectId: l.projectId, lineId: l.id, newAmountCents: null, newDate: date.date }));
  } else if (/\b(received|got paid|got|arrived|came in|deposited)\b/.test(t)) {
    if (amount === null) ambiguities.push({ id: "amount", question: "How much did you receive?", options: [] });
    if (!date) ambiguities.push({ id: "date", question: "On which date did the money arrive?", options: [] });
    if (amount !== null && date) pickLine(openReceipts(req.context, text), "Which expected payment was this?", l => ({ type: "record_receipt", projectId: l.projectId, lineId: l.id, amountCents: amount, date: date.date }));
  } else if (/\b(offer|offered|proposal|quote|would pay|wants to pay)\b/.test(t)) {
    if (amount === null) ambiguities.push({ id: "amount", question: "What is the total project fee?", options: [] });
    if (!date) ambiguities.push({ id: "date", question: "When would the client pay?", options: [] });
    const owner = adults.length === 1 ? adults[0].id : null;
    if (!owner) ambiguities.push({ id: "person", question: "Whose business is this project for?", options: adults.map(a => ({ id: a.id, label: a.role === "primary" ? "You" : "Your spouse" })) });
    const title = /\bfor (?:a |an |the )?([a-z0-9][a-z0-9 '&-]{2,60}?)(?:\s+(?:paid|payable|due|on|by|at|in)\b|[.,]|$)/i.exec(text)?.[1]?.trim();
    if (amount !== null && date && owner) commands.push({ type: "add_offered_project", title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "New client offer",
      ownerPersonId: owner, totalPriceCents: amount, received: [], unpaid: [{ amountCents: amount, date: date.date }], expenses: [], priceNegotiable: null, scheduleNegotiable: null });
  } else {
    ambiguities.push({ id: "unknown", question: "I couldn't match this to a change I can make. Try e.g. “The remaining payment moved to January 8, 2027”, “Received $3,000 on December 16”, “Paid $1,500 into my SEP on Dec 20 for 2026”, or use the form.", options: [] });
  }
  return {
    id, createdAt: now, base: req.base ?? { workspaceId: "none", revision: 0, fingerprint: "" }, intent: req.intent,
    commands, ambiguities, resolvedDates, evidence: [{ documentId: null, excerpt: text.slice(0, 200) }], provenance: "pattern", status: "proposed",
  };
}

/** Fill an ambiguity answer (e.g. the chosen payment) into a pattern proposal and re-run it deterministically. */
export function answerAmbiguity(req: AssistanceRequest, proposal: ChangeProposal, answers: Record<string, string>): ChangeProposal {
  let text = req.text;
  if (answers.date) text += ` on ${answers.date}`;
  if (answers.amount) text += ` $${answers.amount}`;
  if (answers.tax_year) text += ` for ${answers.tax_year}`;
  const ctx: AssistanceContext = structuredClone(req.context);
  if (answers.which_payment) {
    const [projectId, lineId] = answers.which_payment.split("::");
    for (const p of ctx.projects) p.lines = p.lines.filter(l => p.id === projectId ? l.id === lineId || l.kind !== "receipt" : l.kind !== "receipt");
  }
  if (answers.person) ctx.people = ctx.people.filter(p => p.id === answers.person || p.role === "dependent");
  const next = proposeFromPatterns({ ...req, text, context: ctx }, proposal.id, proposal.createdAt);
  return { ...next, evidence: proposal.evidence };
}
