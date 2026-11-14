import { inflateSync } from "node:zlib";

/** Extract drawn text from pdf-lib output: inflate content streams and decode hex string operands. */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try { content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { content = m[1]; }
    for (const t of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

/** Page count via pdf-lib (page objects may sit in compressed object streams). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(bytes)).getPageCount();
}
