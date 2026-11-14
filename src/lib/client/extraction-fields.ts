/**
 * Whitelist of fields a document import may PROPOSE. Paths are person/month-agnostic on purpose:
 * the user chooses which person, year or months a proposed value applies to during review.
 * Nothing is applied automatically.
 *
 *   income.<field>      → years[y].incomes[personId].<field>          (MoneyFact)
 *   coverage.<field>    → years[y].coverage[month].<field>             (MoneyFact, monthly)
 *   opportunity.<field> → opportunity.<field>
 */
export const EXTRACTION_FIELDS = {
  "income.scheduleCProfit": { kind: "money", label: "Business net profit (Schedule C)" },
  "income.w2Box1": { kind: "money", label: "W-2 wages (Box 1)" },
  "income.socialSecurityWages": { kind: "money", label: "Social Security wages" },
  "income.medicareWages": { kind: "money", label: "Medicare wages" },
  "income.grossWages": { kind: "money", label: "Gross pay" },
  "income.payrollPretaxDeductions": { kind: "money", label: "Pre-tax payroll deductions" },
  "income.taxableInterest": { kind: "money", label: "Taxable interest" },
  "income.taxExemptInterest": { kind: "money", label: "Tax-exempt interest" },
  "income.existingSepContribution": { kind: "money", label: "SEP-IRA contribution already made" },
  "coverage.enrollmentPremium": { kind: "money", label: "Monthly plan premium" },
  "coverage.benchmarkPremium": { kind: "money", label: "Benchmark (second-lowest silver) premium" },
  "coverage.advancePtc": { kind: "money", label: "Advance premium tax credit (APTC)" },
  "opportunity.title": { kind: "text", label: "Project name" },
  "opportunity.grossRevenueCents": { kind: "money", label: "Project fee" },
  "opportunity.incrementalExpensesCents": { kind: "money", label: "Project expenses" },
  "opportunity.plannedReceiptDate": { kind: "date", label: "Expected payment date" },
  "opportunity.expensePaymentDate": { kind: "date", label: "Expense payment date" },
} as const satisfies Record<string, { kind: "money" | "date" | "text"; label: string }>;

export type ExtractionFieldPath = keyof typeof EXTRACTION_FIELDS;
export const EXTRACTION_FIELD_PATHS = Object.keys(EXTRACTION_FIELDS) as [ExtractionFieldPath, ...ExtractionFieldPath[]];

export type AmountPeriod = "annual" | "year_to_date" | "monthly" | "one_time" | "unknown";

/** Shape of `ExtractionResult.fields[i].proposedValue`, by field kind. */
export type ProposedFieldValue =
  | { kind: "money"; amountCents: number; period: AmountPeriod; asPrinted: string }
  | { kind: "date"; date: string; asPrinted: string }
  | { kind: "text"; text: string };

export function isExtractionFieldPath(path: string): path is ExtractionFieldPath {
  return Object.prototype.hasOwnProperty.call(EXTRACTION_FIELDS, path);
}

/**
 * Parse a printed US-dollar amount ("$1,234.56", "1234", "1,234") into integer cents with string
 * arithmetic only. Returns null for negatives, ambiguous or malformed values.
 */
export function parseUsdToCents(printed: string): number | null {
  const s = printed.trim().replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  if (/^\(.*\)$/.test(s) || s.startsWith("-") || s.includes("−")) return null;
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const dollars = m[1].replace(/,/g, "");
  const cents = (m[2] ?? "").padEnd(2, "0");
  const value = Number(dollars) * 100 + Number(cents);
  return Number.isSafeInteger(value) ? value : null;
}

/** Parse ISO (2027-01-15), US (01/15/2027) or long ("January 15, 2027") dates to YYYY-MM-DD. */
export function parseDate(printed: string): string | null {
  const s = printed.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { y = +m[3]; mo = +m[1]; d = +m[2]; }
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx < 0) return null;
    y = +m[3]; mo = idx + 1; d = +m[2];
  } else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Mask SSNs, EINs and long account-like digit runs before an excerpt is shown or stored. */
export function redactExcerpt(text: string, maxLength = 200): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "***-**-****")
    .replace(/\b\d{2}-\d{7}\b/g, "**-*******")
    .replace(/\b\d{8,}\b/g, m => `${"*".repeat(m.length - 4)}${m.slice(-4)}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
