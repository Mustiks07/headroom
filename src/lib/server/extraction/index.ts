import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { ExtractionResult } from "@/domain/contracts";
import { serverConfig } from "../env";
import { HttpError } from "../http";
import type { DocumentKind } from "@/domain/assistance";
import { toExtractedFacts, type ExtractionResponse } from "@/lib/client/import-draft";
import { aiFeatureEnabled, type AiReservation } from "../ai-budget";
import { extractWithAnthropic, type ProviderCallInfo, type ProviderMedia } from "./anthropic";
import { detectAsOfDate, documentKindCode, extractFromText } from "./text";

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_PDF_PAGES = 5;
export const UNAVAILABLE_MESSAGE = "Document analysis is unavailable. Enter the figures manually.";

type Detected = { kind: "text"; text: string; label: string } | { kind: "pdf" } | { kind: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp" };

function detect(bytes: Uint8Array, mime: string, name: string): Detected | null {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (head(5).map(b => String.fromCharCode(b)).join("") === "%PDF-") return { kind: "pdf" };
  if (head(8).join(",") === "137,80,78,71,13,10,26,10") return { kind: "image", mediaType: "image/png" };
  if (head(3).join(",") === "255,216,255") return { kind: "image", mediaType: "image/jpeg" };
  if (String.fromCharCode(...head(4)) === "RIFF" && String.fromCharCode(...Array.from(bytes.subarray(8, 12))) === "WEBP") {
    return { kind: "image", mediaType: "image/webp" };
  }
  const textual = ["csv", "txt", "tsv"].includes(ext) || /^text\/(plain|csv|tab-separated-values)$/.test(mime);
  if (!textual || bytes.includes(0)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: "text", text, label: ext === "csv" || mime === "text/csv" ? "Uploaded CSV file" : "Uploaded text file" };
  } catch {
    return null;
  }
}

export interface ExtractRequest {
  bytes: Uint8Array; mime: string; name: string; consentToProvider: boolean;
  /** Session + durable quota check, run only right before a paid provider call. */
  authorizeProvider?: (estimate: { pdfPages?: number; images?: number }) => Promise<AiReservation>;
}

/**
 * Validate and read one uploaded document. CSV/TXT are parsed locally. PDF/images go to the
 * configured AI provider only after explicit consent. Nothing is stored; nothing is auto-applied.
 */
export async function extractDocumentServer(req: ExtractRequest): Promise<{ status: number; result: ExtractionResponse }> {
  if (req.bytes.byteLength === 0) throw new HttpError(400, "EMPTY_FILE", "The file is empty.");
  if (req.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "The file is larger than 3 MB. Upload a smaller file or enter the figures manually.");
  const detected = detect(req.bytes, req.mime, req.name);
  // Content hash: the same file always gets the same id, so re-importing it cannot create doubles.
  const documentId = createHash("sha256").update(req.bytes).digest("hex").slice(0, 32);
  if (!detected) {
    return { status: 415, result: { status: "unavailable", fields: [],
      warnings: ["This file type is not supported. Upload a PDF, PNG, JPEG, CSV or TXT file, or enter the figures manually."] } };
  }
  if (detected.kind === "text") {
    const result = extractFromText(detected.text, documentId, detected.label);
    const kind = documentKindCode(detected.text);
    return { status: 200, result: { ...result, document: { documentId, kind: kind as DocumentKind },
      facts: toExtractedFacts(result, documentId, kind, "deterministic_text", detectAsOfDate(detected.text)) } };
  }

  let media: ProviderMedia;
  if (detected.kind === "pdf") {
    let pageCount: number;
    try {
      const pdf = await PDFDocument.load(req.bytes, { ignoreEncryption: false, updateMetadata: false });
      pageCount = pdf.getPageCount();
    } catch {
      return { status: 415, result: { status: "unavailable", fields: [],
        warnings: ["This PDF could not be opened (it may be damaged or password-protected). Enter the figures manually."] } };
    }
    if (pageCount > MAX_PDF_PAGES) {
      return { status: 413, result: { status: "unavailable", fields: [],
        warnings: [`This PDF has ${pageCount} pages. Upload only the relevant pages (up to ${MAX_PDF_PAGES}) or enter the figures manually.`] } };
    }
    media = { kind: "pdf", data: Buffer.from(req.bytes), pageCount };
  } else {
    media = { kind: "image", data: Buffer.from(req.bytes), mediaType: detected.mediaType };
  }

  if (!aiFeatureEnabled("extraction")) return { status: 200, result: { status: "unavailable", fields: [], warnings: [UNAVAILABLE_MESSAGE] } };
  if (!req.consentToProvider) {
    throw new HttpError(400, "CONSENT_REQUIRED", "Confirm that this document may be sent to the document-analysis provider before it is read.");
  }
  if (!req.authorizeProvider) throw new HttpError(503, "AI_UNAVAILABLE", UNAVAILABLE_MESSAGE);
  const reservation = await req.authorizeProvider(media.kind === "pdf" ? { pdfPages: media.pageCount } : { images: 1 });
  const info: ProviderCallInfo = { usage: null, outcome: "error" };
  try {
    const label = detected.kind === "pdf" ? "Uploaded PDF" : "Uploaded image";
    const result = await extractWithAnthropic(media, documentId, label,
      { apiKey: reservation.apiKey, model: reservation.model, maxOutputTokens: reservation.maxOutputTokens, timeoutMs: reservation.timeoutMs }, info);
    await reservation.settle(info.usage, info.outcome);
    const kind = result.document?.kind ?? "unknown";
    return { status: 200, result: { ...result, document: { documentId, kind }, facts: toExtractedFacts(result, documentId, kind, "ai_model") } };
  } catch (error) {
    await reservation.settle(info.usage, error instanceof Error ? error.name : "error");
    console.error("[headroom] document provider failed", error instanceof Error ? error.name : "unknown");
    return { status: 503, result: { status: "unavailable", fields: [],
      warnings: ["Document analysis did not respond in time. Try again or enter the figures manually."] } };
  }
}
