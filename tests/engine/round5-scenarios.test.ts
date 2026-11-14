// Round 5 evidence scenarios (SYNTHETIC households; planning results, not customer outcomes).
// Each: input → output → practical action → limitation. Figures are pinned so the handoff/deck numbers stay reproducible.
import { describe, expect, it } from "vitest";
import { ChangeProposalSchema, type ChangeCommand } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import {
  assessInputReadiness, engineWorkspaceFingerprint, evaluateOfferAsOffered, previewChange, searchDealTerms, validateAndApply, type EngineDealVariant,
} from "@/lib/engine";
import { annual, deal, dealWorkspace, line, T } from "./deal-fixture";
import { usd } from "./helpers";

const proposal = async (ws: HouseholdWorkspace, id: string, commands: ChangeCommand[]) => ChangeProposalSchema.parse({ id, createdAt: "2026-11-16T10:00:00.000Z",
  base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) }, intent: "update", commands,
  ambiguities: [], resolvedDates: [], evidence: [], provenance: "pattern", status: "proposed" });

describe("round 5 scenarios", () => {
  it("1. cliff deal: the offer loses the credit; the smallest change that holds is a new schedule at the same price", async () => {
    const ws = dealWorkspace(), d = deal();
    const asIs = await evaluateOfferAsOffered(ws, "B");
    expect(asIs.status === "ready" && [asIs.verdict, asIs.cashChangeCents, asIs.years[0].creditLost]).toEqual(["review_terms", -usd(3616), true]);
    const r = await searchDealTerms(ws, d.goal, d.space, null);
    if (r.status !== "ready") throw new Error();
    const rec = r.variants.find(v => v.id === r.recommendedVariantId) as EngineDealVariant;
    expect([rec.terms.priceCents, rec.terms.payments.map(p => [p.date, p.amountCents]), rec.twoYearCashDeltaCents, rec.robustness.roomCents])
      .toEqual([usd(12000), [["2026-12-15", usd(5400)], ["2027-01-04", usd(6600)]], usd(8310), usd(3804)]);
    expect(rec.comparisons.versusOfferedCents).toBe(usd(11926));
    // Same price, new dates: the client must agree to the dates only. Money by date stays separate from the two-year result.
    expect(rec.clientAgreement).toMatchObject({ required: true, changes: ["dates"] });
    expect(rec.moneyByDate.find(m => m.date === "2026-12-31")).toMatchObject({ receivedCents: usd(5400), availableCents: usd(3745) });
    expect(rec.moneyByDate.at(-1)!.availableCents).toBe(rec.comparisons.versusDeclineCents);         // after both returns = two-year result
    expect(rec.retirementAddedCents).toBe(0);
    const more = r.variants.find(v => v.purpose === "most_cash")!;
    expect([more.label.slice(0, 31), more.twoYearCashDeltaCents]).toEqual(["More cash, if the client agrees", usd(10390)]);
    expect((more as EngineDealVariant).clientAgreement.changes).toEqual(["price", "dates"]);
  });

  it("2. ordinary offer: accept as offered — no manoeuvre, no 2027 facts needed", async () => {
    const ws = dealWorkspace(80000);
    ws.forecasts = ws.forecasts.filter(f => f.year === 2026);
    expect(assessInputReadiness(ws, "new_offer", null, { projectId: "B" }).status).toBe("ready");
    const r = await evaluateOfferAsOffered(ws, "B");
    expect(r.status === "ready" && [r.verdict, r.cashChangeCents, r.years[0].creditAfterCents, r.years[0].roomAfterCents])
      .toEqual(["accept_as_offered", usd(7797), usd(14854), usd(29204)]);
  });

  it("3. uncertainty that flips the answer: a $4,000 offer on a $90,000–$125,000 profit range → ask to narrow the range first", async () => {
    const ws = dealWorkspace();
    ws.forecasts[0] = { ...annual("primary", 2026, 104000), annualNetProfit: { valueCents: usd(104000), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(90000), highCents: usd(125000) } } };
    ws.projects[1].receipts = [line("b1", 4000, "2026-12-20")];
    const rd = assessInputReadiness(ws, "new_offer", null, { projectId: "B" });
    expect([rd.status, rd.precision, rd.questions[0].code]).toEqual(["ready", "range_changes_answer", "RANGE_DECIDES"]);
    const r = await evaluateOfferAsOffered(ws, "B");
    expect(r.status === "ready" && [r.verdict, r.cashChangeCents]).toEqual(["accept_as_offered", usd(2774)]);    // at the entered value only
  });

  it("4. deposit already received: new terms only for the remainder, then the remaining payment moves and is paid", async () => {
    const ws = dealWorkspace(), d = deal({ projectId: "A", minPrice: 6000, maxPrice: 7000, minCash: 2500, targets: [] });
    const r = await searchDealTerms(ws, d.goal, d.space, null);
    if (r.status !== "ready") throw new Error();
    const rec = r.variants.find(v => v.id === r.recommendedVariantId) as EngineDealVariant;
    // $3,000 received on 2026-10-02 stays; the asked total $6,750 includes it, payments cover only $3,750.
    expect([rec.terms.priceCents, rec.terms.payments.map(p => [p.date, p.amountCents]), rec.twoYearCashDeltaCents, rec.comparisons.versusOfferedCents])
      .toEqual([usd(6750), [["2026-12-15", usd(3750)]], usd(2598), usd(515)]);
    // A is already agreed: declining its unpaid part is not presented as a free choice.
    expect(r.warnings.join(" ")).toMatch(/already agreed: declining its unpaid part is not a free choice/);
    const keep = await searchDealTerms(ws, { ...d.goal, minimumTwoYearCashDeltaCents: usd(2000) }, d.space, null);
    expect(keep.status === "ready" && keep.variants.find(v => v.id === keep.recommendedVariantId)!.label).toMatch(/^Keep the agreed terms/);
    // The client agrees: the agreed remainder replaces the open line (what the agreement operation records).
    const agreed = structuredClone(ws);
    agreed.projects[0].receipts = [agreed.projects[0].receipts[0], { ...line("a2", 3750, "2026-12-15"), id: "a2" }];
    agreed.dealPlanning = { version: "1.0", goals: [d.goal], termSpaces: [d.space], cashContext: null, packages: [] };
    // "The remaining payment moved to January 8, 2027."
    const move = await proposal(agreed, "move", [{ type: "update_expected_payment", projectId: "A", lineId: "a2", newAmountCents: null, newDate: "2027-01-08" }]);
    const pv = await previewChange(agreed, move, { userDate: "2026-11-16" });
    if (!("changes" in pv)) throw new Error(JSON.stringify(pv));
    expect(pv.changes.map(c => [c.before, c.after])).toEqual([["$3,750 expected on 2026-12-15", "$3,750 expected on 2027-01-08"]]);
    expect(pv.after!.cashDeltaCents).toBe(pv.years.reduce((a, y) => a + y.after!.spendableCents - y.before!.spendableCents, 0));
    const moved = validateAndApply(agreed, move, "2026-11-16", T).workspace;
    expect(moved.projects[0].receipts[0].actual).toEqual(ws.projects[0].receipts[0].actual);       // deposit untouched
    // Paid on January 8; recording it twice changes nothing.
    const pay = await proposal(moved, "pay", [{ type: "record_receipt", projectId: "A", lineId: "a2", amountCents: usd(3750), date: "2027-01-08" }]);
    const paid = validateAndApply(moved, pay, "2027-01-08", T).workspace;
    const again = validateAndApply(paid, { ...pay, base: { ...pay.base, fingerprint: await engineWorkspaceFingerprint(paid) } }, "2027-01-08", T);
    expect([again.changes.length, again.noOps.length]).toEqual([0, 1]);
  });
});
