import type { ExtractionResult, MoneyFact, TaxYear } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace, type WorkspaceEvent } from "@/domain/household-workspace";
import type { ProposedFieldValue } from "./extraction-fields";

type Field = ExtractionResult["fields"][number];

/** Where the USER decided a reviewed document figure belongs (nothing is guessed from similar amounts). */
export type FactTarget =
  | { kind: "forecast"; personId: string; year: TaxYear; field: "annualNetProfit" | "ytdNetProfit" | "remainingReceipts" | "remainingExpenses";
      status: "confirmed" | "estimated"; /** required for year-to-date figures */ asOfDate?: string }
  | { kind: "payment_received"; projectId: string; lineId: string; /** received date (from the document or entered) */ date: string;
      /** set only when deliberately replacing a different recorded amount; kept in corrections */ correctionReason?: string }
  | { kind: "sep_contribution"; personId: string; taxYear: TaxYear; paidDate: string };

export type ApplyFactResult =
  | { status: "applied"; workspace: HouseholdWorkspace; event: Omit<WorkspaceEvent, "id" | "at"> }
  /** The same document figure was already applied here: nothing changes (safe re-import). */
  | { status: "duplicate"; workspace: HouseholdWorkspace }
  /** The target already holds a different fact; the user must resolve it explicitly. */
  | { status: "needs_resolution"; message: string }
  | { status: "rejected"; message: string };

const moneyOf = (v: unknown): number | null =>
  v && typeof v === "object" && (v as ProposedFieldValue).kind === "money" ? (v as { amountCents: number }).amountCents : null;

/**
 * Apply one reviewed document figure to the workspace as a confirmed/estimated FACT with its
 * source. Idempotent: evidence ids are deterministic (content hash + line), so applying the same
 * document line twice is a no-op. Never merges by similar amount; never overwrites a different
 * received amount unless `correctionReason` is given (the old value stays in `corrections`).
 */
export function applyDocumentFact(ws: HouseholdWorkspace, field: Field, target: FactTarget, now = new Date()): ApplyFactResult {
  const amount = moneyOf(field.proposedValue);
  if (amount === null) return { status: "rejected", message: "This figure isn't an amount." };
  const evidenceId = field.evidence.id;
  const next: HouseholdWorkspace = structuredClone(ws);
  if (!next.evidence.some(e => e.id === evidenceId)) next.evidence.push(field.evidence);
  const at = now.toISOString();
  const period = (field.proposedValue as { period?: string }).period;

  if (target.kind === "forecast") {
    const f = next.forecasts.find(x => x.personId === target.personId && x.year === target.year);
    if (!f) return { status: "rejected", message: "Choose how this year's profit is entered (full-year total or year to date + rest of year) first." };
    const isYtdField = target.field === "ytdNetProfit";
    if (period === "year_to_date" && !isYtdField) {
      return { status: "rejected", message: "A year-to-date figure can only be used as year-to-date profit, not as a full-year or remaining amount." };
    }
    if ((f.method === "annual_total") !== (target.field === "annualNetProfit")) {
      return { status: "rejected", message: "This field doesn't belong to the profit method used for this year." };
    }
    const current = (f as Record<string, unknown>)[target.field] as MoneyFact;
    if (current.sourceId === evidenceId && current.valueCents === amount) return { status: "duplicate", workspace: ws };
    (f as Record<string, unknown>)[target.field] = { valueCents: amount, status: target.status, sourceId: evidenceId } satisfies MoneyFact;
    if (isYtdField && f.method === "year_to_date_plus_remaining") {
      if (!target.asOfDate) return { status: "rejected", message: "Confirm the date the year-to-date figure refers to." };
      f.asOfDate = target.asOfDate; f.asOfConfirmed = true;
    }
    return finish(next, { kind: "forecast_updated", description: `Applied a document figure to the ${target.year} profit forecast.`,
      refs: { documentId: field.evidence.documentId }, previousFingerprint: null, nextFingerprint: null });
  }

  if (target.kind === "payment_received") {
    const project = next.projects.find(p => p.id === target.projectId);
    const line = project?.receipts.find(l => l.id === target.lineId);
    if (!project || !line) return { status: "rejected", message: "Choose which expected payment this receipt belongs to." };
    if (line.actual) {
      if (line.actual.sourceId === evidenceId && line.actual.amountCents === amount && line.actual.date === target.date) return { status: "duplicate", workspace: ws };
      if (!target.correctionReason) {
        return { status: "needs_resolution", message: `This payment already has a received amount (${(line.actual.amountCents / 100).toFixed(2)} USD on ${line.actual.date}). Record it as a correction or choose another payment.` };
      }
      line.corrections.push({ at, previousActual: { amountCents: line.actual.amountCents, date: line.actual.date }, reason: target.correctionReason });
    }
    line.actual = { amountCents: amount, date: target.date, recordedAt: at, sourceId: evidenceId };
    line.cancelledAt = null;
    return finish(next, { kind: target.correctionReason ? "payment_corrected" : "payment_recorded",
      description: `${target.correctionReason ? "Corrected" : "Recorded"} payment received for "${project.title}".`,
      refs: { projectId: project.id, lineId: line.id, documentId: field.evidence.documentId }, previousFingerprint: null, nextFingerprint: null });
  }

  // SEP contribution: id derived from the evidence, so the same confirmation can't be counted twice.
  const id = `sep-${evidenceId}`;
  if (next.retirement.contributions.some(c => c.id === id)) return { status: "duplicate", workspace: ws };
  next.retirement.contributions.push({ id, personId: target.personId, taxYear: target.taxYear, amountCents: amount, paidDate: target.paidDate,
    sourceId: evidenceId, recordedAt: at });
  return finish(next, { kind: "sep_contribution_recorded", description: `Recorded a ${target.taxYear} SEP contribution from a document.`,
    refs: { contributionId: id, documentId: field.evidence.documentId }, previousFingerprint: null, nextFingerprint: null });
}

function finish(next: HouseholdWorkspace, event: Omit<WorkspaceEvent, "id" | "at">): ApplyFactResult {
  const parsed = HouseholdWorkspaceSchema.safeParse(next);
  if (!parsed.success) return { status: "rejected", message: parsed.error.issues[0]?.message ?? "The figure doesn't fit this plan." };
  return { status: "applied", workspace: parsed.data, event };
}
