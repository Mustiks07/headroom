/**
 * Explanation packets (round 5): machine-readable explanations built ONLY from verified engine results.
 *
 * Every number or date a statement shows is a `{ref}` placeholder pointing at a fact in the packet,
 * and every fact comes from a result calculated now (or the stored snapshot of a recorded decision,
 * re-verified only when the same engine and rules are available). A provider may rephrase the
 * statements but may not add numbers or advice: `numbersNotInPacket` checks a text against the packet.
 *
 * Standard questions answered per subject: why_worse ("Why am I worse off?"), why_january
 * ("Why January?"), client_refuses ("What if the client refuses?"), what_changes ("What would change
 * your answer?"). Each is answered from results or returns the exact fact that is missing.
 */
import type { BlockedComparison, TaxYear, YearResult } from "@/domain/contracts";
import { DecisionRecordSchema, type DecisionRecord, type ExplanationPacket } from "@/domain/assistance";
import { dealSearchFingerprint, DealGoalSchema, DealVariantSchema, type DealGoal, type DealVariant } from "@/domain/deal-planning";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { evaluateDecisionSensitivity, evaluateTermsExact, searchDealTerms, type ExactTerms } from "../deal";
import { buildHouseholdProjection, engineWorkspaceFingerprint, evaluateHouseholdWorkspace } from "../household";
import { formatUsd } from "../money";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";

export type ExplanationQuestion = "why_worse" | "why_january" | "client_refuses" | "what_changes";
type Fact = ExplanationPacket["facts"][number];

export interface ExplanationAnswer {
  question: ExplanationQuestion;
  status: "answered" | "unresolved";
  /** Deterministic sentences with {ref} placeholders. */
  statements: string[];
  /** When unresolved: the exact fact or step that is missing. */
  missing: string | null;
}

/** Contract packet + standard answers and the next action (additive). */
export interface EngineExplanationPacket extends ExplanationPacket {
  answers: ExplanationAnswer[];
  nextAction: string | null;
  /** Source/rule ids behind the figures (IRS/CMS ids from the rule pack and the user's evidence ids). */
  sourceIds: string[];
}

class Packet {
  facts: Fact[] = [];
  money(ref: string, label: string, valueCents: number) { this.facts.push({ ref, label, kind: "money", valueCents }); return `{${ref}}`; }
  date(ref: string, label: string, date: string) { this.facts.push({ ref, label, kind: "date", date }); return `{${ref}}`; }
  text(ref: string, label: string, text: string) { this.facts.push({ ref, label, kind: "text", text }); return `{${ref}}`; }
}

/** Fill placeholders deterministically (the default explanation without a provider). */
export function renderStatements(packet: Pick<ExplanationPacket, "facts">, statements: string[]): string {
  const byRef = new Map(packet.facts.map(f => [f.ref, f]));
  return statements.map(s => s.replace(/\{([a-z0-9_]+)\}/gi, (_m, ref: string) => {
    const f = byRef.get(ref);
    if (!f) throw new Error(`Unknown explanation reference ${ref}`);
    return f.kind === "money" ? formatUsd(f.valueCents!) : f.kind === "date" ? f.date! : f.kind === "percent" ? `${f.percent}%` : f.text!;
  })).join(" ");
}

/**
 * Numbers and dates in a (provider) text that the packet does not contain. Empty = every figure is
 * backed by the packet. Years 2026/2027/2028 and small counts (≤ 12) are allowed as words of the text.
 */
export function numbersNotInPacket(packet: Pick<ExplanationPacket, "facts">, text: string): string[] {
  const allowedMoney = new Set(packet.facts.filter(f => f.kind === "money").flatMap(f => [Math.abs(f.valueCents!), f.valueCents!]).map(c => c));
  const allowedDates = new Set(packet.facts.filter(f => f.kind === "date").map(f => f.date!));
  const out: string[] = [];
  for (const m of text.matchAll(/-?\$\s?\d[\d,]*(?:\.\d{1,2})?/g)) {
    const cents = Math.round(Number(m[0].replace(/[$,\s]/g, "")) * 100);
    if (!allowedMoney.has(cents) && !allowedMoney.has(-cents)) out.push(m[0]);
  }
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) if (!allowedDates.has(m[0])) out.push(m[0]);
  for (const m of text.replace(/-?\$\s?\d[\d,]*(?:\.\d{1,2})?/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").matchAll(/\b\d[\d,]*(?:\.\d+)?%?/g)) {
    const n = m[0];
    if (/^(2026|2027|2028)$/.test(n) || (/^\d+$/.test(n) && Number(n) <= 12)) continue;
    out.push(n);
  }
  return out;
}

const YEARS: TaxYear[] = [2026, 2027];
const absWord = (p: Packet, ref: string, label: string, cents: number, up: string, down: string) => `${p.money(ref, label, Math.abs(cents))} ${cents >= 0 ? up : down}`;

/** Build the packet for one subject. `refId`: package id or goal id (deal_choice), project id (agreed_plan). */
export async function buildExplanationPacket(raw: HouseholdWorkspace, subject: "current_year" | "deal_choice" | "agreed_plan", refId?: string): Promise<EngineExplanationPacket | BlockedComparison> {
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) return { status: "needs_data", code: "INVALID_WORKSPACE", message: "Part of the household plan needs review first.", fields: parsed.error.issues.map(i => ({ path: i.path.map(String).join("."), reason: i.message })) };
  const ws = parsed.data;
  if (subject === "current_year") return currentYear(ws);
  if (subject === "agreed_plan") return agreedPlan(ws, refId);
  return dealChoice(ws, refId);
}

async function currentYear(ws: HouseholdWorkspace): Promise<EngineExplanationPacket | BlockedComparison> {
  const pr = await buildHouseholdProjection(ws);
  if (pr.status !== "ready") return pr;
  const r = pr.currentRisk;
  if (!r) return { status: "needs_data", code: "NO_CURRENT_RESULT", message: "The current-year position is not available yet.", fields: [{ path: "household.years[0]", reason: pr.warnings.find(w => w.startsWith("Current-year")) ?? "Missing facts." }] };
  const p = new Packet();
  const statements: string[] = [];
  const magi = p.money("magi_2026", "Household income for the subsidy (2026)", r.forecastMagiCents);
  const limit = p.money("limit_2026", "Income limit for the credit (400% of the poverty line, 2026)", r.thresholdMagiCents);
  const credit = p.money("credit_2026", "Premium tax credit for 2026", r.subsidyCents);
  statements.push(`Your 2026 household income for the subsidy is ${magi}; the credit stops above ${limit}.`);
  statements.push(r.state === "no_credit" ? `No premium tax credit is due for 2026 on these facts.` : `Your 2026 premium tax credit is ${credit}.`);
  if (r.advanceSettlementCents !== 0) statements.push(`At filing you ${r.advanceSettlementCents > 0 ? "repay" : "receive"} ${p.money("settlement_2026", "Settlement of the advance credit at filing (2026)", Math.abs(r.advanceSettlementCents))} compared with the advance already paid.`);
  const room = r.additionalProfitHeadroomCents;
  if (room !== null) statements.push(`${p.money("room_2026", "Extra 2026 business profit still possible before the credit is lost", room)} more business profit in 2026 would still keep the credit; more than that ends it.`);
  const answers: ExplanationAnswer[] = [
    r.state === "over_cliff"
      ? { question: "why_worse", status: "answered", missing: null, statements: [`Household income ${magi} is above ${limit}, so no credit is allowed for 2026 and the advance credit is repaid at filing.`] }
      : { question: "why_worse", status: "answered", missing: null, statements: [`On these facts the 2026 credit is kept (${credit}).`] },
    { question: "why_january", status: "unresolved", statements: [], missing: "No payment timing is part of the current-year check. Ask about a specific offer to compare payment dates." },
    { question: "client_refuses", status: "unresolved", statements: [], missing: "No offer is part of the current-year check." },
    room !== null ? { question: "what_changes", status: "answered", missing: null, statements: ["More than {room_2026} of extra 2026 business profit would end the 2026 credit."] }
      : { question: "what_changes", status: r.state === "over_cliff" ? "answered" : "unresolved", missing: r.state === "over_cliff" ? null : "No credit limit applies to these facts.",
        statements: r.state === "over_cliff" ? [`Household income would have to fall to ${limit} or less (for example through an allowed SEP-IRA contribution) to restore the credit.`] : [] },
  ];
  return { id: `pkt-current-${pr.fingerprint.slice(0, 12)}`, subject: "current_year", fingerprint: pr.fingerprint, facts: p.facts, statements, answers,
    limitations: [...r.headroomAssumptions.slice(0, 4), ...pr.warnings.slice(0, 4), "Planning estimate; not a Marketplace eligibility decision or tax advice."],
    nextAction: r.state === "at_risk" ? "Before accepting more work this year, check the offer in Headroom." : null,
    sourceIds: [...new Set(r.trace.flatMap(t => t.sourceIds))] };
}

async function agreedPlan(ws: HouseholdWorkspace, projectId?: string): Promise<EngineExplanationPacket | BlockedComparison> {
  const ev = await evaluateHouseholdWorkspace(ws);
  if (ev.status !== "ready") return ev;
  const p = new Packet();
  const statements: string[] = [];
  const answers: ExplanationAnswer[] = [];
  const changes: string[] = [];
  for (const y of ev.fixedPlan.years) {
    if (!y.risk) continue;
    const credit = p.money(`credit_${y.year}`, `Premium tax credit with the plan as agreed (${y.year})`, y.risk.ptcCents);
    statements.push(`${y.year}: with everything agreed so far, the premium tax credit is ${credit}${y.risk.settlementCents ? ` and at filing you ${y.risk.settlementCents > 0 ? "repay" : "receive"} ${p.money(`settlement_${y.year}`, `Settlement at filing (${y.year})`, Math.abs(y.risk.settlementCents))}` : ""}.`);
    if (y.risk.additionalProfitHeadroomCents !== null) changes.push(`More than ${p.money(`room_${y.year}`, `Extra ${y.year} profit still possible before the credit is lost`, y.risk.additionalProfitHeadroomCents)} of extra ${y.year} business profit would end the ${y.year} credit under the agreed plan.`);
  }
  if (changes.length) answers.push({ question: "what_changes", status: "answered", missing: null, statements: changes });
  for (const s of ev.sep) if (s.targetCents !== null && s.targetCents > 0)
    statements.push(`SEP-IRA for ${s.year}: goal ${p.money(`sep_goal_${s.year}`, `SEP-IRA goal ${s.year}`, s.targetCents)}, paid ${p.money(`sep_paid_${s.year}`, `SEP-IRA paid ${s.year}`, s.paidCents)}, still to pay ${p.money(`sep_left_${s.year}`, `SEP-IRA still to pay ${s.year}`, s.remainingCents)}.`);
  if (ev.agreed.result) statements.push(`The open agreements (payments still expected and SEP-IRA still to pay) change spendable cash by ${p.money("agreed_cash", "Cash change of the open agreements over both years", ev.agreed.result.twoYearCashDeltaCents)} compared with only what already happened.`);
  if (!ev.agreed.stillFeasible) for (const [i, reason] of ev.agreed.reasons.entries()) statements.push(`Problem ${i + 1}: ${p.text(`problem_${i + 1}`, "Problem with the agreed plan", reason)}`);
  answers.push(ev.agreed.creditLostYears.length
    ? { question: "why_worse", status: "answered", missing: null, statements: [`The open agreements push household income above the limit in ${p.text("lost_years", "Years whose credit the agreements lose", ev.agreed.creditLostYears.join(" and "))}.`] }
    : { question: "why_worse", status: "answered", missing: null, statements: ["No credit is lost by the open agreements."] });
  answers.push({ question: "why_january", status: "unresolved", statements: [], missing: projectId ? "Ask about this project's terms to compare payment dates." : "Choose the project whose payment dates you want explained." });
  answers.push({ question: "client_refuses", status: "unresolved", statements: [], missing: "The agreed plan is already agreed; ask about a specific project to compare other terms." });
  if (!answers.some(a => a.question === "what_changes")) answers.push({ question: "what_changes", status: "unresolved", statements: [], missing: "No credit limit applies to the calculated years." });
  return { id: `pkt-agreed-${ev.fingerprint.slice(0, 12)}`, subject: "agreed_plan", fingerprint: ev.fingerprint, facts: p.facts, statements, answers,
    limitations: [...ev.warnings.slice(0, 5), "Fixed agreements on current facts; amounts and dates are not re-optimized."],
    nextAction: ev.agreed.stillFeasible ? null : "Review the agreed plan: it no longer works on the current facts.", sourceIds: ws.evidence.map(e => e.id).slice(0, 30) };
}

async function dealChoice(ws: HouseholdWorkspace, refId?: string): Promise<EngineExplanationPacket | BlockedComparison> {
  const dp = ws.dealPlanning;
  const pkg = dp?.packages.find(x => x.id === refId);
  const goal = pkg ? dp!.goals.find(g => g.id === pkg.goalId) : dp?.goals.find(g => g.id === refId) ?? dp?.goals.at(-1);
  if (!goal) return { status: "needs_data", code: "NO_GOAL", message: "Set a goal for the project first.", fields: [{ path: "dealPlanning.goals", reason: "No goal." }] };
  const space = dp!.termSpaces.find(t => t.projectId === goal.projectId);
  if (!space) return { status: "needs_data", code: "NO_TERMS", message: "Set the allowed terms first.", fields: [{ path: "dealPlanning.termSpaces", reason: "No allowed terms." }] };
  const cash = dp!.cashContext;
  const fp = await dealSearchFingerprint(await engineWorkspaceFingerprint(ws), goal, space, cash, ENGINE_VERSION, RULES_VERSION);
  let variant: DealVariant;
  if (pkg) {
    if (pkg.searchFingerprint !== fp) return { status: "needs_data", code: "STALE_RESULT", message: "This saved choice was calculated on earlier facts. Its record stays as it was; search again for current figures.", fields: [{ path: `dealPlanning.packages.${pkg.id}`, reason: "Facts, goal or terms changed since it was calculated." }] };
    variant = pkg.variant;
  } else {
    const r = await searchDealTerms(ws, goal, space, cash);
    if (r.status !== "ready") return r.status === "no_feasible_terms"
      ? { status: "needs_data", code: "NO_FEASIBLE_TERMS", message: "No terms in your limits meet the goal; see the search explanation.", fields: r.violated.map(v => ({ path: `goal.${v.id}`, reason: v.detail })) } : r;
    variant = r.variants.find(v => v.id === r.recommendedVariantId) ?? r.variants[0];
  }
  const ex = evaluateTermsExact(ws, goal, variant.terms);
  if (ex.status !== "ready") return ex;
  return dealPacket(ws, goal, variant, ex, fp);
}

/** Decomposition per year: cash change = profit change − ΔSE tax − Δ income tax + Δ credit − SEP (identity of the year engine). */
function attribution(d: YearResult, c: YearResult) {
  const cash = c.spendableAfterSettlementCents - d.spendableAfterSettlementCents;
  const se = c.selfEmploymentTaxCents - d.selfEmploymentTaxCents, tax = c.federalIncomeTaxCents - d.federalIncomeTaxCents, credit = c.ptcCents - d.ptcCents;
  const sep = c.additionalRetirementCents - d.additionalRetirementCents, fica = c.employeeFicaCents - d.employeeFicaCents;
  return { cash, se, tax, credit, sep, profit: cash + se + tax + fica - credit + sep };
}

export interface TermsDecomposition {
  /** Cash change of the offer as it stands and of the chosen terms, both against the goal's baseline. */
  offeredCashCents: number;
  chosenCashCents: number;
  /** Sequential steps from the offer to the chosen terms; each is a full recalculation, so they add up exactly. */
  steps: Array<{ id: "dates" | "price" | "retirement"; label: string; cashCents: number; retirementCents: number }>;
  order: string;
}

/**
 * Split the difference between the offer as it stands and the chosen terms into dates → price → SEP-IRA.
 * Effects interact (moving money between years changes the tax on a price change), so the steps are taken
 * in this fixed order on one path; their sum equals the full difference exactly. Another order gives other
 * step sizes with the same total.
 */
export function decomposeVersusOffer(ws: HouseholdWorkspace, goal: DealGoal, terms: DealVariant["terms"]): TermsDecomposition | BlockedComparison {
  const project = ws.projects.find(p => p.id === goal.projectId);
  if (!project) return { status: "needs_data", code: "CANDIDATE_MISSING", message: "Project not found.", fields: [{ path: "projects", reason: goal.projectId }] };
  const received = project.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0);
  const offered = project.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected).map(l => ({ id: l.id, ...l.expected! }));
  const offeredUnpaid = offered.reduce((a, q) => a + q.amountCents, 0);
  const unpaid = terms.priceCents - received;
  const at = (t: DealVariant["terms"]) => evaluateTermsExact(ws, goal, t);
  // Step 1: the chosen dates and shares at the offered price.
  let left = offeredUnpaid;
  const scaled = terms.payments.map((q, i) => {
    const amt = i === terms.payments.length - 1 ? left : Math.round((offeredUnpaid * q.amountCents) / unpaid);
    left -= amt;
    return { ...q, amountCents: amt };
  }).filter(q => q.amountCents > 0);
  const points = [at({ priceCents: received + offeredUnpaid, payments: offered, additionalSep: null }),
    at({ priceCents: received + offeredUnpaid, payments: scaled, additionalSep: null }),
    at({ ...terms, additionalSep: null }), at(terms)];
  const bad = points.find((x): x is BlockedComparison => x.status !== "ready");
  if (bad) return bad;
  const cash = points.map(x => (x as ExactTerms).cashDeltaCents);
  return { offeredCashCents: cash[0], chosenCashCents: cash[3], order: "dates first (at the offered price), then the price, then the extra SEP-IRA",
    steps: [
      { id: "dates", label: "New payment dates at the offered price", cashCents: cash[1] - cash[0], retirementCents: 0 },
      { id: "price", label: "The different price, on the new dates", cashCents: cash[2] - cash[1], retirementCents: 0 },
      { id: "retirement", label: "The extra SEP-IRA contribution", cashCents: cash[3] - cash[2], retirementCents: terms.additionalSep?.amountCents ?? 0 },
    ].filter(x => x.cashCents !== 0 || x.retirementCents !== 0) as TermsDecomposition["steps"] };
}

async function dealPacket(ws: HouseholdWorkspace, goal: DealGoal, variant: DealVariant, ex: ExactTerms, fp: string): Promise<EngineExplanationPacket> {
  const p = new Packet();
  const t = variant.terms;
  const statements: string[] = [];
  const price = p.money("price", "Total asked price (incl. money already received)", t.priceCents);
  const received = p.money("received", "Already received from this project", ex.receivedCents);
  const unpaid = p.money("unpaid", "Still to be paid under these terms", t.priceCents - ex.receivedCents);
  const base = p.text("baseline", "Compared with", ex.baselineKind === "decline_unpaid_terms" ? `your plan without the unpaid terms of "${ex.title}"` : `"${ex.title}" exactly as offered`);
  statements.push(ex.receivedCents ? `You ask ${price} in total: ${received} already received and ${unpaid} still to be paid.` : `You ask ${price} in total, all still to be paid.`);
  t.payments.forEach((q, i) => statements.push(`Payment ${i + 1}: ${p.money(`pay_${i + 1}_amount`, `Payment ${i + 1}`, q.amountCents)} on ${p.date(`pay_${i + 1}_date`, `Payment ${i + 1} date`, q.date)}.`));
  statements.push(`Compared with ${base}, these terms leave ${absWord(p, "cash_delta", "Change in spendable cash after both tax years are settled", ex.cashDeltaCents, "more", "less")} spendable cash after both tax returns are settled.`);
  if (t.additionalSep) statements.push(`${p.money("sep_extra", "Extra SEP-IRA contribution", t.additionalSep.amountCents)} goes into your SEP-IRA for ${t.additionalSep.year}: retirement money, not spendable cash. It lowers household income for the credit.`);
  for (const [yi, y] of YEARS.entries()) {
    const a = attribution(ex.decline[yi], ex.chosen[yi]);
    const receipts = t.payments.filter(q => q.date.startsWith(`${y}-`)).reduce((s, q) => s + q.amountCents, 0);
    if (!receipts && !a.cash) continue;
    const parts = [`profit ${absWord(p, `profit_${y}`, `Business profit change ${y}`, a.profit, "higher", "lower")}`];
    if (a.se) parts.push(`self-employment tax ${absWord(p, `se_${y}`, `Self-employment tax change ${y}`, a.se, "more", "less")}`);
    if (a.tax) parts.push(`income tax ${absWord(p, `tax_${y}`, `Federal income tax change ${y}`, a.tax, "more", "less")}`);
    if (a.credit) parts.push(`premium tax credit ${absWord(p, `credit_change_${y}`, `Premium tax credit change ${y}`, a.credit, "more", "less")}`);
    statements.push(`${y}: ${parts.join(", ")}; net ${absWord(p, `cash_${y}`, `Spendable cash change ${y}`, a.cash, "more", "less")} (settled with the return due ${p.date(`due_${y}`, `Return due date ${y}`, ex.dueDates[yi])}).`);
  }
  const dec = decomposeVersusOffer(ws, goal, t);
  if ("steps" in dec && dec.steps.length && (t.priceCents !== ex.offeredPriceCents || t.additionalSep || JSON.stringify(t.payments.map(q => q.date)) !== JSON.stringify(ws.projects.find(x => x.id === goal.projectId)!.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected).map(l => l.expected!.date)))) {
    statements.push(`Compared with the offer as it stands (${p.money("offered_vs_base", "Cash change of the offer as it stands", dec.offeredCashCents)}), the difference comes from: ${dec.steps.map((st, i) => `${st.label.toLowerCase()} ${absWord(p, `step_${i + 1}`, st.label, st.cashCents, "more", "less")}`).join("; ")} (in this order; each step is fully recalculated).`);
  }
  const limitations = ["The difference is measured against the baseline named above; it is not savings caused by Headroom.",
    "Asked terms are proposals until the client confirms in writing.", "Planning estimate on your entries; not tax advice or a Marketplace eligibility decision."];

  const answers: ExplanationAnswer[] = [];
  // Why am I worse off?
  const off = ex.offered;
  if (ex.cashDeltaCents < 0) {
    const worstYear = YEARS.map((y, yi) => ({ y, a: attribution(ex.decline[yi], ex.chosen[yi]) })).sort((x, z) => x.a.cash - z.a.cash)[0];
    const y = worstYear.y;
    answers.push({ question: "why_worse", status: "answered", missing: null, statements: [
      `In ${y} the project changes profit by {profit_${y}}, but self-employment tax, income tax${worstYear.a.credit ? ` and the premium tax credit ({credit_change_${y}})` : ""} take more than that: net {cash_${y}}.`] });
  } else if (off && off.cashDeltaCents < 0 && ex.baselineKind === "decline_unpaid_terms") {
    const lost = YEARS.filter((_y, yi) => ex.decline[yi].ptcCents > 0 && off.years[yi].ptcCents === 0);
    const offCash = p.money("offered_cash_abs", "Cash lost with the offer as it stands", -off.cashDeltaCents);
    answers.push({ question: "why_worse", status: "answered", missing: null, statements: [`As offered, the project would leave you ${offCash} worse off${lost.length ? `: the ${lost.join(" and ")} premium tax credit of ${lost.map(y => p.money(`credit_before_${y}`, `Premium tax credit without the project ${y}`, ex.decline[YEARS.indexOf(y)].ptcCents)).join(" and ")} would be lost` : ""}. These terms avoid that.`] });
  } else answers.push({ question: "why_worse", status: "answered", missing: null, statements: [`These terms do not leave you worse off than the baseline: {cash_delta} ${ex.cashDeltaCents >= 0 ? "more" : "less"}.`] });

  // Why January?
  const jan = t.payments.filter(q => q.date >= "2027-01-01");
  if (!jan.length) answers.push({ question: "why_january", status: "answered", missing: null, statements: ["These terms have no payment in 2027."] });
  else {
    const last2026 = t.payments.filter(q => q.date < "2027-01-01").map(q => q.date).sort().at(-1) ?? "2026-12-31";
    const alt = evaluateTermsExact(ws, goal, { ...t, payments: [{ id: "all-2026", date: last2026, amountCents: t.payments.reduce((s, q) => s + q.amountCents, 0) }] });
    if (alt.status !== "ready") answers.push({ question: "why_january", status: "unresolved", statements: [], missing: `Paying everything in 2026 cannot be calculated: ${alt.message}` });
    else {
      const lost = YEARS.filter((_y, yi) => ex.chosen[yi].ptcCents > 0 && alt.chosen[yi].ptcCents === 0);
      answers.push({ question: "why_january", status: "answered", missing: null, statements: [
        `If all ${unpaid} were paid on ${p.date("alt_date", "Single 2026 payment date compared", last2026)}, the change in spendable cash would be ${p.money("alt_cash", "Cash change if everything were paid in 2026", alt.cashDeltaCents)} instead of {cash_delta}${lost.length ? `, because the ${lost.join(" and ")} premium tax credit would be lost` : ""}. Money received in January counts in 2027 income.`] });
    }
  }
  // What if the client refuses?
  if (off) answers.push({ question: "client_refuses", status: "answered", missing: null, statements: [
    `If the client keeps the original terms (${p.money("offered_price", "Offered total price", ex.offeredPriceCents)} as offered), the change compared with ${base} is ${p.money("offered_cash", "Cash change with the offer as it stands", off.cashDeltaCents)}. If the project does not go ahead, your plan stays as it is without it.`] });
  else answers.push({ question: "client_refuses", status: "unresolved", statements: [], missing: "The offer as it stands cannot be calculated in the supported range." });
  // What would change the answer?
  const sens = await evaluateDecisionSensitivity(ws, goal, variant, fp);
  if (sens.status === "ready") {
    const items = sens.items.filter(i => i.checked === "exact_threshold" && i.currentCents !== null && i.thresholdCents !== null).slice(0, 2);
    const st = items.map(i => { const y = i.id.slice(-4); return `${p.money(`threshold_${y}`, `Extra ${y} profit that loses the ${y} credit under these terms`, i.thresholdCents! - i.currentCents!)} more ${y} business profit would lose the ${y} premium tax credit under these terms.`; });
    const dec = sens.items.find(i => i.id === "december-payment");
    if (dec && dec.thresholdCents !== null) st.push(`If a December payment slips to January, the cash change becomes ${p.money("slip_cash", "Cash change if a December payment slips into January", dec.thresholdCents)}.`);
    answers.push(st.length ? { question: "what_changes", status: "answered", missing: null, statements: st } : { question: "what_changes", status: "unresolved", statements: [], missing: "No threshold was found in the checked range." });
  } else answers.push({ question: "what_changes", status: "unresolved", statements: [], missing: sens.message });
  const action = variant.actions[0];
  return { id: `pkt-deal-${fp.slice(0, 12)}`, subject: "deal_choice", fingerprint: fp, facts: p.facts, statements, answers, limitations,
    nextAction: action ? action.title : null, sourceIds: [...new Set(variant.actions.flatMap(a => a.sourceIds))] };
}

// ------------------------------------------------------------------ historical decisions --

export interface DecisionRecordCheck {
  status: "reverified" | "differs" | "archived_only" | "invalid";
  message: string;
  /** Figures as recorded (never replaced). */
  recorded: { cashDeltaCents: number; credits: Array<{ year: TaxYear; ptcCents: number }> } | null;
  /** Recomputed on the record's own snapshot with the same engine and rules (null unless re-verified). */
  recomputed: { cashDeltaCents: number; credits: Array<{ year: TaxYear; ptcCents: number }> } | null;
}

/**
 * Re-check a recorded decision on ITS OWN snapshot. Only when the record's engine and rules versions
 * equal the current ones is it recalculated; otherwise it is an archived record (no "re-verified" label).
 * Never re-optimizes, never uses today's facts.
 */
export function verifyDecisionRecord(raw: DecisionRecord): DecisionRecordCheck {
  const rec = DecisionRecordSchema.safeParse(raw);
  if (!rec.success) return { status: "invalid", message: "The decision record is damaged.", recorded: null, recomputed: null };
  const r = rec.data;
  const variant = DealVariantSchema.safeParse(r.variant), goal = DealGoalSchema.safeParse(r.goal), snap = HouseholdWorkspaceSchema.safeParse(r.workspaceSnapshot);
  if (!variant.success || !goal.success || !snap.success) return { status: "invalid", message: "The decision record's snapshot cannot be read.", recorded: null, recomputed: null };
  const recorded = { cashDeltaCents: variant.data.twoYearCashDeltaCents, credits: variant.data.aca.map(a => ({ year: a.year, ptcCents: a.ptcCents })) };
  if (r.engineVersion !== ENGINE_VERSION || r.rulesVersion !== RULES_VERSION)
    return { status: "archived_only", message: `Recorded with ${r.engineVersion} / ${r.rulesVersion}; this build runs ${ENGINE_VERSION} / ${RULES_VERSION}. Shown as the archived record, not re-verified.`, recorded, recomputed: null };
  const ex = evaluateTermsExact(snap.data, goal.data, variant.data.terms);
  if (ex.status !== "ready") return { status: "archived_only", message: `The snapshot cannot be recalculated now (${ex.message}); shown as the archived record.`, recorded, recomputed: null };
  const recomputed = { cashDeltaCents: ex.cashDeltaCents, credits: ex.chosen.map(y => ({ year: y.year, ptcCents: y.ptcCents })) };
  const same = recomputed.cashDeltaCents === recorded.cashDeltaCents && recomputed.credits.every((c, i) => c.ptcCents === recorded.credits[i]?.ptcCents);
  return same ? { status: "reverified", message: `Recalculated on the facts of ${r.recordedAt.slice(0, 10)} with the same rules: the recorded figures match.`, recorded, recomputed }
    : { status: "differs", message: "Recalculating the recorded snapshot gives different figures; the record is kept as recorded and the difference is shown.", recorded, recomputed };
}
