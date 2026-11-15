import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistanceRequest, ChangeProposal } from "@/domain/assistance";
import type { ReadyDealSearch } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { sampleDocuments } from "@/fixtures/assistance";
import { dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { workspaceFixture } from "@/fixtures/workspace";
import { fakeSearchDealTerms, fakeState } from "../support/fake-deal-search";
import { parseIcs } from "../support/ics";
import { pdfText } from "../support/pdf-text";

// Engine: real, plus the labelled deal-search test double (Claude 2's search is exercised in tests/engine).
vi.mock("@/lib/engine", async original => {
  const actual = await original<typeof import("@/lib/engine")>();
  return { ...actual, get searchDealTerms() { return fakeState.enabled ? fakeSearchDealTerms : undefined; } };
});
// Provider/session/budget store are mocked ONLY for the failure-recovery checks; no real provider call is claimed.
const rpc = vi.fn(); const requireOwner = vi.fn(); const parse = vi.fn(); const create = vi.fn();
vi.mock("@/lib/server/supabase", () => ({ requireOwner: (...a: unknown[]) => requireOwner(...a), optionalOwner: async () => null,
  privilegedClient: () => ({ rpc }), dbFailure: () => { throw new Error("db"); } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse, create }; } }));

const { createLocalWorkspaceRepository, commitWorkspaceChange, newWorkspaceEvent } = await import("@/lib/client/workspace-repository");
const { mergeIntoDraft, applyConfirmedFacts, emptyImportDraft } = await import("@/lib/client/import-draft");
const { buildAssistanceContext, answerAmbiguity, resolveDate } = await import("@/lib/client/assistance-text");
const { commitProposal, applyChangeProposal } = await import("@/lib/client/workspace-commands");
const { buildActionPackage, buildCurrentCalendar, reminderUid, calendarUid } = await import("@/lib/client/deal-exports");
const { saveActionPackage, exportCurrentCalendar } = await import("@/lib/client/deal-state");
const { recordClientAgreement } = await import("@/features/household-plan/ops");
const { analyzeWorkspaceFile, exportWorkspaceJson } = await import("@/lib/client/workspace-migration");
const { engineWorkspaceFingerprint } = await import("@/lib/engine");
const { POST: extract } = await import("@/app/api/documents/extract/route");
const { POST: propose } = await import("@/app/api/assist/propose/route");
const { POST: explain } = await import("@/app/api/assist/explain/route");
const { POST: exportDecision } = await import("@/app/api/export/decision/route");
const { POST: exportRecord } = await import("@/app/api/export/decision-record/route");

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }
const json = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", authorization: "Bearer a.b.c" }, body: JSON.stringify(body) }));
async function upload(text: string, name: string) {
  const form = new FormData(); form.set("file", new File([text], name, { type: "text/plain" }));
  return (await extract(new Request("http://localhost/api/documents/extract", { method: "POST", body: form }))).json();
}
async function request(ws: HouseholdWorkspace, text: string, userDate = "2026-11-16"): Promise<AssistanceRequest> {
  return { intent: "update", text, userDate, timeZone: "America/Chicago", base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) }, context: buildAssistanceContext(ws) };
}
afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); parse.mockReset(); create.mockReset(); requireOwner.mockReset(); });

describe("documents → reviewed facts → one atomic apply", () => {
  it("reads a P&L and a payment confirmation, merges them, applies the confirmed group once", async () => {
    const pl = await upload(sampleDocuments.profitAndLoss, "pl.txt");
    expect(pl.document.kind).toBe("profit_and_loss");
    expect(pl.facts.map((f: { field: string }) => f.field)).toEqual(["income.scheduleCProfit"]); // "Total expenses" is not a project expense
    expect(pl.facts[0]).toMatchObject({ taxYear: 2026, asOfDate: "2026-09-30", personCandidate: null, provenance: "deterministic_text" });
    const pay = await upload(sampleDocuments.paymentConfirmation, "pay.txt");
    expect(pay.document.kind).toBe("payment_confirmation");

    let draft = emptyImportDraft();
    draft = mergeIntoDraft(draft, pl.facts, { documentId: pl.document.documentId, kind: pl.document.kind, label: "P&L", addedAt: "2026-11-16T10:00:00Z", provenance: "deterministic_text" }).draft;
    const second = mergeIntoDraft(draft, pay.facts, { documentId: pay.document.documentId, kind: pay.document.kind, label: "Payment", addedAt: "2026-11-16T10:01:00Z", provenance: "deterministic_text" });
    draft = second.draft;
    expect(mergeIntoDraft(draft, pay.facts, draft.documents[1]).duplicates).toBe(pay.facts.length); // same document again: no-op

    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const ws = await repo.save(structuredClone(workspaceFixture) as HouseholdWorkspace, null);
    const ytd = draft.facts.find(f => f.field === "income.scheduleCProfit")!;
    const received = draft.facts.find(f => f.field === "project.paymentReceived")!;
    const decisions = [
      { factId: ytd.id, target: { kind: "forecast" as const, personId: "primary", year: 2026 as const, field: "ytdNetProfit" as const, status: "confirmed" as const, asOfDate: "2026-09-30" } },
      { factId: received.id, target: { kind: "payment_received" as const, projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16" } },
    ];
    // All-or-nothing: one bad decision (unknown line) leaves the plan untouched.
    expect(applyConfirmedFacts(ws, draft, [decisions[0], { factId: received.id, target: { kind: "payment_received" as const, projectId: "proj-a", lineId: "nope", date: "2026-12-16" } }]).status).toBe("rejected");
    const applied = applyConfirmedFacts(ws, draft, decisions);
    if (applied.status !== "applied") throw new Error(applied.status);
    const { saved } = await commitWorkspaceChange(repo, ws, applied.workspace, applied.event);
    expect(saved.revision).toBe(ws.revision + 1);
    expect(saved.events.filter(e => e.kind === "document_imported")).toHaveLength(1);
    expect(saved.projects[0].receipts[1].actual?.amountCents).toBe(300_000);
    // Same group again: nothing new (no second payment).
    expect(applyConfirmedFacts(saved, draft, decisions).status).toBe("nothing_new");
  });

  it("flags conflicts between documents; equal values from different documents are not duplicates", async () => {
    const a = await upload("Profit and Loss\nJanuary 1 - September 30, 2026\nNet profit YTD: $88,000.00\n", "a.txt");
    const b = await upload("Profit and Loss (revised)\nJanuary 1 - September 30, 2026\nNet profit YTD: $86,500.00\n", "b.txt");
    const c = await upload("P&L export\nJanuary 1 - September 30, 2026\nNet profit YTD: $88,000.00\nprepared by bookkeeper\n", "c.txt");
    let draft = emptyImportDraft();
    for (const r of [a, b, c]) draft = mergeIntoDraft(draft, r.facts, { documentId: r.document.documentId, kind: r.document.kind, label: "P&L", addedAt: "2026-11-16T10:00:00Z", provenance: "deterministic_text" }).draft;
    expect(draft.facts).toHaveLength(3);
    // Round 6: whose profit it is comes first — unassigned P&Ls are unresolved targets, not yet a conflict.
    expect(draft.facts.every(f => f.review === "extracted" && f.conflictsWith.length === 0)).toBe(true);
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    const forecastYtd = structuredClone(ws);
    forecastYtd.forecasts[0] = { method: "year_to_date_plus_remaining", personId: "primary", year: 2026, asOfDate: "2026-09-30", asOfConfirmed: true, excludesManagedProjects: true,
      ytdNetProfit: { valueCents: null, status: "unknown", sourceId: ws.evidence[0].id }, remainingReceipts: { valueCents: 0, status: "estimated", sourceId: ws.evidence[0].id }, remainingExpenses: { valueCents: 0, status: "estimated", sourceId: ws.evidence[0].id } } as HouseholdWorkspace["forecasts"][number];
    const { applyImportGroup } = await import("@/lib/client/import-pipeline");
    const target = { kind: "forecast" as const, personId: "primary", year: 2026 as const, field: "ytdNetProfit" as const, status: "confirmed" as const, asOfDate: "2026-09-30" };
    const both = applyImportGroup(forecastYtd, draft, [draft.facts[0], draft.facts[1]].map(f => ({ factId: f.id, target, resolvesConflictWith: [], correctedAmountCents: null })), { userDate: "2026-11-16" });
    expect(both.result.status).toBe("rejected"); // same person and period, different values: choose one
    const one = applyImportGroup(forecastYtd, draft, [{ factId: draft.facts[1].id, target, resolvesConflictWith: [draft.facts[0].id, draft.facts[2].id], correctedAmountCents: null }], { userDate: "2026-11-16" });
    expect(one.result.status).toBe("applied");
  });
});

describe("text → proposal → preview → confirm", () => {
  it("a named payment → one exact command; confirm once; retries are no-ops; stale is refused", async () => {
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const ws = await repo.save(structuredClone(workspaceFixture) as HouseholdWorkspace, null);
    const res = await json(propose, { request: await request(ws, "The bakery payment moved to January 8, 2027"), consentToProvider: false });
    const { proposal, providerUsed } = await res.json() as { proposal: ChangeProposal; providerUsed: boolean };
    expect(providerUsed).toBe(false);
    expect(proposal.commands).toEqual([{ type: "update_expected_payment", projectId: "proj-a", lineId: "a-pay-2", newAmountCents: null, newDate: "2027-01-08" }]);
    const first = await commitProposal(repo, ws, proposal);
    expect(first.saved.revision).toBe(ws.revision + 1);
    expect(first.saved.projects[0].receipts[1].expected).toEqual({ amountCents: 300_000, date: "2027-01-08" });
    const lostAck = await commitProposal(repo, ws, proposal); // retried against the old revision
    expect(lostAck.saved.revision).toBe(first.saved.revision);
    expect((await commitProposal(repo, first.saved, proposal)).alreadyApplied).toBe(true);
    const changed = structuredClone(first.saved); changed.planning.minimumDesiredCashGainCents = 100;
    const { saved: other } = await commitWorkspaceChange(repo, first.saved, changed, newWorkspaceEvent("forecast_updated", "Other change"));
    const next = (await (await json(propose, { request: await request(first.saved, "Paid $1,500 into my SEP on December 20 for 2026"), consentToProvider: false })).json()).proposal as ChangeProposal;
    await expect(applyChangeProposal(other, next)).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });

  it("asks instead of guessing; relative dates use the user's date", async () => {
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    const req = await request(ws, "Received $3,000 next Friday");
    const remaining = (await (await json(propose, { request: await request(ws, "The remaining payment moved to January 8, 2027"), consentToProvider: false })).json()).proposal;
    expect(remaining.commands).toEqual([]);
    expect(remaining.ambiguities[0].id).toBe("which_payment");
    const paid = (await (await json(propose, { request: await request(ws, "The client paid me $2,000 for the bakery on November 14, 2026"), consentToProvider: false })).json()).proposal;
    expect(paid.commands).toEqual([{ type: "record_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 200_000, date: "2026-11-14" }]);
    expect(resolveDate("next Friday", "2026-11-16")).toMatchObject({ date: "2026-11-20", relative: true });
    const { proposal } = await (await json(propose, { request: req, consentToProvider: false })).json() as { proposal: ChangeProposal };
    expect(proposal.commands).toEqual([]);
    expect(proposal.ambiguities[0].id).toBe("which_payment"); // A's final payment and B's payment both open
    expect(proposal.resolvedDates).toEqual([{ phrase: "next friday", date: "2026-11-20" }]);
    const answered = answerAmbiguity(req, proposal, { which_payment: "proj-a::a-pay-2" });
    expect(answered.commands).toEqual([{ type: "record_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 300_000, date: "2026-11-20" }]);
    const sep = (await (await json(propose, { request: await request(ws, "Paid $1,500 into my SEP on December 20 for 2026"), consentToProvider: false })).json()).proposal as ChangeProposal;
    expect(sep.commands).toEqual([{ type: "record_sep_contribution", personId: "primary", taxYear: 2026, amountCents: 150_000, paidDate: "2026-12-20" }]);
    const unclear = (await (await json(propose, { request: await request(ws, "Paid $1,500 into SEP on February 2, 2027"), consentToProvider: false })).json()).proposal as ChangeProposal;
    expect(unclear.ambiguities.map(a => a.id)).toEqual(["tax_year", "person"]); // Feb 2027 could be for 2026 or 2027; two adults
    const afterApril = (await (await json(propose, { request: await request(ws, "Paid $1,500 into my SEP on May 2, 2027"), consentToProvider: false })).json()).proposal as ChangeProposal;
    expect(afterApril.ambiguities.map(a => a.id)).toContain("tax_year"); // An extension can permit a prior-year contribution.
  });

  it("provider failure, budget limit and invented figures fall back to deterministic output", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testvalue");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_testvalue"); vi.stubEnv("AI_PROVIDER", "anthropic"); vi.stubEnv("AI_API_KEY", "sk-ant-test-not-real");
    vi.stubEnv("AI_FEATURES", "proposal,explanation"); vi.stubEnv("AI_MODEL", "claude-haiku-5-5");
    requireOwner.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", db: {} });
    rpc.mockImplementation(async (name: string) => name === "headroom_settle_ai_spend" ? { data: null, error: null } : { data: [{ reservation_id: "r1", outcome: "ok" }], error: null });
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    const body = { request: await request(ws, "The remaining payment moved to January 8, 2027"), consentToProvider: true };
    parse.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" }));
    const timeout = await (await json(propose, body)).json();
    expect(timeout).toMatchObject({ providerUsed: false, proposal: { provenance: "pattern" } });
    expect(timeout.notes[0]).toMatch(/didn't respond/);
    expect(rpc.mock.calls.filter(c => c[0] === "headroom_settle_ai_spend")).toHaveLength(0); // unknown usage retains the reservation
    rpc.mockImplementationOnce(async () => ({ data: [{ reservation_id: null, outcome: "global_budget" }], error: null }));
    const limited = await (await json(propose, body)).json();
    expect(limited.providerUsed).toBe(false);
    expect(limited.notes[0]).toMatch(/budget has been used/);
    parse.mockResolvedValueOnce({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 120 }, parsed_output: { questions: [],
      commands: [{ type: "update_expected_payment", projectId: "proj-a", lineId: "made-up-line", personId: null, amountAsWritten: null, dateAsWritten: "January 8, 2027", taxYear: null, title: null, field: null }] } });
    const invented = await (await json(propose, body)).json();
    expect(invented).toMatchObject({ providerUsed: true, proposal: { provenance: "ai_model", commands: [] } });
    expect(invented.proposal.ambiguities[0].question).toMatch(/Which open payment/);
    const settled = rpc.mock.calls.filter(c => c[0] === "headroom_settle_ai_spend").at(-1)![1];
    expect(settled).toMatchObject({ p_input: 900, p_output: 120, p_actual: Math.ceil(900 * 0.1 + 120 * 0.5) }); // Haiku 5.5 dated price
    const packet = { id: "p", subject: "current_year", fingerprint: "f", facts: [{ ref: "m", label: "Income", kind: "money", valueCents: 10_110_000 }],
      statements: ["Your income for the subsidy is {m}."], limitations: [] };
    create.mockResolvedValueOnce({ stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 40 }, content: [{ type: "text", text: "Your income is $101,100, so you keep about $12,000." }] });
    const ex = await (await json(explain, { packet, consentToProvider: true })).json();
    expect(ex.explanation).toMatchObject({ source: "deterministic", text: "Your income for the subsidy is $101,100.00." });
    expect(ex.explanation.unanswered[0]).toMatch(/figure that isn't in your result/);
  });
});

describe("decision lifecycle and calendar", () => {
  it("keeps a historical record after the client agrees; the current calendar updates and cancels events", async () => {
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const ws = await repo.save(structuredClone(dealWorkspaceFixture) as HouseholdWorkspace, null);
    const d = ws.dealPlanning!;
    const result = await fakeSearchDealTerms(ws, d.goals[0], d.termSpaces[0], d.cashContext) as ReadyDealSearch;
    const { saved: withPkg } = await saveActionPackage(repo, ws, buildActionPackage(ws, result, "v-cash"));
    const pkg = withPkg.dealPlanning!.packages[0];
    const agreed = await recordClientAgreement(withPkg, pkg.id);
    const { saved: afterAgreement } = await commitWorkspaceChange(repo, withPkg, agreed.workspace, agreed.event);
    const record = afterAgreement.dealPlanning!.decisionRecords![0];
    expect(record).toMatchObject({ status: "client_agreed", searchFingerprint: pkg.searchFingerprint, workspaceRevision: withPkg.revision });
    expect((await recordClientAgreement(afterAgreement, pkg.id)).workspace.dealPlanning!.decisionRecords).toHaveLength(1); // retry: no second record
    // The comparison context and the client's first offer travel with the decision; the offer is captured once and kept.
    expect(pkg.decisionContext!.alternatives.find(a => a.chosen)!.variantId).toBe("v-cash");
    expect(record.decisionContext!.originalOffer).toMatchObject({ source: { kind: "existing_project" }, confirmation: "captured" });
    const offerAtAgreement = afterAgreement.projects.find(p => p.id === pkg.projectId)!.originalOffer!;
    expect(offerAtAgreement.priceCents).toBe(record.decisionContext!.originalOffer!.priceCents);

    expect((await json(exportDecision, { workspace: afterAgreement, packageId: pkg.id })).status).toBe(409); // current export refuses old numbers
    const hist = await json(exportRecord, { workspace: afterAgreement, recordId: record.id });
    expect(hist.status).toBe(200);
    expect(hist.headers.get("x-headroom-record")).toBe("verified");
    const text = pdfText(new Uint8Array(await hist.arrayBuffer())).replace(/\n/g, " ");
    expect(text).toMatch(/Decision recorded on .*; figures as of plan revision/);
    expect(text).toContain("not a fresh recommendation");
    expect(text).toContain("+$5,123.00");
    expect(text).toContain("Client's original offer");

    // Current calendar: the agreed open payments; then one is received, one moves.
    const cal1 = await exportCurrentCalendar(repo, afterAgreement, new Date("2026-11-16T12:00:00Z"));
    const ev1 = parseIcs(await cal1.blob.text());
    expect(ev1.some(e => e.UID.includes(".proj-a.a-pay-2.receipt@"))).toBe(true); // A's open agreed payment is current too
    const receipts1 = ev1.filter(e => e.UID.includes(".proj-b.") && e.UID.includes(".receipt@"));
    expect(receipts1.map(e => [e.DTSTART, e.SEQUENCE])).toEqual([["20261215", "0"], ["20270106", "0"]]);
    const b = cal1.saved.projects.find(p => p.id === "proj-b")!;
    const paid = structuredClone(cal1.saved);
    const pb = paid.projects.find(p => p.id === "proj-b")!;
    pb.receipts[0].actual = { amountCents: pb.receipts[0].expected!.amountCents, date: "2026-12-15", recordedAt: "2026-12-15T10:00:00Z", sourceId: "demo-input" };
    pb.receipts[1].expected = { ...pb.receipts[1].expected!, date: "2027-01-08" };
    const { saved: changed } = await commitWorkspaceChange(repo, cal1.saved, paid, newWorkspaceEvent("payment_recorded", "First B payment received; second moved."));
    const ev2 = parseIcs(buildCurrentCalendar(changed, new Date("2026-12-16T12:00:00Z")).ics);
    const byUid = new Map(ev2.map(e => [e.UID, e]));
    expect(byUid.get(receipts1[0].UID)).toMatchObject({ STATUS: "CANCELLED", SEQUENCE: "1" }); // received → cancelled entry, not just missing
    expect(byUid.get(receipts1[1].UID)).toMatchObject({ STATUS: "CONFIRMED", SEQUENCE: "1", DTSTART: "20270108" }); // moved → same UID, new sequence
    expect(ev2.some(e => e.SUMMARY.startsWith("SEP-IRA") && e.DTSTART === "20270415")).toBe(true); // remaining SEP goal
    expect(b.receipts.length).toBe(2);

    // Historical record still exports after new facts, with "recorded since" lines.
    const later = pdfText(new Uint8Array(await (await json(exportRecord, { workspace: changed, recordId: record.id })).arrayBuffer())).replace(/\n/g, " ");
    expect(later).toContain("+$5,123.00");
    expect(later).toMatch(/Received \$5,000.00 on 2026-12-15/);
    expect(later).toMatch(/now expects \$8,000.00 on 2027-01-08/);
    expect(changed.projects.find(p => p.id === pkg.projectId)!.originalOffer).toEqual(offerAtAgreement); // moved payment never rewrites the original offer

    // Old/new state survives JSON export → restore.
    const restored = analyzeWorkspaceFile(await exportWorkspaceJson(changed).text());
    expect(restored.status === "workspace" && restored.workspace.dealPlanning).toEqual(changed.dealPlanning);
  });
});

describe("calendar UIDs for the user's own data", () => {
  it("stay within the stored limit and stable for long ids; short UIDs are unchanged", async () => {
    expect(reminderUid("ws-1", "proj-a", "act-1")).toBe("ws-1.proj-a.act-1@headroom.plan"); // issued round 4/5 UIDs keep matching
    const long = (p: string) => `${p}-${"x".repeat(100 - p.length - 1)}`;
    const wsId = "dc9f5843-c1b2-4697-affc-23f7cb2b3325";
    const a = reminderUid(wsId, long("proj"), long("act")), b = reminderUid(wsId, long("proj"), long("act2"));
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).toBe(reminderUid(wsId, long("proj"), long("act")));
    expect(a).not.toBe(b);
    expect(calendarUid(wsId, long("proj"), long("line"), "receipt").length).toBeLessThanOrEqual(200);

    // A household with long ids (as created from the user's own entries) exports and saves its calendar twice without growing UIDs.
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const raw = structuredClone(dealWorkspaceFixture) as HouseholdWorkspace;
    for (const p of raw.projects) for (const l of p.receipts) l.id = long(`${p.id}-${l.id}`);
    const ws = await repo.save(raw, null);
    const first = await exportCurrentCalendar(repo, ws, new Date("2026-11-16T12:00:00Z"));
    const uids = first.saved.dealPlanning!.calendar!.issued.map(e => e.uid);
    expect(uids.length).toBeGreaterThan(0);
    expect(uids.every(u => u.length <= 200)).toBe(true);
    const second = await exportCurrentCalendar(repo, first.saved, new Date("2026-11-17T12:00:00Z"));
    expect(second.saved.dealPlanning!.calendar!.issued.map(e => e.uid)).toEqual(uids);
    expect(second.cancelled).toBe(0);
  });
});

describe("explanations bound to the plan revision; insurance lookups", () => {
  it("a confirmed new offer keeps its original terms when a payment later moves", async () => {
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    const base = { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) };
    const offer: ChangeProposal = { id: "prop-offer", createdAt: "2026-11-16T10:00:00Z", base, intent: "offer", ambiguities: [], resolvedDates: [], evidence: [], provenance: "ai_model", status: "proposed",
      commands: [{ type: "add_offered_project", title: "Site redesign", ownerPersonId: "primary", totalPriceCents: 900_000, received: [], unpaid: [{ amountCents: 900_000, date: "2026-12-20" }], expenses: [], priceNegotiable: true, scheduleNegotiable: true }] };
    const added = (await applyChangeProposal(ws, offer)).workspace;
    const project = added.projects.at(-1)!;
    expect(project.originalOffer).toMatchObject({ priceCents: 900_000, payments: [{ amountCents: 900_000, date: "2026-12-20" }], source: { kind: "assistant_text" }, confirmation: "user_confirmed" });
    added.revision += 1;
    const move: ChangeProposal = { ...offer, id: "prop-move", intent: "update", base: { workspaceId: added.id, revision: added.revision, fingerprint: await engineWorkspaceFingerprint(added) },
      commands: [{ type: "update_expected_payment", projectId: project.id, lineId: project.receipts[0].id, newAmountCents: null, newDate: "2027-01-08" }] };
    const moved = (await applyChangeProposal(added, move)).workspace;
    expect(moved.projects.at(-1)!.receipts[0].expected!.date).toBe("2027-01-08");
    expect(moved.projects.at(-1)!.originalOffer).toEqual(project.originalOffer);
  });

  it("rebuilds the packet on the server, labels a browser packet, and only accepts a number-free provider framing", async () => {
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    const server = await (await json(explain, { workspace: ws, subject: "current_year", consentToProvider: false })).json();
    expect(server.verification).toMatchObject({ origin: "server_recomputed", workspaceId: ws.id, workspaceRevision: ws.revision });
    expect(server.explanation.text).toMatch(/2026 household income for the subsidy is \$/);
    const legacy = await (await json(explain, { packet: { id: "p", subject: "current_year", fingerprint: "f", facts: [], statements: ["Fine."], limitations: [] } })).json();
    expect(legacy.verification.origin).toBe("client_packet_unverified");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testvalue");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_testvalue"); vi.stubEnv("AI_PROVIDER", "anthropic"); vi.stubEnv("AI_API_KEY", "sk-ant-test-not-real");
    vi.stubEnv("AI_FEATURES", "explanation"); vi.stubEnv("AI_MODEL", "claude-haiku-5-5");
    requireOwner.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", db: {} });
    rpc.mockImplementation(async (name: string) => name === "headroom_settle_ai_spend" ? { data: null, error: null } : { data: [{ reservation_id: "r1", outcome: "ok" }], error: null });
    create.mockResolvedValueOnce({ stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 30 }, content: [{ type: "text", text: "In short, your income still lets you keep the credit this year." }] });
    const framed = await (await json(explain, { workspace: ws, subject: "current_year", consentToProvider: true })).json();
    expect(framed).toMatchObject({ providerUsed: true, explanation: { source: "ai_model" } });
    expect(framed.explanation.text.startsWith("In short, your income still lets you keep the credit this year. ")).toBe(true);
    expect(framed.explanation.text).toContain(server.explanation.text.slice(0, 60)); // the figures are still the engine's template sentences
  });

  it("insurance: county candidate with source/version/date; county by name; ZIP lookup off or ambiguous, never guessed", async () => {
    const { POST: benchmark } = await import("@/app/api/insurance/benchmark/route");
    const { GET: location } = await import("@/app/api/insurance/location/route");
    const { lookupCountiesByZip } = await import("@/lib/server/insurance");
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    ws.household.years[0].benchmarkStatus = "county_candidate";
    const b = await (await json(benchmark, { workspace: ws, year: 2026 })).json();
    expect(b).toMatchObject({ status: "county_candidate", countyFips: "47037", source: { kind: "cms_county_extract", dataVersion: "PY2026", sourceDate: "2026-11-14" } });
    expect(b.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    ws.household.countyFips = null;
    expect((await (await json(benchmark, { workspace: ws, year: 2026 })).json()).status).toBe("not_available");

    const get = (qs: string) => location(new Request(`http://localhost/api/insurance/location?${qs}`));
    expect(await (await get("state=TN&q=david")).json()).toMatchObject({ status: "single", counties: [{ countyFips: "47037", planDataYears: [2026, 2027] }] });
    expect((await (await get("state=CA&q=los")).json()).status).toBe("not_available");
    expect((await (await get("zip=37203")).json()).status).toBe("not_available"); // no MARKETPLACE_API_KEY → off, no external call
    const twoCounties = vi.fn(async () => new Response(JSON.stringify({ counties: [{ fips: "47037", name: "Davidson County", state: "TN" }, { fips: "47187", name: "Williamson County", state: "TN" }] })));
    const amb = await lookupCountiesByZip("37027", { MARKETPLACE_API_KEY: "test-key-not-real-0000" } as unknown as NodeJS.ProcessEnv, twoCounties as unknown as typeof fetch);
    expect(amb).toMatchObject({ status: "ambiguous", counties: [{ countyFips: "47037", planDataYears: [2026, 2027] }, { countyFips: "47187", planDataYears: [] }] });
    expect(String((twoCounties.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/marketplace\.api\.healthcare\.gov\/api\/v1\/counties\/by\/zip\/37027\?apikey=/);
    const odd = await lookupCountiesByZip("37028", { MARKETPLACE_API_KEY: "test-key-not-real-0000" } as unknown as NodeJS.ProcessEnv, (async () => new Response("{}")) as unknown as typeof fetch);
    expect(odd.status).toBe("not_available");
  });
});
