import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeWorkspaceFile } from "@/lib/client/api";

describe("judge-facing round6 input files", () => {
  it("opens all three files through the actual Restore adapter and keeps the published goal", () => {
    for (const id of [1, 2, 3]) {
      const analysis = analyzeWorkspaceFile(readFileSync(`docs/artifacts/round6/ui/case-${id}-importable.json`, "utf8"));
      expect(analysis.status).toBe("workspace");
      if (analysis.status !== "workspace") throw new Error(`Case ${id} is not restorable`);
      expect(analysis.workspace.household.isSynthetic).toBe(true);
      expect(analysis.workspace.projects.some(p => p.id === "B")).toBe(true);
      if (id === 1) expect(analysis.workspace.dealPlanning?.goals[0].projectId).toBe("B");
    }
  });
});
