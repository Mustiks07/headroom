import { describe, expect, it } from "vitest";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { CurrentActionSchema } from "@/domain/actions";
import { workspaceFixture } from "@/fixtures/workspace";
import { currentActions } from "@/lib/client/current-actions";
import { buildCurrentCalendar } from "@/lib/client/deal-exports";
import { exportCurrentCalendar } from "@/lib/client/deal-state";
import { commitCommands } from "@/lib/client/workspace-commands";
import { createLocalWorkspaceRepository } from "@/lib/client/workspace-repository";
import { parseIcs } from "../support/ics";

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

describe("current actions are a projection of saved facts", () => {
  it("uses the observed-holiday deadline in both the action list and the exported calendar", async () => {
    const ws = structuredClone(workspaceFixture) as HouseholdWorkspace;
    ws.retirement.targets.push({ ...ws.retirement.targets[0], id: "sep-2027-primary", year: 2027, targetCents: 100_000 });
    const actions = await currentActions(ws, "2026-11-15");
    expect(actions.find(a => a.kind === "sep_remaining" && a.refs.year === 2027)?.dueDate).toBe("2028-04-18");
    const events = parseIcs(buildCurrentCalendar(ws, new Date("2026-11-15T12:00:00Z")).ics);
    expect(events.find(e => e.UID.includes(".sep.primary.2027@"))?.DTSTART).toBe("20280418");
  });

  it("pending / completed / overdue / remainder / counteroffer review, and the calendar labels done vs cancelled", async () => {
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const ws = await repo.save(structuredClone(workspaceFixture) as HouseholdWorkspace, null);
    const a0 = await currentActions(ws, "2026-11-15");
    for (const a of a0) expect(CurrentActionSchema.safeParse(a).success).toBe(true);
    const pay2 = (xs: typeof a0) => xs.find(a => a.refs.lineId === "a-pay-2")!;
    expect(pay2(a0)).toMatchObject({ kind: "expected_payment", status: "pending", dueDate: "2026-12-15", overdue: false });
    expect(a0.find(a => a.refs.lineId === "a-pay-1")).toMatchObject({ status: "completed", completedOn: "2026-10-17" });
    expect(a0.find(a => a.refs.projectId === "proj-b")).toMatchObject({ kind: "open_decision", status: "pending" });
    expect((await currentActions(ws, "2026-12-20")).find(a => a.refs.lineId === "a-pay-2")).toMatchObject({ kind: "overdue_payment", overdue: true });

    const cal1 = await exportCurrentCalendar(repo, ws, new Date("2026-11-15T12:00:00Z"));
    const partial = await commitCommands(repo, cal1.saved, "partial-a", [{ type: "record_partial_receipt", projectId: "proj-a", lineId: "a-pay-2", amountCents: 120_000, date: "2026-12-15", remainderDate: "2027-01-10" }], { userDate: "2026-12-15" });
    const counter = await commitCommands(repo, partial.saved, "counter-b", [{ type: "record_client_response", projectId: "proj-b", response: "countered", respondedOn: "2026-12-15", packageId: null,
      counter: { totalPriceCents: 1_300_000, unpaid: [{ amountCents: 500_000, date: "2026-12-20" }, { amountCents: 800_000, date: "2027-01-06" }], note: null } }], { userDate: "2026-12-15" });
    const a1 = await currentActions(counter.saved, "2026-12-15");
    expect(pay2(a1)).toMatchObject({ status: "completed", completedOn: "2026-12-15" });
    expect(a1.find(a => a.refs.lineId === "a-pay-2-rest")).toMatchObject({ kind: "partial_remainder", status: "pending", dueDate: "2027-01-10" });
    expect(a1.find(a => a.refs.projectId === "proj-b")).toMatchObject({ kind: "open_decision", title: expect.stringContaining("counteroffer") });

    const events = parseIcs(buildCurrentCalendar(counter.saved, new Date("2026-12-15T12:00:00Z")).ics);
    const old = events.find(e => e.UID.includes(".proj-a.a-pay-2.receipt@"))!;
    expect(old).toMatchObject({ STATUS: "CANCELLED", SEQUENCE: "1" });
    expect(old.SUMMARY.startsWith("Done:")).toBe(true); // received is not "cancelled"
    expect(events.find(e => e.UID.includes(".proj-a.a-pay-2-rest.receipt@"))).toMatchObject({ STATUS: "CONFIRMED", DTSTART: "20270110" });
  });
});
