"use client";

import * as engine from "@/lib/engine";
import type { BlockedComparison, ScenarioResult, TaxYear } from "@/domain/contracts";
import {
  HouseholdWorkspaceSchema, canonicalWorkspaceContent, effectiveLine, forecastFacts, sepPosition, workspaceToCaseInput,
  type HouseholdProjectionResult, type HouseholdWorkspace, type HouseholdWorkspaceEngine, type Project, type ProjectionComponent,
  type ReadyHouseholdProjection, type SepYearStatus, type WorkspaceComparisonResult,
} from "@/domain/household-workspace";

/**
 * Calculation bridge for the household plan.
 *
 * Prefers Claude 2's workspace entry points when `@/lib/engine` exports them. Until then it runs
 * the existing, verified v1 engine (Claude 2) on Claude 3's shared `workspaceToCaseInput` adapter,
 * whose semantics the contract defines. The UI itself performs no tax arithmetic: totals come from
 * the contract helpers, subsidy/tax figures from the engine.
 */
const ws = engine as unknown as Partial<HouseholdWorkspaceEngine>;
export const engineSource: "workspace" | "v1-adapter" =
  typeof ws.buildHouseholdProjection === "function" && typeof ws.compareWorkspaceOpportunity === "function" ? "workspace" : "v1-adapter";

const blocked = (code: string, message: string, fields: BlockedComparison["fields"], status: BlockedComparison["status"] = "needs_data"): BlockedComparison =>
  ({ status, code, message, fields });

function schemaCheck(w: HouseholdWorkspace): BlockedComparison | null {
  const parsed = HouseholdWorkspaceSchema.safeParse(w);
  if (parsed.success) return null;
  return blocked("WORKSPACE_INVALID", "Some entries in this plan need fixing before Headroom can calculate.",
    parsed.error.issues.map(i => ({ path: i.path.join("."), reason: i.message })));
}

/** Adapter "missing" items that concern a given year only (current-year checks ignore 2027). */
function missingFor(w: HouseholdWorkspace, missing: BlockedComparison["fields"], years: TaxYear[]) {
  return missing.filter(m => {
    const byKey = /^forecasts\[(.+):(\d{4})\]$/.exec(m.path);
    if (byKey) return years.includes(Number(byKey[2]) as TaxYear);
    const byIndex = /^forecasts\[(\d+)\]/.exec(m.path);
    if (byIndex) return years.includes(w.forecasts[Number(byIndex[1])]?.year);
    return true;
  });
}

async function fingerprintOf(w: HouseholdWorkspace): Promise<string> {
  const text = JSON.stringify({ c: canonicalWorkspaceContent(w), e: engine.ENGINE_VERSION, r: engine.RULES_VERSION });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Composition of each person/year profit, from contract helpers only. */
function components(w: HouseholdWorkspace, personId: string, year: TaxYear): ProjectionComponent[] {
  const out: ProjectionComponent[] = [];
  const f = w.forecasts.find(x => x.personId === personId && x.year === year);
  if (f) for (const part of forecastFacts(f)) {
    const kind = ({ annualNetProfit: "annual_total", ytdNetProfit: "ytd_net_profit", remainingReceipts: "remaining_receipts", remainingExpenses: "remaining_expenses" } as const)[part.key as "annualNetProfit"];
    out.push({ kind, label: COMPONENT_LABEL[kind], amountCents: part.fact.valueCents === null ? null : part.sign * part.fact.valueCents,
      status: part.fact.status, sourceIds: [part.fact.sourceId] });
  }
  for (const p of w.projects) {
    if (p.ownerPersonId !== personId || p.status === "proposed") continue;
    for (const [kind, lines] of [["project_receipt", p.receipts], ["project_expense", p.expenses]] as const) for (const line of lines) {
      const e = effectiveLine(line);
      if (e.basis === "cancelled" || !e.date?.startsWith(`${year}-`)) continue;
      if (p.status === "cancelled" && e.basis !== "actual") continue;
      out.push({ kind, label: `${p.title}${line.label ? ` — ${line.label}` : ""}`, amountCents: kind === "project_expense" ? -e.amountCents : e.amountCents,
        status: e.basis === "actual" ? "confirmed" : "estimated", basis: e.basis,
        sourceIds: [e.basis === "actual" ? line.actual!.sourceId : line.sourceId], refs: { projectId: p.id, lineId: line.id } });
    }
  }
  return out;
}

const COMPONENT_LABEL = {
  annual_total: "Whole-year profit estimate", ytd_net_profit: "Net profit so far this year", remaining_receipts: "Client payments still expected",
  remaining_expenses: "Business expenses still expected", project_receipt: "Project payment", project_expense: "Project cost",
} as const;

export async function projectHousehold(w: HouseholdWorkspace): Promise<HouseholdProjectionResult> {
  if (ws.buildHouseholdProjection) return ws.buildHouseholdProjection(w);
  const bad = schemaCheck(w); if (bad) return bad;
  const adapted = workspaceToCaseInput(w);
  const missing = missingFor(w, adapted.missing, [2026]);
  if (missing.length) return blocked("WORKSPACE_NEEDS_DATA", "A few facts are needed before Headroom can check this year.", missing);
  const risk = await engine.assessCurrentRisk(adapted.input);
  if (risk.status !== "ready") return risk;
  const years = adapted.input.years.map(y => ({ year: y.year, people: y.incomes.map(row => ({
    personId: row.personId, year: y.year, method: w.forecasts.find(f => f.personId === row.personId && f.year === y.year)?.method ?? null,
    components: components(w, row.personId, y.year), total: row.scheduleCProfit })) }));
  const result: ReadyHouseholdProjection = { status: "ready", workspaceId: w.id, workspaceRevision: w.revision,
    engineVersion: risk.engineVersion, rulesVersion: risk.rulesVersion, fingerprint: await fingerprintOf(w), years,
    currentRisk: risk.risk, assumptions: adapted.notes, warnings: risk.warnings };
  return result;
}

/** One agreed project, fixed amounts/dates, checked on current facts (not re-optimized). */
export interface AgreedCheck {
  project: Project;
  result: engine.AgreedPlanEvaluation;
}

export async function checkAgreedProjects(w: HouseholdWorkspace): Promise<AgreedCheck[]> {
  const agreed = w.projects.filter(p => p.status === "agreed");
  return Promise.all(agreed.map(async project => {
    const adapted = workspaceToCaseInput(w, { candidateProjectId: project.id });
    const missing = missingFor(w, adapted.missing, [2026, 2027]);
    if (missing.length) return { project, result: blocked("WORKSPACE_NEEDS_DATA", "A few facts are needed before this agreement can be checked.", missing) };
    const lines = project.receipts.map(effectiveLine).filter(e => e.basis !== "cancelled" && e.date) as Array<{ amountCents: number; date: string }>;
    const expenses = project.expenses.map(effectiveLine).filter(e => e.basis !== "cancelled" && e.date) as Array<{ amountCents: number; date: string }>;
    const decisions: ScenarioResult["decisions"] = {
      grossRevenueCents: lines.reduce((s, l) => s + l.amountCents, 0),
      receipts: lines.map(l => ({ date: l.date, amountCents: l.amountCents })),
      expenses: ([2026, 2027] as TaxYear[]).map(year => ({ year, amountCents: expenses.filter(e => e.date.startsWith(`${year}-`)).reduce((s, e) => s + e.amountCents, 0) })).filter(e => e.amountCents > 0),
      additionalSep: [],
    };
    const result = await engine.evaluateAgreedPlan(adapted.input, { kind: project.agreedDecision?.kind ?? "accept_now", label: project.agreedDecision?.label, decisions });
    return { project, result };
  }));
}

export async function compareProject(w: HouseholdWorkspace, projectId: string): Promise<WorkspaceComparisonResult> {
  if (ws.compareWorkspaceOpportunity) return ws.compareWorkspaceOpportunity(w, projectId);
  const bad = schemaCheck(w); if (bad) return bad;
  const project = w.projects.find(p => p.id === projectId);
  if (!project) return blocked("PROJECT_MISSING", "This project isn't in the plan any more.", []);
  const adapted = workspaceToCaseInput(w, { candidateProjectId: projectId });
  const missing = missingFor(w, adapted.missing, [2026, 2027]);
  if (missing.length) return blocked("WORKSPACE_NEEDS_DATA", "A few facts are needed before this project can be compared.", missing);
  if (project.receipts.some(l => l.actual)) return blocked("RECEIVED_PAYMENTS", "Part of this project has already been paid. Received money can't be re-timed, so Headroom doesn't search new arrangements for it.", [], "unsupported");
  const comparison = await engine.calculateComparison(adapted.input);
  if (comparison.status !== "ready") return comparison;
  const others = w.projects.filter(p => p.id !== projectId && p.status === "agreed").map(p => p.title);
  return { status: "ready", candidateProjectId: projectId, comparison, fingerprint: comparison.calculationFingerprint,
    baseline: { label: `Your plan without “${project.title}”`,
      description: others.length ? `Includes your forecast and agreed project${others.length > 1 ? "s" : ""}: ${others.join(", ")}. Only “${project.title}” changes between options.` : `Your forecast without this project. Only “${project.title}” changes between options.` } };
}

/** Goal / paid / remaining per owner and year, from the contract helper. Legal limit comes from the workspace engine when available. */
export function sepRows(w: HouseholdWorkspace): SepYearStatus[] {
  const keys = new Set<string>();
  for (const t of w.retirement.targets) keys.add(`${t.personId}|${t.year}`);
  for (const c of w.retirement.contributions) keys.add(`${c.personId}|${c.taxYear}`);
  return [...keys].sort().map(k => {
    const [personId, y] = k.split("|"); const year = Number(y) as TaxYear;
    return { personId, year, ...sepPosition(w, personId, year), legalLimitCents: null };
  });
}

export { ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
