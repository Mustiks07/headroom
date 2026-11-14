import { DOCUMENT_KINDS, type DocumentKind, type ExtractedFact, type ImportDraft } from "@/domain/assistance";
import type { ExtractionResult } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, withEvent, type HouseholdWorkspace, type WorkspaceEvent } from "@/domain/household-workspace";
import { applyDocumentFact, type FactTarget } from "./workspace-facts";

/** /api/documents/extract response: the v1 ExtractionResult plus round 5 additive fields. */
export type ExtractionResponse = ExtractionResult & {
  document?: { documentId: string; kind: DocumentKind };
  facts?: ExtractedFact[];
};

const asKind = (k: string | undefined): DocumentKind => (DOCUMENT_KINDS as readonly string[]).includes(k ?? "") ? k as DocumentKind : "unknown";

/**
 * Convert reviewed-extraction fields into typed ExtractedFacts. Ids are stable per document +
 * field + locator. The person is NEVER inferred (null = ask); year comes only from the document.
 */
export function toExtractedFacts(result: ExtractionResult, documentId: string, kind: string | undefined,
  provenance: ExtractedFact["provenance"], asOfDate: string | null = null): ExtractedFact[] {
  return result.fields.map(f => {
    const v = f.proposedValue as { kind?: string; amountCents?: number; period?: string; date?: string; text?: string; asPrinted?: string };
    const locator = f.evidence.id.replace(/^doc-[0-9a-f]+-/, "");
    const value: ExtractedFact["value"] = v?.kind === "money"
      ? { kind: "money", amountCents: v.amountCents!, period: (["annual", "year_to_date", "monthly", "one_time"].includes(v.period ?? "") ? v.period : "unknown") as "annual" }
      : v?.kind === "date" ? { kind: "date", date: v.date! } : { kind: "text", text: String(v?.text ?? "").slice(0, 300) };
    return {
      id: `${documentId}:${f.path}:${locator}`.slice(0, 120),
      documentId, documentKind: asKind(kind), field: f.path, value,
      valueAsPrinted: String(v?.asPrinted ?? v?.text ?? "").slice(0, 120),
      personCandidate: null,
      taxYear: (f.evidence.taxYear ?? null) as 2026 | 2027 | null,
      asOfDate: value.kind === "money" && value.period === "year_to_date" ? asOfDate : null,
      source: { label: f.evidence.label.slice(0, 200), page: f.evidence.page ?? null, excerpt: f.evidence.excerpt?.slice(0, 200) ?? null },
      provenance, review: "extracted", conflictsWith: [],
    };
  });
}

const valueKey = (f: ExtractedFact) => JSON.stringify(f.value);
/** Same field for the same target/period. Different documents with the same value are NOT duplicates. */
const slotKey = (f: ExtractedFact) => [f.field, f.taxYear ?? "?", f.asOfDate ?? "?", f.personCandidate ?? "?",
  f.value.kind === "money" ? f.value.period : f.value.kind].join("|");

/**
 * Add one document's facts to the draft. Re-reading the same document is a no-op (same ids).
 * Two different values for the same field/period/target become `conflict` (never "last wins").
 */
export function mergeIntoDraft(draft: ImportDraft, facts: ExtractedFact[], doc: ImportDraft["documents"][number]): { draft: ImportDraft; added: number; duplicates: number; conflicts: number } {
  const next: ImportDraft = structuredClone(draft);
  if (!next.documents.some(d => d.documentId === doc.documentId)) next.documents.push(doc);
  let added = 0, duplicates = 0;
  for (const fact of facts) {
    if (next.facts.some(f => f.id === fact.id)) { duplicates++; continue; }
    next.facts.push(structuredClone(fact));
    added++;
  }
  // Recompute conflicts across the whole draft (confirmed/rejected stay as the user set them).
  for (const f of next.facts) f.conflictsWith = [];
  const bySlot = new Map<string, ExtractedFact[]>();
  for (const f of next.facts) if (f.review !== "rejected") bySlot.set(slotKey(f), [...(bySlot.get(slotKey(f)) ?? []), f]);
  let conflicts = 0;
  for (const group of bySlot.values()) {
    if (new Set(group.map(valueKey)).size < 2) continue;
    for (const f of group) {
      f.conflictsWith = group.filter(g => valueKey(g) !== valueKey(f)).map(g => g.id).slice(0, 10);
      if (f.review === "extracted") { f.review = "conflict"; conflicts++; }
    }
  }
  return { draft: next, added, duplicates, conflicts };
}

export interface FactDecision {
  factId: string;
  target: FactTarget;
  /** Required for a fact in conflict: the user picked this value over the others. */
  resolvesConflict?: boolean;
}

export type GroupApplyResult =
  | { status: "applied"; workspace: HouseholdWorkspace; event: WorkspaceEvent; applied: string[]; alreadyRecorded: string[] }
  | { status: "nothing_new"; workspace: HouseholdWorkspace; alreadyRecorded: string[] }
  | { status: "rejected"; failures: Array<{ factId: string; message: string }> };

function shortHash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519); }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0");
}

/**
 * Apply a USER-CONFIRMED group of facts as ONE change: all facts + their sources + one history
 * event, or nothing (any rejected / needs-resolution fact aborts the whole group). Facts already
 * recorded from the same document line are skipped. The event id derives from the decisions, so
 * retrying the same group is a no-op. Save the result with commitWorkspaceChange.
 */
export function applyConfirmedFacts(ws: HouseholdWorkspace, draft: ImportDraft, decisions: FactDecision[]): GroupApplyResult {
  const failures: Array<{ factId: string; message: string }> = [];
  const chosen = new Set(decisions.map(d => d.factId));
  let current = ws;
  const applied: string[] = [], alreadyRecorded: string[] = [];
  for (const d of decisions) {
    const fact = draft.facts.find(f => f.id === d.factId);
    if (!fact) { failures.push({ factId: d.factId, message: "This figure is no longer in the review list." }); continue; }
    if (fact.review === "rejected") { failures.push({ factId: d.factId, message: "This figure was rejected." }); continue; }
    if (fact.conflictsWith.length && !d.resolvesConflict) { failures.push({ factId: d.factId, message: "Other documents show a different value for this figure. Choose which one is right first." }); continue; }
    if (fact.conflictsWith.some(id => chosen.has(id))) { failures.push({ factId: d.factId, message: "Two different values for the same figure can't both be applied." }); continue; }
    const field = {
      path: fact.field,
      proposedValue: fact.value.kind === "money" ? { kind: "money", amountCents: fact.value.amountCents, period: fact.value.period, asPrinted: fact.valueAsPrinted }
        : fact.value.kind === "date" ? { kind: "date", date: fact.value.date, asPrinted: fact.valueAsPrinted } : { kind: "text", text: fact.value.text },
      evidence: { id: `doc-${fact.documentId.slice(0, 16)}-${fact.id.split(":").pop()}`.slice(0, 100), kind: "document" as const, label: fact.source.label,
        documentId: fact.documentId, ...(fact.taxYear ? { taxYear: fact.taxYear } : {}), ...(fact.source.page ? { page: fact.source.page } : {}),
        ...(fact.source.excerpt ? { excerpt: fact.source.excerpt } : {}) },
    };
    const r = applyDocumentFact(current, field, d.target);
    if (r.status === "applied") { current = r.workspace; applied.push(d.factId); }
    else if (r.status === "duplicate") alreadyRecorded.push(d.factId);
    else failures.push({ factId: d.factId, message: r.message });
  }
  if (failures.length) return { status: "rejected", failures };
  if (!applied.length) return { status: "nothing_new", workspace: ws, alreadyRecorded };
  const docs = [...new Set(applied.map(id => draft.facts.find(f => f.id === id)!.documentId))];
  const event: WorkspaceEvent = {
    id: `evt-import-${shortHash(JSON.stringify(decisions.map(d => [d.factId, d.target]).sort()))}`,
    at: new Date().toISOString(), kind: "document_imported",
    description: `Applied ${applied.length} confirmed figure(s) from ${docs.length} document(s).`,
    refs: { documentId: docs[0] }, previousFingerprint: null, nextFingerprint: null,
  };
  const parsed = HouseholdWorkspaceSchema.safeParse(withEvent(current, event));
  if (!parsed.success) return { status: "rejected", failures: [{ factId: applied[0], message: parsed.error.issues[0]?.message ?? "The figures don't fit this plan." }] };
  return { status: "applied", workspace: parsed.data, event, applied, alreadyRecorded };
}

export const emptyImportDraft = (id = "draft"): ImportDraft => ({ id, documents: [], facts: [] });
