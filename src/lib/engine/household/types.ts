/**
 * ENGINE INPUT for household (multi-project) calculations — not the shared workspace schema.
 *
 * Claude 3 owns `HouseholdWorkspace` (workspaceVersion "2.0"); its adapter maps a workspace to
 * this input. The v1 `CaseInput` in `household` keeps carrying people, wages, interest, coverage,
 * constraints and evidence exactly as before. The owner's business profit and SEP contributions
 * are NOT taken from it: they are derived here from one forecast per owner/year, the managed
 * projects' payments and the owner/year SEP records.
 */
import { z } from "zod";
import { CaseInputSchema, CentsSchema, FactSchema, TaxYearSchema } from "@/domain/contracts";

export const HOUSEHOLD_ENGINE_INPUT_VERSION = "household-engine-1" as const;

const IsoDate = z.string().date();

/** Exactly one active profit forecast per owner and tax year. Both methods EXCLUDE managed projects. */
export const ProfitForecastSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("annual_total"),
    personId: z.string(),
    year: TaxYearSchema,
    /** Net profit for the whole year without any managed project's payments or expenses. */
    netProfit: FactSchema,
    /** User confirmed that the amounts exclude every project managed in this plan (null = not asked yet). */
    projectsExcluded: z.boolean().nullable(),
  }),
  z.object({
    method: z.literal("year_to_date_plus_remaining"),
    personId: z.string(),
    year: TaxYearSchema,
    asOfDate: IsoDate.nullable(),
    /** Actual net profit to the as-of date; actual expenses to date are already inside it. */
    ytdNetProfit: FactSchema,
    /** Expected gross receipts after the as-of date (managed projects excluded). */
    remainingReceipts: FactSchema,
    /** Expected deductible expenses after the as-of date (managed projects excluded). */
    remainingExpenses: FactSchema,
    projectsExcluded: z.boolean().nullable(),
  }),
]);

export const ProjectItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["receipt", "expense"]),
  /** What was agreed or offered. */
  expected: z.object({ amountCents: CentsSchema.nonnegative(), date: IsoDate }).nullable(),
  /** What actually happened. When present it REPLACES the expected amount and date. */
  actual: z.object({ amountCents: CentsSchema.nonnegative(), date: IsoDate, sourceId: z.string() }).nullable(),
  /** The expected part will not happen. An actual amount, if any, still counts. */
  cancelled: z.boolean(),
  sourceId: z.string(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  ownerPersonId: z.string(),
  title: z.string().min(1).max(200),
  status: z.enum(["proposed", "agreed", "cancelled"]),
  items: z.array(ProjectItemSchema),
});

/** A SEP-IRA contribution that was actually paid. */
export const SepContributionSchema = z.object({
  id: z.string().min(1),
  personId: z.string(),
  taxYear: TaxYearSchema,
  amountCents: CentsSchema.positive(),
  paidDate: IsoDate,
  sourceId: z.string(),
});

/** Agreed total SEP-IRA amount for an owner and tax year (including what is already paid). */
export const SepTargetSchema = z.object({
  personId: z.string(),
  taxYear: TaxYearSchema,
  targetCents: CentsSchema.nonnegative(),
});

export const HouseholdEngineInputSchema = z.object({
  engineInputVersion: z.literal(HOUSEHOLD_ENGINE_INPUT_VERSION),
  /** v1 household facts. Owner's scheduleCProfit must be unknown (it is derived); owner's existingSepContribution must be $0 or unknown. */
  household: CaseInputSchema,
  forecasts: z.array(ProfitForecastSchema),
  projects: z.array(ProjectSchema),
  sepContributions: z.array(SepContributionSchema),
  sepTargets: z.array(SepTargetSchema),
  /** Money set aside for SEP-IRA contributions not yet paid (all years). Paid contributions are not deducted from it again. null = not entered. */
  futureSepBudgetCents: CentsSchema.nonnegative().nullable(),
});

export type ProfitForecast = z.infer<typeof ProfitForecastSchema>;
export type ProjectItem = z.infer<typeof ProjectItemSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type SepContribution = z.infer<typeof SepContributionSchema>;
export type SepTarget = z.infer<typeof SepTargetSchema>;
export type HouseholdEngineInput = z.infer<typeof HouseholdEngineInputSchema>;
