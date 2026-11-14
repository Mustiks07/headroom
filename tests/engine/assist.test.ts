// Round 5: readiness by intent, document fact semantics, change previews, explanation packets, decision records.
// Bounded: one check per risk named in the assignment, not a test per signature.
import { describe, expect, it } from "vitest";
import { ChangeProposalSchema, type ChangeCommand, type ChangeProposal, type ExtractedFact } from "@/domain/assistance";
import { DealVariantSchema } from "@/domain/deal-planning";
import { remainingSepCash, type HouseholdWorkspace } from "@/domain/household-workspace";
import { changeProposalFixture, extractedFactsFixture } from "@/fixtures/assistance";
import { workspaceFixture } from "@/fixtures/workspace";
import {
  assessInputReadiness, buildExplanationPacket, checkExtractedFacts, engineWorkspaceFingerprint, evaluateHouseholdWorkspace, evaluateOfferAsOffered,
  numbersNotInPacket, previewChange, renderStatements, resolveRelativeDate, searchDealTerms, validateAndApply, verifyDecisionRecord,
  type EngineChangePreview, type EngineExplanationPacket,
} from "@/lib/engine";
import { annual, deal, dealWorkspace, T } from "./deal-fixture";
import { usd } from "./helpers";

const proposal = async (ws: HouseholdWorkspace, commands: ChangeCommand[], id = "p1"): Promise<ChangeProposal> => ChangeProposalSchema.parse({
  id, createdAt: "2026-11-16T10:00:00.000Z", base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) },
  intent: "update", commands, ambiguities: [], resolvedDates: [], evidence: [], provenance: "pattern", status: "proposed" });
async function preview(ws: HouseholdWorkspace, commands: ChangeCommand[], id = "p1"): Promise<EngineChangePreview> {
  const r = await previewChange(ws, await proposal(ws, commands, id), { userDate: "2026-11-16" });
  if (!("changes" in r)) throw new Error(JSON.stringify(r));
  return r;
}
const fact = (over: Partial<ExtractedFact>): ExtractedFact => ({ ...extractedFactsFixture[0], ...over });

describe("readiness by intent", () => {
  it("the current-year check needs no 2027 and no offer; two-year terms ask for 2027 — and the calculations agree", async () => {
    const ws = dealWorkspace();
    ws.forecasts = ws.forecasts.filter(f => f.year === 2026);
    const now = assessInputReadiness(ws, "current_year_subsidy");
    expect(now).toMatchObject({ status: "ready", yearsNeeded: [2026] });
    expect((await evaluateHouseholdWorkspace(ws)).status).toBe("ready");
    expect(assessInputReadiness(ws, "new_offer", null, { projectId: "B" })).toMatchObject({ status: "ready", yearsNeeded: [2026] });   // B is paid in 2026
    expect((await evaluateOfferAsOffered(ws, "B")).status).toBe("ready");
    const terms = assessInputReadiness(ws, "two_year_terms", null, { projectId: "B" });
    expect(terms.status).toBe("needs_data");
    expect(terms.questions.map(q => q.id)).toEqual(expect.arrayContaining(["forecast:2027"]));
    expect(terms.questions.every(q => q.year === 2027)).toBe(true);
  });

  it("a missing spouse income is one grouped question; only a confirmed $0 makes it ready", () => {
    const ws = dealWorkspace();
    const row = ws.household.years[0].otherIncomes.find(i => i.personId === "spouse")!;
    for (const k of ["grossWages", "w2Box1", "socialSecurityWages", "medicareWages"] as const) row[k] = { valueCents: null, status: "unknown", sourceId: row[k].sourceId };
    const r = assessInputReadiness(ws, "current_year_subsidy");
    expect(r.status).toBe("needs_data");
    const wages = r.questions.filter(q => q.id.startsWith("wages:spouse"));
    expect(wages).toHaveLength(1);
    expect(wages[0]).toMatchObject({ allowUnknown: false, answer: { kind: "money" }, blocks: "calculation" });
    expect(wages[0].paths.length).toBe(4);
    for (const k of ["grossWages", "w2Box1", "socialSecurityWages", "medicareWages"] as const) row[k] = { valueCents: 0, status: "confirmed", sourceId: row[k].sourceId };
    expect(assessInputReadiness(ws, "current_year_subsidy").status).toBe("ready");
  });

  it("a range that flips the answer is asked first; unsupported stays different from missing", () => {
    const ws = dealWorkspace();
    ws.forecasts[0] = { ...annual("primary", 2026, 112000), annualNetProfit: { valueCents: usd(112000), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(100000), highCents: usd(125000) } } };
    const r = assessInputReadiness(ws, "current_year_subsidy");
    expect(r).toMatchObject({ status: "ready", precision: "range_changes_answer" });
    expect(r.questions[0]).toMatchObject({ code: "RANGE_DECIDES", blocks: "decision" });
    const narrow = structuredClone(ws);
    (narrow.forecasts[0] as { annualNetProfit: { range: unknown } }).annualNetProfit.range = { lowCents: usd(110000), highCents: usd(114000) };
    expect(assessInputReadiness(narrow, "current_year_subsidy").precision).toBe("range_stable");
    const other = dealWorkspace(); other.household.state = "CA";
    expect(assessInputReadiness(other, "current_year_subsidy")).toMatchObject({ status: "unsupported", questions: [] });
    expect(assessInputReadiness(null, "new_offer").questions.map(q => q.id)).toContain("start:offer");
  });
});

describe("document facts", () => {
  it("year-to-date profit is never annualized; a managed payment inside the period and annual/YTD conflicts are flagged", () => {
    const ws = dealWorkspace();                                    // A received $3,000 on 2026-10-02
    const ytd = fact({ id: "ytd", personCandidate: "primary", asOfDate: "2026-10-31" });
    const annualF = fact({ id: "ann", personCandidate: "primary", value: { kind: "money", amountCents: usd(80000), period: "annual" }, asOfDate: null });
    const r = checkExtractedFacts(ws, [ytd, annualF], "2026-11-16");
    const c = r.checks.find(x => x.factId === "ytd")!;
    expect(c.destination).toBe("forecast.ytdNetProfit");
    expect(c.issues.map(i => i.code)).toEqual(expect.arrayContaining(["NOT_ANNUAL", "MANAGED_PAYMENT_INSIDE"]));
    expect(r.conflicts.length).toBeGreaterThanOrEqual(1);         // annual lower than YTD + both methods present
    expect(r.confirmableTogether).not.toContain("ytd");
  });

  it("prior-year forms, invoices and transfers never become current facts; same line twice is a no-op", () => {
    const ws = dealWorkspace();
    const prior = fact({ id: "py", documentKind: "prior_year_tax_return", taxYear: null, value: { kind: "money", amountCents: usd(90000), period: "annual" }, personCandidate: "primary" });
    const invoice = fact({ id: "inv", documentKind: "invoice", field: "project.paymentReceived", value: { kind: "money", amountCents: usd(3000), period: "one_time" } });
    const transfer = fact({ id: "tr", documentKind: "bank_statement", field: "project.paymentReceived", value: { kind: "money", amountCents: usd(3000), period: "one_time" },
      source: { label: "Bank", page: null, excerpt: "Transfer from savings" } });
    const r = checkExtractedFacts(ws, [prior, invoice, transfer, transfer], "2026-11-16");
    expect(r.checks.find(x => x.factId === "py")!.verdict).toBe("reference_only");
    expect(r.checks.find(x => x.factId === "inv")!.issues.map(i => i.code)).toContain("INVOICE_NOT_RECEIPT");
    expect(r.checks.filter(x => x.factId === "tr").map(x => x.verdict)).toEqual(["not_income", "duplicate"]);
    expect(r.confirmableTogether).toEqual([]);
  });
});

describe("change preview", () => {
  it("the contract example: the remaining payment moves to January — exact before/after, nothing else changes", async () => {
    const ws = structuredClone(workspaceFixture);
    const p = { ...changeProposalFixture, base: { ...changeProposalFixture.base, fingerprint: await engineWorkspaceFingerprint(ws) } };
    const r = await previewChange(ws, p, { userDate: "2026-11-16" });
    if (!("changes" in r)) throw new Error(JSON.stringify(r));
    expect(r.status).toBe("ready");
    expect(r.changes).toEqual([expect.objectContaining({ path: "projects[0].receipts[1].expected", after: "$3,000 expected on 2027-01-08" })]);
    expect(r.notes.join(" ")).toMatch(/counts in 2027 income/);
    const applied = validateAndApply(ws, p, "2026-11-16", T).workspace;
    expect(applied.projects[0].receipts[0]).toEqual(ws.projects[0].receipts[0]);                 // received deposit untouched
    expect(applied.projects.slice(1)).toEqual(ws.projects.slice(1));
    expect(r.after!.cashDeltaCents).toBe(r.years.reduce((s, y) => s + (y.after && y.before ? y.after.spendableCents - y.before.spendableCents : 0), 0));
    expect(resolveRelativeDate("January 8", "2026-11-16")).toBe("2027-01-08");
    expect(resolveRelativeDate("next Friday", "2026-11-20")).toBe("2026-11-27");                 // 2026-11-20 is a Friday
  });

  it("received money is a fact: no backdated proposals, no future receipts, deposit included in the price; retries are no-ops; stale is refused", async () => {
    const ws = dealWorkspace();
    const blocked = await preview(ws, [
      { type: "update_expected_payment", projectId: "A", lineId: "a1", newAmountCents: null, newDate: "2026-12-30" },              // a1 already received
      { type: "record_receipt", projectId: "A", lineId: "a2", amountCents: usd(3000), date: "2026-11-30" },                        // future
      { type: "add_offered_project", title: "C", ownerPersonId: null, totalPriceCents: usd(9000), received: [{ amountCents: usd(2000), date: "2026-11-10" }],
        unpaid: [{ amountCents: usd(6000), date: "2026-12-20" }], expenses: [], priceNegotiable: null, scheduleNegotiable: null },     // 2,000 + 6,000 ≠ 9,000
    ]);
    expect(blocked.status).toBe("needs_data");
    expect(blocked.blockers.map(b => b.path)).toEqual(["commands[0].lineId", "commands[1].date", "commands[2].totalPriceCents"]);
    expect(blocked.after).toBeNull();
    const again = await preview(ws, [{ type: "record_receipt", projectId: "A", lineId: "a1", amountCents: usd(3000), date: "2026-10-02" }]);
    expect(again).toMatchObject({ status: "ready", changes: [], noOps: [expect.objectContaining({ commandIndex: 0 })] });
    const ok = await preview(ws, [{ type: "add_offered_project", title: "C", ownerPersonId: null, totalPriceCents: usd(8000), received: [{ amountCents: usd(2000), date: "2026-11-10" }],
      unpaid: [{ amountCents: usd(6000), date: "2026-12-20" }], expenses: [], priceNegotiable: true, scheduleNegotiable: true }]);
    expect(ok.status).toBe("ready");
    expect(ok.after!.cashDeltaCents).toBeGreaterThan(0);          // the $2,000 deposit is a fact now (a proposed offer's unpaid lines are what-if only)
    const stale = await previewChange(ws, { ...(await proposal(ws, [])), base: { workspaceId: ws.id, revision: 0, fingerprint: "old" } }, { userDate: "2026-11-16" });
    expect(stale).toMatchObject({ status: "needs_data", code: "PROPOSAL_STALE" });
  });

  it("a paid SEP contribution satisfies the goal and spends cash; it never creates new SEP money", async () => {
    const ws = dealWorkspace();                                     // goal $1,000, $2,500 set aside on 2026-11-15
    expect(remainingSepCash(ws)! - 100000).toBe(usd(1500));
    const p = await proposal(ws, [{ type: "record_sep_contribution", personId: "primary", taxYear: 2026, amountCents: usd(400), paidDate: "2026-11-16" }]);
    const out = validateAndApply(ws, p, "2026-11-16", T);
    const ev = await evaluateHouseholdWorkspace(out.workspace);
    expect(ev.status === "ready" && ev.futureContributionBudgetRemainingCents).toBe(usd(1500));
    expect(ev.status === "ready" && ev.sep[0]).toMatchObject({ paidCents: usd(400), remainingCents: usd(600) });
    expect(out.notes.join(" ")).toMatch(/never adds to the cash set aside/);
    const sameDay = validateAndApply(ws, await proposal(ws, [{ type: "record_sep_contribution", personId: "primary", taxYear: 2026, amountCents: usd(400), paidDate: "2026-11-15" }]), "2026-11-16", T);
    expect(sameDay.notes.join(" ")).toMatch(/day of your SEP cash snapshot/);
  });
});

describe("offers, robustness and explanations", () => {
  it("an ordinary profitable offer is simply accepted as offered (no manoeuvre); its cash adds up", async () => {
    const ws = dealWorkspace(80000);
    ws.forecasts = ws.forecasts.filter(f => f.year === 2026);
    const r = await evaluateOfferAsOffered(ws, "B");
    if (r.status !== "ready") throw new Error(JSON.stringify(r));
    expect(r.verdict).toBe("accept_as_offered");
    const y = r.years[0];
    expect(y.cashChangeCents).toBe(y.receiptsCents - y.expensesCents - y.selfEmploymentTaxChangeCents - y.incomeTaxChangeCents + y.premiumTaxCreditChangeCents);
    expect(r.cashChangeCents).toBeGreaterThan(0);
    const cliff = await evaluateOfferAsOffered(dealWorkspace(), "B");
    expect(cliff.status === "ready" && [cliff.verdict, cliff.cashChangeCents]).toEqual(["review_terms", -usd(3616)]);   // same figure as the round 4 search
  });

  it("a fragile simplest option brings a sturdier one with its price; the fragile simple option is not recommended", async () => {
    const d = deal();
    const r = await searchDealTerms(dealWorkspace(), d.goal, d.space, null);
    if (r.status !== "ready") throw new Error();
    const robust = r.variants.find(v => v.purpose === "lowest_risk")!;
    expect(robust.label).toMatch(/room before a credit is lost: \$3,214/);
    expect(r.warnings.join(" ")).toMatch(/only \$0 of extra profit to spare/);
    expect(r.recommendedVariantId).not.toBe("v-simplest");
    expect(robust.constraints.every(c => c.satisfied)).toBe(true);
  });

  it("explanations: every figure has a reference; invented numbers are caught; answers come from results", async () => {
    const ws = dealWorkspace();
    const d = deal();
    ws.dealPlanning = { version: "1.0", goals: [d.goal], termSpaces: [d.space], cashContext: null, packages: [] };
    for (const subject of ["current_year", "deal_choice", "agreed_plan"] as const) {
      const k = await buildExplanationPacket(ws, subject) as EngineExplanationPacket;
      expect(k.facts.length).toBeGreaterThan(0);
      const text = renderStatements(k, [...k.statements, ...k.answers.flatMap(a => a.statements)]);
      expect(numbersNotInPacket(k, text)).toEqual([]);
      expect(numbersNotInPacket(k, `${text} You save $5,001.`)).toEqual(["$5,001"]);
      expect(k.answers.map(a => a.question).sort()).toEqual(["client_refuses", "what_changes", "why_january", "why_worse"]);
    }
    const k = await buildExplanationPacket(ws, "deal_choice") as EngineExplanationPacket;
    const jan = k.answers.find(a => a.question === "why_january")!;
    expect(renderStatements(k, jan.statements)).toMatch(/2026 premium tax credit would be lost/);
    expect(k.limitations.join(" ")).toMatch(/not savings caused by Headroom/);
  });

  it("a recorded decision is re-verified on its own snapshot only with the same rules; otherwise archived", async () => {
    const ws = dealWorkspace(), d = deal();
    const r = await searchDealTerms(ws, d.goal, d.space, null);
    if (r.status !== "ready") throw new Error();
    const record = { id: "rec-1", packageId: "pkg-1", projectId: "B", status: "client_agreed" as const, recordedAt: T, workspaceRevision: 3, searchFingerprint: r.searchFingerprint,
      engineVersion: r.engineVersion, rulesVersion: r.rulesVersion, workspaceSnapshot: ws as unknown as Record<string, unknown>, goal: d.goal as unknown as Record<string, unknown>,
      termSpace: d.space as unknown as Record<string, unknown>, cashContext: null, variant: DealVariantSchema.parse(r.variants[1]) as unknown as Record<string, unknown> };
    expect(verifyDecisionRecord(record)).toMatchObject({ status: "reverified" });
    expect(verifyDecisionRecord({ ...record, rulesVersion: "us-federal-aca-2026-2027.r2" })).toMatchObject({ status: "archived_only", recomputed: null });
  });
});
