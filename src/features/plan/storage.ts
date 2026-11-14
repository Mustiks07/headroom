"use client";

import { CaseInputSchema, CONTRACT_VERSION, type CaseInput, type PlanRepository, type ReadyComparison, type SavedPlan } from "@/domain/contracts";
import { createPlanRepository, HeadroomError, PlanConflictError } from "@/lib/client/api";

let repo: PlanRepository | null = null;
export function planRepository(): PlanRepository {
  if (!repo) repo = createPlanRepository();
  return repo;
}

export type StorageMode = "local" | "cloud" | "unknown";

/**
 * Where saved plans live. Prefers an optional `storageMode()` on the
 * repository (proposed additive helper), then the public capabilities route.
 * Never claims cloud storage without evidence.
 */
export async function detectStorageMode(): Promise<StorageMode> {
  const r = planRepository() as PlanRepository & { storageMode?: () => Promise<StorageMode> | StorageMode };
  if (typeof r.storageMode === "function") {
    try { return await r.storageMode(); } catch { /* fall through */ }
  }
  try {
    const res = await fetch("/api/capabilities", { cache: "no-store" });
    if (!res.ok) return "unknown";
    const caps = await res.json() as { cloudSave?: boolean };
    return caps.cloudSave === true ? "cloud" : caps.cloudSave === false ? "local" : "unknown";
  } catch { return "unknown"; }
}

export function storageText(mode: StorageMode): string {
  if (mode === "cloud") return "Saved to a private guest session for this browser. Not synced to other devices.";
  if (mode === "local") return "Saved in this browser.";
  return "Saved.";
}

export function describeStorageError(e: unknown): string {
  // Typed errors from the storage adapter (Claude 3) carry English UI copy and a stable code.
  if (e instanceof PlanConflictError) return "This plan was changed somewhere else (maybe another tab). Reload to see the latest version — your edits here are kept until you leave.";
  if (e instanceof HeadroomError) {
    if (e.code === "STALE_RESULT") return "These results are out of date for the current inputs. Recalculate, then save again.";
    return `Your plan couldn't be saved: ${e.message}`;
  }
  const text = e instanceof Error ? e.message : String(e);
  if (/409|conflict|revision/i.test(text)) return "This plan was changed somewhere else (maybe another tab). Reload to see the latest version — your edits here are kept until you leave.";
  if (/not implemented|unavailable/i.test(text)) return `Saving isn't available in this build: ${text}`;
  return `Your plan couldn't be saved: ${text}`;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveNewPlan(input: CaseInput, comparison: ReadyComparison, chosenScenarioId: string): Promise<SavedPlan> {
  const now = new Date().toISOString();
  const plan: SavedPlan = { id: newId(), revision: 0, createdAt: now, updatedAt: now, input, comparison, chosenScenarioId, completedActionIds: [] };
  return planRepository().save(plan, null);
}

export function eventId() { return newId(); }

/* ---------- Files ---------- */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), filename);
}

export const PLAN_FILE_KIND = "headroom.saved-plan";
export const INPUT_FILE_KIND = "headroom.case-input";

export function planFile(plan: SavedPlan) {
  return { kind: PLAN_FILE_KIND, contractVersion: CONTRACT_VERSION, exportedAt: new Date().toISOString(), plan };
}

export function inputFile(input: unknown) {
  return { kind: INPUT_FILE_KIND, contractVersion: CONTRACT_VERSION, exportedAt: new Date().toISOString(), input };
}

export function fileStamp() { return new Date().toISOString().slice(0, 10); }

/**
 * Reads a Headroom JSON file. Only the input is trusted (after schema
 * validation); stored results are always recalculated by the caller.
 */
export function readHeadroomFile(text: string): { ok: true; input: CaseInput; chosenScenarioId: string | null; completedActionIds: string[] } | { ok: false; message: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, message: "This file isn't valid JSON." }; }
  const obj = data as Record<string, unknown>;
  const plan = (obj?.kind === PLAN_FILE_KIND ? obj.plan : obj?.input && obj?.comparison ? obj : null) as Partial<SavedPlan> | null;
  const rawInput = plan ? plan.input : obj?.kind === INPUT_FILE_KIND ? obj.input : obj?.contractVersion ? obj : null;
  if (!rawInput) return { ok: false, message: "This doesn't look like a Headroom plan or data file." };
  const parsed = CaseInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: `The household data in this file isn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}.` };
  return { ok: true, input: parsed.data, chosenScenarioId: typeof plan?.chosenScenarioId === "string" ? plan.chosenScenarioId : null,
    completedActionIds: Array.isArray(plan?.completedActionIds) ? plan.completedActionIds.filter((x): x is string => typeof x === "string") : [] };
}

/* ---------- Hand-off between pages (no financial data in URLs) ---------- */

const HANDOFF_KEY = "headroom.handoff.v1";
export function stashInputForCalculator(input: CaseInput) {
  try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(input)); } catch { /* storage blocked */ }
}
export function takeStashedInput(): CaseInput | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = CaseInputSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export const DRAFT_KEY = "headroom.check.draft.v1";
export function clearBrowserDrafts() {
  try { localStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(HANDOFF_KEY); localStorage.removeItem("headroom.demo-access.v1"); localStorage.removeItem("headroom:v1:entitlement"); } catch { /* ignore */ }
}
