import { afterEach, expect, it, vi } from "vitest";
import { defaultGoal } from "@/features/deal/GoalForm";
import { buildGoal } from "@/features/deal/model";
import { addProject, recordClientAgreement, recordActual } from "@/features/household-plan/ops";
import { emptyDealPlanning } from "@/domain/deal-planning";
import { searchDealTerms } from "@/lib/engine";
import { buildActionPackage } from "@/lib/client/deal-exports";
import { deal, dealWorkspace } from "../engine/deal-fixture";

afterEach(() => vi.useRealTimers());

it("manual project entry keeps the client's original offer before any later edits", () => {
  const ws = dealWorkspace();
  const added = addProject(ws, { title: "Original proposal", ownerPersonId: ws.projects[0].ownerPersonId,
    receipts: [{ amountCents: 1200000, date: "2026-12-20" }], expenses: [],
    terms: { canSplitPayment: true, canRenegotiatePrice: true, nextYearPaymentLatestDate: "2027-01-31" },
    cashAccountingConfirmed: true, timingArrangementConfirmed: null, sourceLabel: "Entered offer" });
  const project = added.workspace.projects.find(p => p.id === added.projectId)!;
  project.receipts[0].expected!.amountCents = 1400000;
  expect(project.originalOffer).toMatchObject({ priceCents: 1200000, confirmation: "user_confirmed",
    source: { kind: "user_entered" }, payments: [{ amountCents: 1200000, date: "2026-12-20" }] });
});

it("a deposit is part of the total price passed from the goal form to the engine", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  const ws = dealWorkspace(), project = ws.projects[0]; // $3k received + $3k unpaid
  const draft = defaultGoal(project);
  expect(draft.price).toEqual({ min: "6000", max: "6000" });
  const built = buildGoal(ws, project, draft, null);
  if (!built.ok) throw new Error(built.message);
  expect(built.space.price.minCents).toBe(600000);
  expect(built.space.price.maxCents).toBe(600000);
});

it("new terms cannot backdate payments, and a January search has no inverted December window", () => {
  // Local midnight can still be the previous UTC day; do not backdate a new payment.
  vi.useFakeTimers(); vi.setSystemTime(new Date(2027, 0, 6, 0, 30));
  const ws = dealWorkspace(), project = ws.projects[1], draft = defaultGoal(project);
  expect(draft.cash.asOf).toBe("2027-01-06");
  draft.windows.latestDate = "2026-12-31";
  expect(buildGoal(ws, project, draft, null)).toMatchObject({ ok: false });
  draft.windows.latestDate = "2027-01-31";
  const built = buildGoal(ws, project, draft, null);
  if (!built.ok) throw new Error(built.message);
  expect(built.space.paymentWindows).toEqual([{ id: "w-2027", earliest: "2027-01-06", latest: "2027-01-31", maxShareBps: 10000 }]);
});

it("agreement uses fresh terms once; a retry after payment preserves facts and the SEP target", async () => {
  // Offer-only terms with an allowed extra SEP: the search returns an option that adds SEP (round 5 selection policy
  // gives the third slot of the default example to the sturdier option instead).
  const ws = dealWorkspace(), { goal, space } = deal({ newTerms: null, minCash: -5000 });
  ws.dealPlanning = { ...emptyDealPlanning(), goals: [goal], termSpaces: [space] };
  const result = await searchDealTerms(ws, goal, space, null);
  if (result.status !== "ready") throw new Error(result.status);
  const variant = result.variants.find(v => v.retirementAddedCents > 0)!;
  expect(variant).toBeDefined();
  const pkg = buildActionPackage(ws, result, variant.id);
  ws.dealPlanning.packages.push(pkg);
  const changed = structuredClone(ws);
  changed.projects[0].receipts[1].expected!.amountCents += 10000;
  await expect(recordClientAgreement(changed, pkg.id)).rejects.toThrow("plan changed");

  const agreed = await recordClientAgreement(ws, pkg.id);
  const line = agreed.workspace.projects[1].receipts.find(l => !l.actual)!;
  const paid = recordActual(agreed.workspace, "B", line.id, { ...line.expected!, sourceLabel: "Synthetic receipt" });
  const retry = await recordClientAgreement(paid, pkg.id);
  expect(retry.workspace).toBe(paid);
  expect(retry.event.id).toBe(agreed.event.id);
  expect(retry.workspace.retirement.targets).toEqual(agreed.workspace.retirement.targets);
  expect(retry.workspace.projects[1].receipts.filter(l => l.actual)).toHaveLength(1);
  expect(retry.workspace.events.filter(e => e.id === agreed.event.id)).toHaveLength(1);
});
