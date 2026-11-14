import { describe, expect, it } from "vitest";
import {
  canonicalWorkspaceContent, HouseholdWorkspaceSchema, sepPosition, withEvent, workspaceToCaseInput, type HouseholdWorkspace,
} from "@/domain/household-workspace";
import { CaseInputSchema } from "@/domain/contracts";
import { workspaceFixture } from "@/fixtures/workspace";
import { assessCurrentRisk } from "@/lib/engine";

const clone = () => structuredClone(workspaceFixture) as HouseholdWorkspace;
const profit = (ws: HouseholdWorkspace, year = 0, person = "primary") =>
  workspaceToCaseInput(ws).input.years[year].incomes.find(i => i.personId === person)!.scheduleCProfit;

describe("household workspace contract v2.0", () => {
  it("derives one Schedule C profit per person/year: YTD + remaining − expenses + agreed A, never proposed B", () => {
    const { input, missing } = workspaceToCaseInput(clone());
    expect(CaseInputSchema.safeParse(input).success).toBe(true);
    expect(missing).toEqual([]);
    // 88,000 + 34,000 − 4,000 + A (4,000 received + 3,000 expected) = 125,000
    expect(profit(clone())).toEqual({ valueCents: 12_500_000, status: "estimated", sourceId: "derived-profit",
      range: { lowCents: 11_800_000, highCents: 13_100_000 } }); // low = 88+29−6+7, high = 88+39−3+7 (thousands)
    expect(input.opportunity.grossRevenueCents).toBe(0);
    const sep = input.years[0].incomes.find(i => i.personId === "primary")!.existingSepContribution;
    expect(sep).toMatchObject({ valueCents: 500_000, status: "estimated" }); // goal 5,000 of which 2,000 paid
    expect(sepPosition(clone(), "primary", 2026)).toEqual({ targetCents: 500_000, paidCents: 200_000, remainingCents: 300_000 });
  });

  it("evaluates B as the only change on top of A", () => {
    const { input } = workspaceToCaseInput(clone(), { candidateProjectId: "proj-b" });
    expect(input.opportunity).toMatchObject({ title: "December design project", grossRevenueCents: 1_200_000, plannedReceiptDate: "2026-12-20" });
    expect(input.years[0].incomes.find(i => i.personId === "primary")!.scheduleCProfit.valueCents).toBe(12_500_000);
    const editA = workspaceToCaseInput(clone(), { candidateProjectId: "proj-a" });
    expect(editA.input.years[0].incomes.find(i => i.personId === "primary")!.scheduleCProfit.valueCents).toBe(12_200_000); // received A stays in base
    expect(editA.input.opportunity.grossRevenueCents).toBe(300_000); // only the unpaid balance can change
  });

  it("actual replaces expected; cancellation keeps money already received", () => {
    const ws = clone();
    ws.projects[0].receipts[0].actual!.amountCents = 450_000;
    expect(profit(ws).valueCents).toBe(12_550_000);
    ws.projects[0].status = "cancelled";
    expect(profit(ws).valueCents).toBe(11_800_000 + 450_000); // final payment dropped, deposit kept
    const repeated = withEvent(withEvent(ws, ws.events[0]), ws.events[0]);
    expect(repeated.events).toHaveLength(1);
  });

  it("does not give a ready input while project exclusion is unconfirmed", () => {
    const ws = clone();
    ws.forecasts[0].excludesManagedProjects = null;
    expect(workspaceToCaseInput(ws).missing.map(m => m.path)).toEqual(["forecasts[0].excludesManagedProjects"]);
    ws.forecasts = ws.forecasts.filter(f => !(f.personId === "spouse" && f.year === 2026));
    expect(profit(ws, 0, "spouse")).toMatchObject({ valueCents: null, status: "unknown" }); // missing ≠ zero
  });

  it("rejects ambiguous or damaged data", () => {
    const bad = (mutate: (ws: Record<string, any>) => void) => { const ws: Record<string, any> = clone(); mutate(ws); return HouseholdWorkspaceSchema.safeParse(ws).success; };
    expect(bad(() => {})).toBe(true);
    expect(bad(ws => ws.forecasts.push({ ...ws.forecasts[1] }))).toBe(false); // two methods for one person/year
    expect(bad(ws => { ws.projects[0].receipts[0].cancelledAt = "2026-11-01T00:00:00Z"; })).toBe(false); // received + cancelled
    expect(bad(ws => ws.retirement.contributions.push({ ...ws.retirement.contributions[0] }))).toBe(false); // same payment twice
    expect(bad(ws => { ws.projects[0].receipts[1].sourceId = "nowhere"; })).toBe(false);
    expect(bad(ws => { ws.forecasts[0].asOfDate = "2025-12-01"; })).toBe(false);
    expect(bad(ws => { ws.retirement.contributions[0].paidDate = "2027-10-16"; })).toBe(false);
    expect(bad(ws => { ws.workspaceVersion = "2.1"; })).toBe(false);
  });

  it("fingerprint content ignores record order; the real engine runs on the adapter output", async () => {
    const ws = clone();
    const shuffled = clone();
    shuffled.projects.reverse(); shuffled.evidence.reverse(); shuffled.forecasts.reverse();
    expect(JSON.stringify(canonicalWorkspaceContent(shuffled))).toBe(JSON.stringify(canonicalWorkspaceContent(ws)));
    const risk = await assessCurrentRisk(workspaceToCaseInput(ws).input);
    expect(risk.status).toBe("ready");
  });
});
