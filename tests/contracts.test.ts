import { describe, expect, it } from "vitest";
import { CaseInputSchema, FactSchema } from "@/domain/contracts";
import { demoCases } from "@/fixtures/cases";

describe("shared foundation contract", () => {
  it("accepts the three shared demo inputs", () => {
    for (const sample of demoCases) expect(CaseInputSchema.safeParse(sample).success).toBe(true);
  });
  it("does not silently turn an unknown amount into zero", () => {
    expect(FactSchema.safeParse({ valueCents: 0, status: "unknown", sourceId: "manual" }).success).toBe(false);
    expect(FactSchema.safeParse({ valueCents: null, status: "unknown", sourceId: "manual" }).success).toBe(true);
  });
});
