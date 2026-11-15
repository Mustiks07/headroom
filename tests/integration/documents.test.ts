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

  it("keeps expense dates separate from expense amounts and client payment dates", async () => {
    const response = await upload([
      "Project expenses: $900", "Expense payment date: 2026-12-10", "Payment date: 2027-01-05",
    ].join("\n"), "project.txt", "text/plain");
    const result = await response.json();
    expect(result.fields.map((f: { path: string; proposedValue: unknown }) => [f.path, f.proposedValue])).toEqual([
      ["opportunity.incrementalExpensesCents", { kind: "money", amountCents: 90_000, period: "one_time", asPrinted: "$900" }],
      ["opportunity.expensePaymentDate", { kind: "date", date: "2026-12-10", asPrinted: "2026-12-10" }],
      ["opportunity.plannedReceiptDate", { kind: "date", date: "2027-01-05", asPrinted: "2027-01-05" }],
    ]);
  });

  it("skips ambiguous or partial amounts instead of silently changing their value", async () => {
    const response = await upload([
      "Annual business profit,118,000", "Business profit,45000,55000", "Project expenses: −500",
      "Project fee: 500.123", "Project fee: 2026-12-10", "Project fee: $1,000 to $2,000",
      "Annual business profit\t118,000",
    ].join("\n"), "amounts.txt", "text/plain");
    const result = await response.json();
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].proposedValue.amountCents).toBe(11_800_000);
    expect(result.warnings.join(" ")).toMatch(/more than one value column/);
    expect(result.warnings.join(" ")).toMatch(/unreadable and was skipped/);
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
    // Round 6: a PDF's embedded text is read on the server without AI; this one has none (like a scan).
    expect(await response.json()).toEqual({ status: "unavailable", fields: [],
      warnings: ["This PDF has no readable text layer (for example a scan). Paste the relevant text or enter the figures manually."] });
  });

  it("requires explicit consent before a document goes to a configured provider", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_API_KEY", "sk-ant-test-not-a-real-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testvalue");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_testvalue");
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const response = await upload(new Uint8Array(await pdf.save()) as BlobPart, "w2.pdf", "application/pdf");
    // Round 6: without consent nothing goes to the provider; the PDF is read on Headroom's server only.
    expect(response.status).toBe(200);
    expect((await response.json()).warnings[0]).toMatch(/no readable text layer/);
  });
});
