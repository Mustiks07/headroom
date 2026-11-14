import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, ReportModel } from "./report-model";

const PAGE: [number, number] = [612, 792]; // US Letter
const MARGIN = 54;
const WIDTH = PAGE[0] - MARGIN * 2;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const RULE = rgb(0.85, 0.87, 0.9);
const NOTICE_BG = rgb(0.96, 0.95, 0.9);

/** Standard PDF fonts only encode WinAnsi; map common symbols and drop anything else. */
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function toWinAnsi(text: string): string {
  return text
    .replace(/[→⟶]/g, "->").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/[−‐‑]/g, "-")
    .replace(/[   ]/g, " ").replace(/[\t\r\n]+/g, " ")
    .split("").map(ch => {
      const code = ch.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRA.includes(ch) ? ch : "?";
    }).join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = toWinAnsi(text).split(" ");
  const lines: string[] = [];
  let line = "";
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (let word of words) {
    while (!fits(word)) { // hard-break very long tokens such as fingerprints
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) line = next;
    else { if (line) lines.push(line); line = word; }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

export async function renderReportPdf(model: ReportModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.title} - ${toWinAnsi(model.subtitle)}`);
  doc.setAuthor("Headroom");
  doc.setSubject(`Calculation fingerprint ${model.fingerprint}`);
  doc.setProducer("Headroom");
  doc.setCreator("Headroom");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; };
  const ensure = (height: number) => { if (y - height < MARGIN + 20) newPage(); };
  const text = (s: string, x: number, size: number, font = regular, color = INK) => {
    page.drawText(toWinAnsi(s), { x, y, size, font, color });
  };

  // Title block
  text(model.title, MARGIN, 20, bold);
  y -= 24;
  for (const line of wrap(model.subtitle, regular, 12, WIDTH)) { text(line, MARGIN, 12, regular, MUTED); y -= 16; }
  y -= 6;

  const drawBlock = (block: Block) => {
    switch (block.type) {
      case "heading": {
        ensure(90); // keep a heading with the start of its section
        y -= 10;
        text(block.text, MARGIN, 13, bold);
        y -= 6;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.6, color: RULE });
        y -= 14;
        break;
      }
      case "paragraph": {
        const size = 9.5;
        const lines = wrap(block.text, regular, size, WIDTH - (block.tone === "notice" ? 16 : 0));
        if (block.tone === "notice") {
          const h = lines.length * 13 + 10;
          ensure(h + 4);
          page.drawRectangle({ x: MARGIN, y: y - h + 12, width: WIDTH, height: h, color: NOTICE_BG });
          for (const l of lines) { text(l, MARGIN + 8, size); y -= 13; }
          y -= 12;
        } else {
          for (const l of lines) { ensure(13); text(l, MARGIN, size, regular, block.tone === "muted" ? MUTED : INK); y -= 13; }
          y -= 5;
        }
        break;
      }
      case "keyValues": {
        const size = 9.5, keyW = WIDTH * 0.48, valW = WIDTH - keyW - 8;
        for (const [k, v] of block.rows) {
          const kl = wrap(k, regular, size, keyW), vl = wrap(v, bold, size, valW);
          const rows = Math.max(kl.length, vl.length);
          ensure(rows * 13 + 4);
          for (let i = 0; i < rows; i++) {
            if (kl[i]) text(kl[i], MARGIN, size, regular, MUTED);
            if (vl[i]) text(vl[i], MARGIN + keyW + 8, size, bold);
            y -= 13;
          }
          y -= 3;
        }
        y -= 4;
        break;
      }
      case "bullets": {
        const size = 9.5;
        for (const item of block.items) {
          const lines = wrap(item, regular, size, WIDTH - 14);
          ensure(lines.length * 13);
          lines.forEach((l, i) => { if (i === 0) text("-", MARGIN + 2, size); text(l, MARGIN + 14, size); y -= 13; });
          y -= 2;
        }
        y -= 4;
        break;
      }
      case "table": {
        const size = 8.5, pad = 4, lineH = 11;
        const widths = block.columns.map(c => c.width * WIDTH);
        const drawRow = (cells: string[], font: PDFFont, header: boolean) => {
          const wrapped = cells.map((c, i) => wrap(c, font, size, widths[i] - pad * 2));
          const h = Math.max(...wrapped.map(w => w.length)) * lineH + pad;
          if (y - h < MARGIN + 20) { newPage(); if (!header) drawRow(block.columns.map(c => c.title), bold, true); }
          let x = MARGIN;
          wrapped.forEach((lines, i) => {
            lines.forEach((l, li) => {
              const w = font.widthOfTextAtSize(l, size);
              const lx = block.columns[i].align === "right" ? x + widths[i] - pad - w : x + pad;
              page.drawText(l, { x: lx, y: y - li * lineH, size, font, color: header ? MUTED : INK });
            });
            x += widths[i];
          });
          y -= h;
          page.drawLine({ start: { x: MARGIN, y: y + lineH - 3 }, end: { x: MARGIN + WIDTH, y: y + lineH - 3 }, thickness: 0.4, color: RULE });
        };
        ensure(lineH * 3);
        drawRow(block.columns.map(c => c.title), bold, true);
        for (const row of block.rows) drawRow(row, regular, false);
        y -= 8;
        break;
      }
    }
  };
  model.blocks.forEach(drawBlock);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(toWinAnsi(`Headroom - calculation ${model.fingerprint.slice(0, 16)} - page ${i + 1} of ${pages.length}`),
      { x: MARGIN, y: MARGIN - 24, size: 7.5, font: regular, color: MUTED });
  });
  return doc.save();
}
