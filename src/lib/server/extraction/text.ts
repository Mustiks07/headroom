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
  [/(project\s+)?expenses?|subcontract(or)?\s+cost/i, "opportunity.incrementalExpensesCents"],
  [/payment\s+(date|due|expected)|expected\s+payment|receipt\s+date|paid\s+on/i, "opportunity.plannedReceiptDate"],
  [/expense\s+(payment\s+)?date/i, "opportunity.expensePaymentDate"],
];

const MAX_LINES = 5000;
const AMOUNT_RE = /\(?-?\$?\s*\d[\d,]*(?:\.\d{1,2})?\)?/;
const DATE_RE = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/;

function periodOf(line: string, field: ExtractionFieldPath): AmountPeriod {
  if (/\bytd\b|year[- ]to[- ]date/i.test(line)) return "year_to_date";
  if (/monthly|per\s+month|\/\s*mo(nth)?\b/i.test(line)) return "monthly";
  if (/annual|yearly|per\s+year|full[- ]year|\/\s*yr\b/i.test(line)) return "annual";
  if (field.startsWith("opportunity.")) return "one_time";
  return "unknown";
}

/** Split "label: value", "label,value", "label\tvalue" or a 2+ column CSV row. */
function splitLine(line: string): { label: string; value: string } | null {
  const csv = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ""));
  const colon = /^([^:]{2,80}):\s*(.+)$/.exec(line);
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() };
  if (csv.length >= 2 && /[A-Za-z]/.test(csv[0])) {
    const value = csv.slice(1).find(c => c.length > 0);
    return value ? { label: csv[0], value: csv.length === 2 ? value : csv.slice(1).join(" ") } : null;
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
export function extractFromText(text: string, documentId: string, label: string): ExtractionResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > MAX_LINES) warnings.push(`Only the first ${MAX_LINES} lines were read.`);
  const { taxYear, warnings: yw } = yearWarnings(text);
  warnings.push(...yw);

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
    const path = match[1];
    const kind = EXTRACTION_FIELDS[path].kind;
    let proposedValue: ProposedFieldValue | null = null;
    if (kind === "money") {
      const printed = AMOUNT_RE.exec(parts.value)?.[0];
      if (!printed) return;
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
      evidence: evidenceFor(documentId, `${label}, line ${index + 1}`, redactExcerpt(line), taxYear, undefined) });
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
