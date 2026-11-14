import "server-only";
import { z } from "zod";

/** Boundary schema for a plan submitted to the API. The comparison is NOT trusted; only its fingerprint is read. */
export const SubmittedPlanSchema = z.object({
  id: z.string().max(100).optional(),
  revision: z.number().int().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  input: z.unknown(),
  comparison: z.object({ calculationFingerprint: z.string().min(1).max(200) }).passthrough(),
  chosenScenarioId: z.string().min(1).max(100),
  completedActionIds: z.array(z.string().max(100)).max(200),
});

export const CreatePlanBodySchema = z.object({ plan: SubmittedPlanSchema, expectedRevision: z.null() });
export const UpdatePlanBodySchema = z.object({ plan: SubmittedPlanSchema, expectedRevision: z.number().int().positive() });

export const PlanEventBodySchema = z.object({
  id: z.string().max(100).optional().default(""),
  planId: z.string().max(100),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  kind: z.enum(["income_changed", "coverage_changed", "opportunity_changed", "action_confirmed"]),
  description: z.string().min(1).max(500),
  previousFingerprint: z.string().max(200),
  nextFingerprint: z.string().max(200).nullable(),
});

export const ExportBodySchema = z.object({
  input: z.unknown(),
  chosenScenarioId: z.string().min(1).max(100),
  /** When present, the export is refused if the fresh calculation has a different fingerprint. */
  expectedFingerprint: z.string().min(1).max(200).optional(),
  completedActionIds: z.array(z.string().max(100)).max(200).optional(),
});
