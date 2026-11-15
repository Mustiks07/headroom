// Round 6 boundaries: import field identity, explicit months, readiness semantics, payment events, client responses.
import { describe, expect, it } from "vitest";
import { ChangeProposalSchema, type ExtractedFact } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { extractedFactsFixture } from "@/fixtures/assistance";
import { assessInputReadiness, checkExtractedFacts, engineWorkspaceFingerprint, evaluateClientResponse, evaluateHouseholdWorkspace, responseFromCommand, validateAndApply } from "@/lib/engine";
import { deal, dealWorkspace, T } from "./deal-fixture";
import { usd } from "./helpers";

const fact = (over: Partial<ExtractedFact>): ExtractedFact => ({ ...extractedFactsFixture[0], personCandidate: "spouse", taxYear: 2026, asOfDate: null, ...over });
const money = (amountCents: number, period: "annual" | "monthly" | "year_to_date" | "one_time" | "unknown" = "annual") => ({ kind: "money" as const, amountCents, period });
const proposal = async (ws: HouseholdWorkspace, id: string, commands: unknown[]) => ({ ...ChangeProposalSchema.parse({ id, createdAt: "2026-11-16T10:00:00.000Z",
  base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) }, intent: "update", commands: [], ambiguities: [], resolvedDates: [], evidence: [], provenance: "manual", status: "proposed" }), commands }) as never;

describe("import semantics", () => {
  it("taxable and tax-exempt interest and the W-2 boxes keep their identity; a box mismatch is a conflict", () => {
    const ws = dealWorkspace();
    const r = checkExtractedFacts(ws, [
      fact({ id: "ti", field: "income.taxableInterest", value: money(usd(400)) }), fact({ id: "te", field: "income.taxExemptInterest", value: money(usd(900)) }),
      fact({ id: "g", documentKind: "w2", field: "income.grossWages", value: money(usd(50000)) }), fact({ id: "b1", documentKind: "w2", field: "income.w2Box1", value: money(usd(44000)) }),
      fact({ id: "pre", documentKind: "w2", field: "income.payrollPretaxDeductions", value: money(usd(5000)) }),
    ], "2026-11-16");
    const dest = (id: string) => r.checks.find(c => c.factId === id)!.destination;
    expect([dest("ti"), dest("te"), dest("b1")]).toEqual(["otherIncomes.taxableInterest", "otherIncomes.taxExemptInterest", "otherIncomes.w2Box1"]);
    expect(r.conflicts.some(c => c.factIds.includes("b1") && /box 1/.test(c.message))).toBe(true);      // 50,000 − 5,000 ≠ 44,000
  });

  it("coverage amounts are not forced to monthly; months must be stated and confirmed", () => {
    const ws = dealWorkspace();
    const prem = (id: string, period: "monthly" | "annual") => fact({ id, documentKind: "marketplace_statement", field: "coverage.enrollmentPremium", personCandidate: null, value: money(usd(period === "annual" ? 23013 : 1917.75), period) });
    const none = checkExtractedFacts(ws, [prem("m", "monthly")], "2026-11-16");
    expect(none.checks[0]).toMatchObject({ verdict: "needs_resolution", destination: null });
    expect(none.checks[0].needs).toContain("months");
    const unconfirmed = checkExtractedFacts(ws, [prem("m", "monthly")], "2026-11-16", { months: { m: [1, 2, 3] } });
    expect(unconfirmed.checks[0].destination).toBeNull();
    const ok = checkExtractedFacts(ws, [prem("a", "annual")], "2026-11-16", { months: { a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, monthsConfirmed: { a: true } });
    expect(ok.checks[0].destination).toBe("coverage[1,2,3,4,5,6,7,8,9,10,11,12].enrollmentPremium (÷12)");
  });
});

describe("readiness semantics", () => {
  it("every question has a stable key, meaning, blocking/refining flag, sources and the effect of 'I don't know'", () => {
    const ws = dealWorkspace();
    ws.forecasts = ws.forecasts.filter(f => f.year === 2026);
    const r = assessInputReadiness(ws, "two_year_terms", null, { projectId: "B" });
    expect(r.questions.length).toBeGreaterThan(0);
    for (const q of r.questions) {
      expect(q.key).toBe(q.id);
      expect(q.meaning.length).toBeGreaterThan(10);
      expect(["blocks_result", "refines_result"]).toContain(q.blocking);
      expect(q.ifUnknown.length).toBeGreaterThan(10);
    }
    expect(r.questions.find(q => q.key === "forecast:2027")!.acceptableSources).toContain("Your own estimate (marked as an estimate)");
  });
});

describe("payment events", () => {
  it("partial receipt keeps the total, refuses a past remainder date or a full amount, and a retry is a no-op", async () => {
    const ws = dealWorkspace();
    const partial = (remainderDate: string, amount = usd(1000)) => proposal(ws, "pp", [{ type: "record_partial_receipt", projectId: "A", lineId: "a2", amountCents: amount, date: "2026-11-16", remainderDate }]);
    expect(validateAndApply(ws, await partial("2026-11-10"), "2026-11-16", T).blockers[0].path).toBe("commands[0].remainderDate");
    expect(validateAndApply(ws, await partial("2027-01-08", usd(3000)), "2026-11-16", T).blockers[0].path).toBe("commands[0].amountCents");
    const out = validateAndApply(ws, await partial("2027-01-08"), "2026-11-16", T);
    const a = out.workspace.projects[0].receipts;
    expect(a.filter(l => l.actual).reduce((s, l) => s + l.actual!.amountCents, 0) + a.filter(l => !l.actual).reduce((s, l) => s + l.expected!.amountCents, 0)).toBe(usd(6000));
    const again = validateAndApply(out.workspace, { ...(await partial("2027-01-08")) as object, base: { workspaceId: ws.id, revision: 0, fingerprint: "x" } } as never, "2026-11-16", T);
    expect([again.changes.length, again.noOps.length]).toEqual([0, 1]);
  });

  it("settling for less ends the line explicitly; a refund cannot exceed what was received", async () => {
    const ws = dealWorkspace();
    const settled = validateAndApply(ws, await proposal(ws, "s", [{ type: "settle_lower_total", projectId: "A", lineId: "a2", amountCents: usd(2500), date: "2026-11-16", reason: "Scope reduced" }]), "2026-11-16", T);
    expect(settled.notes.join(" ")).toMatch(/\$500 that was expected will not be received/);
    expect(settled.workspace.projects[0].receipts.every(l => l.actual)).toBe(true);
    const tooMuch = validateAndApply(ws, await proposal(ws, "r", [{ type: "record_refund", projectId: "A", amountCents: usd(3500), date: "2026-11-16", reason: "Cancelled" }]), "2026-11-16", T);
    expect(tooMuch.blockers[0].path).toBe("commands[0].amountCents");
    const ok = validateAndApply(ws, await proposal(ws, "r2", [{ type: "record_refund", projectId: "A", amountCents: usd(1000), date: "2026-11-16", reason: "Cancelled" }]), "2026-11-16", T);
    const ev = await evaluateHouseholdWorkspace(ok.workspace);
    expect(ev.status === "ready" && ev.projection.years[0].people[0].components.some(c => c.refs?.projectId === "A" && c.amountCents === -usd(1000))).toBe(true);
  });
});

describe("client responses", () => {
  it("a counteroffer without a date or with a wrong total asks; declining agreed work with unknown costs is not calculated", async () => {
    const ws = dealWorkspace(); const d = deal();
    ws.dealPlanning = { version: "1.0", goals: [d.goal], termSpaces: [d.space], cashContext: null, packages: [] };
    const base = { id: "r", projectId: "B", recordedAt: T, sourceId: "demo-input", limits: null, refundCents: null, cancellationCostCents: null } as const;
    const noDate = await evaluateClientResponse(ws, { ...base, kind: "counteroffer", terms: { priceCents: usd(12000), payments: [{ amountCents: usd(12000), date: null }] } }, "2026-11-16");
    expect("questions" in noDate && noDate.status === "needs_data" && noDate.questions[0].key).toBe("counter.date:B:0");
    const wrongTotal = await evaluateClientResponse(ws, { ...base, kind: "counteroffer", terms: { priceCents: usd(13000), payments: [{ amountCents: usd(12000), date: "2026-12-20" }] } }, "2026-11-16");
    expect("questions" in wrongTotal && wrongTotal.questions.map(q => q.key)).toContain("counter.total:B");
    const decline = await evaluateClientResponse(ws, { ...base, projectId: "A", kind: "declined", terms: null }, "2026-11-16");
    expect("results" in decline && decline.results[0]).toMatchObject({ amountCents: null, precision: "not_calculable", basis: { kind: "agreed_terms" } });
  });

  it("the contract's record_client_response: a counter replaces only the unpaid terms; a wrong total is refused", async () => {
    const ws = dealWorkspace();
    const cmd = (total: number | null) => proposal(ws, `cr-${total}`, [{ type: "record_client_response", projectId: "A", response: "countered", respondedOn: "2026-11-16", packageId: null,
      counter: { totalPriceCents: total, unpaid: [{ amountCents: usd(3500), date: "2027-01-08" }], note: null } }]);
    expect(validateAndApply(ws, await cmd(usd(7000)), "2026-11-16", T).blockers[0].path).toBe("commands[0].counter.totalPriceCents");
    const out = validateAndApply(ws, await cmd(usd(6500)), "2026-11-16", T);
    const a = out.workspace.projects[0];
    expect([a.status, a.receipts.filter(l => l.actual).map(l => l.id), a.receipts.filter(l => !l.actual).map(l => l.expected!.amountCents)]).toEqual(["proposed", ["a1"], [usd(3500)]]);
    const ev = await evaluateClientResponse(ws, responseFromCommand(ws, { type: "record_client_response", projectId: "A", response: "countered", respondedOn: "2026-11-16", packageId: null,
      counter: { totalPriceCents: usd(6500), unpaid: [{ amountCents: usd(3500), date: "2027-01-08" }], note: null } }, T, "demo-input"), "2026-11-16");
    expect("results" in ev && ev.status).toBe("ready");
  });
});
