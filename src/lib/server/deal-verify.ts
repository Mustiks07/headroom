import "server-only";
import { z } from "zod";
import {
  dealSearchFingerprint, type ActionPackage, type CashContext, type DealGoal, type DealSearchResult, type DealTermsSpace, type DealVariant, type ReadyDealSearch,
} from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import * as engine from "@/lib/engine";
import { engineWorkspaceFingerprint, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { termsAddUp } from "@/lib/client/deal-exports";
import { PlanIntegrityError } from "@/lib/client/errors";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { HttpError } from "./http";

export const PackageExportBodySchema = z.object({ workspace: z.unknown(), packageId: z.string().min(1).max(100) });

export interface PackageContext { ws: HouseholdWorkspace; pkg: ActionPackage; goal: DealGoal; space: DealTermsSpace; cash: CashContext | null; searchFingerprint: string }

/** Validate the workspace and refuse a package whose inputs changed (stale) or whose terms don't add up. */
export async function loadCurrentPackage(raw: unknown, packageId: string): Promise<PackageContext> {
  let ws: HouseholdWorkspace;
  try { ws = validateWorkspace(raw); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
  const dp = ws.dealPlanning;
  const pkg = dp?.packages.find(p => p.id === packageId);
  if (!dp || !pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "These chosen terms are not in this plan.");
  if (pkg.status === "superseded") throw new HttpError(409, "STALE_RESULT", "These terms were replaced by a newer choice.");
  const goal = dp.goals.find(g => g.id === pkg.goalId);
  const space = dp.termSpaces.find(t => t.projectId === pkg.projectId);
  if (!goal || !space) throw new HttpError(409, "STALE_RESULT", "The goal or allowed terms for this project were removed. Search again.");
  const searchFingerprint = await dealSearchFingerprint(await engineWorkspaceFingerprint(ws), goal, space, dp.cashContext, ENGINE_VERSION, RULES_VERSION);
  if (searchFingerprint !== pkg.searchFingerprint) {
    throw new HttpError(409, "STALE_RESULT", "Facts, the goal, the allowed terms or the cash picture changed since these terms were calculated. Search again before exporting.");
  }
  if (!termsAddUp(ws, pkg.projectId, pkg.variant)) throw new HttpError(409, "INVALID_TERMS", "The saved payments don't add up to the price minus the money already received.");
  return { ws, pkg, goal, space, cash: dp.cashContext, searchFingerprint };
}

const sameTerms = (a: DealVariant, b: DealVariant) => a.terms.priceCents === b.terms.priceCents &&
  JSON.stringify(a.terms.payments.map(p => [p.date, p.amountCents])) === JSON.stringify(b.terms.payments.map(p => [p.date, p.amountCents])) &&
  JSON.stringify(a.terms.additionalSep) === JSON.stringify(b.terms.additionalSep);
const sameMoney = (a: DealVariant, b: DealVariant) => a.twoYearCashDeltaCents === b.twoYearCashDeltaCents && a.retirementAddedCents === b.retirementAddedCents &&
  JSON.stringify(a.aca) === JSON.stringify(b.aca) && JSON.stringify(a.datedFlows) === JSON.stringify(b.datedFlows);

/**
 * Re-run the engine's search (Claude 2's `searchDealTerms`) and return the FRESH variant with the
 * same terms. Stored numbers are never trusted for an export. 503 when the search isn't in this build.
 */
export async function recheckWithEngine(ctx: PackageContext): Promise<{ result: ReadyDealSearch; variant: DealVariant }> {
  const search = (engine as unknown as { searchDealTerms?: (ws: HouseholdWorkspace, g: DealGoal, s: DealTermsSpace, c: CashContext | null) => Promise<DealSearchResult> }).searchDealTerms;
  if (typeof search !== "function") throw new HttpError(503, "DEAL_SEARCH_UNAVAILABLE", "Deal-term search isn't available in this build, so the decision package can't be re-checked.");
  const result = await search(ctx.ws, ctx.goal, ctx.space, ctx.cash);
  if (result.status !== "ready" || result.searchFingerprint !== ctx.searchFingerprint) {
    throw new HttpError(409, "STALE_RESULT", "A fresh calculation no longer offers these terms. Search again before exporting.");
  }
  const fresh = result.variants.find(v => sameTerms(v, ctx.pkg.variant));
  if (!fresh) throw new HttpError(409, "STALE_RESULT", "These terms are not among the current calculated options. Search again before exporting.");
  if (!sameMoney(fresh, ctx.pkg.variant)) throw new HttpError(409, "RESULT_MISMATCH", "The saved figures differ from a fresh calculation. Search again and save the terms again.");
  return { result, variant: fresh };
}
