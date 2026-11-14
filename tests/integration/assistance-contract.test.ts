import { describe, expect, it } from "vitest";
import { AssistanceRequestSchema, ChangeCommandSchema, ChangeProposalSchema, ExtractedFactSchema } from "@/domain/assistance";
import { HouseholdWorkspaceSchema } from "@/domain/household-workspace";
import { changeProposalFixture, extractedFactsFixture, importDraftFixture } from "@/fixtures/assistance";
import { dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { workspaceFixture } from "@/fixtures/workspace";

describe("assistance contract v1.0", () => {
  it("fixtures are valid and older workspaces still parse", () => {
    expect(importDraftFixture.facts).toHaveLength(2);
    expect(ChangeProposalSchema.safeParse(changeProposalFixture).success).toBe(true);
    expect(HouseholdWorkspaceSchema.safeParse(workspaceFixture).success).toBe(true);
    expect(HouseholdWorkspaceSchema.safeParse(dealWorkspaceFixture).success).toBe(true);
  });

  it("only whitelisted typed commands are accepted", () => {
    expect(ChangeCommandSchema.safeParse({ type: "json_patch", ops: [] }).success).toBe(false);
    expect(ChangeCommandSchema.safeParse({ type: "send_email", to: "x@example.com" }).success).toBe(false);
    expect(ChangeCommandSchema.safeParse({ type: "record_receipt", projectId: "p", lineId: "l", amountCents: 100.5, date: "2026-12-16" }).success).toBe(false); // cents only
    expect(ChangeCommandSchema.safeParse({ type: "record_receipt", projectId: "p", lineId: "l", amountCents: 300_000, date: "2030-01-01" }).success).toBe(false);
    expect(ChangeProposalSchema.safeParse({ ...changeProposalFixture, commands: Array(6).fill(changeProposalFixture.commands[0]) }).success).toBe(false);
  });

  it("extracted facts keep unknown as null and requests carry the user's date/time zone", () => {
    expect(ExtractedFactSchema.safeParse({ ...extractedFactsFixture[0], personCandidate: null, taxYear: null }).success).toBe(true);
    expect(AssistanceRequestSchema.safeParse({ intent: "update", text: "moved", userDate: "2026-11-16", base: null,
      context: { people: [], projects: [], forecasts: [], goals: [] } }).success).toBe(false); // timeZone required
  });
});
