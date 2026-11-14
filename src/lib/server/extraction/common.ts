import "server-only";
import type { ExtractionResult } from "@/domain/contracts";

type Evidence = ExtractionResult["fields"][number]["evidence"];

export function evidenceFor(documentId: string, label: string, excerpt: string,
  taxYear: 2026 | 2027 | undefined, page: number | undefined): Evidence {
  return {
    id: `doc-${documentId.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "document", label, documentId,
    ...(taxYear ? { taxYear } : {}),
    ...(page ? { page } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

/**
 * Detect the document's tax year from printed years. Prior-year documents are labelled and their
 * amounts must not be carried into 2026/2027 silently.
 */
export function yearWarnings(text: string, explicitYear?: number | null): { taxYear: 2026 | 2027 | undefined; warnings: string[] } {
  const years = explicitYear ? [explicitYear] : [...new Set((text.match(/\b20(2[0-9])\b/g) ?? []).map(Number))];
  const current = years.filter(y => y === 2026 || y === 2027) as Array<2026 | 2027>;
  const prior = years.filter(y => y < 2026);
  const warnings: string[] = [];
  if (current.length === 0 && prior.length > 0) {
    warnings.push(`This document appears to be for ${Math.max(...prior)}. Its amounts are not carried into 2026 or 2027 automatically; use them only as a reference for your forecast.`);
  } else if (current.length > 1) {
    warnings.push("This document mentions both 2026 and 2027. Check which year each figure belongs to.");
  }
  return { taxYear: current.length === 1 ? current[0] : undefined, warnings };
}
