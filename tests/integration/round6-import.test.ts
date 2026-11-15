import { describe, expect, it } from "vitest";
import type { DocumentKind, ExtractedFact, ImportDraft } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import type { ImportDecision, ImportTarget } from "@/domain/imports";
import { workspaceFixture } from "@/fixtures/workspace";
import { emptyImportDraft, mergeIntoDraft } from "@/lib/client/import-draft";
import { applyImportGroup, commitImportGroup } from "@/lib/client/import-pipeline";
import { createLocalWorkspaceRepository } from "@/lib/client/workspace-repository";

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

const fact = (doc: string, kind: DocumentKind, field: string, cents: number, period: "annual" | "monthly" | "year_to_date" | "one_time" | "unknown", taxYear: number | null, excerpt: string): ExtractedFact => ({
  id: `${doc}:${field}:l1`, documentId: doc, documentKind: kind, field, value: { kind: "money", amountCents: cents, period }, valueAsPrinted: `$${cents / 100}`,
  personCandidate: null, taxYear: taxYear as 2026, asOfDate: null, source: { label: `${kind} ${doc}`, page: 1, excerpt }, provenance: "deterministic_text", review: "extracted", conflictsWith: [],
});
const draftOf = (...facts: ExtractedFact[]): ImportDraft => {
  let d = emptyImportDraft("d");
  for (const doc of [...new Set(facts.map(f => f.documentId))])
    d = mergeIntoDraft(d, facts.filter(f => f.documentId === doc), { documentId: doc, kind: facts.find(f => f.documentId === doc)!.documentKind, label: doc, addedAt: "2026-11-15T10:00:00Z", provenance: "deterministic_text" }).draft;
  return d;
};
const decide = (factId: string, target: ImportTarget, resolvesConflictWith: string[] = []): ImportDecision => ({ factId, target, resolvesConflictWith, correctedAmountCents: null });
const opts = { userDate: "2026-11-15" };
/** The fixture's confirmed $0 wages / confirmed benchmarks become estimates, so a document may fill them without an explicit replace. */
const ws0 = () => {
  const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
  for (const r of ws.household.years[0].otherIncomes) for (const k of ["w2Box1", "taxExemptInterest"] as const) if (r[k].status === "confirmed") r[k] = { ...r[k], status: "estimated" };
  for (const m of ws.household.years[0].coverage) if (m.benchmarkPremium.status === "confirmed") m.benchmarkPremium = { ...m.benchmarkPremium, status: "estimated" };
  return ws;
};
const income = (ws: HouseholdWorkspace, person: string) => ws.household.years[0].otherIncomes.find(r => r.personId === person)!;

describe("one import path: targets before conflicts, whole group or nothing", () => {
  it("two unnamed W-2s are two targets (not a conflict); applied once; retry is nothing new", () => {
    const a = fact("w2a", "w2", "income.w2Box1", 4_200_000, "annual", 2026, "Box 1 Wages $42,000.00");
    const b = fact("w2b", "w2", "income.w2Box1", 3_100_000, "annual", 2026, "Box 1 Wages $31,000.00");
    const draft = draftOf(a, b);
    expect(draft.facts.every(f => f.conflictsWith.length === 0 && f.review === "extracted")).toBe(true);
    const decisions = [decide(a.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" }), decide(b.id, { kind: "wages", personId: "spouse", year: 2026, field: "w2Box1" })];
    const r = applyImportGroup(ws0(), draft, decisions, opts);
    expect(r.result).toMatchObject({ status: "applied", applied: 2 });
    expect(income(r.workspace!, "primary").w2Box1).toMatchObject({ valueCents: 4_200_000, status: "confirmed" });
    expect(income(r.workspace!, "spouse").w2Box1.valueCents).toBe(3_100_000);
    expect(r.workspace!.events.filter(e => e.kind === "document_imported")).toHaveLength(1);
    expect(applyImportGroup(r.workspace!, draft, decisions, opts).result.status).toBe("nothing_new");
    // Both to the same person and year → a real conflict, refused until one is chosen.
    const same = applyImportGroup(ws0(), draft, [decide(a.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" }), decide(b.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" })], opts);
    expect(same.result.status).toBe("rejected");
  });

  it("taxable and tax-exempt interest stay distinct; coverage fills only chosen months; prior-year and period mismatches block the whole group", () => {
    const ex = fact("int", "unknown", "income.taxExemptInterest", 45_000, "annual", 2026, "Tax-exempt interest $450.00");
    const bench = fact("mkt", "marketplace_statement", "coverage.benchmarkPremium", 191_776, "monthly", 2026, "Benchmark plan premium $1,917.76 per month");
    const old = fact("w2old", "w2", "income.w2Box1", 3_900_000, "annual", 2025, "2025 W-2 Box 1 $39,000.00");
    const draft = draftOf(ex, bench, old);
    expect(applyImportGroup(ws0(), draft, [decide(ex.id, { kind: "interest", personId: "primary", year: 2026, taxExempt: false })], opts).result).toMatchObject({ status: "rejected", issues: [{ code: "INTEREST_TYPE" }] });
    const ok = applyImportGroup(ws0(), draft, [decide(ex.id, { kind: "interest", personId: "primary", year: 2026, taxExempt: true }),
      decide(bench.id, { kind: "coverage", year: 2026, field: "benchmarkPremium", months: [1, 2, 3] })], opts);
    expect(ok.result.status).toBe("applied");
    expect(income(ok.workspace!, "primary").taxExemptInterest.valueCents).toBe(45_000);
    expect(income(ok.workspace!, "primary").taxableInterest).toEqual(income(ws0(), "primary").taxableInterest);
    const months = ok.workspace!.household.years[0].coverage;
    expect(months.filter(m => m.benchmarkPremium.valueCents === 191_776).map(m => m.month)).toEqual([1, 2, 3]);
    // One invalid member (a 2025 W-2 used as 2026) → nothing from the group is applied.
    const ws = ws0();
    const mixed = applyImportGroup(ws, draft, [decide(ex.id, { kind: "interest", personId: "primary", year: 2026, taxExempt: true }),
      decide(old.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" })], opts);
    expect(mixed).toMatchObject({ result: { status: "rejected" }, workspace: null });
    expect(ws).toEqual(ws0());
    expect(applyImportGroup(ws0(), draft, [decide(old.id, { kind: "reference_only" })], opts).result).toMatchObject({ status: "applied", referenceOnly: 1 });
  });

  it("a payment confirmation can be a partial receipt; a replacement document needs an explicit choice and keeps earlier evidence", () => {
    const pay = fact("conf", "payment_confirmation", "project.paymentReceived", 120_000, "one_time", 2026, "Payment received $1,200.00 for the Bakery website");
    const r = applyImportGroup(ws0(), draftOf(pay), [decide(pay.id, { kind: "partial_payment", projectId: "proj-a", lineId: "a-pay-2", date: "2026-11-14", remainderDate: "2027-01-10" })], opts);
    expect(r.result.status).toBe("applied");
    const lines = r.workspace!.projects.find(p => p.id === "proj-a")!.receipts;
    expect(lines.map(l => [l.id, l.actual?.amountCents ?? null, l.expected?.amountCents ?? null])).toEqual([["a-pay-1", 400_000, 400_000], ["a-pay-2", 120_000, 300_000], ["a-pay-2-rest", null, 180_000]]);

    const first = fact("w2v1", "w2", "income.w2Box1", 4_200_000, "annual", 2026, "Box 1 $42,000.00");
    const corrected = fact("w2v2", "w2", "income.w2Box1", 4_250_000, "annual", 2026, "Box 1 $42,500.00 (corrected W-2c)");
    const t: ImportTarget = { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" };
    const a = applyImportGroup(ws0(), draftOf(first), [decide(first.id, t)], opts).workspace!;
    expect(applyImportGroup(a, draftOf(corrected), [decide(corrected.id, t)], opts).result).toMatchObject({ status: "rejected", issues: [{ code: "SAVED_VALUE_DIFFERS" }] });
    const b = applyImportGroup(a, draftOf(corrected), [decide(corrected.id, t, ["workspace"])], opts);
    expect(b.result.status).toBe("applied");
    expect(income(b.workspace!, "primary").w2Box1.valueCents).toBe(4_250_000);
    expect(b.workspace!.evidence.filter(e => e.label.startsWith("w2 w2v")).length).toBe(2); // the earlier source stays
  });

  it("a plan saved elsewhere after review yields a recoverable stale result; nothing is saved", async () => {
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const reviewed = await repo.save(ws0(), null);
    const other = await repo.save({ ...reviewed, updatedAt: new Date().toISOString() }, reviewed.revision);
    const a = fact("w2a", "w2", "income.w2Box1", 4_200_000, "annual", 2026, "Box 1 $42,000.00");
    const out = await commitImportGroup(repo, reviewed, draftOf(a), [decide(a.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" })], opts);
    expect(out).toEqual({ result: { status: "stale", currentRevision: other.revision }, saved: null });
    const saved = await commitImportGroup(repo, other, draftOf(a), [decide(a.id, { kind: "wages", personId: "primary", year: 2026, field: "w2Box1" })], opts);
    expect(saved.result).toMatchObject({ status: "applied", revision: other.revision + 1 });
  });
});
