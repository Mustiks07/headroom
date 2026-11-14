import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST } from "@/app/api/documents/extract/route";

const upload = (content: BlobPart, name: string, type: string, consent = false) => {
  const form = new FormData();
  form.set("file", new File([content], name, { type }));
  if (consent) form.set("consent", "provider");
  return POST(new Request("http://localhost/api/documents/extract", { method: "POST", body: form }));
};

afterEach(() => vi.unstubAllEnvs());

describe("document import", () => {
  it("reads a real CSV pay-stub export deterministically and requires review", async () => {
    const csv = ["Item,Amount", "Pay period end,2026-10-31", "Gross pay YTD,\"$48,250.00\"", "Pre-tax deductions YTD,\"$3,000.00\"",
      "Social Security wages YTD,\"$45,250.00\"", "Employee SSN,123-45-6789", "Monthly premium,$1917.75"].join("\n");
    const response = await upload(csv, "paystub.csv", "text/csv");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("review_required");
    const gross = result.fields.find((f: { path: string }) => f.path === "income.grossWages");
    expect(gross.proposedValue).toEqual({ kind: "money", amountCents: 4_825_000, period: "year_to_date", asPrinted: "$48,250.00" });
    expect(gross.evidence.kind).toBe("document");
    expect(gross.evidence.taxYear).toBe(2026);
    expect(result.fields.find((f: { path: string }) => f.path === "coverage.enrollmentPremium").proposedValue.amountCents).toBe(191_775);
    expect(result.warnings.join(" ")).toMatch(/Year-to-date amounts are not full-year forecasts/);
    expect(JSON.stringify(result)).not.toContain("123-45-6789");
  });

  it("does not classify bank-statement deposits as profit", async () => {
    const response = await upload("Date,Description,Amount\n2026-03-01,Client ACME,5000.00\n", "bank.csv", "text/csv");
    const result = await response.json();
    expect(result.fields).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/bank statement/);
  });

  it("rejects an unsupported file with a manual-entry path", async () => {
    const response = await upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "notes.docx", "application/octet-stream");
    expect(response.status).toBe(415);
    const result = await response.json();
    expect(result.status).toBe("unavailable");
    expect(result.warnings[0]).toMatch(/enter the figures manually/i);
  });

  it("is honest when no AI provider is configured for a PDF", async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    vi.stubEnv("AI_API_KEY", "");
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const response = await upload(new Uint8Array(await pdf.save()) as BlobPart, "w2.pdf", "application/pdf");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable", fields: [],
      warnings: ["Document analysis is unavailable. Enter the figures manually."] });
  });

  it("requires explicit consent before a document goes to a configured provider", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_API_KEY", "sk-ant-test-not-a-real-key");
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const response = await upload(new Uint8Array(await pdf.save()) as BlobPart, "w2.pdf", "application/pdf");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("CONSENT_REQUIRED");
  });
});
