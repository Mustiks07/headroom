import { CaseInputSchema, CONTRACT_VERSION, type BlockedComparison, type CaseInput, type ReadyComparison, type SavedPlan } from "@/domain/contracts";
import { calculateComparison, calculationFingerprint } from "@/lib/engine";
import type { VersionPair } from "./plan-upgrade";

export const PLAN_FILE_KIND = "headroom.saved-plan";
export const INPUT_FILE_KIND = "headroom.case-input";
const MAX_FILE_CHARS = 5_000_000;

export type RestoreAnalysis =
  | { status: "invalid"; message: string }
  | { status: "blocked"; input: CaseInput; result: BlockedComparison; message: string }
  | {
    status: "ready";
    input: CaseInput;
    /** Fresh result from the current engine. Stored numbers in the file are never used. */
    comparison: ReadyComparison;
    fileKind: "saved-plan" | "case-input";
    /** Engine/rules recorded in the file, when it was a saved plan. */
    fileVersions: VersionPair | null;
    /** The file's stored fingerprint equals the fresh one (same inputs, same engine and rules). */
    fingerprintMatches: boolean;
    choice: { fromFile: string | null; label: string | null; state: "kept" | "missing" | "infeasible" | "none" };
    /** Pre-selected only when the file's option still exists and is feasible; otherwise the user must choose. */
    suggestedScenarioId: string | null;
    completedKept: string[];
    completedDropped: string[];
    feasibleOptions: Array<{ id: string; label: string; recommended: boolean }>;
    notes: string[];
  };

const invalid = (message: string): RestoreAnalysis => ({ status: "invalid", message });

/**
 * Read a Headroom JSON file (saved plan or collected inputs), validate it, and recalculate it with
 * the current engine. Reports version/fingerprint differences, a missing or unavailable option and
 * completed actions that no longer exist, so the UI can ask instead of silently replacing them.
 */
export async function analyzePlanFile(text: string): Promise<RestoreAnalysis> {
  if (text.length > MAX_FILE_CHARS) return invalid("This file is too large to be a Headroom plan.");
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { return invalid("This file isn't valid JSON."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return invalid("This doesn't look like a Headroom plan or data file.");

  let plan: Partial<SavedPlan> | null = null;
  let rawInput: unknown;
  let fileKind: "saved-plan" | "case-input";
  if (data.kind === PLAN_FILE_KIND || (data.input && data.comparison)) {
    plan = (data.kind === PLAN_FILE_KIND ? data.plan : data) as Partial<SavedPlan> | null;
    if (!plan || typeof plan !== "object") return invalid("This plan file has no plan in it.");
    rawInput = plan.input; fileKind = "saved-plan";
  } else if (data.kind === INPUT_FILE_KIND) {
    rawInput = data.input; fileKind = "case-input";
  } else if (data.contractVersion && data.years) {
    rawInput = data; fileKind = "case-input";
  } else {
    return invalid("This doesn't look like a Headroom plan or data file.");
  }

  const fileContract = (data.contractVersion ?? (rawInput as { contractVersion?: unknown } | undefined)?.contractVersion) as unknown;
  if (fileContract !== undefined && fileContract !== CONTRACT_VERSION) {
    return invalid(`This file was made with data format ${String(fileContract)}; this version of Headroom reads format ${CONTRACT_VERSION}.`);
  }
  const parsed = CaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid(`The household data in this file isn't valid${issue ? ` (${issue.path.join(".") || "input"}: ${issue.message})` : ""}.`);
  }
  const input = parsed.data;
  const result = await calculateComparison(input);
  if (result.status !== "ready") {
    return { status: "blocked", input, result, message: result.status === "unavailable"
      ? `The calculation isn't available right now: ${result.message}`
      : `The data was read, but it can't be calculated as is: ${result.message}` };
  }

  const notes: string[] = [];
  const stored = plan?.comparison as Partial<ReadyComparison> | undefined;
  const fileVersions = stored && typeof stored.engineVersion === "string" && typeof stored.rulesVersion === "string"
    ? { engineVersion: stored.engineVersion, rulesVersion: stored.rulesVersion } : null;
  const fingerprintMatches = typeof stored?.calculationFingerprint === "string" && stored.calculationFingerprint === result.calculationFingerprint;
  if (fileKind === "saved-plan") {
    if (fileVersions && (fileVersions.engineVersion !== result.engineVersion || fileVersions.rulesVersion !== result.rulesVersion)) {
      notes.push(`The file was calculated with ${fileVersions.engineVersion} / ${fileVersions.rulesVersion}. It has been recalculated with ${result.engineVersion} / ${result.rulesVersion}; figures may differ.`);
    } else if (!fingerprintMatches) {
      notes.push("The figures stored in the file don't match its inputs, so they were ignored and recalculated.");
    }
  }

  const fromFile = typeof plan?.chosenScenarioId === "string" ? plan.chosenScenarioId : null;
  const fileOption = fromFile ? (stored?.scenarios ?? []).find(s => s?.id === fromFile) : undefined;
  const now = fromFile ? result.scenarios.find(s => s.id === fromFile) : undefined;
  const state = !fromFile ? "none" : !now ? "missing" : now.feasible ? "kept" : "infeasible";
  if (state === "missing") notes.push(`The option chosen in the file ("${fileOption?.label ?? fromFile}") is not offered in the current calculation. Choose an option.`);
  if (state === "infeasible") notes.push(`The option chosen in the file ("${now!.label}") is not available now: ${now!.infeasibilityReasons.join(" ") || "it is outside your limits."} Choose an option.`);

  const completed = Array.isArray(plan?.completedActionIds) ? plan!.completedActionIds.filter((x): x is string => typeof x === "string") : [];
  const completedKept = state === "kept" ? completed.filter(id => now!.actions.some(a => a.id === id)) : [];
  const completedDropped = completed.filter(id => !completedKept.includes(id));
  if (completedDropped.length) notes.push(`${completedDropped.length} completed action(s) from the file no longer match the current plan and were not restored as done.`);

  // Re-derive the fingerprint locally as a consistency check of the engine itself.
  if (await calculationFingerprint(input) !== result.calculationFingerprint) notes.push("Calculation fingerprint could not be confirmed.");

  return {
    status: "ready", input, comparison: result, fileKind, fileVersions, fingerprintMatches,
    choice: { fromFile, label: now?.label ?? fileOption?.label ?? null, state },
    suggestedScenarioId: state === "kept" ? fromFile : null,
    completedKept, completedDropped,
    feasibleOptions: result.scenarios.filter(s => s.feasible).map(s => ({ id: s.id, label: s.label, recommended: s.id === result.recommendedScenarioId })),
    notes,
  };
}

/** Build a new plan (to save with `repository.save(plan, null)`) from an analysed file and the user's option. */
export function planFromAnalysis(analysis: Extract<RestoreAnalysis, { status: "ready" }>, chosenScenarioId: string): SavedPlan {
  const chosen = analysis.comparison.scenarios.find(s => s.id === chosenScenarioId);
  if (!chosen?.feasible) throw new Error("Choose an option that is available in the current calculation.");
  const now = new Date().toISOString();
  return { id: "", revision: 0, createdAt: now, updatedAt: now, input: analysis.input, comparison: analysis.comparison, chosenScenarioId,
    completedActionIds: chosenScenarioId === analysis.suggestedScenarioId ? analysis.completedKept : [] };
}
