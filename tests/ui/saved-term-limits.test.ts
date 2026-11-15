import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HouseholdWorkspaceSchema } from "@/domain/household-workspace";
import { DealGoalSchema, DealTermsSpaceSchema } from "@/domain/deal-planning";
import { defaultGoal } from "@/features/deal/GoalForm";
import { buildGoal, draftFromSaved } from "@/features/deal/model";

describe("returning to saved negotiation limits", () => {
  it("keeps allowed windows, caps and price step instead of silently allowing payment today", () => {
    const input = JSON.parse(readFileSync("docs/artifacts/round6/scenarios/inputs/case-1.json", "utf8"));
    const ws = HouseholdWorkspaceSchema.parse(input.workspace);
    const goal = DealGoalSchema.parse(input.goal);
    const space = DealTermsSpaceSchema.parse(input.space);
    space.paymentWindows[0].maxShareBps = 6500;
    space.price.stepCents = 10000;
    ws.dealPlanning = { version: "1.0", goals: [goal], termSpaces: [space], cashContext: null, packages: [] };
    const project = ws.projects.find(p => p.id === goal.projectId)!;
    const draft = draftFromSaved(defaultGoal(project), goal, space, null);
    const built = buildGoal(ws, project, draft, goal.id);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.space.paymentWindows).toEqual(space.paymentWindows);
    expect(built.space.price.stepCents).toBe(10000);
    draft.windows.latestDate = "2027-01-08";
    const narrowed = buildGoal(ws, project, draft, goal.id);
    expect(narrowed.ok && narrowed.space.paymentWindows).toEqual([
      space.paymentWindows[0], { ...space.paymentWindows[1], latest: "2027-01-08" },
    ]);
  });
});
