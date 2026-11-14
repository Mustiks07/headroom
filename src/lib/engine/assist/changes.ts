/**
 * Change commands (round 5): business validation, apply on a COPY, and the preview of consequences.
 *
 * A provider only proposes whitelisted typed commands (src/domain/assistance.ts). Here:
 *  - `validateAndApply` checks the meaning of each command against the workspace and applies it to a
 *    copy (pure). The same function is what a confirmed save should use, so preview == applied.
 *  - `previewChange` runs the current engine on the plan before and after: current-year credit and
 *    settlement, cash relative to the plan before the change, whether agreed terms still meet their goal
 *    (the agreed terms re-evaluated, NOT a new optimum), and saved packages/actions that go stale.
 *
 * Invariants: received money is never moved or re-dated (a correction needs a reason and keeps
 * history); an expected payment cannot be proposed in the past, a received one cannot be in the
 * future; unknown is never filled with 0; a repeated command that is already true is a no-op;
 * ambiguous references come back as blockers, never guessed.
 */
import type { BlockedComparison, MoneyFact, TaxYear } from "@/domain/contracts";
import { ChangeProposalSchema, type ChangeCommand, type ChangePreview, type ChangePreviewSummary, type ChangeProposal } from "@/domain/assistance";
import { DealGoalSchema, DealTermsSpaceSchema, type DealGoal, type DealPlanningState } from "@/domain/deal-planning";
import { captureSepBudgetContributions, HouseholdWorkspaceSchema, type HouseholdWorkspace, type Project, type ProjectLine, type WorkspaceEvent } from "@/domain/household-workspace";
import { searchDealTerms } from "../deal";
import { engineWorkspaceFingerprint, evaluateHouseholdWorkspace } from "../household";
import { formatUsd } from "../money";

type Change = ChangePreview["changes"][number];
export interface ApplyOutcome {
  workspace: HouseholdWorkspace;
  changes: Change[];
  blockers: ChangePreview["blockers"];
  /** Commands that are already true (safe retry): nothing changes for them. */
  noOps: Array<{ commandIndex: number; reason: string }>;
  notes: string[];
  /** One event per applied command, stable ids (proposal id + index), to be stored with the revision. */
  events: WorkspaceEvent[];
  touchedProjectIds: string[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/**
 * Resolve a relative date phrase against the user's calendar date (already in the user's time zone).
 * Supported: today, tomorrow, yesterday, in N days/weeks, next <weekday>, this <weekday>, <weekday>,
 * end of month/year, "<Month> <day>[, <year>]". Returns null when the phrase is not one of these.
 * "next Friday" = the first Friday after today (never today).
 */
export function resolveRelativeDate(phrase: string, userDate: string): string | null {
  const s = phrase.trim().toLowerCase().replace(/[.,]+$/g, "").replace(/\s+/g, " ");
  if (s === "today") return userDate;
  if (s === "tomorrow") return addDays(userDate, 1);
  if (s === "yesterday") return addDays(userDate, -1);
  let m = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(s);
  if (m) return addDays(userDate, Number(m[1]) * (m[2].startsWith("week") ? 7 : 1));
  m = /^(next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (m) {
    const today = new Date(`${userDate}T00:00:00Z`).getUTCDay(), target = WEEKDAYS.indexOf(m[2]);
    let diff = (target - today + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(userDate, diff);
  }
  if (s === "end of the month" || s === "end of month") { const d = new Date(`${userDate}T00:00:00Z`); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); }
  if (s === "end of the year" || s === "end of year") return `${userDate.slice(0, 4)}-12-31`;
  m = /^(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1]) + 1, day = Number(m[2]);
    let y = m[3] ? Number(m[3]) : Number(userDate.slice(0, 4));
    const mk = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!m[3] && mk(y) < userDate) y += 1;                     // "January 8" in November means next January
    const out = mk(y);
    return iso(new Date(`${out}T00:00:00Z`)) === out ? out : null;
  }
  return null;
}

const usd = (c: number | null | undefined) => (c === null || c === undefined ? "not set" : formatUsd(c));
const lineText = (l: ProjectLine) => l.actual ? `${formatUsd(l.actual.amountCents)} received on ${l.actual.date}` : l.expected ? `${formatUsd(l.expected.amountCents)} expected on ${l.expected.date}` : "no amount";
const shortHash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** Validate the meaning of each command and apply it to a copy. Pure. */
export function validateAndApply(raw: HouseholdWorkspace, proposal: ChangeProposal, userDate: string, now: string): ApplyOutcome {
  const ws: HouseholdWorkspace = structuredClone(raw);
  const out: ApplyOutcome = { workspace: ws, changes: [], blockers: [], noOps: [], notes: [], events: [], touchedProjectIds: [] };
  const sourceId = `assist-${proposal.id}`.slice(0, 100);
  const ensureSource = () => { if (!ws.evidence.some(e => e.id === sourceId)) ws.evidence.push({ id: sourceId, kind: "manual", label: `Your confirmed change (${proposal.provenance === "ai_model" ? "proposed by the assistant" : "entered"} on ${userDate})` }); };
  const block = (i: number, path: string, reason: string) => out.blockers.push({ path: `commands[${i}].${path}`, reason });
  const event = (i: number, kind: WorkspaceEvent["kind"], description: string, refs: WorkspaceEvent["refs"]) =>
    out.events.push({ id: `${proposal.id}-${i}`.slice(0, 100), at: now, kind, description: description.slice(0, 500), refs, previousFingerprint: proposal.base.fingerprint, nextFingerprint: null });
  const findLine = (i: number, projectId: string, lineId: string) => {
    const pi = ws.projects.findIndex(p => p.id === projectId);
    const p = ws.projects[pi];
    if (!p) { block(i, "projectId", "This project is not in your plan."); return null; }
    const li = p.receipts.findIndex(l => l.id === lineId);
    if (li < 0) { block(i, "lineId", `"${p.title}" has no such payment.`); return null; }
    return { p, pi, l: p.receipts[li], li };
  };
  const owner = ws.projects[0]?.ownerPersonId ?? ws.household.people.find(p => p.role === "primary")!.id;
  const dp = (): DealPlanningState => (ws.dealPlanning ??= { version: "1.0", goals: [], termSpaces: [], cashContext: null, packages: [] });

  proposal.commands.forEach((c: ChangeCommand, i) => {
    const before = out.blockers.length;
    switch (c.type) {
      case "add_offered_project": {
        const all = [...c.received, ...c.unpaid];
        if (!c.unpaid.length) { block(i, "unpaid", "Enter at least one unpaid payment with its date."); break; }
        const total = all.reduce((a, x) => a + x.amountCents, 0);
        if (c.totalPriceCents !== null && c.totalPriceCents !== total)
          block(i, "totalPriceCents", `The total price (${formatUsd(c.totalPriceCents)}) must equal the deposit already received plus the unpaid payments (${formatUsd(total)}).`);
        c.received.forEach((x, k) => { if (x.date > userDate) block(i, `received[${k}].date`, `Money received cannot be dated after today (${userDate}).`); });
        c.unpaid.forEach((x, k) => { if (x.date < userDate) block(i, `unpaid[${k}].date`, `An unpaid payment cannot be due before today (${userDate}); if it already arrived, record it as received.`); });
        c.expenses.forEach((x, k) => { if (x.date < "2026-01-01" || x.date > "2027-12-31") block(i, `expenses[${k}].date`, "Expenses must fall in 2026 or 2027."); });
        if ([...all, ...c.expenses].some(x => x.date > "2027-12-31")) block(i, "unpaid", "Payments must fall in 2026 or 2027.");
        const personId = c.ownerPersonId ?? owner;
        if (ws.projects.length && personId !== owner) block(i, "ownerPersonId", "Only one business (one owner) is supported.");
        if (out.blockers.length > before) break;
        const id = `prj-${shortHash(`${proposal.id}:${i}`)}`;
        const same = ws.projects.find(p => p.id === id || (p.title === c.title && JSON.stringify(p.receipts.map(l => l.expected ?? l.actual)) === JSON.stringify(all.map(x => ({ amountCents: x.amountCents, date: x.date })))));
        if (same) { out.noOps.push({ commandIndex: i, reason: `"${c.title}" is already in your plan with these payments.` }); break; }
        ensureSource();
        const cash = ws.projects.filter(p => p.ownerPersonId === personId).map(p => p.cashAccountingConfirmed);
        const line = (k: string, x: { amountCents: number; date: string }, received: boolean): ProjectLine => ({ id: `${id}-${k}`, expected: received ? null : { ...x },
          actual: received ? { ...x, recordedAt: now, sourceId } : null, cancelledAt: null, sourceId, corrections: [] });
        const p: Project = { id, title: c.title, ownerPersonId: personId, status: "proposed", createdAt: now, statusChangedAt: now,
          // The accounting method belongs to the business: reuse it only if every existing project of this owner confirmed it.
          cashAccountingConfirmed: cash.length && cash.every(v => v === true) ? true : null, timingArrangementConfirmed: null,
          terms: { canSplitPayment: c.scheduleNegotiable ?? false, canRenegotiatePrice: c.priceNegotiable ?? false, nextYearPaymentLatestDate: null },
          receipts: [...c.received.map((x, k) => line(`r${k}`, x, true)), ...c.unpaid.map((x, k) => line(`p${k}`, x, false))],
          expenses: c.expenses.map((x, k) => line(`e${k}`, x, false)), agreedDecision: null };
        ws.projects.push(p);
        out.touchedProjectIds.push(id);
        out.changes.push({ commandIndex: i, path: `projects[${ws.projects.length - 1}]`, label: `New offer "${c.title}"`, before: null,
          after: `${formatUsd(total)} total: ${[...c.received.map(x => `${formatUsd(x.amountCents)} received ${x.date}`), ...c.unpaid.map(x => `${formatUsd(x.amountCents)} due ${x.date}`)].join(", ")}${c.expenses.length ? `; costs ${formatUsd(c.expenses.reduce((a, x) => a + x.amountCents, 0))}` : ""}` });
        if (p.cashAccountingConfirmed === null) out.notes.push("Confirm the cash method for this business before the offer can be calculated.");
        event(i, "project_added", `Added offer "${c.title}" (${formatUsd(total)} total).`, { projectId: id });
        break;
      }
      case "update_expected_payment": {
        const f = findLine(i, c.projectId, c.lineId);
        if (!f) break;
        const { p, l, pi, li } = f;
        if (l.actual) { block(i, "lineId", `This payment was already received (${lineText(l)}). Received money is not moved; use a correction with a reason if the record is wrong.`); break; }
        if (l.cancelledAt) { block(i, "lineId", "This payment was cancelled."); break; }
        if (c.newAmountCents === null && c.newDate === null) { block(i, "newDate", "Say what changes: the amount, the date or both."); break; }
        if (c.newDate !== null && c.newDate < userDate) { block(i, "newDate", `A payment still expected cannot be moved to a date before today (${userDate}). If it arrived, record it as received.`); break; }
        const next = { amountCents: c.newAmountCents ?? l.expected!.amountCents, date: c.newDate ?? l.expected!.date };
        if (next.amountCents === l.expected!.amountCents && next.date === l.expected!.date) { out.noOps.push({ commandIndex: i, reason: "The payment already has this amount and date." }); break; }
        const prev = lineText(l), prevYear = l.expected!.date.slice(0, 4);
        l.expected = next;
        out.touchedProjectIds.push(p.id);
        out.changes.push({ commandIndex: i, path: `projects[${pi}].receipts[${li}].expected`, label: `"${p.title}" payment`, before: prev, after: lineText(l) });
        if (next.date.slice(0, 4) !== prevYear) out.notes.push(`The payment moves from ${prevYear} to ${next.date.slice(0, 4)}: it now counts in ${next.date.slice(0, 4)} income.`);
        if (p.status === "agreed" && next.date.startsWith("2027") && p.timingArrangementConfirmed !== true) out.notes.push("A payment that moves into 2027 counts in 2027 only if it is not payable or available to you in 2026; keep the client's written confirmation.");
        event(i, "project_updated", `Expected payment of "${p.title}" changed: ${prev} → ${lineText(l)}.`, { projectId: p.id, lineId: l.id });
        break;
      }
      case "record_receipt": {
        const f = findLine(i, c.projectId, c.lineId);
        if (!f) break;
        const { p, l, pi, li } = f;
        if (c.date > userDate) { block(i, "date", `Money received cannot be dated after today (${userDate}). An expected date is a change of the expected payment.`); break; }
        if (l.actual) {
          if (l.actual.amountCents === c.amountCents && l.actual.date === c.date) { out.noOps.push({ commandIndex: i, reason: "This payment is already recorded with the same amount and date." }); break; }
          block(i, "lineId", `This payment is already recorded (${lineText(l)}). To change it, record a correction with a reason.`); break;
        }
        ensureSource();
        const prev = lineText(l);
        l.actual = { amountCents: c.amountCents, date: c.date, recordedAt: now, sourceId };
        l.cancelledAt = null;
        out.touchedProjectIds.push(p.id);
        out.changes.push({ commandIndex: i, path: `projects[${pi}].receipts[${li}].actual`, label: `"${p.title}" payment received`, before: prev, after: lineText(l) });
        if (l.expected && l.expected.amountCents !== c.amountCents) out.notes.push(`${formatUsd(c.amountCents)} arrived instead of the expected ${formatUsd(l.expected.amountCents)}; the received amount replaces the expected one (they are never added).`);
        if (p.status === "proposed") out.notes.push(`Money arrived for "${p.title}", which is still marked as an offer; mark it agreed if the client accepted.`);
        event(i, "payment_recorded", `Recorded ${formatUsd(c.amountCents)} received on ${c.date} for "${p.title}".`, { projectId: p.id, lineId: l.id });
        break;
      }
      case "correct_fact": {
        if (c.target.kind === "payment") {
          const f = findLine(i, c.target.projectId, c.target.lineId);
          if (!f) break;
          const { p, l, pi, li } = f;
          if (!l.actual) { block(i, "target", "Only a received payment is corrected; an expected payment is simply changed."); break; }
          const date = c.date ?? l.actual.date;
          if (date > userDate) { block(i, "date", `A received payment cannot be dated after today (${userDate}).`); break; }
          if (l.actual.amountCents === c.amountCents && l.actual.date === date) { out.noOps.push({ commandIndex: i, reason: "The record already has this amount and date." }); break; }
          if (c.amountCents === 0) { block(i, "amountCents", "A received payment of $0 is not a correction; if no money arrived, say so and the record will be reviewed."); break; }
          ensureSource();
          const prev = lineText(l);
          l.corrections.push({ at: now, previousActual: { amountCents: l.actual.amountCents, date: l.actual.date }, reason: c.reason });
          l.actual = { amountCents: c.amountCents, date, recordedAt: now, sourceId };
          out.touchedProjectIds.push(p.id);
          out.changes.push({ commandIndex: i, path: `projects[${pi}].receipts[${li}].actual`, label: `Correction of "${p.title}" payment (${c.reason})`, before: prev, after: lineText(l) });
          event(i, "payment_corrected", `Corrected a payment of "${p.title}": ${prev} → ${lineText(l)} (${c.reason}).`, { projectId: p.id, lineId: l.id });
        } else {
          const t = c.target;
          const fi = ws.forecasts.findIndex(x => x.personId === t.personId && x.year === t.year);
          const fc = ws.forecasts[fi];
          if (!fc) { block(i, "target", `There is no ${t.year} profit forecast to correct.`); break; }
          if (!(t.field in fc)) { block(i, "target.field", `The ${t.year} forecast uses ${fc.method === "annual_total" ? "a full-year total" : "year to date plus the rest of the year"}; this field does not belong to it.`); break; }
          const cur = (fc as Record<string, unknown>)[t.field] as MoneyFact;
          if (cur.valueCents === c.amountCents) { out.noOps.push({ commandIndex: i, reason: "The forecast already has this amount." }); break; }
          ensureSource();
          (fc as Record<string, unknown>)[t.field] = { valueCents: c.amountCents, status: "confirmed", sourceId } satisfies MoneyFact;
          out.changes.push({ commandIndex: i, path: `forecasts[${fi}].${t.field}`, label: `Correction of ${t.year} ${t.field.replace(/([A-Z])/g, " $1").toLowerCase()} (${c.reason})`, before: usd(cur.valueCents), after: formatUsd(c.amountCents) });
          event(i, "forecast_updated", `Corrected the ${t.year} forecast (${c.reason}).`, {});
        }
        break;
      }
      case "record_sep_contribution": {
        if (c.personId !== owner) { block(i, "personId", "Only the business owner's SEP-IRA is modeled."); break; }
        if (c.paidDate > userDate) { block(i, "paidDate", `A paid contribution cannot be dated after today (${userDate}); a planned contribution is a SEP goal.`); break; }
        if (c.paidDate < `${c.taxYear}-01-01` || c.paidDate > `${c.taxYear + 1}-10-15`) { block(i, "paidDate", `A ${c.taxYear} contribution must be paid between ${c.taxYear}-01-01 and ${c.taxYear + 1}-10-15.`); break; }
        const id = `sep-${proposal.id}-${i}`.slice(0, 100);
        if (ws.retirement.contributions.some(x => x.id === id)) { out.noOps.push({ commandIndex: i, reason: "This contribution is already recorded." }); break; }
        if (ws.retirement.contributions.some(x => x.amountCents === c.amountCents && x.paidDate === c.paidDate && x.taxYear === c.taxYear))
          out.notes.push("A contribution with the same amount and date is already recorded. If this is the same payment, do not confirm: it would be counted twice.");
        ensureSource();
        captureSepBudgetContributions(ws);
        const budget = ws.retirement.futureContributionBudget;
        // Paid strictly before the cash snapshot date → already reflected in it. On or after → it uses that cash.
        if (budget.asOfDate && c.paidDate < budget.asOfDate) budget.includedContributionIds!.push(id);
        else if (budget.asOfDate && c.paidDate === budget.asOfDate) out.notes.push(`Paid on the day of your SEP cash snapshot (${budget.asOfDate}): treated as NOT yet in that amount, so it reduces the SEP cash left. If the snapshot already included it, say so.`);
        ws.retirement.contributions.push({ id, personId: c.personId, taxYear: c.taxYear, amountCents: c.amountCents, paidDate: c.paidDate, sourceId, recordedAt: now });
        const target = ws.retirement.targets.find(t => t.personId === c.personId && t.year === c.taxYear);
        const paid = ws.retirement.contributions.filter(x => x.personId === c.personId && x.taxYear === c.taxYear).reduce((a, x) => a + x.amountCents, 0);
        out.changes.push({ commandIndex: i, path: "retirement.contributions", label: `SEP-IRA contribution for ${c.taxYear}`, before: target ? `${formatUsd(paid - c.amountCents)} paid of the ${formatUsd(target.targetCents)} goal` : `${formatUsd(paid - c.amountCents)} paid`,
          after: target ? `${formatUsd(paid)} paid of the ${formatUsd(target.targetCents)} goal${paid > target.targetCents ? " (more than the goal: the total used is what was paid)" : ""}` : `${formatUsd(paid)} paid (no goal set: the total used is what was paid)` });
        out.notes.push("A paid contribution is retirement money already spent; it never adds to the cash set aside for SEP.");
        event(i, "sep_contribution_recorded", `Recorded a ${formatUsd(c.amountCents)} SEP-IRA contribution for ${c.taxYear} paid on ${c.paidDate}.`, { contributionId: id });
        break;
      }
      case "update_forecast": {
        const fi = ws.forecasts.findIndex(x => x.personId === c.personId && x.year === c.year);
        const fc = ws.forecasts[fi];
        const ytd = c.field !== "annualNetProfit";
        if (!ws.household.people.some(p => p.id === c.personId)) { block(i, "personId", "Unknown person."); break; }
        if (!fc) {
          if (ytd) { block(i, "field", "Start the year-to-date forecast in the form: it needs profit so far, the date it runs through, and the rest of the year."); break; }
          ensureSource();
          ws.forecasts.push({ method: "annual_total", personId: c.personId, year: c.year, excludesManagedProjects: null, annualNetProfit: { valueCents: c.amountCents, status: c.status, sourceId } });
          out.changes.push({ commandIndex: i, path: `forecasts[${ws.forecasts.length - 1}]`, label: `${c.year} full-year profit forecast`, before: null, after: formatUsd(c.amountCents) });
          out.notes.push(`Confirm that the ${c.year} forecast leaves out the projects listed in Headroom (they are added separately).`);
        } else {
          if (!(c.field in fc)) { block(i, "field", `The ${c.year} forecast uses ${fc.method === "annual_total" ? "a full-year total" : "year to date plus the rest of the year"}; switch the method in the form first.`); break; }
          if (c.field === "ytdNetProfit" && !c.asOfDate) { block(i, "asOfDate", "Say through which date the year-to-date profit runs."); break; }
          if (c.asOfDate && (!c.asOfDate.startsWith(`${c.year}-`) || c.asOfDate > userDate)) { block(i, "asOfDate", "The year-to-date date must be in that year and not after today."); break; }
          const cur = (fc as Record<string, unknown>)[c.field] as MoneyFact;
          if (cur.valueCents === c.amountCents && cur.status === c.status && (!c.asOfDate || (fc.method === "year_to_date_plus_remaining" && fc.asOfDate === c.asOfDate))) { out.noOps.push({ commandIndex: i, reason: "The forecast already has this amount." }); break; }
          ensureSource();
          (fc as Record<string, unknown>)[c.field] = { valueCents: c.amountCents, status: c.status, sourceId } satisfies MoneyFact;
          if (c.asOfDate && fc.method === "year_to_date_plus_remaining") { fc.asOfDate = c.asOfDate; fc.asOfConfirmed = true; }
          out.changes.push({ commandIndex: i, path: `forecasts[${fi}].${c.field}`, label: `${c.year} ${c.field.replace(/([A-Z])/g, " $1").toLowerCase()}`, before: usd(cur.valueCents), after: formatUsd(c.amountCents) });
        }
        event(i, "forecast_updated", `Updated the ${c.year} profit forecast.`, {});
        break;
      }
      case "change_goal": {
        const p = ws.projects.find(x => x.id === c.projectId);
        if (!p) { block(i, "projectId", "This project is not in your plan."); break; }
        const d = dp();
        const gi = d.goals.findIndex(g => g.projectId === c.projectId);
        const prev = d.goals[gi];
        if (!prev && c.minimumTwoYearCashDeltaCents === null) { block(i, "minimumTwoYearCashDeltaCents", "Enter the least cash this project should leave after both tax years."); break; }
        const goal: DealGoal = { ...(prev ?? { id: `goal-${shortHash(`${proposal.id}:${i}`)}`, projectId: c.projectId, baseline: "decline_unpaid_terms", maxAdditionalSepCents: null, dateTargets: [], createdAt: now }),
          minimumTwoYearCashDeltaCents: c.minimumTwoYearCashDeltaCents ?? prev!.minimumTwoYearCashDeltaCents,
          maxAdditionalSepCents: c.maxAdditionalSepCents ?? prev?.maxAdditionalSepCents ?? null,
          dateTargets: c.dateTarget ? [{ id: `t-${c.dateTarget.kind}-${c.dateTarget.byDate}`, ...c.dateTarget }] : prev?.dateTargets ?? [], updatedAt: now };
        const ok = DealGoalSchema.safeParse(goal);
        if (!ok.success) { block(i, ok.error.issues[0].path.join("."), ok.error.issues[0].message); break; }
        if (prev && JSON.stringify({ ...prev, updatedAt: "" }) === JSON.stringify({ ...ok.data, updatedAt: "" })) { out.noOps.push({ commandIndex: i, reason: "The goal is already set this way." }); break; }
        if (gi >= 0) d.goals[gi] = ok.data; else d.goals.push(ok.data);
        const g = ok.data;
        out.changes.push({ commandIndex: i, path: `dealPlanning.goals[${gi >= 0 ? gi : d.goals.length - 1}]`, label: `Goal for "${p.title}"`,
          before: prev ? `at least ${formatUsd(prev.minimumTwoYearCashDeltaCents)} after both years${prev.dateTargets[0] ? `; ${formatUsd(prev.dateTargets[0].minimumCents)} by ${prev.dateTargets[0].byDate}` : ""}` : null,
          after: `at least ${formatUsd(g.minimumTwoYearCashDeltaCents)} after both years${g.dateTargets[0] ? `; ${formatUsd(g.dateTargets[0].minimumCents)} by ${g.dateTargets[0].byDate}` : ""}${g.maxAdditionalSepCents !== null ? `; extra SEP at most ${formatUsd(g.maxAdditionalSepCents)}` : ""}` });
        if (g.dateTargets.some(t => t.kind === "household_balance") && !d.cashContext?.completeness.confirmed) out.notes.push("A household balance goal is answered only after you enter a bank balance and confirm every significant flow through that date.");
        event(i, "deal_planning_updated", `Changed the goal for "${p.title}".`, { projectId: p.id });
        break;
      }
      case "change_terms": {
        const p = ws.projects.find(x => x.id === c.projectId);
        if (!p) { block(i, "projectId", "This project is not in your plan."); break; }
        const d = dp();
        const ti = d.termSpaces.findIndex(t => t.projectId === c.projectId);
        const prev = d.termSpaces[ti];
        if (!prev) { block(i, "projectId", "Set up the allowed terms for this project in the form first (price range and payment windows)."); break; }
        const next = structuredClone(prev);
        if (c.priceMinCents !== null) next.price.minCents = c.priceMinCents;
        if (c.priceMaxCents !== null) next.price.maxCents = c.priceMaxCents;
        if (c.maxPayments !== null) next.maxPayments = c.maxPayments;
        if (c.newTermsConfirmed !== null) next.newTermsConfirmed = c.newTermsConfirmed;
        if (c.latestPaymentDate !== null) {
          if (c.latestPaymentDate < userDate) { block(i, "latestPaymentDate", `The latest payment date cannot be before today (${userDate}).`); break; }
          const last = [...next.paymentWindows].sort((a, b) => a.latest.localeCompare(b.latest)).at(-1)!;
          if (c.latestPaymentDate < last.earliest) { block(i, "latestPaymentDate", `It is before the start of the last payment window (${last.earliest}).`); break; }
          last.latest = c.latestPaymentDate;
        }
        const ok = DealTermsSpaceSchema.safeParse(next);
        if (!ok.success) { block(i, ok.error.issues[0].path.join("."), ok.error.issues[0].message); break; }
        if (JSON.stringify(prev) === JSON.stringify(ok.data)) { out.noOps.push({ commandIndex: i, reason: "The allowed terms are already set this way." }); break; }
        d.termSpaces[ti] = ok.data;
        out.changes.push({ commandIndex: i, path: `dealPlanning.termSpaces[${ti}]`, label: `Allowed terms for "${p.title}"`,
          before: `${formatUsd(prev.price.minCents)}–${formatUsd(prev.price.maxCents)}, up to ${prev.maxPayments} payment(s), last date ${[...prev.paymentWindows].map(w => w.latest).sort().at(-1)}`,
          after: `${formatUsd(ok.data.price.minCents)}–${formatUsd(ok.data.price.maxCents)}, up to ${ok.data.maxPayments} payment(s), last date ${[...ok.data.paymentWindows].map(w => w.latest).sort().at(-1)}` });
        event(i, "deal_planning_updated", `Changed the allowed terms for "${p.title}".`, { projectId: p.id });
        break;
      }
    }
  });
  const parsed = HouseholdWorkspaceSchema.safeParse(ws);
  if (!parsed.success) for (const e of parsed.error.issues.slice(0, 5)) out.blockers.push({ path: e.path.map(String).join("."), reason: e.message });
  else out.workspace = parsed.data;
  out.touchedProjectIds = [...new Set(out.touchedProjectIds)];
  return out;
}

/** Engine detail on top of the contract preview. */
export interface EngineChangePreview extends ChangePreview {
  noOps: ApplyOutcome["noOps"];
  notes: string[];
  /** Per tax year, before → after (null when that year cannot be calculated). */
  years: Array<{ year: TaxYear; before: { subsidyCents: number; settlementCents: number; spendableCents: number } | null; after: { subsidyCents: number; settlementCents: number; spendableCents: number } | null }>;
  /** Agreed terms re-evaluated on the new facts (not re-optimized). */
  agreedChecks: Array<{ projectId: string; goalId: string; before: { met: boolean; cashDeltaCents: number | null } | null; after: { met: boolean; cashDeltaCents: number | null } | null }>;
  fingerprintBefore: string;
  fingerprintAfter: string | null;
  /** The resolved user date the checks used. */
  userDate: string;
}

async function summary(ws: HouseholdWorkspace) {
  const ev = await evaluateHouseholdWorkspace(ws);
  if (ev.status !== "ready") return { years: null, blocked: ev };
  return { years: ev.fixedPlan.years.map(y => ({ year: y.year, risk: y.risk, spendable: y.result?.spendableAfterSettlementCents ?? null })), blocked: null };
}

/** Agreed terms of a project still meet its goal? Evaluates the agreed unpaid schedule exactly (no new terms, no extra SEP). */
async function agreedMeets(ws: HouseholdWorkspace, projectId: string): Promise<{ met: boolean; cashDeltaCents: number | null } | null> {
  const goal = ws.dealPlanning?.goals.find(g => g.projectId === projectId);
  const space = ws.dealPlanning?.termSpaces.find(t => t.projectId === projectId);
  if (!goal || !space) return null;
  const r = await searchDealTerms(ws, goal, { ...space, newTermsConfirmed: false, allowAdditionalSep: false }, ws.dealPlanning?.cashContext ?? null);
  if (r.status === "ready") return { met: true, cashDeltaCents: r.variants[0]?.twoYearCashDeltaCents ?? null };
  if (r.status === "no_feasible_terms") return { met: false, cashDeltaCents: null };
  return null;
}

/**
 * Preview a proposal on a copy of the workspace. Nothing is saved. `userDate` is the user's calendar
 * date (their time zone); without it the proposal's creation date (UTC) is used and noted.
 */
export async function previewChange(ws: HouseholdWorkspace, proposalRaw: ChangeProposal, opts: { userDate?: string; now?: string } = {}): Promise<EngineChangePreview | BlockedComparison> {
  const pr = ChangeProposalSchema.safeParse(proposalRaw);
  if (!pr.success) return { status: "needs_data", code: "INVALID_REQUEST", message: "The proposed change is not valid.", fields: pr.error.issues.map(i => ({ path: `proposal.${i.path.join(".")}`, reason: i.message })) };
  const proposal = pr.data;
  const parsedWs = HouseholdWorkspaceSchema.safeParse(ws);
  if (!parsedWs.success) return { status: "needs_data", code: "INVALID_WORKSPACE", message: "Part of the household plan needs review first.", fields: parsedWs.error.issues.map(i => ({ path: i.path.map(String).join("."), reason: i.message })) };
  const fpBefore = await engineWorkspaceFingerprint(parsedWs.data);
  if (proposal.base.workspaceId !== ws.id || proposal.base.fingerprint !== fpBefore) {
    return { status: "needs_data", code: "PROPOSAL_STALE", message: "Your plan changed after this change was proposed. Propose it again on the current plan.",
      fields: [{ path: "proposal.base", reason: proposal.base.workspaceId !== ws.id ? "Different plan." : `Proposed on revision ${proposal.base.revision}; the plan is now at revision ${ws.revision}.` }] };
  }
  if (proposal.status !== "proposed") return { status: "needs_data", code: "PROPOSAL_STALE", message: `This change is already ${proposal.status}.`, fields: [{ path: "proposal.status", reason: proposal.status }] };
  const userDate = opts.userDate ?? proposal.createdAt.slice(0, 10);
  const now = opts.now ?? proposal.createdAt;
  const applied = validateAndApply(parsedWs.data, proposal, userDate, now);
  const notes = [...applied.notes];
  if (!opts.userDate) notes.push(`Dates were checked against ${userDate} (the day the change was proposed).`);
  const blockers = [...applied.blockers];
  for (const a of proposal.ambiguities) blockers.push({ path: `ambiguities.${a.id}`, reason: a.question });
  for (const rd of proposal.resolvedDates) {
    const mine = resolveRelativeDate(rd.phrase, userDate);
    if (mine && mine !== rd.date) blockers.push({ path: "resolvedDates", reason: `"${rd.phrase}" is ${mine} from ${userDate}, not ${rd.date}. Check the date.` });
  }

  const before = await summary(parsedWs.data);
  const after = blockers.length ? null : await summary(applied.workspace);
  const yearsBefore = before.years ?? [], yearsAfter = after?.years ?? [];
  const years = ([2026, 2027] as TaxYear[]).map(year => {
    const b = yearsBefore.find(y => y.year === year), a = yearsAfter.find(y => y.year === year);
    const pick = (y: typeof b) => (y?.risk && y.spendable !== null ? { subsidyCents: y.risk.ptcCents, settlementCents: y.risk.settlementCents, spendableCents: y.spendable } : null);
    return { year, before: pick(b), after: pick(a) };
  });
  const both = years.filter(y => y.before && y.after);
  const cashDelta = both.length ? both.reduce((s, y) => s + y.after!.spendableCents - y.before!.spendableCents, 0) : null;
  const baselineLabel = both.length ? `Your plan before this change (${both.map(y => y.year).join(" and ")}${both.length === 1 ? " only; the other year cannot be calculated yet" : ""})` : null;

  // Agreed terms: projects with an agreed package or decision record, whose goal and terms exist.
  const agreedProjects = new Set([...(parsedWs.data.dealPlanning?.packages ?? []).filter(p => p.status === "client_agreed").map(p => p.projectId),
    ...(parsedWs.data.dealPlanning?.decisionRecords ?? []).filter(r => r.status === "client_agreed").map(r => r.projectId)]);
  const agreedChecks: EngineChangePreview["agreedChecks"] = [];
  for (const projectId of agreedProjects) {
    const goal = parsedWs.data.dealPlanning?.goals.find(g => g.projectId === projectId);
    if (!goal) continue;
    const proj = parsedWs.data.projects.find(p => p.id === projectId);
    if (!proj?.receipts.some(l => !l.actual && !l.cancelledAt && l.expected)) continue;     // nothing left to check
    agreedChecks.push({ projectId, goalId: goal.id, before: await agreedMeets(parsedWs.data, projectId), after: blockers.length ? null : await agreedMeets(applied.workspace, projectId) });
  }
  const meets = (k: "before" | "after") => agreedChecks.length && agreedChecks.every(c => c[k] !== null) ? agreedChecks.every(c => c[k]!.met) : null;

  const fpAfter = blockers.length ? null : await engineWorkspaceFingerprint(applied.workspace);
  const staleDependencies: ChangePreview["staleDependencies"] = [];
  if (fpAfter && fpAfter !== fpBefore) {
    for (const p of parsedWs.data.dealPlanning?.packages ?? []) {
      if (p.status === "draft" || p.status === "terms_shared_by_user") staleDependencies.push({ kind: "package", id: p.id, reason: "Calculated on the plan before this change; search again before sharing it." });
      if (p.status === "client_agreed" && applied.touchedProjectIds.includes(p.projectId))
        for (const r of p.reminders.filter(x => x.status === "open")) staleDependencies.push({ kind: "action", id: r.uid, reason: `"${r.title}" was planned on the earlier terms; export the current calendar again.` });
    }
    for (const c of proposal.commands) if (c.type === "change_goal") for (const p of parsedWs.data.dealPlanning?.packages ?? [])
      if (p.projectId === c.projectId && p.status !== "superseded") staleDependencies.push({ kind: "goal", id: p.goalId, reason: "The goal changed; options chosen for the old goal are not current." });
  }
  const mk = (k: "before" | "after"): ChangePreviewSummary | null => {
    const y26 = years.find(y => y.year === 2026)![k];
    if (k === "after" && blockers.length) return null;
    return { currentYearSubsidyCents: y26?.subsidyCents ?? null, currentYearSettlementCents: y26?.settlementCents ?? null, agreedTermsStillMeetGoal: meets(k),
      cashDeltaCents: k === "after" ? cashDelta : 0, baselineLabel };
  };
  const status: ChangePreview["status"] = blockers.length ? "needs_data" : after?.blocked?.status === "unsupported" ? "unsupported" : "ready";
  if (after?.blocked) blockers.push(...after.blocked.fields.map(f => ({ path: f.path, reason: `After this change the plan cannot be calculated yet: ${f.reason}` })));
  return { status, proposalId: proposal.id, changes: applied.changes, before: mk("before"), after: mk("after"), staleDependencies, blockers,
    noOps: applied.noOps, notes, years, agreedChecks, fingerprintBefore: fpBefore, fingerprintAfter: fpAfter, userDate };
}
