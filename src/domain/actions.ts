/**
 * Round 6 contract — current-action projection and result presentation metadata.
 *
 * `currentActions(ws, userDate)` (Claude 3, src/lib/client/current-actions.ts) derives actions from
 * saved workspace facts only — expected payments, agreed packages, SEP goals, unconfirmed facts,
 * client responses. It is NOT an editable reminder database: completing an action means recording
 * the fact (receipt, contribution, response), after which the projection marks it completed.
 */
import { z } from "zod";

export const CURRENT_ACTION_KINDS = [
  "expected_payment", "overdue_payment", "partial_remainder", "sep_remaining", "client_response_pending",
  "open_decision", "unconfirmed_fact", "review_after_change", "package_reminder",
] as const;

export const CurrentActionSchema = z.object({
  /** Stable across projections (same fact → same id); also the calendar UID seed. */
  id: z.string().min(1).max(200),
  kind: z.enum(CURRENT_ACTION_KINDS),
  title: z.string().min(1).max(300),
  /** Local calendar date, or null with a condition. */
  dueDate: z.string().date().nullable(),
  condition: z.string().max(300).nullable(),
  status: z.enum(["pending", "completed", "superseded"]),
  /** When completed: the recorded fact's date (receipt/contribution/response). */
  completedOn: z.string().date().nullable(),
  overdue: z.boolean(),
  refs: z.object({ projectId: z.string().optional(), lineId: z.string().optional(), packageId: z.string().optional(), personId: z.string().optional(), year: z.number().int().optional() }),
  /** Where the action comes from (never invented urgency). */
  source: z.object({ kind: z.enum(["expected_payment", "agreed_package", "sep_goal", "offer_version", "workspace_fact", "workspace_event"]), id: z.string().max(200) }),
});

/**
 * Money measures with ONE label each, used by UI, PDF and comparison exports (Claude 2 fills the values;
 * nobody relabels one number as another).
 */
export const MONEY_MEASURES = {
  settled_two_year_cash: "Spendable cash after both tax years are settled",
  project_gross_by_date: "Money received from this project by date",
  project_available_by_date: "Money from this project available by date (after costs, SEP and tax reserve)",
  household_balance: "Household balance on the date",
  retirement_principal: "Added to retirement savings (not spendable cash)",
} as const;
export type MoneyMeasure = keyof typeof MONEY_MEASURES;

/** Binds any shown or exported result to the exact plan revision it was calculated on. */
export const ResultBindingSchema = z.object({
  workspaceId: z.string().min(1).max(120),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().min(1).max(200),
  engineVersion: z.string().max(100),
  rulesVersion: z.string().max(100),
  /** current = recalculated on this revision; historical = a recorded decision's own snapshot. */
  basis: z.enum(["current", "historical"]),
});

export type CurrentAction = z.infer<typeof CurrentActionSchema>;
export type ResultBinding = z.infer<typeof ResultBindingSchema>;
