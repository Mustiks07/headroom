import { describe, expect, it } from "vitest";
import type { ChangeCommand } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { workspaceFixture } from "@/fixtures/workspace";
import { evaluateHouseholdWorkspace } from "@/lib/engine";
import { createLocalWorkspaceRepository } from "@/lib/client/workspace-repository";
import { CommandBlockedError, commitCommands, manualProposal, commitProposal } from "@/lib/client/workspace-commands";

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

async function fresh() {
  const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
  const ws = await repo.save(structuredClone(workspaceFixture) as HouseholdWorkspace, null);
  return { repo, ws };
}
const receipts = (ws: HouseholdWorkspace, id: string) => ws.projects.find(p => p.id === id)!.receipts;
const counted = (ws: HouseholdWorkspace, id: string) => receipts(ws, id).reduce((t, l) => t + (l.actual?.amountCents ?? (l.cancelledAt ? 0 : l.expected?.amountCents ?? 0)), 0);
const reject = (projectId: string): ChangeCommand => ({ type: "record_client_response", projectId, response: "rejected", respondedOn: "2026-11-15", packageId: null, counter: null });
const accept = (projectId: string): ChangeCommand => ({ type: "record_client_response", projectId, response: "accepted", respondedOn: "2026-11-15", packageId: null, counter: null });
const today = { userDate: "2026-11-15" };

describe("commit re-runs the shared semantic validator", () => {
  it("a fresh, schema-valid proposal with a future receipt date is refused at save time", async () => {
    const { repo, ws } = await fresh();
    const p = await manualProposal(ws, "form-future", [{ type: "record_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 300_000, date: "2026-12-16" }]);
    await expect(commitProposal(repo, ws, p, today)).rejects.toBeInstanceOf(CommandBlockedError);
    expect((await repo.get(ws.id))!.revision).toBe(ws.revision); // nothing saved
    const ok = await commitProposal(repo, ws, p, { userDate: "2026-12-16" });
    expect(ok.saved.revision).toBe(ws.revision + 1);
  });
});

describe("partial receipt, lower settlement", () => {
  it("records the received part, keeps the dated remainder, no double count; retry is a no-op", async () => {
    const { repo, ws } = await fresh();
    const cmd: ChangeCommand = { type: "record_partial_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 120_000, date: "2026-12-15", remainderDate: "2027-01-10" };
    const before = counted(ws, "proj-a");
    const first = await commitCommands(repo, ws, "partial-1", [cmd], { userDate: "2026-12-15" });
    const lines = receipts(first.saved, "proj-a");
    expect(lines.find(l => l.id === "a-pay-2")!.actual).toMatchObject({ amountCents: 120_000, date: "2026-12-15" });
    expect(lines.find(l => l.id === "a-pay-2-rest")).toMatchObject({ expected: { amountCents: 180_000, date: "2027-01-10" }, actual: null });
    expect(counted(first.saved, "proj-a")).toBe(before); // received + remainder = the original expected amount
    expect(first.saved.events.at(-1)!.kind).toBe("partial_receipt_recorded");
    expect(first.saved.projects.find(p => p.id === "proj-a")!.originalOffer!.priceCents).toBe(700_000);
    const again = await commitCommands(repo, first.saved, "partial-1", [cmd], { userDate: "2026-12-15" });
    expect(again.alreadyApplied).toBe(true);
    expect(receipts(again.saved, "proj-a")).toHaveLength(3);
    expect((await evaluateHouseholdWorkspace(first.saved)).status).toBe("ready");
    const rest = await commitCommands(repo, first.saved, "rest-1", [{ type: "record_receipt", projectId: "proj-a", lineId: "a-pay-2-rest", amountCents: 180_000, date: "2027-01-08" }], { userDate: "2027-01-08" });
    expect(counted(rest.saved, "proj-a")).toBe(before);
  });

  it("refuses a 'partial' that is not less than expected; a lower final amount is explicit", async () => {
    const { repo, ws } = await fresh();
    await expect(commitCommands(repo, ws, "p-full", [{ type: "record_partial_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 300_000, date: "2026-12-15", remainderDate: "2027-01-10" }], { userDate: "2026-12-15" }))
      .rejects.toMatchObject({ code: "NOT_LESS_THAN_EXPECTED" });
    const low = await commitCommands(repo, ws, "settle-1", [{ type: "settle_lower_total", projectId: "proj-a", lineId: "a-pay-2", amountCents: 250_000, date: "2026-12-15", reason: "Agreed lower final amount." }], { userDate: "2026-12-15" });
    expect(receipts(low.saved, "proj-a")).toHaveLength(2); // no remainder line
    expect(low.saved.events.at(-1)!.kind).toBe("payment_settled_lower");
  });
});

describe("client response lifecycle", () => {
  it("counteroffer keeps the original offer and replaces only unpaid terms; acceptance versions it", async () => {
    const { repo, ws } = await fresh();
    const counter: ChangeCommand = { type: "record_client_response", projectId: "proj-b", response: "countered", respondedOn: "2026-11-15", packageId: null,
      counter: { totalPriceCents: 1_300_000, unpaid: [{ amountCents: 500_000, date: "2026-12-15" }, { amountCents: 800_000, date: "2027-01-06" }], note: "Keep part in December." } };
    const c1 = await commitCommands(repo, ws, "resp-1", [counter], today);
    const b = c1.saved.projects.find(p => p.id === "proj-b")!;
    expect(b.originalOffer).toMatchObject({ priceCents: 1_200_000, payments: [{ amountCents: 1_200_000, date: "2026-12-20" }] });
    expect(b.offerVersions!.map(v => [v.kind, v.status])).toEqual([["original", "superseded"], ["client_counteroffer", "open"]]);
    expect(b.receipts.filter(l => !l.cancelledAt).map(l => [l.expected!.amountCents, l.expected!.date])).toEqual([[500_000, "2026-12-15"], [800_000, "2027-01-06"]]);
    expect(b.receipts.find(l => l.id === "b-pay-1")!.cancelledAt).not.toBeNull(); // old unpaid term kept as history
    expect(b.status).toBe("proposed");
    const c2 = await commitCommands(repo, c1.saved, "resp-2", [accept("proj-b")], today);
    const b2 = c2.saved.projects.find(p => p.id === "proj-b")!;
    expect(b2.status).toBe("agreed");
    expect(b2.offerVersions!.map(v => [v.kind, v.status])).toEqual([["original", "superseded"], ["client_counteroffer", "accepted"], ["accepted_terms", "accepted"]]);
    expect(b2.originalOffer).toEqual(b.originalOffer);
    await expect(commitCommands(repo, c2.saved, "resp-3", [accept("proj-b")], today)).rejects.toMatchObject({ code: "ALREADY_RECORDED" });
  });

  it("rejection cancels only unpaid payments; money already received stays", async () => {
    const { repo, ws } = await fresh();
    const r = await commitCommands(repo, ws, "rej-1", [reject("proj-a")], today);
    const a = r.saved.projects.find(p => p.id === "proj-a")!;
    expect(a.status).toBe("cancelled");
    expect(a.receipts.find(l => l.id === "a-pay-1")!.actual!.amountCents).toBe(400_000);
    expect(a.receipts.find(l => l.id === "a-pay-2")!.cancelledAt).not.toBeNull();
    expect(r.saved.events.at(-1)!.description).toMatch(/\$4,000.00 already received stays recorded/);
    expect((await evaluateHouseholdWorkspace(r.saved)).status).toBe("ready");
  });

  it("counteroffer totals must add up with money already received; a stale proposal is refused", async () => {
    const { repo, ws } = await fresh();
    await expect(commitCommands(repo, ws, "bad-1", [{ type: "record_client_response", projectId: "proj-a", response: "countered", respondedOn: "2026-11-15", packageId: null,
      counter: { totalPriceCents: 700_000, unpaid: [{ amountCents: 400_000, date: "2026-12-20" }], note: null } }], today)).rejects.toMatchObject({ code: "PRICE_MISMATCH" });
    const p = await manualProposal(ws, "stale-1", [reject("proj-b")]);
    const moved = await commitCommands(repo, ws, "other-1", [{ type: "update_expected_payment", projectId: "proj-a", lineId: "a-pay-2", newAmountCents: null, newDate: "2026-12-30" }], today);
    await expect(commitProposal(repo, moved.saved, p, today)).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });
});

describe("original offer at the first save", () => {
  it("workspaceFromCase keeps the entered offer as the original offer", async () => {
    const { workspaceFromCase } = await import("@/features/household-plan/ops");
    const { familyCase } = await import("@/fixtures/cases");
    const ws = workspaceFromCase(familyCase, [], true);
    expect(ws.projects[0].originalOffer).toMatchObject({ priceCents: familyCase.opportunity.grossRevenueCents, confirmation: "user_confirmed", source: { kind: "user_entered" } });
  });
});
