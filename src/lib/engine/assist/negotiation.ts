/**
 * Client responses (round 6): accepted, counteroffer, declined. Pure.
 *
 * A counteroffer is evaluated exactly as written, through the same search path, so it gets the same dated money,
 * date goals, robustness and descriptors as any option. It is compared with:
 *  - declining the unpaid terms (for agreed work, refunds/costs of ending it count only when entered; otherwise not calculable),
 *  - the current offer it replaces (latest client offer or agreed terms),
 *  - the client's original offer (project.originalOffer), when different,
 *  - the last proposal the household sent (latest non-superseded action package), when there is one.
 * The client's stated limits restrict the next search (no payments after a date, fixed price, fewer payments). Removed
 * dates are never offered again. Money already received stays a fact in every comparison.
 */
import type { BlockedComparison } from "@/domain/contracts";
import type { ChangeCommand } from "@/domain/assistance";
import type { DealGoal, DealTermsSpace } from "@/domain/deal-planning";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { evaluateTermsExact, searchDealTerms, type EngineDealVariant } from "../deal";
import { evaluateHouseholdWorkspace } from "../household";
import { money, type MoneyResult } from "../descriptors";
import { formatUsd } from "../money";

/** Requested from Claude 3 as ClientResponseSchema (contract needs §3); local until published. */
export interface ClientResponse {
  id: string;
  projectId: string;
  recordedAt: string;
  sourceId: string;
  kind: "accepted" | "counteroffer" | "declined";
  terms: { priceCents: number; payments: Array<{ amountCents: number; date: string | null }> } | null;
  limits: { latestPaymentDate: string | null; priceFixed: boolean; maxPayments: number | null } | null;
  refundCents: number | null;
  cancellationCostCents: number | null;
}

export interface ClientResponseEvaluation {
  status: "ready" | "needs_data";
  kind: ClientResponse["kind"];
  questions: Array<{ key: string; question: string; reason: string }>;
  /** The counteroffer evaluated as written (as_offered variant of a search on the counter terms). */
  counter: EngineDealVariant | null;
  results: MoneyResult[];
  /** null when there is no goal for this project. */
  meetsGoal: boolean | null;
  /** The allowed terms narrowed by the client's limits, for the next search (null = unchanged / no terms set). */
  restrictedSpace: DealTermsSpace | null;
  notes: string[];
}

/**
 * Adapter from the contract command `record_client_response` (03ebf21). Refund and cancellation costs are not part of
 * the command: they stay unknown (null) unless entered separately, so ending agreed work is not counted as free.
 */
export function responseFromCommand(ws: HouseholdWorkspace, cmd: Extract<ChangeCommand, { type: "record_client_response" }>, recordedAt: string, sourceId: string): ClientResponse {
  const project = ws.projects.find(p => p.id === cmd.projectId);
  const received = project ? project.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0) : 0;
  return { id: `resp-${cmd.projectId}-${cmd.respondedOn}`, projectId: cmd.projectId, recordedAt, sourceId,
    kind: cmd.response === "rejected" ? "declined" : cmd.response === "countered" ? "counteroffer" : "accepted",
    terms: cmd.counter ? { priceCents: cmd.counter.totalPriceCents ?? received + cmd.counter.unpaid.reduce((a, q) => a + q.amountCents, 0),
      payments: cmd.counter.unpaid.map(q => ({ amountCents: q.amountCents, date: q.date })) } : null,
    limits: null, refundCents: null, cancellationCostCents: null };
}

const needs = (kind: ClientResponse["kind"], questions: ClientResponseEvaluation["questions"]): ClientResponseEvaluation =>
  ({ status: "needs_data", kind, questions, counter: null, results: [], meetsGoal: null, restrictedSpace: null, notes: [] });

/** Narrow the allowed terms by the client's stated limits. Windows after the latest date are removed, a crossing window is cut. */
export function restrictTerms(space: DealTermsSpace, limits: NonNullable<ClientResponse["limits"]>, fixedPriceCents: number | null): DealTermsSpace | { error: string } {
  const next: DealTermsSpace = structuredClone(space);
  if (limits.latestPaymentDate) {
    next.paymentWindows = next.paymentWindows.filter(w => w.earliest <= limits.latestPaymentDate!).map(w => ({ ...w, latest: w.latest > limits.latestPaymentDate! ? limits.latestPaymentDate! : w.latest }));
    if (!next.paymentWindows.length) return { error: `No allowed payment window starts on or before ${limits.latestPaymentDate}.` };
    if (next.paymentWindows.reduce((a, w) => a + w.maxShareBps, 0) < 10_000) {
      // The windows left must be able to take the whole remainder: widen the last one (the client's date is the binding limit).
      next.paymentWindows[next.paymentWindows.length - 1].maxShareBps = 10_000;
    }
  }
  if (limits.priceFixed && fixedPriceCents !== null) next.price = { ...next.price, minCents: fixedPriceCents, maxCents: fixedPriceCents };
  if (limits.maxPayments !== null) next.maxPayments = Math.min(next.maxPayments, limits.maxPayments);
  next.newTermsConfirmed = true;
  return next;
}

/** Spendable cash over the calculable years of a workspace (fixed plan as recorded). */
async function planCash(ws: HouseholdWorkspace): Promise<{ cents: number; years: number[] } | null> {
  const ev = await evaluateHouseholdWorkspace(ws);
  if (ev.status !== "ready") return null;
  const ys = ev.fixedPlan.years.filter(y => y.result);
  return { cents: ys.reduce((a, y) => a + y.result!.spendableAfterSettlementCents, 0), years: ys.map(y => y.year) };
}

export async function evaluateClientResponse(raw: HouseholdWorkspace, response: ClientResponse, userDate: string): Promise<ClientResponseEvaluation | BlockedComparison> {
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) return { status: "needs_data", code: "INVALID_WORKSPACE", message: "Part of the household plan needs review first.", fields: parsed.error.issues.map(i => ({ path: i.path.map(String).join("."), reason: i.message })) };
  const ws = parsed.data;
  const pi = ws.projects.findIndex(p => p.id === response.projectId);
  const project = ws.projects[pi];
  if (!project) return { status: "needs_data", code: "CANDIDATE_MISSING", message: "Choose the project the client answered about.", fields: [{ path: "projects", reason: response.projectId }] };
  const received = project.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0);
  const openLines = project.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected);
  const goal: DealGoal = ws.dealPlanning?.goals.find(g => g.projectId === project.id) ?? { id: "no-goal", projectId: project.id, minimumTwoYearCashDeltaCents: -1_000_000_000,
    baseline: "decline_unpaid_terms", maxAdditionalSepCents: 0, dateTargets: [], createdAt: response.recordedAt, updatedAt: response.recordedAt };
  const hasGoal = goal.id !== "no-goal";
  const space = ws.dealPlanning?.termSpaces.find(t => t.projectId === project.id) ?? null;
  const cash = ws.dealPlanning?.cashContext ?? null;
  const agreed = project.status === "agreed";
  const notes: string[] = [];

  if (response.kind === "declined") {
    // Declining: unpaid lines end; money already received stays. For agreed work, refund/costs are counted only when entered.
    const declined = structuredClone(ws);
    const dp = declined.projects[pi];
    for (const l of dp.receipts) if (!l.actual) l.cancelledAt = response.recordedAt;
    dp.status = "cancelled";
    const refund = (response.refundCents ?? 0) + (response.cancellationCostCents ?? 0);
    if (refund > 0) {
      if (!declined.evidence.some(e => e.id === response.sourceId)) declined.evidence.push({ id: response.sourceId, kind: "manual", label: "Client response" });
      dp.expenses.push({ id: `${dp.id}-decline-cost`, label: "Refund and costs of ending the project", expected: null,
        actual: { amountCents: refund, date: response.recordedAt.slice(0, 10) < userDate ? response.recordedAt.slice(0, 10) : userDate, recordedAt: response.recordedAt, sourceId: response.sourceId },
        cancelledAt: null, sourceId: response.sourceId, corrections: [] });
    }
    const unknownCost = agreed && (response.refundCents === null || response.cancellationCostCents === null);
    const [before, after] = await Promise.all([planCash(ws), planCash(declined)]);
    const delta = before && after && before.years.length === after.years.length ? after.cents - before.cents : null;
    if (received) notes.push(`${formatUsd(received)} already received from "${project.title}" stays recorded.`);
    if (unknownCost) notes.push("Refunds or costs of ending agreed work are not entered, so the cash effect of ending it is not calculated (they are not assumed to be $0).");
    return { status: "ready", kind: "declined", questions: unknownCost ? [{ key: `decline.costs:${project.id}`, question: "Does ending the agreement mean a refund or other costs? Enter them, or confirm none.", reason: "Agreed work cannot be dropped for free by assumption." }] : [],
      counter: null, meetsGoal: null, restrictedSpace: null, notes,
      results: [money("settled_two_year_cash", unknownCost ? null : delta, { kind: agreed ? "agreed_terms" : "latest_client_offer", label: agreed ? `Keeping the agreed terms of "${project.title}"` : `Accepting "${project.title}" as offered` },
        { horizon: { from: "2026-01-01", through: "2027-12-31", settlementThrough: "2028-04-18" }, conditions: unknownCost ? ["Refunds or costs of ending the agreement are not known."] : [] })] };
  }

  if (response.kind === "accepted") {
    if (!openLines.length) return needs("accepted", [{ key: `offer.unpaid:${project.id}`, question: "Which unpaid payments did the client accept?", reason: "There is no unpaid amount on this project." }]);
    const r = await searchDealTerms(ws, goal, { ...(space ?? defaultSpace(project.id, openLines.map(l => l.expected!.date))), newTermsConfirmed: false, allowAdditionalSep: false }, cash);
    if (r.status === "needs_data" || r.status === "unsupported" || r.status === "unavailable") return r;
    const v = r.status === "ready" ? r.variants.find(x => x.purpose === "as_offered") as EngineDealVariant : null;
    return { status: "ready", kind: "accepted", questions: [], counter: v, results: v?.results ?? [], meetsGoal: hasGoal ? r.status === "ready" : null, restrictedSpace: null,
      notes: ["The accepted terms become the agreed terms; record payments as they arrive."] };
  }

  // Counteroffer.
  const t = response.terms;
  if (!t) return needs("counteroffer", [{ key: `counter.terms:${project.id}`, question: "What did the client offer instead: total price and payment dates?", reason: "A counteroffer is evaluated on its own terms." }]);
  const qs: ClientResponseEvaluation["questions"] = [];
  t.payments.forEach((q, i) => { if (!q.date) qs.push({ key: `counter.date:${project.id}:${i}`, question: `When would the client pay the ${formatUsd(q.amountCents)}?`, reason: "The tax year of a payment decides its effect; no date is assumed." }); });
  const unpaid = t.payments.reduce((a, q) => a + q.amountCents, 0);
  if (t.priceCents !== received + unpaid) qs.push({ key: `counter.total:${project.id}`, question: `The client's total (${formatUsd(t.priceCents)}) should equal the ${formatUsd(received)} already received plus the payments still to come (${formatUsd(unpaid)}). Which is right?`, reason: "Money already received is part of the price and is never asked for again." });
  t.payments.forEach((q, i) => { if (q.date && q.date < userDate) qs.push({ key: `counter.past:${project.id}:${i}`, question: `The payment on ${q.date} is in the past: was it already received, or is the date different?`, reason: "A payment still to come cannot be dated in the past." }); });
  if (t.payments.some(q => q.date && q.date > "2027-12-31")) qs.push({ key: `counter.year:${project.id}`, question: "A payment after 2027 is outside what Headroom calculates. Can it be in 2026 or 2027?", reason: "Only 2026 and 2027 are supported." });
  if (qs.length) return needs("counteroffer", qs);

  // Evaluate as written: a copy whose unpaid lines are the counter's payments (original offer and received lines unchanged).
  const counterWs = structuredClone(ws);
  const cp = counterWs.projects[pi];
  if (!counterWs.evidence.some(e => e.id === response.sourceId)) counterWs.evidence.push({ id: response.sourceId, kind: "manual", label: "Client counteroffer" });
  cp.receipts = [...cp.receipts.filter(l => l.actual || l.cancelledAt), ...t.payments.map((q, i) => ({ id: `${response.id}-p${i}`.slice(0, 100), label: "Client counteroffer",
    expected: { amountCents: q.amountCents, date: q.date! }, actual: null, cancelledAt: null, sourceId: response.sourceId, corrections: [] }))];
  const fixedSpace = { ...(space ?? defaultSpace(project.id, t.payments.map(q => q.date!))), newTermsConfirmed: false, allowAdditionalSep: space?.allowAdditionalSep ?? false };
  const r = await searchDealTerms(counterWs, goal, fixedSpace, cash);
  if (r.status === "needs_data" || r.status === "unsupported" || r.status === "unavailable") return r;
  let counter: EngineDealVariant | null = null;
  if (r.status === "ready") counter = r.variants.find(x => x.purpose === "as_offered") as EngineDealVariant ?? null;
  const exact = evaluateTermsExact(counterWs, { ...goal, baseline: "decline_unpaid_terms" }, { priceCents: t.priceCents, payments: t.payments.map((q, i) => ({ id: `p${i}`, date: q.date!, amountCents: q.amountCents })), additionalSep: null });
  if (exact.status !== "ready") return exact;
  const results: MoneyResult[] = [money("settled_two_year_cash", exact.cashDeltaCents, { kind: "decline_unpaid_terms", label: agreed ? `Declining the unpaid part of "${project.title}" (refunds or costs not known, not counted)` : `Your plan without the unpaid terms of "${project.title}"` })];
  // Against the offer it replaces (as currently recorded).
  if (openLines.length) {
    const current = evaluateTermsExact(ws, { ...goal, baseline: "decline_unpaid_terms" }, { priceCents: received + openLines.reduce((a, l) => a + l.expected!.amountCents, 0),
      payments: openLines.map(l => ({ id: l.id, date: l.expected!.date, amountCents: l.expected!.amountCents })), additionalSep: null });
    if (current.status === "ready") results.push(money("settled_two_year_cash", exact.cashDeltaCents - current.cashDeltaCents,
      { kind: agreed ? "agreed_terms" : "latest_client_offer", label: agreed ? `The agreed terms of "${project.title}"` : `"${project.title}" as offered before this response` }));
  }
  if (counter?.comparisons.versusOriginalOfferCents != null) results.push(money("settled_two_year_cash", counter.comparisons.versusOriginalOfferCents, { kind: "original_offer", label: `The client's original offer for "${project.title}"` }));
  const pkg = ws.dealPlanning?.packages.filter(p => p.projectId === project.id && p.status !== "superseded").at(-1);
  if (pkg) {
    const proposed = evaluateTermsExact(ws, { ...goal, baseline: "decline_unpaid_terms" }, pkg.variant.terms);
    if (proposed.status === "ready") results.push(money("settled_two_year_cash", exact.cashDeltaCents - proposed.cashDeltaCents, { kind: "household_proposal", label: "The terms you proposed to the client" },
      { conditions: [`Your proposal: ${formatUsd(pkg.variant.terms.priceCents)} total.`] }));
    else notes.push("Your earlier proposal no longer matches the recorded payments, so it is not compared.");
  }
  if (counter) results.push(...counter.results.filter(x => x.metric !== "settled_two_year_cash"));
  let restricted: DealTermsSpace | null = null;
  if (response.limits && space) {
    const rs = restrictTerms(space, response.limits, response.limits.priceFixed ? t.priceCents : null);
    if ("error" in rs) notes.push(`The client's limits leave no allowed payment window: ${rs.error}`); else restricted = rs;
  }
  if (!hasGoal) notes.push("No goal is set for this project, so the counteroffer is compared but not checked against a goal.");
  if (r.status === "no_feasible_terms") notes.push("The counteroffer as written does not meet your goal.");
  return { status: "ready", kind: "counteroffer", questions: [], counter, results, meetsGoal: hasGoal ? r.status === "ready" : null, restrictedSpace: restricted, notes };
}

function defaultSpace(projectId: string, dates: string[]): DealTermsSpace {
  const sorted = [...dates].sort();
  return { projectId, price: { minCents: 0, maxCents: 0, stepCents: 100 }, paymentWindows: [{ id: "as-written", earliest: sorted[0], latest: sorted.at(-1)!, maxShareBps: 10_000 }],
    maxPayments: 4, newTermsConfirmed: false, allowAdditionalSep: false };
}
