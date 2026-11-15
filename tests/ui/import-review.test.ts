import { describe, expect, it } from "vitest";
import type { ExtractedFact, ImportDraft } from "@/domain/assistance";
import { workspaceFixture } from "@/fixtures/workspace";
import { decisionFor, initialChoice, isPriorYearOnlyWarning, reviewChoice, reviewedDraft, sourceConflicts, targetFor } from "@/features/imports/review-model";
import { applyImportGroup } from "@/lib/client/import-pipeline";

const fact = (id: string, field = "income.w2Box1", period: "annual" | "year_to_date" | "monthly" | "one_time" | "unknown" = "annual"): ExtractedFact => ({
  id, documentId: `document-${id}`, documentKind: "other", field,
  value: { kind: "money", amountCents: 200_000, period }, valueAsPrinted: "$2,000",
  personCandidate: null, taxYear: 2026, asOfDate: null, source: { label: id, page: 1, excerpt: "$2,000" },
  provenance: "deterministic_text", review: "extracted", conflictsWith: [],
});
const draftFor = (...facts: ExtractedFact[]): ImportDraft => ({ id: "review", documents: facts.map(f => ({ documentId: f.documentId, kind: f.documentKind, label: f.id, addedAt: "2026-11-15T12:00:00Z", provenance: f.provenance })), facts });

describe("document review safeguards", () => {
  it("keeps a 2025-only W-2 warning reference-only without treating mixed-year warnings as proof", () => {
    const warning = "This document appears to be for 2025. Its amounts are not carried into 2026 or 2027 automatically; use them only as a reference for your forecast.";
    expect(isPriorYearOnlyWarning(warning)).toBe(true);
    const oldW2 = { ...fact("2025-w2"), documentKind: "w2" as const, taxYear: null };
    const draft = draftFor(oldW2);
    const attemptedCurrentYear = { ...initialChoice(oldW2, draft), personId: "primary", year: "2026" };
    const restricted = reviewChoice(oldW2, draft, attemptedCurrentYear, { [oldW2.documentId]: warning });
    expect(decisionFor(oldW2, restricted)?.target).toEqual({ kind: "reference_only" });
    expect(isPriorYearOnlyWarning("This document mentions both 2026 and 2027. Check which year each figure belongs to.")).toBe(false);
    expect(isPriorYearOnlyWarning("Figures were read by an AI model.")).toBe(false);
  });
  it("does not collapse two unidentified adults into one conflicting wage field", () => {
    const a = fact("w2-a"), b = fact("w2-b"); const draft = draftFor(a, b);
    const choices = { [a.id]: initialChoice(a, draft), [b.id]: initialChoice(b, draft) };
    expect(decisionFor(a, choices[a.id])).toBeNull();
    expect(sourceConflicts(draft, choices)).toEqual([]);
    choices[a.id].personId = "primary"; choices[b.id].personId = "spouse";
    expect(sourceConflicts(draft, choices)).toEqual([]);
    choices[b.id].personId = "primary";
    expect(sourceConflicts(draft, choices)[0].ids).toEqual([a.id, b.id]);
  });

  it("keeps YTD profit YTD and requires a through date", () => {
    const f = fact("profit", "income.scheduleCProfit", "year_to_date"); const draft = draftFor(f);
    const c = { ...initialChoice(f, draft), personId: "primary", status: "confirmed" as const };
    expect(targetFor(f, c)).toBeNull();
    c.asOfDate = "2026-10-31";
    expect(targetFor(f, c)).toMatchObject({ kind: "forecast", field: "ytdNetProfit", asOfDate: "2026-10-31" });
    expect(reviewedDraft(draft, { [f.id]: c }).facts[0].value).toEqual(f.value);
  });

  it("cannot copy an annual premium into monthly cells unchanged", () => {
    const f = fact("premium", "coverage.enrollmentPremium", "annual"); const draft = draftFor(f);
    const c = { ...initialChoice(f, draft), months: [1, 2], monthsConfirmed: true };
    expect(decisionFor(f, c)).toBeNull();
    c.correcting = true; c.correction = "1000";
    expect(decisionFor(f, c)).toBeNull();
    c.monthlyCorrection = true;
    expect(decisionFor(f, c)).toMatchObject({ correctedAmountCents: 100_000, target: { kind: "coverage", months: [1, 2] } });
    expect(reviewedDraft(draft, { [f.id]: c }).facts[0].value).toMatchObject({ period: "monthly", amountCents: 200_000 });
    expect(f.value).toMatchObject({ period: "annual", amountCents: 200_000 }); // Source value remains unchanged.
  });

  it("requires the partial-payment path when a lower receipt leaves a remainder", () => {
    const f = fact("receipt", "project.paymentReceived", "one_time"); const draft = draftFor(f);
    const c = { ...initialChoice(f, draft), projectId: "proj-a", lineId: "a-pay-2", date: "2026-11-15", receiptMode: "actual" as "actual" | "partial" };
    expect(decisionFor(f, c, workspaceFixture)).toBeNull();
    c.receiptMode = "partial";
    expect(decisionFor(f, c, workspaceFixture)).toBeNull();
    c.remainderDate = "2026-12-15";
    expect(decisionFor(f, c, workspaceFixture)).toMatchObject({ target: { kind: "partial_payment", remainderDate: "2026-12-15" } });
  });

  it("does not turn a prior-year return into confirmed current income", () => {
    const f = { ...fact("old-return", "income.scheduleCProfit"), documentKind: "prior_year_tax_return" as const };
    const draft = draftFor(f); const c = initialChoice(f, draft);
    expect(c.mode).toBe("reference");
    expect(decisionFor(f, c)?.target).toEqual({ kind: "reference_only" });
    expect(decisionFor(f, { ...c, mode: "use", personId: "primary", status: "confirmed" })).toBeNull();
  });

  it("applies a reviewed monthly correction only to selected months and keeps the original excerpt", () => {
    const f = fact("annual-coverage", "coverage.benchmarkPremium", "annual"); const draft = draftFor(f);
    const c = { ...initialChoice(f, draft), correcting: true, correction: "1000", monthlyCorrection: true,
      months: [1, 2], monthsConfirmed: true, resolves: ["workspace"] };
    const out = applyImportGroup(workspaceFixture, reviewedDraft(draft, { [f.id]: c }), [decisionFor(f, c)!], { userDate: "2026-11-15" });
    expect(out.result).toMatchObject({ status: "applied", applied: 1 });
    expect(out.workspace!.household.years[0].coverage.filter(m => m.benchmarkPremium.valueCents === 100_000).map(m => m.month)).toEqual([1, 2]);
    expect(out.workspace!.evidence.find(e => e.documentId === f.documentId)?.excerpt).toBe(f.source.excerpt);
  });

  it("switches a forecast method only after explicit replacement and keeps missing future profit unknown", () => {
    const f = { ...fact("ytd-new", "income.scheduleCProfit", "year_to_date"), taxYear: 2027 as const };
    const draft = draftFor(f); const c = { ...initialChoice(f, draft), personId: "primary", status: "confirmed" as const, asOfDate: "2027-03-31", excludesManagedProjects: true };
    const blocked = applyImportGroup(workspaceFixture, reviewedDraft(draft, { [f.id]: c }), [decisionFor(f, c)!], { userDate: "2027-04-01" });
    expect(blocked.result).toMatchObject({ status: "rejected", issues: [{ code: "FORECAST_METHOD" }] });
    c.resolves = ["workspace"];
    const out = applyImportGroup(workspaceFixture, reviewedDraft(draft, { [f.id]: c }), [decisionFor(f, c)!], { userDate: "2027-04-01" });
    expect(out.result.status).toBe("applied");
    expect(out.workspace!.forecasts.find(f => f.personId === "primary" && f.year === 2027)).toMatchObject({ method: "year_to_date_plus_remaining", ytdNetProfit: { valueCents: 200_000 }, remainingReceipts: { valueCents: null, status: "unknown" }, remainingExpenses: { valueCents: null, status: "unknown" } });
  });

  it("never turns unstated offer costs into zero without a recorded explicit confirmation", () => {
    const f = fact("offer", "opportunity.grossRevenueCents", "one_time"); const draft = draftFor(f);
    const c = { ...initialChoice(f, draft), personId: "primary", title: "Client offer", date: "2026-12-01" };
    expect(decisionFor(f, c)).toBeNull();
    c.noAdditionalProjectCosts = true; c.singleExpectedPayment = true;
    const decision = decisionFor(f, c)!;
    const blocked = applyImportGroup(workspaceFixture, draft, [{ ...decision, reviewConfirmations: undefined }], { userDate: "2026-11-15" });
    expect(blocked.result).toMatchObject({ status: "rejected", issues: [{ code: "OFFER_REVIEW_REQUIRED" }] });
    const out = applyImportGroup(workspaceFixture, reviewedDraft(draft, { [f.id]: c }), [decision], { userDate: "2026-11-15" });
    expect(out.result.status).toBe("applied");
    expect(out.workspace!.evidence.some(e => e.kind === "manual" && e.label.includes("no additional project costs"))).toBe(true);
    expect(out.workspace!.evidence.find(e => e.kind === "document" && e.documentId === f.documentId)?.excerpt).toBe(f.source.excerpt);
    expect(out.workspace!.projects.at(-1)).toMatchObject({ title: "Client offer", status: "proposed", cashAccountingConfirmed: null });
  });

  it("permits an explicit receipt correction while preserving the earlier receipt", () => {
    const f = { ...fact("correct-receipt", "project.paymentReceived", "one_time"), documentKind: "payment_confirmation" as const };
    const draft = draftFor(f); const c = { ...initialChoice(f, draft), projectId: "proj-a", lineId: "a-pay-1", date: "2026-10-17", receiptMode: "correct" as const, reason: "Corrected bank confirmation" };
    const out = applyImportGroup(workspaceFixture, reviewedDraft(draft, { [f.id]: c }), [decisionFor(f, c)!], { userDate: "2026-11-15" });
    expect(out.result.status).toBe("applied");
    expect(out.workspace!.projects[0].receipts[0]).toMatchObject({ actual: { amountCents: 200_000 }, corrections: [{ previousActual: { amountCents: 400_000 }, reason: "Corrected bank confirmation" }] });
  });
});
