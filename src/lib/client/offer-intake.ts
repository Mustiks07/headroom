/**
 * First-offer intake without a provider (round 6), shared by the browser and POST /api/assist/intake:
 * ordinary email text → offers AS WRITTEN → typed questions → onboarding draft → explicit conversion.
 *
 * Reads amounts/dates with Headroom's own parsers. Never infers costs (unknown ≠ $0), a tax year, or a
 * received payment from an invoice; projects stay separate; anything it can't place is "unsupported".
 */
import type { CaseInput } from "@/domain/contracts";
import type { ChangeCommand, ChangeProposal } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import {
  INTAKE_VERSION, ONBOARDING_DRAFT_VERSION, OnboardingDraftSchema, type IntakeResult, type OnboardingConversion, type OnboardingDraft,
  type ProposedOffer, type ProposedPayment, type ProviderStatus, type TypedAnswer, type UnresolvedField,
} from "@/domain/intake";
import { resolveDate } from "./assistance-text";

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ tokens */

type Token = { kind: "usd" | "other" | "pct"; start: number; end: number; raw: string; cents: number | null; pct: number | null };

const MONEY = /(US\$|\$|USD\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|thousand)?\b|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|thousand)?\s?(?:dollars|usd)\b|(€|£|EUR\s?|GBP\s?|CAD\s?|C\$|A\$)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:euros?|pounds?|EUR|GBP)\b|\b(\d{1,3})\s?%|\b((?:the other |one )?half)\b(?! (?:of|an?) )/gi;

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(MONEY)) {
    const start = m.index!, raw = m[0].trim(), end = start + m[0].length;
    if (m[9] !== undefined) { const pct = Number(m[9]); if (pct > 0 && pct <= 100) out.push({ kind: "pct", start, end, raw, cents: null, pct }); continue; }
    if (m[10] !== undefined) { out.push({ kind: "pct", start, end, raw, cents: null, pct: 50 }); continue; }
    if (m[8] !== undefined || /euro|pound|EUR|GBP/i.test(raw) && !/\$/.test(raw)) { out.push({ kind: "other", start, end, raw, cents: null, pct: null }); continue; }
    const whole = (m[2] ?? m[5])!.replace(/,/g, ""), frac = (m[3] ?? m[6] ?? "").padEnd(2, "0"), mult = (m[4] ?? m[7]) ? 1000 : 1;
    const cents = mult === 1 ? Number(whole) * 100 + Number(frac || 0) : Math.round(Number(`${whole}.${frac || 0}`) * 1000 * 100);
    out.push({ kind: "usd", start, end, raw, cents: Number.isSafeInteger(cents) && cents > 0 ? cents : null, pct: null });
  }
  return out;
}

const RATE = /\b(per|an|a|each)\s+(hour|hr|day|week|month|year)\b|\/\s?(hr|hour|day|mo|month)\b|\bhourly\b|\bmonthly retainer\b/i;
const COST = /\b(cost|costs|expense|expenses|materials?|software|license|licen[cs]es|subcontract\w*|contractor fee|printing|travel|out of pocket|you(?:'ll| will) (?:need to )?(?:pay|spend|buy))\b/i;
const TOTAL = /\b(total|budget|fee|price|flat|quoted?|all[- ]in|overall|in all|for the (?:whole|entire|full) (?:project|job|thing)|for everything|project (?:cost|value))\b/i;
const RECEIVED = /\b(paid|sent|transferred|wired|received|deposited|has gone out|went out)\b/i;
const FUTURE = /\b(will|to be|once|when|after|upon|on (?:delivery|completion|signing)|due|invoice|expect|planned|plan to|would)\b/i;
const REMAINDER = /\b(remaining|rest|balance|remainder|the other half|final payment)\b/i;
const CONDITION = /\b(on|upon|at|after) (delivery|completion|launch|signing|sign-?off|approval|kickoff|kick-off|start)\b|\bwhen (we sign|it goes live|it launches|it'?s done|you deliver)\b|\bnet ?\d{1,3}\b|\bon receipt\b/i;

/** Split the text into windows, one per money/percent token (boundary at " and ", ", ", "; " between tokens). */
function windows(text: string, toks: Token[]): string[] {
  const cuts = toks.map((t, i) => {
    if (i === 0) return Math.max(0, text.lastIndexOf("\n", t.start) + 1, sentenceStart(text, t.start));
    const gap = text.slice(toks[i - 1].end, t.start);
    // Prefer a sentence/line end, then "and"/";", then a comma: a date after "paid … on March 2." stays with its amount.
    const m = /(\.\s|\n|[!?]\s)/.exec(gap) ?? /( and |; )/.exec(gap) ?? /(, )/.exec(gap);
    return m ? toks[i - 1].end + m.index + 1 : toks[i - 1].end;
  });
  return toks.map((t, i) => text.slice(cuts[i], i + 1 < toks.length ? cuts[i + 1] : sentenceEnd(text, t.end)));
}
const sentenceStart = (text: string, at: number) => { const s = text.slice(0, at); const m = Math.max(s.lastIndexOf(". "), s.lastIndexOf("! "), s.lastIndexOf("? "), s.lastIndexOf("\n")); return m < 0 ? 0 : m + 1; };
const sentenceEnd = (text: string, at: number) => { const rest = text.slice(at); const m = /[.!?](\s|$)|\n\s*\n/.exec(rest); return m ? at + m.index + 1 : text.length; };

function titleOf(text: string): string | null {
  const subject = /^(?:subject|re|fw|fwd|quote|project|proposal):\s*(.{3,120})$/im.exec(text);
  if (subject) {
    const t = subject[1].replace(/^(re|fw|fwd):\s*/i, "").split(/\s(?:US\$|\$|€|£)|\s\d|[.;:!?]/)[0].trim();
    if (t.length >= 3) return clip(t[0].toUpperCase() + t.slice(1), 200);
  }
  const the = /\bthe ([a-z][a-z &'\-]{2,40}?) (?:for|at) (?:US\$|\$)/i.exec(text);
  if (the) return clip(the[1][0].toUpperCase() + the[1].slice(1), 200);
  const verb = /\b(?:to|for|you to|you'd|you would|can you|could you|would you|will you)\s+(redesign|design|build|develop|create|write|produce|update|refresh|launch|rebuild|translate|edit|shoot|film|photograph|illustrate|brand|migrate|set up|audit)\s+(?:our|the|a|an|my|their|its)?\s*([a-z0-9][a-z0-9 &'\-]{2,40}?)(?=[.,;:!?\n]| for | by | with | and | before | in )/i.exec(text);
  if (verb) return clip(`${verb[1][0].toUpperCase()}${verb[1].slice(1).toLowerCase()} ${verb[2].trim()}`, 200);
  const project = /\bproject:\s*(.{3,80})$/im.exec(text);
  return project ? clip(project[1].trim(), 200) : null;
}

/* ------------------------------------------------------------------ parse */

/** Deterministic reading of an ordinary offer email (no provider). Counteroffers use the same reading. */
export function parseOfferText(text: string, userDate: string, draftId: string): IntakeResult {
  const toks = tokens(text);
  const wins = windows(text, toks);
  const unsupported: IntakeResult["unsupported"] = [];
  const notes: string[] = [];
  const usd = toks.filter(t => t.kind === "usd");
  if (!usd.length && toks.some(t => t.kind === "other")) {
    return result(draftId, "unsupported_input", [], [], toks.filter(t => t.kind === "other").map(t => ({ excerpt: t.raw, reason: "Headroom calculates US dollar amounts only." })), notes);
  }
  type Item = { kind: "total" | "payment" | "cost"; t: Token; win: string };
  const items: Item[] = [];
  toks.forEach((t, i) => {
    const win = wins[i], w = win.toLowerCase();
    if (t.kind === "other") { unsupported.push({ excerpt: clip(win.trim(), 300), reason: "Headroom calculates US dollar amounts only." }); return; }
    if (RATE.test(win)) { unsupported.push({ excerpt: clip(win.trim(), 300), reason: "A rate (per hour/day/month) is not a fixed project price. Enter the expected total instead." }); return; }
    if (t.kind === "pct") { items.push({ kind: "payment", t, win }); return; }
    if (COST.test(w) && !TOTAL.test(w)) { items.push({ kind: "cost", t, win }); return; }
    items.push({ kind: TOTAL.test(w) && !REMAINDER.test(w) && !/\b(deposit|upfront|up front|first|initial)\b/.test(w) ? "total" : "payment", t, win });
  });
  // One offer per stated total (distinct projects stay distinct); payments/costs belong to the nearest preceding total.
  const groups: Item[][] = [];
  const paragraphOf = (at: number) => text.slice(0, at).split(/\n\s*\n/).length - 1;
  const paragraphs = text.split(/\n\s*\n/);
  const noTotals = !items.some(x => x.kind === "total");
  for (const it of items) {
    const prev = groups.at(-1);
    const newParagraph = prev && paragraphOf(prev.at(-1)!.t.start) !== paragraphOf(it.t.start);
    const separate = newParagraph && (noTotals || /^\s*(separately|also|another|in addition|second(ly)?|plus)\b/i.test(paragraphs[paragraphOf(it.t.start)]));
    if (separate && it.kind !== "total") { groups.push([it]); continue; }
    if (it.kind === "total") {
      const prev = groups.at(-1);
      const sameTotal = prev?.find(x => x.kind === "total");
      if (prev && (!sameTotal || sameTotal.t.cents === it.t.cents) && !/\n\s*\n/.test(text.slice(prev[0].t.end, it.t.start))) { if (!sameTotal) prev.push(it); continue; }
      groups.push([it]);
    } else (groups.at(-1) ?? (groups[0] = [], groups[0])).push(it);
  }
  // "We can do $13,000: $5,000 on Dec 15 and $8,000 on Jan 6" — an undated amount equal to the sum of the
  // other stated payments is the total, not a third payment.
  for (const g of groups) {
    if (g.some(x => x.kind === "total")) continue;
    // "$6,000 — half when we start and half when it's done": with shares stated, the one undated dollar amount is the total.
    const usdPays = g.filter(x => x.kind === "payment" && x.t.kind === "usd" && x.t.cents);
    if (g.some(x => x.t.kind === "pct") && usdPays.length === 1 && !resolveDate(usdPays[0].win, userDate) && !CONDITION.test(usdPays[0].win)) { usdPays[0].kind = "total"; continue; }
    const pays = g.filter(x => x.kind === "payment" && x.t.kind === "usd" && x.t.cents);
    for (const x of pays) {
      const others = pays.filter(y => y !== x);
      if (others.length >= 2 && others.reduce((sum, y) => sum + y.t.cents!, 0) === x.t.cents && !resolveDate(x.win, userDate) && !CONDITION.test(x.win)) { x.kind = "total"; break; }
    }
  }
  const title = titleOf(text);
  const offers: ProposedOffer[] = groups.filter(g => g.length).slice(0, 3).map((g, gi) => {
    const own = groups.length > 1 ? titleOf(paragraphs[paragraphOf(g[0].t.start)] ?? "") : null;
    const id = `offer-${gi + 1}`;
    const total = g.find(x => x.kind === "total");
    const payments: ProposedPayment[] = [];
    let n = 0;
    for (const x of g.filter(y => y.kind === "payment")) {
      const cents = x.t.kind === "pct" ? (total?.t.cents ? Math.round(total.t.cents * x.t.pct! / 100) : null) : x.t.cents;
      payments.push(payment(`${id}-p${++n}`, x.win, cents, x.t.raw, userDate));
      if (x.t.kind === "pct" && cents !== null) notes.push(`${x.t.raw} of ${total!.t.raw} is ${dollars(cents)}.`);
    }
    const paid = payments.reduce((s, p) => s + (p.amountCents ?? 0), 0);
    if (total?.t.cents && payments.length && paid < total.t.cents && payments.every(p => p.amountCents !== null)) {
      // "…and the rest on delivery": an unnumbered remainder after the stated parts.
      const after = text.slice(g.at(-1)!.t.end);
      const rest = REMAINDER.exec(after.slice(0, 200));
      if (rest) payments.push(payment(`${id}-p${++n}`, after.slice(rest.index, rest.index + 160), total.t.cents - paid, rest[0], userDate));
    }
    if (total?.t.cents && !payments.length) {
      const scope = text.slice(total.t.start, Math.min(text.length, sentenceEnd(text, total.t.end) + 200));
      payments.push(payment(`${id}-p1`, scope, total.t.cents, total.t.raw, userDate));
    }
    const costs = g.filter(y => y.kind === "cost" && y.t.cents).map((y, i) => {
      const d = resolveDate(y.win, userDate);
      return { id: `${id}-c${i + 1}`, amountCents: y.t.cents!, asWritten: y.t.raw, date: d?.date ?? null, excerpt: clip(y.win.trim(), 300) };
    });
    const tax = /\btax year\s+(20\d\d)\b|\bfor (?:my |our |the )?(20\d\d) (?:taxes|tax return)\b/i.exec(text);
    return {
      id, title: own ?? (gi === 0 ? title : null), currency: "USD",
      totalPrice: total ? { amountCents: total.t.cents, asWritten: total.t.raw, excerpt: clip(total.win.trim(), 300) } : null,
      payments: payments.slice(0, 8), costs: costs.slice(0, 6), costsStated: costs.length > 0, taxYearStated: tax ? Number(tax[1] ?? tax[2]) : null,
      negotiable: {
        price: /\b(budget|price) is (fixed|firm)\b|\bnot negotiable\b/i.test(text) ? false : /\b(flexible|open|negotiable) on (the )?(price|budget|fee)\b/i.test(text) ? true : null,
        schedule: /\b(flexible|open) (on|about) (the )?(timing|schedule|dates|payment dates)\b|\bcan split\b/i.test(text) ? true : null,
      },
    };
  });
  const usable = offers.filter(o => o.payments.length || o.totalPrice);
  return result(draftId, usable.length ? "proposed" : "nothing_found", usable, questionsForOffers(usable, draftId), unsupported, notes);
}

function payment(id: string, win: string, cents: number | null, asWritten: string, userDate: string): ProposedPayment {
  const d = resolveDate(win, userDate);
  const cond = CONDITION.exec(win);
  const status: ProposedPayment["status"] = RECEIVED.test(win) && !FUTURE.test(win) ? "said_received" : "expected";
  return { id, amountCents: cents, amountAsWritten: clip(asWritten, 80), date: d?.date ?? null, dateAsWritten: d ? clip(d.phrase, 80) : null,
    condition: cond ? clip(cond[0], 200) : null, status, excerpt: clip(win.trim(), 300) };
}

function result(draftId: string, outcome: IntakeResult["outcome"], offers: ProposedOffer[], questions: UnresolvedField[], unsupported: IntakeResult["unsupported"], notes: string[]): IntakeResult {
  return { intakeVersion: INTAKE_VERSION, draftId, outcome, offers, questions, unsupported: unsupported.slice(0, 10), provenance: "pattern", providerStatus: "not_consented", notes: notes.slice(0, 10) };
}

/* ------------------------------------------------------------------ questions */

/** Typed questions bound to the offer/payment they resolve. Blocking = needed to calculate accepting the offer. */
export function questionsForOffers(offers: ProposedOffer[], draftId: string): UnresolvedField[] {
  const qs: UnresolvedField[] = [];
  const src = (excerpt: string | null) => ({ draftKind: "intake" as const, draftId, excerpt: excerpt ? clip(excerpt, 300) : null });
  for (const o of offers) {
    const name = o.title ? `“${o.title}”` : "this offer";
    if (!o.payments.length) qs.push({ id: `q-${o.id}-amount`, kind: "amount", subject: { kind: "offer", ref: o.id, field: "payments" }, question: `How much will the client pay for ${name}?`,
      reason: "No amount was found in the message.", options: [], blocking: true, source: src(null) });
    for (const p of o.payments) {
      const label = p.amountCents !== null ? `the ${dollars(p.amountCents)} payment` : "this payment";
      if (p.amountCents === null) qs.push({ id: `q-${p.id}-amount`, kind: "amount", subject: { kind: "payment", ref: p.id, field: "amountCents" },
        question: `How much is this payment${p.condition ? ` (“${p.condition}”)` : ""}?`, reason: "The amount isn't stated.", options: [], blocking: true, source: src(p.excerpt) });
      if (p.date === null) qs.push({ id: `q-${p.id}-date`, kind: "date", subject: { kind: "payment", ref: p.id, field: "date" },
        question: `When do you expect ${label}${p.condition ? ` (“${p.condition}”)` : ""}?`, reason: "The tax year of a payment depends on when the money arrives.", options: [], blocking: true, source: src(p.excerpt) });
      if (p.status !== "expected") qs.push({ id: `q-${p.id}-received`, kind: "choice", subject: { kind: "payment", ref: p.id, field: "status" },
        question: `Has ${label} already arrived?`, reason: "Money already received is a fact; an invoice or promise is only expected.",
        options: [{ value: "received", label: "Yes, it arrived" }, { value: "expected", label: "No, still expected" }], blocking: true, source: src(p.excerpt) });
    }
    const sum = o.payments.reduce((s, p) => s + (p.amountCents ?? 0), 0);
    if (o.totalPrice?.amountCents && o.payments.length && o.payments.every(p => p.amountCents !== null) && sum !== o.totalPrice.amountCents)
      qs.push({ id: `q-${o.id}-total`, kind: "choice", subject: { kind: "offer", ref: o.id, field: "totalPrice" },
        question: `The payments add up to ${dollars(sum)}, but the total says ${dollars(o.totalPrice.amountCents)}. Which is right?`, reason: "Headroom doesn't guess which number is a typo.",
        options: [{ value: "payments", label: `The payments (${dollars(sum)} in total)` }, { value: "total", label: `The total (${dollars(o.totalPrice.amountCents)}); I'll correct the payments` }], blocking: true, source: src(o.totalPrice.excerpt) });
    for (const c of o.costs) if (c.date === null) qs.push({ id: `q-${c.id}-date`, kind: "date", subject: { kind: "cost", ref: c.id, field: "date" },
      question: `When will you pay the ${dollars(c.amountCents)} cost?`, reason: "Costs count in the year they are paid.", options: [], blocking: true, source: src(c.excerpt) });
    if (!o.costsStated) qs.push({ id: `q-${o.id}-costs`, kind: "amount", subject: { kind: "offer", ref: o.id, field: "costs" },
      question: `Will ${name} have costs you pay (software, subcontractors, materials)? Enter 0 if none.`, reason: "The message doesn't mention costs; they are unknown, not zero.", options: [], blocking: false, source: src(null) });
  }
  if (offers.length > 1) qs.push({ id: "q-which-offer", kind: "choice", subject: { kind: "offer", ref: offers[0].id, field: "selected" },
    question: "The message has more than one offer. Which one should Headroom check first?", reason: "Each offer is checked separately.",
    options: offers.map(o => ({ value: o.id, label: o.title ?? `${o.totalPrice ? dollars(o.totalPrice.amountCents ?? 0) : "Offer"}` })), blocking: false, source: src(null) });
  return qs.slice(0, 40);
}

/* ------------------------------------------------------------------ onboarding draft */

export const ONBOARDING_STORAGE_KEY = "headroom.onboarding.v1";
const store = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function loadOnboardingDraft(storage: Storage | null = store()): OnboardingDraft | null {
  try {
    const raw = storage?.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = OnboardingDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function saveOnboardingDraft(draft: OnboardingDraft, storage: Storage | null = store()): boolean {
  try { storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })); return !!storage; } catch { return false; }
}
export function clearOnboardingDraft(storage: Storage | null = store()) { try { storage?.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* storage blocked */ } }

/** Start (or replace the offers of) a draft from an intake result. `keepText` false drops the pasted text. */
export function draftFromIntake(result: IntakeResult, text: string | null, previous: OnboardingDraft | null = null): OnboardingDraft {
  const at = new Date().toISOString();
  return {
    draftVersion: ONBOARDING_DRAFT_VERSION, id: result.draftId, createdAt: previous?.createdAt ?? at, updatedAt: at,
    text: text ? text.slice(0, 8_000) : null, intake: { provenance: result.provenance, providerStatus: result.providerStatus },
    offers: result.offers, selectedOfferId: result.offers[0]?.id ?? null, facts: previous?.facts ?? [],
    questions: [...result.questions, ...(previous?.questions.filter(q => q.source.draftKind !== "intake") ?? [])].slice(0, 40),
    answers: previous?.answers.filter(a => !result.questions.some(q => q.id === a.fieldId)) ?? [],
    profileDraft: previous?.profileDraft ?? null, status: "collecting", convertedWorkspaceId: null,
  };
}

/** Questions still open (unanswered, or answered "unknown" while blocking). */
export function openQuestions(draft: OnboardingDraft): UnresolvedField[] {
  return draft.questions.filter(q => { const a = draft.answers.find(x => x.fieldId === q.id); return !a || (a.kind === "unknown" && q.blocking); });
}

/**
 * Apply a typed answer to the exact draft item it is bound to. Returns a new draft; nothing is re-parsed.
 * Throws on an answer of the wrong kind for its question.
 */
export function answerQuestion(draft: OnboardingDraft, answer: TypedAnswer): OnboardingDraft {
  const q = draft.questions.find(x => x.id === answer.fieldId);
  if (!q) throw new Error("This question is no longer part of the draft.");
  if (answer.kind !== "unknown" && answer.kind !== q.kind) throw new Error(`This question needs a ${q.kind.replace("_", " ")}.`);
  const next: OnboardingDraft = structuredClone(draft);
  next.answers = [...next.answers.filter(a => a.fieldId !== q.id), answer];
  const offerOf = (ref: string) => next.offers.find(o => o.id === ref || o.payments.some(p => p.id === ref) || o.costs.some(c => c.id === ref));
  const o = offerOf(q.subject.ref);
  if (o && answer.kind !== "unknown") {
    const p = o.payments.find(x => x.id === q.subject.ref);
    if (q.subject.kind === "payment" && p) {
      if (answer.kind === "date") p.date = answer.date;
      if (answer.kind === "amount") p.amountCents = answer.amountCents > 0 ? answer.amountCents : null;
      if (answer.kind === "choice") p.status = answer.value === "received" ? "said_received" : "expected";
    } else if (q.subject.kind === "cost" && answer.kind === "date") {
      const c = o.costs.find(x => x.id === q.subject.ref); if (c) c.date = answer.date;
    } else if (q.subject.field === "payments" && answer.kind === "amount" && answer.amountCents > 0) {
      const id = `${o.id}-p${o.payments.length + 1}`;
      o.payments.push({ id, amountCents: answer.amountCents, amountAsWritten: null, date: null, dateAsWritten: null, condition: null, status: "expected", excerpt: "" });
      next.questions.push({ id: `q-${id}-date`, kind: "date", subject: { kind: "payment", ref: id, field: "date" }, question: `When do you expect the ${dollars(answer.amountCents)} payment?`,
        reason: "The tax year of a payment depends on when the money arrives.", options: [], blocking: true, source: q.source });
    } else if (q.subject.field === "totalPrice" && answer.kind === "choice" && answer.value === "payments") {
      o.totalPrice = null;
    } else if (q.subject.field === "costs" && answer.kind === "amount") {
      o.costsStated = true;
      if (answer.amountCents > 0) {
        const id = `${o.id}-c${o.costs.length + 1}`;
        o.costs.push({ id, amountCents: answer.amountCents, asWritten: dollars(answer.amountCents), date: null, excerpt: "" });
        next.questions.push({ id: `q-${id}-date`, kind: "date", subject: { kind: "cost", ref: id, field: "date" }, question: `When will you pay the ${dollars(answer.amountCents)} cost?`,
          reason: "Costs count in the year they are paid.", options: [], blocking: true, source: q.source });
      }
    } else if (q.subject.field === "selected" && answer.kind === "choice" && next.offers.some(x => x.id === answer.value)) {
      next.selectedOfferId = answer.value;
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/** The add_offered_project command for a fully answered offer (null + questions when something blocking is open). */
export function offerCommand(draft: OnboardingDraft, ownerPersonId: string | null): { command: ChangeCommand | null; open: UnresolvedField[] } {
  const offer = draft.offers.find(o => o.id === draft.selectedOfferId) ?? draft.offers[0];
  if (!offer) return { command: null, open: [] };
  const mine = (q: UnresolvedField) => q.subject.ref === offer.id || offer.payments.some(p => p.id === q.subject.ref) || offer.costs.some(c => c.id === q.subject.ref);
  const open = openQuestions(draft).filter(q => q.blocking && mine(q));
  if (open.length) return { command: null, open };
  const received = offer.payments.filter(p => p.status === "said_received").map(p => ({ amountCents: p.amountCents!, date: p.date! }));
  const unpaid = offer.payments.filter(p => p.status !== "said_received").map(p => ({ amountCents: p.amountCents!, date: p.date! }));
  const sum = [...received, ...unpaid].reduce((s, p) => s + p.amountCents, 0);
  return { open: [], command: {
    type: "add_offered_project", title: clip(offer.title ?? "Client offer", 200), ownerPersonId,
    totalPriceCents: offer.totalPrice?.amountCents === sum ? sum : null, received: received.slice(0, 4), unpaid: unpaid.slice(0, 6),
    expenses: offer.costs.filter(c => c.date).map(c => ({ amountCents: c.amountCents, date: c.date! })).slice(0, 6),
    priceNegotiable: offer.negotiable.price, scheduleNegotiable: offer.negotiable.schedule,
  } };
}

/**
 * Explicit, confirmed conversion: the household from Claude 1's form (`buildWorkspace`) plus the selected
 * offer through the shared add_offered_project path (same checks as any confirmed change; original offer
 * captured). Nothing is saved here: the caller saves the returned workspace as revision 1.
 */
export async function onboardingToWorkspace(draft: OnboardingDraft, buildWorkspace: () => HouseholdWorkspace, opts: { userDate: string; ownerPersonId?: string | null } ):
  Promise<{ conversion: OnboardingConversion; workspace: HouseholdWorkspace | null }> {
  const base = buildWorkspace();
  const adults = base.household.people.filter(p => p.role !== "dependent");
  const owner = opts.ownerPersonId ?? (adults.length === 1 ? adults[0].id : null);
  const offer = draft.offers.find(o => o.id === draft.selectedOfferId) ?? draft.offers[0];
  if (!offer) return { conversion: { status: "converted", workspaceId: base.id, projectId: null }, workspace: base };
  const { command, open } = offerCommand(draft, owner);
  if (!owner) open.push({ id: `q-${offer.id}-owner`, kind: "person", subject: { kind: "offer", ref: offer.id, field: "ownerPersonId" }, question: "Whose business is this offer for?",
    reason: "Income belongs to the person whose business earns it.", options: adults.map(a => ({ value: a.id, label: a.role === "spouse" ? "My spouse" : "Me" })), blocking: true,
    source: { draftKind: "intake", draftId: draft.id, excerpt: null } });
  if (!command || open.length) return { conversion: { status: "needs_answers", questions: open }, workspace: null };
  const { applyChangeProposal, proposalBaseFingerprint } = await import("./workspace-commands");
  const excerpt = offer.totalPrice?.excerpt || offer.payments[0]?.excerpt || "";
  const proposal: ChangeProposal = { id: `intake-${draft.id}`.slice(0, 120), createdAt: new Date().toISOString(), base: { workspaceId: base.id, revision: base.revision, fingerprint: await proposalBaseFingerprint(base) },
    intent: "offer", commands: [{ ...command, ownerPersonId: owner } as ChangeCommand], ambiguities: [], resolvedDates: [], evidence: excerpt ? [{ documentId: null, excerpt: clip(excerpt, 200) }] : [],
    provenance: draft.intake?.provenance === "ai_model" ? "ai_model" : "manual", status: "proposed" };
  try {
    const { workspace } = await applyChangeProposal(base, proposal, new Date().toISOString(), { userDate: opts.userDate });
    const project = workspace.projects.at(-1)!;
    return { conversion: { status: "converted", workspaceId: workspace.id, projectId: project.id }, workspace };
  } catch (e) {
    const fields = (e as { blockers?: Array<{ path: string; reason: string }> }).blockers ?? [];
    return { conversion: { status: "invalid", message: e instanceof Error ? e.message : "This offer can't be added.", fields }, workspace: null };
  }
}

/** Counteroffer from an intake result: the record_client_response command for one project (received money kept). */
export function counterofferCommand(offer: ProposedOffer, projectId: string, respondedOn: string, receivedCents: number): ChangeCommand | null {
  const unpaid = offer.payments.filter(p => p.status !== "said_received" && p.amountCents !== null && p.date !== null).map(p => ({ amountCents: p.amountCents!, date: p.date! }));
  if (!unpaid.length || unpaid.length !== offer.payments.filter(p => p.status !== "said_received").length) return null;
  const sum = unpaid.reduce((s, p) => s + p.amountCents, 0) + receivedCents;
  return { type: "record_client_response", projectId, response: "countered", respondedOn, packageId: null,
    counter: { totalPriceCents: offer.totalPrice?.amountCents === sum ? sum : null, unpaid: unpaid.slice(0, 6), note: null } };
}

export type { ProviderStatus };
