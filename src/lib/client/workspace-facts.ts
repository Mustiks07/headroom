import type { ExtractionResult, MoneyFact, TaxYear } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, captureSepBudgetContributions, type HouseholdWorkspace, type WorkspaceEvent } from "@/domain/household-workspace";
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
  captureSepBudgetContributions(next);
  if (next.retirement.futureContributionBudget.asOfDate && target.paidDate < next.retirement.futureContributionBudget.asOfDate)
    next.retirement.futureContributionBudget.includedContributionIds!.push(id);
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

/* ------------------------------------------------------------------ preview (round 4) */

export type FactNeed = "date" | "tax_year" | "as_of_date" | "status" | "correction_reason";

export interface FactOption {
  id: string;
  label: string;
  /** Partial target; the UI fills the listed `needs` from the user before calling applyDocumentFact. */
  target: Partial<FactTarget> & { kind: FactTarget["kind"] };
  needs: FactNeed[];
}

export interface FactPreview {
  index: number;
  path: string;
  found: { amountCents: number | null; date: string | null; period: string | null; label: string; taxYear: 2026 | 2027 | null; source: string; excerpt: string | null };
  /** Possible destinations. Never pre-selected from a similar amount; the user chooses. */
  options: FactOption[];
  /** Why this figure can't become a plan fact as found (shown, not hidden). */
  blockers: string[];
  /** The same document figure is already a fact here (re-import): offer "already recorded". */
  alreadyApplied: string | null;
}

const TRANSFER = /\btransfer|between (my |your )?accounts|from savings|to savings|internal|own account|zelle from (me|myself)\b/i;

function appliedWhere(ws: HouseholdWorkspace, evidenceId: string): string | null {
  for (const p of ws.projects) for (const l of [...p.receipts, ...p.expenses]) if (l.actual?.sourceId === evidenceId) return `Recorded as a payment for "${p.title}".`;
  for (const f of ws.forecasts) for (const v of Object.values(f)) if (v && typeof v === "object" && (v as MoneyFact).sourceId === evidenceId) return `Used in the ${f.year} profit forecast.`;
  if (ws.retirement.contributions.some(c => c.sourceId === evidenceId)) return "Recorded as a SEP contribution.";
  return null;
}

/**
 * Turn a reviewed extraction into per-figure choices for THIS workspace: found amount/date/period/
 * source, possible destinations and blockers. Nothing is applied; the user confirms each with
 * `applyDocumentFact`. Transfers are not income, an unknown period is not 2026, one receipt is not
 * an annual total, and similar amounts never pick a destination by themselves.
 */
export function previewDocumentFacts(ws: HouseholdWorkspace, extraction: ExtractionResult): FactPreview[] {
  const pairedDate = extraction.fields.find(f => f.path === "project.paymentReceivedDate");
  const dateOf = (f: Field | undefined) => f && (f.proposedValue as { kind?: string; date?: string })?.kind === "date" ? (f.proposedValue as { date: string }).date : null;
  const adults = ws.household.people.filter(p => p.role !== "dependent");
  const who = (id: string) => ws.household.people.find(p => p.id === id)?.role === "spouse" ? "Your spouse" : "You";

  return extraction.fields.map((field, index) => {
    const v = field.proposedValue as { kind?: string; amountCents?: number; period?: string; date?: string };
    const taxYear = (field.evidence.taxYear ?? null) as 2026 | 2027 | null;
    const preview: FactPreview = {
      index, path: field.path,
      found: { amountCents: v?.kind === "money" ? v.amountCents ?? null : null, date: v?.kind === "date" ? v.date ?? null : null, period: v?.period ?? null,
        label: field.path, taxYear, source: field.evidence.label, excerpt: field.evidence.excerpt ?? null },
      options: [], blockers: [], alreadyApplied: appliedWhere(ws, field.evidence.id),
    };
    const yearNeed: FactNeed[] = taxYear ? [] : ["tax_year"];

    if (field.path === "project.paymentReceived") {
      preview.found.date = dateOf(pairedDate);
      if (TRANSFER.test(field.evidence.excerpt ?? "")) {
        preview.blockers.push("This looks like a transfer between your own accounts. Transfers are not business income.");
        return preview;
      }
      for (const p of ws.projects) for (const l of p.receipts) {
        const recorded = !!l.actual;
        preview.options.push({ id: `${p.id}:${l.id}`, target: { kind: "payment_received", projectId: p.id, lineId: l.id, ...(preview.found.date ? { date: preview.found.date } : {}) },
          label: `${p.title} — ${l.label ?? "payment"}${l.expected ? ` (expected ${(l.expected.amountCents / 100).toFixed(2)} USD on ${l.expected.date})` : ""}${recorded ? " — already recorded, would be a correction" : ""}`,
          needs: [...(preview.found.date ? [] : ["date" as const]), ...(recorded ? ["correction_reason" as const] : [])] });
      }
      if (!preview.options.length) preview.blockers.push("Add the project and its expected payment first, then record this receipt.");
    } else if (field.path === "project.paymentReceivedDate") {
      preview.blockers.push("Used as the date of the received payment above.");
    } else if (field.path === "income.existingSepContribution") {
      for (const a of adults) preview.options.push({ id: `sep:${a.id}`, label: `${who(a.id)}: SEP-IRA contribution actually paid`,
        target: { kind: "sep_contribution", personId: a.id, ...(taxYear ? { taxYear } : {}) }, needs: [...yearNeed, "date"] });
    } else if (field.path === "income.scheduleCProfit") {
      if (v?.period === "year_to_date") {
        for (const a of adults) {
          const f = ws.forecasts.find(x => x.personId === a.id && (!taxYear || x.year === taxYear));
          if (f?.method === "year_to_date_plus_remaining") preview.options.push({ id: `ytd:${a.id}`, label: `${who(a.id)}: net profit so far this year`,
            target: { kind: "forecast", personId: a.id, field: "ytdNetProfit", ...(taxYear ? { year: taxYear } : {}) }, needs: [...yearNeed, "as_of_date", "status"] });
        }
        if (!preview.options.length) preview.blockers.push("This is a year-to-date figure. Switch the profit forecast to “year to date plus the rest of the year” to use it.");
      } else if (v?.period === "annual") {
        for (const a of adults) {
          const f = ws.forecasts.find(x => x.personId === a.id && (!taxYear || x.year === taxYear));
          if (f?.method === "annual_total") preview.options.push({ id: `annual:${a.id}`, label: `${who(a.id)}: full-year net profit forecast`,
            target: { kind: "forecast", personId: a.id, field: "annualNetProfit", ...(taxYear ? { year: taxYear } : {}) }, needs: [...yearNeed, "status"] });
        }
        if (!preview.options.length) preview.blockers.push("This is a full-year figure; the plan uses year to date plus the rest of the year. Switch methods first.");
      } else {
        preview.blockers.push("The document doesn't say whether this covers the year so far or the full year. One payment or a partial period is never used as an annual total.");
      }
    } else {
      preview.blockers.push("Use this figure in the household form (it isn't a project payment, SEP contribution or profit forecast).");
    }
    return preview;
  });
}
