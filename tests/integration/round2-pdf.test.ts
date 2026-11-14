import { describe, expect, it } from "vitest";
import { familyCase } from "@/fixtures/cases";
import { calculateComparison } from "@/lib/engine";
import { exportPdfFromInput } from "@/lib/server/pdf";
import { renderReportPdf } from "@/lib/server/pdf/render";
import { pdfPageCount, pdfText } from "../support/pdf-text";

describe("PDF report with the real engine and long content", () => {
  it("keeps long titles, sources and official links without losing data", async () => {
    const input = structuredClone(familyCase);
    input.opportunity.title = "Brand identity, packaging system and twelve-month retainer for a grocery relaunch including photography, copywriting and print supervision";
    input.evidence.push({ id: "doc-long", kind: "document", label: "Uploaded PDF: year-to-date earnings statement", taxYear: 2026, page: 2,
      excerpt: `${"Gross pay YTD 0.00 ".repeat(30)}END-OF-EXCERPT`, url: `https://payroll.example.test/${"segment/".repeat(12)}final` });
    input.years[0].incomes[1].w2Box1 = { valueCents: 0, status: "confirmed", sourceId: "doc-long" };
    const r = await calculateComparison(input);
    if (r.status !== "ready") throw new Error(r.message);
    const { pdf, fingerprint } = await exportPdfFromInput(input, r.recommendedScenarioId!, r.calculationFingerprint);
    const text = pdfText(pdf).replace(/\n/g, " ");
    expect(fingerprint).toBe(r.calculationFingerprint);
    expect(text).toContain("END-OF-EXCERPT");
    expect(text).toContain("print supervision");
    expect(text).toContain("https://www.irs.gov/"); // official rule links survive
    expect(text).toContain("2027 step");
    const lastTrace = r.scenarios.find(s => s.id === r.recommendedScenarioId)!.years[1].trace.at(-1)!;
    expect(text).toContain(lastTrace.label.slice(0, 20)); // trace is not truncated
    expect(await pdfPageCount(pdf)).toBeLessThanOrEqual(8);
  });

  it("continues a table row taller than a page instead of drawing off the page", async () => {
    const long = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const pdf = await renderReportPdf({ title: "T", subtitle: "S", fingerprint: "f".repeat(64), blocks: [
      { type: "table", columns: [{ title: "A", width: 0.3 }, { title: "B", width: 0.7 }], rows: [["short", long], ["after", "row"]] }] });
    const text = pdfText(pdf);
    expect(await pdfPageCount(pdf)).toBeGreaterThan(1);
    expect(text).toContain("word899");
    expect(text).toContain("after");
  });
});
