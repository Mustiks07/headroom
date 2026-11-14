import { describe, expect, it } from "vitest";
import { AssistanceRequestSchema, ChangeCommandSchema, ChangeProposalSchema, ExtractedFactSchema } from "@/domain/assistance";
import { HouseholdWorkspaceSchema, workspaceFingerprint } from "@/domain/household-workspace";
import { DecisionContextSchema, type OriginalOffer } from "@/domain/decision-context";
import { LocationQuerySchema } from "@/domain/insurance";
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

  it("follow-up: original offer is stored but not fingerprinted; decision context and location queries are typed", async () => {
    const offer: OriginalOffer = { priceCents: 1_200_000, payments: [{ amountCents: 1_200_000, date: "2026-12-20" }],
      source: { kind: "assistant_text", sourceId: "prop-1" }, confirmation: "user_confirmed", recordedAt: "2026-11-16T10:00:00Z" };
    const withOffer = structuredClone(dealWorkspaceFixture);
    withOffer.projects[0].originalOffer = offer;
    expect(HouseholdWorkspaceSchema.safeParse(withOffer).success).toBe(true);
    expect(await workspaceFingerprint(withOffer, "e", "r")).toBe(await workspaceFingerprint(dealWorkspaceFixture, "e", "r"));
    expect(DecisionContextSchema.safeParse({ baseline: { kind: "accept_as_offered", label: "As offered", description: "" },
      horizon: { from: "2026-11-16", through: "2027-12-31", settlementThrough: "2028-04-17" }, alternatives: [], recommendedVariantId: null,
      recommendationReasons: [], originalOffer: offer }).success).toBe(true);
    expect(LocationQuerySchema.safeParse({ zip: "3720" }).success).toBe(false);
    expect(LocationQuerySchema.safeParse({ state: "TN", q: "davidson" }).success).toBe(true);
  });
});
