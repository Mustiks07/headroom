// Builds the corpus PDFs from the synthetic text inputs (native text PDFs) plus one PDF without a text layer.
// Usage: node scripts/eval-make-pdfs.mjs   (writes docs/artifacts/round6/eval/inputs/*.pdf)
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const dir = "docs/artifacts/round6/eval/inputs";
const fixed = new Date("2026-11-15T00:00:00Z");
async function textPdf(name) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixed); doc.setModificationDate(fixed); doc.setProducer("Headroom eval corpus"); doc.setCreator("Headroom eval corpus");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 740;
  for (const line of readFileSync(`${dir}/${name}.txt`, "utf8").replace(/—/g, "-").split("\n")) { page.drawText(line, { x: 56, y, size: 11, font }); y -= 18; }
  writeFileSync(`${dir}/${name}.pdf`, await doc.save({ useObjectStreams: false }));
}
for (const n of ["d1-payment-confirmation", "d2-w2", "d3-marketplace-notice", "d6-sep-confirmation"]) await textPdf(n);
// "Scan": only drawn shapes, no text objects at all.
const scan = await PDFDocument.create();
scan.setCreationDate(fixed); scan.setModificationDate(fixed); scan.setProducer("Headroom eval corpus");
const p = scan.addPage([612, 792]);
for (let i = 0; i < 12; i++) p.drawRectangle({ x: 56, y: 700 - i * 22, width: 300 + (i % 4) * 40, height: 8, color: rgb(0.2, 0.2, 0.2) });
writeFileSync(`${dir}/d7-scan.pdf`, await scan.save({ useObjectStreams: false }));
console.log("PDFs written to", dir);
