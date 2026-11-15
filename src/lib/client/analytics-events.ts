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
  // round 6 funnel (own-data entry → source review → first useful result → terms → client response → repeat change → export)
  "intake_submitted", "intake_failed", "source_review_opened", "facts_confirmed", "first_useful_result", "terms_chosen",
  "client_message_prepared", "client_response_recorded", "partial_receipt_recorded", "repeat_change_applied", "decision_exported",
  // returns, bucketed by time since the plan was last saved (retention needs separate sessions over time)
  "plan_reopened_same_day", "plan_reopened_after_1_day", "plan_reopened_after_7_days",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Sample (synthetic fixture) vs own data vs developer runs (localhost/preview); unknown when not applicable. "developer" needs migration 006. */
export const ANALYTICS_DATA_KINDS = ["sample", "own", "developer", "unknown"] as const;
/** How the data came in: document upload, pasted text, manual form, AI provider, or not applicable. */
export const ANALYTICS_INPUT_PATHS = ["document", "paste", "manual", "provider", "none"] as const;
export type AnalyticsDataKind = (typeof ANALYTICS_DATA_KINDS)[number];
export type AnalyticsInputPath = (typeof ANALYTICS_INPUT_PATHS)[number];
