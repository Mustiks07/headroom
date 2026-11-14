import { z } from "zod";
import { CaseInputSchema, CentsSchema, TaxYearSchema, type MoneyFact, type SavedPlan, type TaxYear } from "@/domain/contracts";
import {
  HouseholdWorkspaceSchema, WORKSPACE_FILE_KIND, WORKSPACE_VERSION, type HouseholdWorkspace, type Project, type ProjectLine,
} from "@/domain/household-workspace";
import { CURRENT_FORECAST_TITLE } from "@/domain/household-workspace";
import { PlanIntegrityError } from "./errors";

export const MIGRATION_SOURCE_ID = "v1-migration";

/** The agreed decisions of a v1 plan, validated (the file/storage is untrusted). */
const DecisionsSchema = z.object({
  grossRevenueCents: CentsSchema.nonnegative(),
  receipts: z.array(z.object({ date: z.string().date(), amountCents: CentsSchema.nonnegative() })).max(10),
  expenses: z.array(z.object({ year: TaxYearSchema, amountCents: CentsSchema.nonnegative() })).max(10),
  additionalSep: z.array(z.object({ year: TaxYearSchema, personId: z.string(), amountCents: CentsSchema.nonnegative() })).max(10),
});

export type ExistingSepAnswer =
  | { kind: "paid"; amountCents: number; paidDate: string }
  | { kind: "planned" }
  | { kind: "unknown" };

export interface V1MigrationQuestion {
  id: string;
  kind: "existing_sep" | "project_status";
  personId?: string;
  year?: TaxYear;
  text: string;
  /** Amount the v1 plan recorded, for display. */
  amountCents?: number;
}

export interface V1MigrationPreview {
  source: "browser" | "cloud" | "json";
  planId: string;
  planRevision: number;
  engineVersion: string;
  rulesVersion: string;
  /** Where each new forecast comes from: the v1 Schedule C profit fact (status/range/source kept). */
  baseline: Array<{ personId: string; year: TaxYear; profit: MoneyFact }>;
  /** The v1 project and the option chosen in that plan. */
  opportunity: { title: string; grossRevenueCents: number; chosenScenarioId: string; chosenLabel: string;
    receipts: Array<{ date: string; amountCents: number }>; additionalSep: Array<{ year: TaxYear; personId: string; amountCents: number }> } | null;
  /** v1 "done" marks: shown, kept for review, never converted into payments. */
  completedActions: Array<{ id: string; title: string }>;
  questions: V1MigrationQuestion[];
  warnings: string[];
}

export interface V1MigrationAnswers {
  /** Is the v1 project agreed with the client? (default: agreed when a non-decline option was chosen) */
  projectStatus?: "agreed" | "proposed";
  /** Per "personId:year" with a v1 existing SEP amount: what actually happened. */
  existingSep?: Record<string, ExistingSepAnswer>;
}

/** Describe what migrating a v1 SavedPlan would create. Nothing is saved or deleted. */
export function previewV1Migration(plan: SavedPlan, source: V1MigrationPreview["source"]): V1MigrationPreview {
  const input = CaseInputSchema.safeParse(plan?.input);
  if (!input.success) throw new PlanIntegrityError("INVALID_V1_PLAN", "This saved plan's household data is invalid, so it can't be converted.");
  const scenarios = Array.isArray(plan.comparison?.scenarios) ? plan.comparison.scenarios : [];
  const chosen = scenarios.find(s => s && s.id === plan.chosenScenarioId);
  const warnings: string[] = [];
  const decisions = chosen ? DecisionsSchema.safeParse(chosen.decisions) : null;
  if (chosen && !decisions?.success) warnings.push("The saved payment arrangement is damaged; the project is converted from the offer amount and date instead.");
  const hasProject = input.data.opportunity.grossRevenueCents > 0 && input.data.opportunity.title !== CURRENT_FORECAST_TITLE;
  const baseline = input.data.years.flatMap(y => y.incomes.map(i => ({ personId: i.personId, year: y.year, profit: i.scheduleCProfit })));
  const questions: V1MigrationQuestion[] = [];
  if (hasProject) {
    questions.push({ id: "project_status", kind: "project_status",
      text: `Is "${input.data.opportunity.title}" agreed with the client, or still only an offer?` });
  }
  for (const y of input.data.years) for (const i of y.incomes) {
    const v = i.existingSepContribution.valueCents;
    if (v !== null && v > 0) questions.push({ id: `${i.personId}:${y.year}`, kind: "existing_sep", personId: i.personId, year: y.year, amountCents: v,
      text: `The old plan listed a ${y.year} SEP contribution. Was it actually paid (amount and date), or only planned?` });
  }
  const completed = plan.completedActionIds.map(id => ({ id, title: chosen?.actions?.find(a => a.id === id)?.title ?? id }));
  if (completed.length) warnings.push("Actions marked done in the old plan are kept as notes to review; they are not recorded as payments or contributions.");
  return {
    source, planId: plan.id, planRevision: plan.revision,
    engineVersion: String(plan.comparison?.engineVersion ?? "unknown"), rulesVersion: String(plan.comparison?.rulesVersion ?? "unknown"),
    baseline,
    opportunity: hasProject ? {
      title: input.data.opportunity.title, grossRevenueCents: input.data.opportunity.grossRevenueCents,
      chosenScenarioId: plan.chosenScenarioId, chosenLabel: chosen?.label ?? plan.chosenScenarioId,
      receipts: decisions?.success ? decisions.data.receipts : [],
      additionalSep: decisions?.success ? decisions.data.additionalSep : [],
    } : null,
    completedActions: completed, questions, warnings,
  };
}

/**
 * Build the v2 workspace after the user answered the preview's questions. Throws (nothing partial)
 * if the result would be invalid. The caller saves it and keeps the original v1 plan untouched.
 */
export function confirmV1Migration(plan: SavedPlan, preview: V1MigrationPreview, answers: V1MigrationAnswers, now = new Date()): HouseholdWorkspace {
  const input = CaseInputSchema.parse(plan.input);
  const at = now.toISOString();
  const day = at.slice(0, 10);
  const unconfirmed: string[] = preview.completedActions.map(a => `Old "done" mark: ${a.title} — confirm with the actual amount and date if it was paid.`);
  const sepAnswers = answers.existingSep ?? {};
  for (const q of preview.questions.filter(q => q.kind === "existing_sep")) {
    if (!sepAnswers[q.id]) throw new PlanIntegrityError("MIGRATION_ANSWER_MISSING", "Answer what happened to the SEP contribution listed in the old plan.");
  }

  const otherIncomes = (y: (typeof input.years)[number]) => y.incomes.map(i => {
    const copy: Record<string, unknown> = { ...i };
    delete copy.scheduleCProfit;
    delete copy.existingSepContribution;
    return copy;
  });
  const household = {
    caseId: input.id, title: input.title, isSynthetic: input.isSynthetic, state: input.state, countyFips: input.countyFips,
    filingStatus: input.filingStatus, people: input.people,
    years: input.years.map(y => ({ year: y.year, taxFamilySize: y.taxFamilySize, coveredPersonIds: y.coveredPersonIds, otherIncomes: otherIncomes(y),
      coverage: y.coverage, benchmarkStatus: y.benchmarkStatus, unsupportedFacts: y.unsupportedFacts, scopeConfirmed: y.scopeConfirmed })),
  };
  // v1 profit was entered WITHOUT the opportunity (the opportunity is incremental), so it excludes the managed project.
  const forecasts = preview.baseline.map(b => ({ method: "annual_total" as const, personId: b.personId, year: b.year, excludesManagedProjects: true, annualNetProfit: b.profit }));

  const projects: Project[] = [];
  const o = preview.opportunity;
  if (o) {
    const status = answers.projectStatus ?? (plan.chosenScenarioId !== "decline" ? "agreed" : "proposed");
    const receiptsSource = status === "agreed" && o.receipts.length ? o.receipts : [{ date: input.opportunity.plannedReceiptDate, amountCents: o.grossRevenueCents }];
    const line = (id: string, amountCents: number, date: string, label: string): ProjectLine =>
      ({ id, label, expected: { amountCents, date }, actual: null, cancelledAt: null, sourceId: MIGRATION_SOURCE_ID, corrections: [] });
    const expenses = input.opportunity.incrementalExpensesCents > 0
      ? [line("v1-expense-1", input.opportunity.incrementalExpensesCents, input.opportunity.expensePaymentDate, "Project expenses")] : [];
    projects.push({
      id: "v1-project", title: o.title, ownerPersonId: input.opportunity.ownerPersonId, status, createdAt: plan.createdAt || at, statusChangedAt: at,
      cashAccountingConfirmed: input.opportunity.cashAccountingConfirmed, timingArrangementConfirmed: input.opportunity.timingArrangementConfirmed,
      terms: { canSplitPayment: input.constraints.canSplitPayment, canRenegotiatePrice: input.constraints.canRenegotiatePrice,
        nextYearPaymentLatestDate: input.constraints.nextYearPaymentLatestDate },
      receipts: receiptsSource.map((r, i) => line(`v1-receipt-${i + 1}`, r.amountCents, r.date, receiptsSource.length > 1 ? `Payment ${i + 1}` : "Payment")),
      expenses,
      agreedDecision: status === "agreed" ? { kind: (plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId)?.kind ?? "accept_now"),
        label: o.chosenLabel, chosenAt: plan.updatedAt || at, fingerprint: plan.comparison.calculationFingerprint ?? null } : null,
    });
  }

  // SEP: goal = existing (v1) + additional from the agreed option; payments only from explicit answers.
  const targets: HouseholdWorkspace["retirement"]["targets"] = [];
  const contributions: HouseholdWorkspace["retirement"]["contributions"] = [];
  for (const y of input.years) for (const inc of y.incomes) {
    const existing = inc.existingSepContribution.valueCents ?? 0;
    const additional = projects[0]?.status === "agreed" ? (o?.additionalSep ?? []).filter(a => a.year === y.year && a.personId === inc.personId).reduce((s, a) => s + a.amountCents, 0) : 0;
    const key = `${inc.personId}:${y.year}`;
    const answer = sepAnswers[key];
    if (answer?.kind === "paid") {
      contributions.push({ id: `v1-sep-${key.replace(":", "-")}`, personId: inc.personId, taxYear: y.year, amountCents: answer.amountCents,
        paidDate: answer.paidDate, sourceId: MIGRATION_SOURCE_ID, recordedAt: at });
    } else if (answer?.kind === "unknown") {
      unconfirmed.push(`${y.year} SEP listed in the old plan (${(existing / 100).toFixed(2)} USD): not known whether it was paid. Kept as part of the goal, not as a payment.`);
    }
    if (existing + additional > 0) {
      targets.push({ id: `v1-sep-goal-${key.replace(":", "-")}`, personId: inc.personId, year: y.year, targetCents: existing + additional, acceptedAt: at,
        origin: { projectId: projects[0]?.id ?? null, scenarioKind: additional > 0 ? (projects[0]?.agreedDecision?.kind ?? null) : null, fingerprint: plan.comparison.calculationFingerprint ?? null } });
    }
  }

  const draft = {
    workspaceVersion: WORKSPACE_VERSION, id: `draft-${plan.id}`, revision: 0, createdAt: at, updatedAt: at,
    household, forecasts, projects,
    retirement: { targets, contributions, futureContributionBudget: { amountCents: input.constraints.maxAdditionalSepCents, asOfDate: day, sourceId: MIGRATION_SOURCE_ID } },
    planning: { objective: input.constraints.objective, minimumDesiredCashGainCents: input.constraints.minimumDesiredCashGainCents },
    evidence: [...input.evidence, { id: MIGRATION_SOURCE_ID, kind: "manual" as const,
      label: `Converted from a saved plan (revision ${preview.planRevision}, ${preview.engineVersion} / ${preview.rulesVersion}) with your answers` }],
    events: [{ id: crypto.randomUUID(), at, kind: "migrated_from_v1" as const,
      description: `Converted from saved plan revision ${preview.planRevision}.${unconfirmed.length ? ` ${unconfirmed.length} item(s) need confirmation.` : ""}`,
      refs: {}, previousFingerprint: plan.comparison.calculationFingerprint ?? null, nextFingerprint: null }],
    calculation: null,
    origin: { kind: "migrated_v1" as const, planId: plan.id, planRevision: plan.revision, planFingerprint: String(plan.comparison.calculationFingerprint ?? ""),
      engineVersion: preview.engineVersion, rulesVersion: preview.rulesVersion, source: preview.source, migratedAt: at, unconfirmed: unconfirmed.slice(0, 50) },
  };
  const parsed = HouseholdWorkspaceSchema.safeParse(draft);
  if (!parsed.success) {
    throw new PlanIntegrityError("MIGRATION_INVALID", "This plan can't be converted automatically. Your original plan is unchanged.",
      parsed.error.issues.slice(0, 10).map(i => ({ path: i.path.join("."), reason: i.message })));
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ v2 JSON */

export function exportWorkspaceJson(ws: HouseholdWorkspace, legacySnapshot: unknown = null): Blob {
  return new Blob([JSON.stringify({ kind: WORKSPACE_FILE_KIND, workspaceVersion: WORKSPACE_VERSION, exportedAt: new Date().toISOString(),
    workspace: ws, legacySnapshot }, null, 2)], { type: "application/json" });
}

export type WorkspaceFileAnalysis =
  | { status: "invalid"; message: string }
  | { status: "workspace"; workspace: HouseholdWorkspace; legacySnapshot: unknown | null; notes: string[] }
  | { status: "v1_plan"; plan: SavedPlan; preview: V1MigrationPreview };

/**
 * Read a workspace (v2) or saved-plan (v1) JSON file. A v2 file is validated whole (never a
 * partial import); a newer format is refused with a clear message; a v1 file returns a migration
 * preview that the user must confirm.
 */
export function analyzeWorkspaceFile(text: string): WorkspaceFileAnalysis {
  if (text.length > 5_000_000) return { status: "invalid", message: "This file is too large to be a Headroom plan." };
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { return { status: "invalid", message: "This file isn't valid JSON." }; }
  if (!data || typeof data !== "object") return { status: "invalid", message: "This doesn't look like a Headroom file." };
  if (data.kind === WORKSPACE_FILE_KIND) {
    const version = String(data.workspaceVersion ?? (data.workspace as { workspaceVersion?: unknown } | undefined)?.workspaceVersion ?? "");
    if (version !== WORKSPACE_VERSION) {
      const newer = Number.parseFloat(version) > Number.parseFloat(WORKSPACE_VERSION);
      return { status: "invalid", message: newer
        ? `This file was made by a newer version of Headroom (household plan format ${version}). This version reads format ${WORKSPACE_VERSION}; nothing was imported.`
        : `This household plan format (${version || "unknown"}) isn't supported; nothing was imported.` };
    }
    const parsed = HouseholdWorkspaceSchema.safeParse(data.workspace);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return { status: "invalid", message: `The household plan in this file isn't valid (${i?.path.join(".") || "workspace"}: ${i?.message ?? "invalid"}); nothing was imported.` };
    }
    return { status: "workspace", workspace: { ...parsed.data, revision: 0 }, legacySnapshot: data.legacySnapshot ?? null,
      notes: ["The plan will be saved as a new copy; numbers are recalculated with the current rules when you open it."] };
  }
  if (data.kind === "headroom.saved-plan" && data.plan && typeof data.plan === "object") {
    const plan = data.plan as SavedPlan;
    try { return { status: "v1_plan", plan, preview: previewV1Migration(plan, "json") }; }
    catch (e) { return { status: "invalid", message: e instanceof Error ? e.message : "This saved plan can't be read." }; }
  }
  return { status: "invalid", message: "This doesn't look like a Headroom household plan or saved plan file." };
}
