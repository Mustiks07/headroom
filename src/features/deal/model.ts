import {
  CashContextSchema, DealGoalSchema, DealTermsSpaceSchema,
  type CashContext, type DealGoal, type DealTermsSpace,
} from "@/domain/deal-planning";
import type { HouseholdWorkspace, Project } from "@/domain/household-workspace";
import { centsToInput, localCalendarDate } from "@/features/format";
import { parseAmount } from "@/features/household-plan/parts";
import { goalProblems, type GoalDraft } from "./GoalForm";

/**
 * Converts the goal form (typed text) into the shared contract objects. Format checks only —
 * whether the goal is reachable is the engine's answer (searchDealTerms).
 */
export type BuiltGoal = { ok: true; goal: DealGoal; space: DealTermsSpace; cash: CashContext | null } | { ok: false; message: string };

const cents = (t: string) => parseAmount(t, true).cents ?? 0;

export function buildGoal(ws: HouseholdWorkspace, project: Project, d: GoalDraft, existingGoalId: string | null): BuiltGoal {
  const problems = goalProblems(d);
  if (Object.keys(problems).length) return { ok: false, message: Object.values(problems)[0]! };
  const now = new Date().toISOString();
  const prev = ws.dealPlanning?.goals.find(g => g.id === existingGoalId);
  const goalId = prev?.id ?? `goal-${project.id}`;
  const dateTargets = d.byDate.on ? [{ id: `${goalId}-by-date`, kind: d.byDate.kind, byDate: d.byDate.date, minimumCents: cents(d.byDate.amount) }] : [];
  const goal = DealGoalSchema.safeParse({
    id: goalId, projectId: project.id, minimumTwoYearCashDeltaCents: d.keepAtLeast.trim() === "" ? 0 : cents(d.keepAtLeast),
    baseline: "decline_unpaid_terms", maxAdditionalSepCents: cents(d.sepMax), dateTargets,
    createdAt: prev?.createdAt ?? now, updatedAt: now,
  });
  if (!goal.success) return { ok: false, message: goal.error.issues[0]?.message ?? "The goal isn't complete." };

  // Payment windows: from today (or Jan 1, 2026) to the latest acceptable date; one window holds 100%.
  const earliest = maxDate(localCalendarDate(), "2026-01-01");
  const latest = d.windows.latestDate || lastUnpaidDate(project) || "2026-12-31";
  if (d.clientOpen === true && latest < earliest) return { ok: false, message: "The latest payment date has passed. Choose a future date before searching new terms." };
  const start = minDate(earliest, latest); // fixed offered terms may have an overdue payment
  const windows = [2026, 2027].map(year => ({ id: `w-${year}`, earliest: maxDate(start, `${year}-01-01`),
    latest: minDate(latest, `${year}-12-31`), maxShareBps: 10_000 })).filter(w => w.earliest <= w.latest);
  const space = DealTermsSpaceSchema.safeParse({
    projectId: project.id,
    price: { minCents: cents(d.price.min), maxCents: cents(d.price.max), stepCents: 25_000 },
    paymentWindows: windows, maxPayments: d.windows.maxParts, newTermsConfirmed: d.clientOpen,
    allowAdditionalSep: cents(d.sepMax) > 0,
  });
  if (!space.success) return { ok: false, message: space.error.issues[0]?.message ?? "The payment limits aren't complete." };

  let cash: CashContext | null = ws.dealPlanning?.cashContext ?? null;
  if (d.byDate.on && d.byDate.kind === "household_balance") {
    const parsed = CashContextSchema.safeParse({
      id: cash?.id ?? "cash-context", snapshot: { date: d.cash.asOf, balanceCents: cents(d.cash.balance), sourceId: "manual-entry" },
      // Facts already reflected in today's balance: payments received and SEP contributions paid on or before the snapshot date.
      includedFactIds: [
        ...ws.projects.flatMap(p => [...p.receipts, ...p.expenses]).filter(l => l.actual && l.actual.date <= d.cash.asOf).map(l => l.id),
        ...ws.retirement.contributions.filter(c => c.paidDate <= d.cash.asOf).map(c => c.id),
      ],
      flows: cash?.flows ?? [], reserveCents: cents(d.cash.reserve),
      completeness: { confirmed: d.cash.complete, from: d.cash.asOf, through: d.byDate.date },
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "The cash details aren't complete." };
    cash = parsed.data;
  }
  return { ok: true, goal: goal.data, space: space.data, cash };
}

/** Restores the form from a saved goal/terms space (so a returning user sees their own limits). */
export function draftFromSaved(base: GoalDraft, goal: DealGoal | undefined, space: DealTermsSpace | undefined, cash: CashContext | null): GoalDraft {
  if (!goal) return base;
  const t = goal.dateTargets[0];
  return {
    ...base,
    keepAtLeast: goal.minimumTwoYearCashDeltaCents ? centsToInput(goal.minimumTwoYearCashDeltaCents) : "",
    sepMax: centsToInput(goal.maxAdditionalSepCents ?? 0),
    byDate: t ? { on: true, date: t.byDate, amount: centsToInput(t.minimumCents), kind: t.kind } : base.byDate,
    price: space ? { min: centsToInput(space.price.minCents), max: centsToInput(space.price.maxCents) } : base.price,
    windows: space ? { latestDate: space.paymentWindows.map(w => w.latest).sort().at(-1) ?? "", maxParts: space.maxPayments } : base.windows,
    clientOpen: space ? space.newTermsConfirmed : base.clientOpen,
    cash: cash?.snapshot ? { balance: centsToInput(cash.snapshot.balanceCents), asOf: cash.snapshot.date, reserve: centsToInput(cash.reserveCents), complete: cash.completeness.confirmed } : base.cash,
  };
}

function lastUnpaidDate(p: Project) {
  return p.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected).map(l => l.expected!.date).sort().at(-1) ?? null;
}
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
