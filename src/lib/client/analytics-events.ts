/** Minimal anonymous analytics: event names only. No amounts, inputs, documents or identifiers. */
export const ANALYTICS_EVENTS = [
  "calculation_started", "calculation_completed", "scenario_chosen", "recalculated",
  "plan_saved", "plan_exported", "pricing_viewed", "checkout_demo", "checkout_test",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
