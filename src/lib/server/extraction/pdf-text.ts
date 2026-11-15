import "server-only";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

/** Read embedded text only. No OCR, scripts, external URLs or document persistence. */
export async function readPdfText(data: Uint8Array): Promise<Array<{ page: number; text: string }>> {
  const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 });
  try {
    const result = await parser.getText();
    const pages = result.pages.map(p => ({ page: p.num, text: p.text }));
    if (pages.reduce((sum, p) => sum + p.text.length, 0) > 50_000) throw new Error("PDF_TEXT_LIMIT");
    return pages;
  } finally {
    await parser.destroy();
  }
}
