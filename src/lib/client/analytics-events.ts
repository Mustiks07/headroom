/**
 * Minimal anonymous analytics. Event names + two coarse dimensions only. No amounts, text,
 * documents, household profile, ids or fingerprints. Synthetic demo sessions are counted as
 * `sample`, never as customers.
 *
 * Funnel (round 5): first_visit → start → review_completed → result_calculated → plan_saved →
 * plan_reopened / proposal_confirmed / plan_exported.
 */
export const ANALYTICS_EVENTS = [
  // round 1–4 (kept)
  "calculation_started", "calculation_completed", "scenario_chosen", "recalculated",
  "plan_saved", "plan_exported", "pricing_viewed", "checkout_demo", "checkout_test",
  // round 5 funnel
  "first_visit", "start", "review_completed", "missing_question_resolved", "result_calculated",
  "proposal_confirmed", "plan_reopened", "provider_failure",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Sample (synthetic demo) vs own data; unknown when not applicable. */
export const ANALYTICS_DATA_KINDS = ["sample", "own", "unknown"] as const;
/** How the data came in: document upload, pasted text, manual form, AI provider, or not applicable. */
export const ANALYTICS_INPUT_PATHS = ["document", "paste", "manual", "provider", "none"] as const;
export type AnalyticsDataKind = (typeof ANALYTICS_DATA_KINDS)[number];
export type AnalyticsInputPath = (typeof ANALYTICS_INPUT_PATHS)[number];
