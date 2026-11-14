import "server-only";
import type { ExtractionResult } from "@/domain/contracts";
import {
  EXTRACTION_FIELDS, parseDate, parseUsdToCents, redactExcerpt,
  type AmountPeriod, type ExtractionFieldPath, type ProposedFieldValue,
} from "@/lib/client/extraction-fields";
import { evidenceFor, yearWarnings } from "./common";

/** Label patterns → whitelisted field. Order matters: more specific first. */
const LABELS: Array<[RegExp, ExtractionFieldPath]> = [
  [/schedule\s*c|net\s+(business\s+)?profit|business\s+profit|self[- ]employment\s+profit/i, "income.scheduleCProfit"],
  [/social\s+security\s+wages|box\s*3\b/i, "income.socialSecurityWages"],
  [/medicare\s+wages|box\s*5\b/i, "income.medicareWages"],
  [/w-?2.*box\s*1\b|box\s*1\b|wages,?\s+tips/i, "income.w2Box1"],
  [/pre-?tax\s+deductions?|pretax\s+deductions?|401\(?k\)?\s+deferral/i, "income.payrollPretaxDeductions"],
  [/gross\s+(pay|wages|earnings)/i, "income.grossWages"],
  [/tax[- ]exempt\s+interest/i, "income.taxExemptInterest"],
  [/taxable\s+interest|interest\s+income|^interest$/i, "income.taxableInterest"],
  [/sep(-ira)?\s+contribution/i, "income.existingSepContribution"],
  [/second\s+lowest|slcsp|benchmark/i, "coverage.benchmarkPremium"],
  [/advance(d)?\s+(premium\s+)?(tax\s+)?credit|\baptc\b/i, "coverage.advancePtc"],
  [/(monthly\s+)?premium/i, "coverage.enrollmentPremium"],
  [/project\s+(name|title)|engagement\s+name/i, "opportunity.title"],
  [/(project|contract)\s+(fee|amount|price|total|value)|offer(ed)?\s+(amount|fee)/i, "opportunity.grossRevenueCents"],
  [/expense\s+(payment\s+)?date/i, "opportunity.expensePaymentDate"],
  [/date\s+received|received\s+on|deposit(ed)?\s+(date|on)/i, "project.paymentReceivedDate"],
  [/(payment|amount)\s+received|deposit(ed)?\s+amount|received\s+amount/i, "project.paymentReceived"],
  [/payment\s+(date|due|expected)|expected\s+payment|receipt\s+date|paid\s+on/i, "opportunity.plannedReceiptDate"],
  [/(project\s+)?expenses?|subcontract(or)?\s+cost/i, "opportunity.incrementalExpensesCents"],
];

const MAX_LINES = 5000;
const DATE_RE = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/;

function periodOf(line: string, field: ExtractionFieldPath): AmountPeriod {
  if (/\bytd\b|year[- ]to[- ]date/i.test(line)) return "year_to_date";
  if (/monthly|per\s+month|\/\s*mo(nth)?\b/i.test(line)) return "monthly";
  if (/annual|yearly|per\s+year|full[- ]year|\/\s*yr\b/i.test(line)) return "annual";
  if (field.startsWith("opportunity.")) return "one_time";
  return "unknown";
}

/** A value must occupy one cell; multiple values must never be joined or guessed. */
function splitLine(line: string): { label: string; value: string | null } | null {
  const colon = /^([^:]{2,80}):\s*(.+)$/.exec(line);
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() };
  const separator = line.includes("\t") ? /\t/ : /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
  const csv = line.split(separator).map(c => c.trim().replace(/^"|"$/g, ""));
  if (csv.length >= 2 && /[A-Za-z]/.test(csv[0])) {
    const values = csv.slice(1).filter(c => c.length > 0);
    return values.length ? { label: csv[0], value: values.length === 1 ? values[0] : null } : null;
  }
  return null;
}

function looksLikeBankStatement(lines: string[]): boolean {
  const header = lines.slice(0, 5).join(" ").toLowerCase();
  return /\bdate\b/.test(header) && /description|payee|memo/.test(header) && /amount|debit|credit|balance/.test(header);
}

/**
 * Deterministic reader for supported CSV/TXT exports and pasted text. It proposes only
 * whitelisted figures with a redacted source line; the user must confirm each one.
 */
type DocumentKind = "profit and loss statement" | "pay stub" | "Marketplace notice" | "project offer" | "invoice" | "payment confirmation" | "SEP contribution confirmation" | "W-2" | "prior-year tax return" | null;

/** A coarse, explainable guess used only to label sources and add the right caveat. */
function documentKind(text: string): DocumentKind {
  if (/form\s+1040|schedule\s+c\b.*\b20(1\d|2[0-5])\b|tax\s+return/i.test(text)) return "prior-year tax return";
  if (/\bw-?2\b|wages,?\s+tips/i.test(text)) return "W-2";
  if (/profit\s+(and|&)\s+loss|\bp\s*&\s*l\b|income\s+statement|total\s+expenses/i.test(text)) return "profit and loss statement";
  if (/gross\s+pay|net\s+pay|pay\s+period|earnings\s+statement/i.test(text)) return "pay stub";
  if (/marketplace|healthcare\.gov|premium\s+tax\s+credit|\baptc\b|slcsp|second\s+lowest/i.test(text)) return "Marketplace notice";
  if (/sep(-ira)?\s+contribution/i.test(text) && /confirm|receipt|deposit|contribution\s+date/i.test(text)) return "SEP contribution confirmation";
  if (/payment\s+(received|advice|confirmation)|amount\s+received|deposit(ed)?\s+amount/i.test(text)) return "payment confirmation";
  if (/\binvoice\b|amount\s+due|due\s+date/i.test(text)) return "invoice";
  if (/proposal|statement\s+of\s+work|project\s+(fee|price|amount|total)|contract\s+(fee|amount|value)|offer(ed)?\s+(amount|fee)/i.test(text)) return "project offer";
  return null;
}

const OPPORTUNITY_FIELD = /^opportunity\./;

const KIND_CODE: Record<Exclude<DocumentKind, null>, string> = {
  "profit and loss statement": "profit_and_loss", "pay stub": "pay_stub", "Marketplace notice": "marketplace_statement", "project offer": "client_offer",
  invoice: "invoice", "payment confirmation": "payment_confirmation", "SEP contribution confirmation": "sep_confirmation", "W-2": "w2",
  "prior-year tax return": "prior_year_tax_return",
};

/** Contract document kind (assistance.ts DOCUMENT_KINDS) for a text/CSV document. */
export function documentKindCode(text: string): string {
  if (looksLikeBankStatement(text.replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean))) return "bank_statement";
  const k = documentKind(text);
  return k ? KIND_CODE[k] : "unknown";
}

/** "January 1 - September 30, 2026", "through 2026-09-30", "as of …", "period ending …" → the end date (YYYY-MM-DD). */
export function detectAsOfDate(text: string): string | null {
  const range = /(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s*(?:\d{4})?|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*(?:-|–|to|through)\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text);
  const labelled = /(?:through|as\s+of|period\s+end(?:ing|ed)?|ending)[:\s]+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text);
  const printed = (range ?? labelled)?.[1];
  return printed ? parseDate(printed) : null;
}

const KIND_NOTES: Record<Exclude<DocumentKind, null>, string> = {
  "profit and loss statement": "Profit and loss: net profit covers only the period shown. Add the rest of the year's expected receipts and expenses separately; it is never multiplied up to a full year.",
  "pay stub": "Pay stub: year-to-date figures cover only part of the year. Decide for each one whether it is a starting point or your full-year forecast.",
  "Marketplace notice": "Marketplace notice: monthly premium, benchmark and advance credit amounts apply to the months shown on the notice.",
  "project offer": "Project offer: the fee is revenue, not profit. Expenses and the date you actually receive the money matter.",
  invoice: "Invoice: an invoice is not a payment. Record the payment when the money actually arrives.",
  "payment confirmation": "Payment confirmation: choose which expected payment it belongs to. Transfers between your own accounts are not income.",
  "SEP contribution confirmation": "SEP confirmation: choose the tax year the contribution is for; it is recorded once.",
  "W-2": "W-2: a final W-2 only exists for a completed year. Don't carry a prior-year W-2 into 2026 or 2027 without deciding it is still right.",
  "prior-year tax return": "Prior-year tax return: it describes a past year. It doesn't confirm this year's income; use it only as a reference for your forecast.",
};

export function extractFromText(text: string, documentId: string, rawLabel: string): ExtractionResult {
  const kind = documentKind(text);
  const isProfitAndLoss: boolean = kind === "profit and loss statement";
  const label = kind ? `${rawLabel} (looks like a ${kind})` : rawLabel;
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > MAX_LINES) warnings.push(`Only the first ${MAX_LINES} lines were read.`);
  const { taxYear, warnings: yw } = yearWarnings(text);
  warnings.push(...yw);

  if (kind && !looksLikeBankStatement(lines)) warnings.push(KIND_NOTES[kind]);
  if (looksLikeBankStatement(lines)) {
    warnings.push("This looks like a bank statement. Deposits, transfers and refunds are not classified as business profit automatically. Enter your profit figures manually.");
    return { status: "review_required", fields: [], warnings };
  }

  const fields: ExtractionResult["fields"] = [];
  lines.slice(0, MAX_LINES).forEach((line, index) => {
    const parts = splitLine(line);
    if (!parts) return;
    const match = LABELS.find(([re]) => re.test(parts.label));
    if (!match) return;
    // A P&L's expenses are already inside its net profit; they are not a project's expenses.
    if (isProfitAndLoss && OPPORTUNITY_FIELD.test(match[1])) return;
    if (parts.value === null) {
      warnings.push(`Line ${index + 1}: more than one value column was found. Use one amount per row and quote CSV amounts containing commas.`);
      return;
    }
    const path = match[1];
    const kind = EXTRACTION_FIELDS[path].kind;
    let proposedValue: ProposedFieldValue | null = null;
    if (kind === "money") {
      const printed = parts.value;
      const cents = parseUsdToCents(printed);
      if (cents === null) {
        warnings.push(`Line ${index + 1}: "${EXTRACTION_FIELDS[path].label}" is negative or unreadable and was skipped.`);
        return;
      }
      proposedValue = { kind, amountCents: cents, period: periodOf(line, path), asPrinted: printed.trim() };
    } else if (kind === "date") {
      const printed = DATE_RE.exec(parts.value)?.[0];
      const date = printed ? parseDate(printed) : null;
      if (!printed || !date) return;
      proposedValue = { kind, date, asPrinted: printed };
    } else {
      const textValue = redactExcerpt(parts.value, 200);
      if (!textValue) return;
      proposedValue = { kind, text: textValue };
    }
    fields.push({ path, proposedValue,
      evidence: evidenceFor(documentId, `l${index + 1}`, `${label}, line ${index + 1}`, redactExcerpt(line), taxYear, undefined) });
  });

  const counts = new Map<string, number>();
  fields.forEach(f => counts.set(f.path, (counts.get(f.path) ?? 0) + 1));
  for (const [path, count] of counts) {
    if (count > 1) warnings.push(`${count} values were found for "${EXTRACTION_FIELDS[path as ExtractionFieldPath].label}". Choose the one that applies.`);
  }
  if (fields.some(f => (f.proposedValue as ProposedFieldValue).kind === "money" &&
    (f.proposedValue as { period: AmountPeriod }).period === "year_to_date")) {
    warnings.push("Year-to-date amounts are not full-year forecasts. Add the payments you still expect this year before using them.");
  }
  if (fields.length === 0) warnings.push("No supported figures were found in this file. Enter the figures manually.");
  return { status: "review_required", fields, warnings };
}
