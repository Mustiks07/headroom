import { CONTRACT_VERSION, CaseInputSchema, type CaseInput, type ExtractionResult, type SavedPlan } from "@/domain/contracts";
import type { AnalyticsEvent } from "./analytics-events";
import { getCloudSession } from "./cloud-session";
import { HeadroomError, PlanIntegrityError } from "./errors";
import { apiFetch, errorFromResponse, readJson } from "./http";
import { getStorageMode } from "./repository";

export interface Capabilities { cloudSave: boolean; aiExtraction: boolean; aiTextProposals: boolean; aiExplanations: boolean; checkoutMode: "demo" | "stripe_test"; localTextImport: boolean }

const OFFLINE_CAPABILITIES: Capabilities = { cloudSave: false, aiExtraction: false, aiTextProposals: false, aiExplanations: false, checkoutMode: "demo", localTextImport: false };

/**
 * What the deployment can actually do in this browser. On failure, everything optional is
 * reported unavailable. AI extraction additionally needs this browser's invisible guest session
 * (the server meters the paid provider per guest), so it is false in local mode.
 */
export async function getCapabilities(): Promise<Capabilities> {
  try {
    const caps = await readJson<Capabilities>(await apiFetch("/api/capabilities", { timeoutMs: 8000 }));
    const withDefaults: Capabilities = { ...caps, aiTextProposals: caps.aiTextProposals ?? false, aiExplanations: caps.aiExplanations ?? false };
    const anyAi = withDefaults.aiExtraction || withDefaults.aiTextProposals || withDefaults.aiExplanations;
    // Every paid AI feature is metered per guest session; without one they are off in this browser.
    return anyAi && !(await cloudToken()) ? { ...withDefaults, aiExtraction: false, aiTextProposals: false, aiExplanations: false } : withDefaults;
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

/**
 * Developer context: localhost, an origin other than the configured production URL, or a browser
 * opted in with `?dev=1` (stored as headroom.developer=1; `?dev=0` clears it).
 */
export function isDeveloperContext(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search).get("dev");
    if (q === "1") localStorage.setItem("headroom.developer", "1");
    if (q === "0") localStorage.removeItem("headroom.developer");
    if (localStorage.getItem("headroom.developer") === "1") return true;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(window.location.hostname)) return true;
    const prod = process.env.NEXT_PUBLIC_APP_URL;
    return !!prod && new URL(prod).origin !== window.location.origin;
  } catch { return false; }
}

/** A saved plan was opened again: bucketed by time since it was last saved (no ids or dates are sent). */
export function trackPlanReopened(updatedAt: string, dataKind: import("./analytics-events").AnalyticsDataKind, now = new Date()): Promise<void> {
  const days = (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000;
  return trackEvent(days >= 7 ? "plan_reopened_after_7_days" : days >= 1 ? "plan_reopened_after_1_day" : "plan_reopened_same_day", { dataKind });
}

/** Fire-and-forget anonymous event. Never throws, never sends amounts, text or identifiers. */
export async function trackEvent(event: AnalyticsEvent, dims: { dataKind?: import("./analytics-events").AnalyticsDataKind; inputPath?: import("./analytics-events").AnalyticsInputPath } = {}): Promise<void> {
  try {
    // Own-data activity from a developer context (localhost, a preview deployment, or an opted-in tester) is counted as "developer", never as a user.
    const dataKind = dims.dataKind === "own" && isDeveloperContext() ? "developer" : dims.dataKind;
    await apiFetch("/api/analytics", { method: "POST", timeoutMs: 4000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, ...dims, ...(dataKind ? { dataKind } : {}) }) });
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

async function postPackageExport(path: string, workspace: unknown, packageId: string): Promise<Blob> {
  const response = await apiFetch(path, { method: "POST", timeoutMs: 40_000, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, packageId }) });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    if ([400, 404, 409].includes(response.status)) throw new PlanIntegrityError(error.code, error.message);
    throw error;
  }
  return response.blob();
}

/** Decision package PDF (round 4). Refused when the package is stale; figures re-checked by the engine on the server. */
export function exportDecisionPdf(workspace: import("@/domain/household-workspace").HouseholdWorkspace, packageId: string): Promise<Blob> {
  return postPackageExport("/api/export/decision", workspace, packageId);
}

/** iCalendar (.ics) of the package's open dated actions; stable UIDs so re-imports update, not duplicate. */
export function exportCalendarIcs(workspace: import("@/domain/household-workspace").HouseholdWorkspace, packageId: string): Promise<Blob> {
  return postPackageExport("/api/export/calendar", workspace, packageId);
}

/** Plain-text download of the client draft (the user sends it themselves). */
export function clientDraftFile(draft: { subject: string; body: string }): Blob {
  return new Blob([`Subject: ${draft.subject}\n\n${draft.body}\n`], { type: "text/plain;charset=utf-8" });
}

/**
 * Ask Headroom to turn the user's words into a typed change proposal (nothing is saved).
 * `consentToProvider` sends the minimal context + text to the AI provider (only when enabled);
 * otherwise deterministic patterns are used. Errors return a thrown HeadroomError; the form stays usable.
 */
export async function proposeChange(request: import("@/domain/assistance").AssistanceRequest, options: { consentToProvider?: boolean } = {}): Promise<import("@/domain/assistance").ProposeResponse> {
  return readJson(await apiFetch("/api/assist/propose", { method: "POST", timeoutMs: 35_000, headers: { "Content-Type": "application/json" },
    token: options.consentToProvider ? await cloudToken() : undefined, body: JSON.stringify({ request, consentToProvider: !!options.consentToProvider }) }));
}

/** Explain a verified engine packet; deterministic unless the user consents and the provider is enabled. */
/**
 * Explanation rebuilt by the SERVER from this exact plan revision (verification.origin "server_recomputed").
 * Prefer this over explainResult(packet), whose figures the server cannot re-check.
 */
export async function explainWorkspace(workspace: import("@/domain/household-workspace").HouseholdWorkspace, subject: (typeof import("@/domain/assistance").EXPLAIN_SUBJECTS)[number],
  refId?: string, options: { consentToProvider?: boolean } = {}): Promise<import("@/domain/assistance").ExplainResponse> {
  return readJson(await apiFetch("/api/assist/explain", { method: "POST", timeoutMs: 25_000, headers: { "Content-Type": "application/json" },
    token: options.consentToProvider ? await cloudToken() : undefined, body: JSON.stringify({ workspace, subject, refId, consentToProvider: !!options.consentToProvider }) }));
}

/**
 * First offer / counteroffer from an ordinary pasted message. Without consent nothing leaves Headroom's
 * server except to its own reading; with consent the configured AI provider reads the text. If the
 * request itself fails (offline), the browser reads the text with the same built-in parser.
 */
export async function intakeOffer(request: import("@/domain/intake").IntakeRequest): Promise<import("@/domain/intake").IntakeResult> {
  try {
    return await readJson(await apiFetch("/api/assist/intake", { method: "POST", timeoutMs: 35_000, headers: { "Content-Type": "application/json" },
      token: request.consentToProvider ? await cloudToken() : undefined, body: JSON.stringify(request) }));
  } catch {
    const { parseOfferText } = await import("./offer-intake");
    const r = parseOfferText(request.text, request.userDate, `draft-local-${Date.now()}`);
    return { ...r, providerStatus: request.consentToProvider ? "unavailable" : "not_consented",
      notes: [request.consentToProvider ? "Headroom couldn't reach the server; this is the built-in reading in your browser." : "Read in your browser; nothing was sent.", ...r.notes] };
  }
}

/** Insurance: county candidates for a ZIP (official Marketplace API when configured) or a state + county name. */
export async function lookupLocation(query: { zip: string } | { state: string; q: string }): Promise<import("@/domain/insurance").LocationLookup> {
  const qs = new URLSearchParams("zip" in query ? { zip: query.zip } : { state: query.state, q: query.q });
  return readJson(await apiFetch(`/api/insurance/location?${qs}`, { method: "GET", timeoutMs: 10_000 }));
}

/** Insurance: benchmark for a plan year — confirmed (your notice), county candidate (CMS extract) or not available. */
export async function lookupBenchmark(workspace: import("@/domain/household-workspace").HouseholdWorkspace, year: 2026 | 2027): Promise<import("@/domain/insurance").BenchmarkLookup> {
  return readJson(await apiFetch("/api/insurance/benchmark", { method: "POST", timeoutMs: 15_000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace, year }) }));
}

/** Legacy: a browser-built packet. The response is labelled "client_packet_unverified". */
export async function explainResult(packet: import("@/domain/assistance").ExplanationPacket, options: { consentToProvider?: boolean } = {}): Promise<import("@/domain/assistance").ExplainResponse> {
  return readJson(await apiFetch("/api/assist/explain", { method: "POST", timeoutMs: 25_000, headers: { "Content-Type": "application/json" },
    token: options.consentToProvider ? await cloudToken() : undefined, body: JSON.stringify({ packet, consentToProvider: !!options.consentToProvider }) }));
}
