import { CONTRACT_VERSION, CaseInputSchema, type CaseInput, type ExtractionResult, type SavedPlan } from "@/domain/contracts";
import type { AnalyticsEvent } from "./analytics-events";
import { getCloudSession } from "./cloud-session";
import { HeadroomError, PlanIntegrityError } from "./errors";
import { apiFetch, errorFromResponse, readJson } from "./http";
import { getStorageMode } from "./repository";

export interface Capabilities { cloudSave: boolean; aiExtraction: boolean; checkoutMode: "demo" | "stripe_test"; localTextImport: boolean }

const OFFLINE_CAPABILITIES: Capabilities = { cloudSave: false, aiExtraction: false, checkoutMode: "demo", localTextImport: false };

/**
 * What the deployment can actually do in this browser. On failure, everything optional is
 * reported unavailable. AI extraction additionally needs this browser's invisible guest session
 * (the server meters the paid provider per guest), so it is false in local mode.
 */
export async function getCapabilities(): Promise<Capabilities> {
  try {
    const caps = await readJson<Capabilities>(await apiFetch("/api/capabilities", { timeoutMs: 8000 }));
    return caps.aiExtraction && !(await cloudToken()) ? { ...caps, aiExtraction: false } : caps;
  } catch {
    return OFFLINE_CAPABILITIES;
  }
}

async function cloudToken(): Promise<string | undefined> {
  const mode = await getStorageMode();
  if (mode.mode !== "cloud") return undefined;
  return (await getCloudSession())?.accessToken;
}

/**
 * Upload one document for review. CSV/TXT are read deterministically on the server. PDF/images
 * are sent to the configured AI provider only with `consentToProvider: true` (show the user
 * what will be sent first). Always returns an ExtractionResult; failures become `unavailable`
 * with an English explanation. Nothing is applied automatically.
 */
export async function extractDocument(file: File, options: { consentToProvider?: boolean } = {}): Promise<ExtractionResult> {
  const form = new FormData();
  form.set("file", file);
  if (options.consentToProvider) form.set("consent", "provider");
  try {
    const response = await apiFetch("/api/documents/extract", { method: "POST", body: form, timeoutMs: 70_000,
      token: options.consentToProvider ? await cloudToken() : undefined });
    const body = await response.json().catch(() => null);
    if (body && (body.status === "review_required" || body.status === "unavailable")) return body as ExtractionResult;
    const message = body?.error?.message ?? "The document could not be read. Enter the figures manually.";
    return { status: "unavailable", fields: [], warnings: [message] };
  } catch (error) {
    return { status: "unavailable", fields: [], warnings: [error instanceof Error ? error.message : "The document could not be read. Enter the figures manually."] };
  }
}

/**
 * Generate the accountant PDF from a FRESH server calculation. Refuses (PlanIntegrityError
 * STALE_RESULT) when the plan's stored fingerprint no longer matches its inputs.
 */
export async function exportPlanPdf(plan: SavedPlan): Promise<Blob> {
  const response = await apiFetch("/api/export", {
    method: "POST", timeoutMs: 30_000, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: plan.input, chosenScenarioId: plan.chosenScenarioId,
      expectedFingerprint: plan.comparison.calculationFingerprint, completedActionIds: plan.completedActionIds }),
  });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (response.status === 409 || response.status === 422) throw new PlanIntegrityError(error.code, error.message);
    throw error;
  }
  const fingerprint = response.headers.get("X-Headroom-Fingerprint");
  if (fingerprint && fingerprint !== plan.comparison.calculationFingerprint) {
    throw new PlanIntegrityError("STALE_RESULT", "The exported calculation does not match this plan. Recalculate and try again.");
  }
  return response.blob();
}

/** File kinds shared with the UI (src/features/plan/storage.ts). */
export const PLAN_EXPORT_FORMAT = "headroom.saved-plan" as const;
export const CASE_EXPORT_FORMAT = "headroom.case-input" as const;

/** Machine-readable plan for restoring later. Contains the input, result, choice and fingerprint. */
export function exportPlanJson(plan: SavedPlan): Blob {
  const document = { kind: PLAN_EXPORT_FORMAT, contractVersion: CONTRACT_VERSION, exportedAt: new Date().toISOString(),
    calculationFingerprint: plan.comparison.calculationFingerprint, plan };
  return new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
}

/** Collected inputs only, for unsupported/blocked cases where no plan can be calculated. */
export function exportCaseJson(input: CaseInput): Blob {
  return new Blob([JSON.stringify({ kind: CASE_EXPORT_FORMAT, contractVersion: CONTRACT_VERSION, exportedAt: new Date().toISOString(), input }, null, 2)],
    { type: "application/json" });
}

/** Read inputs from a `headroom.case-input` or `headroom.saved-plan` file. */
export function readCaseInputFromJson(text: string): CaseInput {
  const doc = JSON.parse(text);
  const parsed = CaseInputSchema.safeParse(doc?.kind === PLAN_EXPORT_FORMAT ? doc.plan?.input : doc?.input);
  if (!parsed.success) throw new PlanIntegrityError("INVALID_FILE", "This file does not contain valid Headroom inputs.");
  return parsed.data;
}

export interface CheckoutResult {
  mode: "demo" | "stripe_test"; unlocked: boolean; isRealPayment: false; label: string;
  url?: string; expiresAt?: string; recorded: "cloud" | "browser_only";
}

const ENTITLEMENT_KEY = "headroom:v1:entitlement";

function rememberUnlock(result: CheckoutResult) {
  if (!result.unlocked) return;
  try {
    window.localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify({ mode: result.mode === "demo" ? "demo" : "test", expiresAt: result.expiresAt }));
  } catch { /* the unlock still applies for this page view */ }
}

/** Demo (no card) by default; Stripe TEST when configured. Returns a redirect `url` for Stripe. */
export async function startCheckout(mode?: "demo" | "stripe_test"): Promise<CheckoutResult> {
  const result = await readJson<CheckoutResult>(await apiFetch("/api/checkout", {
    method: "POST", token: await cloudToken(), headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode ? { mode } : {}),
  }));
  rememberUnlock(result);
  void trackEvent(result.mode === "demo" ? "checkout_demo" : "checkout_test");
  return result;
}

/** After returning from Stripe: verify the TEST session on the server before unlocking. */
export async function verifyCheckout(sessionId: string): Promise<CheckoutResult> {
  const result = await readJson<CheckoutResult>(await apiFetch(`/api/checkout?session_id=${encodeURIComponent(sessionId)}`, { token: await cloudToken() }));
  rememberUnlock(result);
  return result;
}

/** The demo/test unlock remembered in this browser, if any. Never a real purchase. */
export function getLocalEntitlement(): { mode: "demo" | "test"; expiresAt?: string } | null {
  try {
    const raw = window.localStorage.getItem(ENTITLEMENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Fire-and-forget anonymous event. Never throws, never sends amounts or identifiers. */
export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  try {
    await apiFetch("/api/analytics", { method: "POST", timeoutMs: 4000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event }) });
  } catch { /* analytics must never affect the journey */ }
}

export { HeadroomError };

/**
 * "Annual income forecast explanation" PDF for a household workspace (v2), generated on the
 * server from the validated workspace and a fresh engine result. Pass the fingerprint of the
 * figures on screen to refuse a stale export (PlanIntegrityError STALE_RESULT).
 */
export async function exportForecastPdf(workspace: import("@/domain/household-workspace").HouseholdWorkspace, year: 2026 | 2027 = 2026,
  expectedFingerprint?: string): Promise<Blob> {
  const response = await apiFetch("/api/export/forecast", {
    method: "POST", timeoutMs: 30_000, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, year, ...(expectedFingerprint ? { expectedFingerprint } : {}) }),
  });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (response.status === 409 || response.status === 400) throw new PlanIntegrityError(error.code, error.message);
    throw error;
  }
  return response.blob();
}
