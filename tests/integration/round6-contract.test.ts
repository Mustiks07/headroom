import { describe, expect, it } from "vitest";
import { ChangeCommandSchema } from "@/domain/assistance";
import { CurrentActionSchema } from "@/domain/actions";
import { HouseholdWorkspaceSchema, workspaceFingerprint } from "@/domain/household-workspace";
import { ImportDecisionSchema, ImportTargetSchema } from "@/domain/imports";
import { IntakeRequestSchema, OnboardingDraftSchema, ProposedOfferSchema, TypedAnswerSchema } from "@/domain/intake";
import { dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { currentActionFixture, importDecisionsFixture, intakeResultFixture, lifecycleCommandsFixture, onboardingDraftFixture } from "@/fixtures/round6";
import { workspaceFixture } from "@/fixtures/workspace";

describe("round 6 contract", () => {
  it("fixtures parse; older workspaces stay valid; offer versions are not fingerprinted", async () => {
    expect(OnboardingDraftSchema.safeParse(onboardingDraftFixture).success).toBe(true);
    for (const o of intakeResultFixture.offers) expect(ProposedOfferSchema.safeParse(o).success).toBe(true);
    for (const d of importDecisionsFixture) expect(ImportDecisionSchema.safeParse(d).success).toBe(true);
    for (const c of lifecycleCommandsFixture) expect(ChangeCommandSchema.safeParse(c).success).toBe(true);
    expect(CurrentActionSchema.safeParse(currentActionFixture).success).toBe(true);
    expect(HouseholdWorkspaceSchema.safeParse(workspaceFixture).success).toBe(true);
    const ws = structuredClone(dealWorkspaceFixture);
    ws.projects[0].offerVersions = [{ version: 2, kind: "client_counteroffer", recordedAt: "2026-11-20T10:00:00Z", priceCents: 1_300_000,
      payments: [{ amountCents: 1_300_000, date: "2027-01-06", received: false }], status: "open", source: { kind: "user_entered", sourceId: null }, note: null }];
    expect(HouseholdWorkspaceSchema.safeParse(ws).success).toBe(true);
    expect(await workspaceFingerprint(ws, "e", "r")).toBe(await workspaceFingerprint(dealWorkspaceFixture, "e", "r"));
  });

  it("answers are typed; targets are explicit; counteroffers need unpaid terms", () => {
    expect(TypedAnswerSchema.safeParse({ kind: "tax_year", fieldId: "q", taxYear: 2025 }).success).toBe(false);
    expect(TypedAnswerSchema.safeParse({ kind: "text", fieldId: "q", text: "on January 8" }).success).toBe(false);
    expect(ImportTargetSchema.safeParse({ kind: "coverage", year: 2026, field: "benchmarkPremium", months: [] }).success).toBe(false); // months must be chosen
    expect(ImportTargetSchema.safeParse({ kind: "interest", personId: "primary", year: 2026 }).success).toBe(false); // taxable vs tax-exempt required
    expect(ChangeCommandSchema.safeParse({ type: "record_client_response", projectId: "p", response: "countered", respondedOn: "2026-11-20", packageId: null,
      counter: { totalPriceCents: null, unpaid: [], note: null } }).success).toBe(false);
    expect(IntakeRequestSchema.safeParse({ purpose: "first_offer", text: "x".repeat(8_001), userDate: "2026-11-15", timeZone: "America/Chicago", consentToProvider: false, project: null }).success).toBe(false);
  });
});
