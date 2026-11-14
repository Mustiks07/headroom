import { CaseInputSchema, CONTRACT_VERSION, type CaseInput, type MoneyFact, type TaxYear } from "@/domain/contracts";
import { ProfitForecastSchema, forecastTotal, type ProfitForecast } from "@/domain/household-workspace";

/**
 * UI editing model. It mirrors the shared CaseInput but lets the few
 * non-money answers that the contract requires (state, filing status, ages)
 * stay unanswered until the person fills them in. Money stays in MoneyFact
 * form so unknown is always `null`, never zero.
 */
type Person = CaseInput["people"][number];
export type DraftPerson = Omit<Person, "ageAt2026Start"> & { ageAt2026Start: number | null };
export type FilingStatus = CaseInput["filingStatus"];
export type YearInput = CaseInput["years"][number];
export type PersonIncome = YearInput["incomes"][number];
export type CoverageMonth = YearInput["coverage"][number];
export type Evidence = CaseInput["evidence"][number];

export interface Draft extends Omit<CaseInput, "state" | "filingStatus" | "people"> {
  state: string | null;
  filingStatus: FilingStatus | null;
  people: DraftPerson[];
  ui: {
    projectStarted: boolean;
    /** Text the person typed that isn't a valid amount yet. Blocks calculation until fixed. */
    invalid?: Record<string, { text: string; message: string; low?: string; high?: string }>;
    /** How each person's business profit is built (shared ProfitForecast shape). scheduleCProfit is derived from it. */
    forecasts?: ProfitForecast[];
  };
}

export const MANUAL_SOURCE_ID = "manual-entry";
export const FORECAST_SOURCE_ID = "derived-forecast";
export const FORECAST_EVIDENCE = { id: FORECAST_SOURCE_ID, kind: "manual" as const, label: "Business profit built from your forecast" };
export const MANUAL_EVIDENCE: Evidence = { id: MANUAL_SOURCE_ID, kind: "manual", label: "Entered by you in Headroom" };
export const CURRENT_FORECAST_TITLE = "Current forecast (no new project)";

export const INCOME_FIELDS = [
  "scheduleCProfit", "w2Box1", "socialSecurityWages", "medicareWages", "grossWages",
  "payrollPretaxDeductions", "taxableInterest", "taxExemptInterest", "existingSepContribution",
] as const;
export type IncomeField = typeof INCOME_FIELDS[number];
export const WAGE_FIELDS = ["grossWages", "payrollPretaxDeductions", "w2Box1", "socialSecurityWages", "medicareWages"] as const;
export const INTEREST_FIELDS = ["taxableInterest", "taxExemptInterest"] as const;

export const unknownFact = (sourceId = MANUAL_SOURCE_ID): MoneyFact => ({ valueCents: null, status: "unknown", sourceId });
export const confirmedZero = (sourceId = MANUAL_SOURCE_ID): MoneyFact => ({ valueCents: 0, status: "confirmed", sourceId });

export function emptyIncome(personId: string): PersonIncome {
  const row = { personId } as PersonIncome;
  for (const key of INCOME_FIELDS) row[key] = unknownFact();
  return row;
}

export function emptyCoverage(): CoverageMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, enrollmentPremium: unknownFact(), benchmarkPremium: unknownFact(), advancePtc: unknownFact(),
    ptcEligibilityConfirmed: null, sehiEligibilityConfirmed: null,
  }));
}

function emptyYear(year: 2026 | 2027): YearInput {
  return { year, taxFamilySize: 1, coveredPersonIds: ["primary"], incomes: [emptyIncome("primary")],
    coverage: emptyCoverage(), benchmarkStatus: "unknown", unsupportedFacts: [], scopeConfirmed: null };
}

/** A new profile starts with unknowns — nothing is assumed to be zero. */
export function blankDraft(): Draft {
  return {
    contractVersion: CONTRACT_VERSION, id: "my-household", title: "My household", isSynthetic: false,
    state: null, countyFips: null, filingStatus: null,
    people: [{ id: "primary", role: "primary", ageAt2026Start: null, qualifyingChildForCtc: null }],
    years: [emptyYear(2026), emptyYear(2027)],
    opportunity: { title: CURRENT_FORECAST_TITLE, ownerPersonId: "primary", grossRevenueCents: 0, incrementalExpensesCents: 0,
      expensePaymentDate: "2026-12-31", plannedReceiptDate: "2026-12-31", cashAccountingConfirmed: null, timingArrangementConfirmed: null },
    constraints: { maxAdditionalSepCents: 0, minimumDesiredCashGainCents: 0, canSplitPayment: false, canRenegotiatePrice: false,
      nextYearPaymentLatestDate: null, objective: "spendable_cash" },
    evidence: [MANUAL_EVIDENCE],
    ui: { projectStarted: false },
  };
}

export function draftFromCase(input: CaseInput): Draft {
  const copy = structuredClone(input);
  const evidence = copy.evidence.some(e => e.id === MANUAL_SOURCE_ID) ? copy.evidence : [...copy.evidence, MANUAL_EVIDENCE];
  const projectStarted = copy.opportunity.title !== CURRENT_FORECAST_TITLE;
  // Sample households state their profit WITHOUT the offered project; own files keep the question open.
  const forecasts: ProfitForecast[] = copy.years.flatMap(y => y.incomes.filter(r => r.scheduleCProfit.status !== "unknown").map(r => ({
    method: "annual_total" as const, personId: r.personId, year: y.year, excludesManagedProjects: copy.isSynthetic ? true : null, annualNetProfit: r.scheduleCProfit })));
  return { ...copy, evidence, ui: { projectStarted, ...(forecasts.length ? { forecasts } : {}) } };
}

export interface Problem { path: string; reason: string }
export type BuildResult = { ok: true; input: CaseInput } | { ok: false; problems: Problem[] };

/**
 * Converts the editing model into the shared contract. Only checks what the
 * contract itself needs to be well-formed; every financial/eligibility check
 * is left to the engine so its needs_data/unsupported answer stays authoritative.
 */
export function buildCaseInput(draft: Draft, purpose: "risk" | "comparison"): BuildResult {
  const invalid = invalidProblems(draft);
  if (invalid.length) return { ok: false, problems: invalid };
  const problems: Problem[] = [];
  if (!draft.state) problems.push({ path: "state", reason: "Choose the state you live in." });
  if (!draft.filingStatus) problems.push({ path: "filingStatus", reason: "Choose how you file your tax return." });
  draft.people.forEach((p, i) => {
    if (p.ageAt2026Start === null) problems.push({ path: `people.${i}.ageAt2026Start`, reason: `Enter ${possessive(personName(draft, p.id))} age on January 1, 2026.` });
  });
  if (purpose === "comparison") {
    const o = draft.opportunity;
    if (!draft.ui.projectStarted || o.grossRevenueCents <= 0) problems.push({ path: "opportunity.grossRevenueCents", reason: "Enter what the client will pay for the project." });
    if (!isIsoDate(o.plannedReceiptDate)) problems.push({ path: "opportunity.plannedReceiptDate", reason: "Enter when you expect to receive the payment." });
    if (!isIsoDate(o.expensePaymentDate)) problems.push({ path: "opportunity.expensePaymentDate", reason: "Enter when you will pay the project costs." });
    for (const f of draft.ui.forecasts ?? []) {
      if (f.personId === o.ownerPersonId && f.excludesManagedProjects !== true) {
        const yi = draft.years.findIndex(y => y.year === f.year);
        const ri = draft.years[yi]?.incomes.findIndex(r => r.personId === f.personId) ?? -1;
        problems.push({ path: `years.${yi}.incomes.${ri}.scheduleCProfit`, reason: `Confirm that the ${f.year} profit forecast leaves out “${o.title}”, so it isn't counted twice.` });
      }
    }
  }
  if (problems.length) return { ok: false, problems };
  const { ui: _ui, ...rest } = draft;
  void _ui;
  const candidate = { ...rest, state: draft.state, filingStatus: draft.filingStatus, people: draft.people };
  const parsed = CaseInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(issue => ({ path: issue.path.join("."), reason: issue.message })) };
  }
  return { ok: true, input: parsed.data };
}

/** Invalid typed amounts, as problems pointing at their field. */
export function invalidProblems(draft: Pick<Draft, "ui">): Problem[] {
  return Object.entries(draft.ui.invalid ?? {}).map(([key, v]) => ({ path: key.replace(/#.*$/, ""), reason: `${v.message} (you typed “${v.text}”)` }));
}

/** Drops invalid-entry markers whose field no longer exists or that match `prefix`. */
export function pruneInvalid(draft: Draft, prefix?: string) {
  const inv = draft.ui.invalid;
  if (!inv) return;
  for (const key of Object.keys(inv)) {
    const base = key.replace(/#.*$/, "");
    if (prefix && (base === prefix || base.startsWith(`${prefix}.`))) { delete inv[key]; continue; }
    // Forecast fields are addressed as ui.forecasts.<personId>.<year>.<field>; keep them while the person exists.
    const fc = /^ui\.forecasts\.([^.]+)\./.exec(base);
    if (fc ? !draft.people.some(p => p.id === fc[1]) : getAt(draft, base) === undefined) delete inv[key];
  }
}

/**
 * Validates a draft read back from browser storage. Placeholders stand in for
 * the answers a draft may leave open, so the rest is checked against the
 * shared schema; anything malformed is discarded rather than half-restored.
 */
export function restoreDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Draft;
  if (!d.ui || typeof d.ui.projectStarted !== "boolean" || !Array.isArray(d.people)) return null;
  if (d.people.some(p => p.ageAt2026Start !== null && typeof p.ageAt2026Start !== "number")) return null;
  const { ui: _ui, ...rest } = d;
  void _ui;
  const probe = { ...rest, state: d.state ?? "TX", filingStatus: d.filingStatus ?? "single",
    people: d.people.map(p => ({ ...p, ageAt2026Start: p.ageAt2026Start ?? 30 })) };
  if (!CaseInputSchema.safeParse(probe).success) return null;
  const invalid = d.ui.invalid && typeof d.ui.invalid === "object" ? Object.fromEntries(Object.entries(d.ui.invalid)
    .filter(([, v]) => v && typeof v.text === "string" && typeof v.message === "string"
      && (v.low === undefined || typeof v.low === "string") && (v.high === undefined || typeof v.high === "string"))) : undefined;
  const forecasts = Array.isArray(d.ui.forecasts) ? d.ui.forecasts.filter(f => ProfitForecastSchema.safeParse(f).success) : undefined;
  return { ...d, ui: { projectStarted: d.ui.projectStarted, ...(invalid && Object.keys(invalid).length ? { invalid } : {}), ...(forecasts?.length ? { forecasts } : {}) } };
}

function isIsoDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }

export function personName(draft: Pick<Draft, "people"> | Pick<CaseInput, "people">, personId: string): string {
  const people = draft.people as DraftPerson[];
  const person = people.find(p => p.id === personId);
  if (!person) return personId;
  if (person.role === "primary") return "You";
  if (person.role === "spouse") return "Your spouse";
  const children = people.filter(p => p.role === "dependent");
  return children.length > 1 ? `Dependent ${children.indexOf(person) + 1}` : "Your dependent";
}

/** "You" → "your", "Your spouse" → "your spouse's". */
export function possessive(name: string): string {
  return name === "You" ? "your" : `${name.charAt(0).toLowerCase()}${name.slice(1)}'s`;
}

export function adults(draft: Pick<Draft, "people">): DraftPerson[] {
  return draft.people.filter(p => p.role !== "dependent");
}

/** Keeps per-year rows aligned with the people list (never fills money with zero). */
export function syncHousehold(draft: Draft) {
  const adultIds = adults(draft).map(p => p.id);
  const ids = new Set(draft.people.map(p => p.id));
  for (const year of draft.years) {
    year.taxFamilySize = draft.people.length;
    year.incomes = adultIds.map(id => year.incomes.find(r => r.personId === id) ?? emptyIncome(id));
    year.coveredPersonIds = year.coveredPersonIds.filter(id => ids.has(id));
    if (year.coveredPersonIds.length === 0) year.coveredPersonIds = ["primary"];
  }
  if (!ids.has(draft.opportunity.ownerPersonId)) draft.opportunity.ownerPersonId = "primary";
}

/* ---------- Business-profit forecasts ---------- */

/** The person/year forecast, or a whole-year forecast seeded from the current profit fact (not stored until edited). */
export function forecastFor(draft: Pick<Draft, "ui" | "years">, personId: string, year: TaxYear): ProfitForecast {
  const found = draft.ui.forecasts?.find(f => f.personId === personId && f.year === year);
  if (found) return found;
  const row = draft.years.find(y => y.year === year)?.incomes.find(r => r.personId === personId);
  const fact = row?.scheduleCProfit ?? { valueCents: null, status: "unknown" as const, sourceId: MANUAL_SOURCE_ID };
  return { method: "annual_total", personId, year, excludesManagedProjects: null,
    annualNetProfit: fact.sourceId === FORECAST_SOURCE_ID ? { ...fact, sourceId: MANUAL_SOURCE_ID } : fact };
}

/** Stores the forecast and derives scheduleCProfit from it with the shared contract helper. */
export function setForecastInDraft(d: Draft, f: ProfitForecast) {
  const list = (d.ui.forecasts ?? []).filter(x => !(x.personId === f.personId && x.year === f.year));
  d.ui.forecasts = [...list, f];
  if (!d.evidence.some(e => e.id === FORECAST_SOURCE_ID)) d.evidence.push(FORECAST_EVIDENCE);
  const row = d.years.find(y => y.year === f.year)?.incomes.find(r => r.personId === f.personId);
  if (row) row.scheduleCProfit = forecastTotal(f, FORECAST_SOURCE_ID);
}

/* ---------- Paths ---------- */

/** "years[0].incomes[1].w2Box1" → "years.0.incomes.1.w2Box1" */
export function normalizePath(path: string): string {
  return path.replace(/\[(\w+|\*)\]/g, ".$1").replace(/^\./, "");
}

export function getAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of normalizePath(path).split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function setAt(root: unknown, path: string, value: unknown): boolean {
  const keys = normalizePath(path).split(".").filter(Boolean);
  const last = keys.pop();
  if (!last) return false;
  let node: unknown = root;
  for (const key of keys) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[key];
  }
  if (node === null || typeof node !== "object" || !(last in (node as object))) return false;
  (node as Record<string, unknown>)[last] = value;
  return true;
}

export function isMoneyFact(value: unknown): value is MoneyFact {
  return !!value && typeof value === "object" && "valueCents" in value && "status" in value && "sourceId" in value;
}

/** DOM id for a contract path, used by "Go to field" links. */
export function fieldId(path: string): string {
  return `f-${normalizePath(path).replace(/\./g, "-")}`;
}

export const FIELD_LABELS: Record<string, string> = {
  scheduleCProfit: "Business profit (Schedule C)",
  w2Box1: "W-2 taxable wages (box 1)",
  socialSecurityWages: "Social Security wages (box 3)",
  medicareWages: "Medicare wages (box 5)",
  grossWages: "Gross pay",
  payrollPretaxDeductions: "Pre-tax payroll deductions",
  taxableInterest: "Taxable interest",
  taxExemptInterest: "Tax-exempt interest",
  existingSepContribution: "SEP-IRA contribution already planned",
  enrollmentPremium: "Full monthly plan premium",
  benchmarkPremium: "Benchmark silver plan premium",
  advancePtc: "Advance credit paid to your insurer",
  ptcEligibilityConfirmed: "Eligible for the premium tax credit",
  sehiEligibilityConfirmed: "Eligible for the self-employed health insurance deduction",
  benchmarkStatus: "Source of the benchmark premium",
  coveredPersonIds: "People covered by the plan",
  taxFamilySize: "People on the tax return",
  unsupportedFacts: "Situations Headroom doesn't cover",
  scopeConfirmed: "Confirmation that no excluded situation applies",
  incomes: "Income",
  coverage: "Health coverage",
  state: "State",
  countyFips: "County",
  filingStatus: "Filing status",
  ageAt2026Start: "Age on January 1, 2026",
  qualifyingChildForCtc: "Qualifies for the child tax credit",
  title: "Project name",
  ownerPersonId: "Who does the project",
  grossRevenueCents: "Project price",
  incrementalExpensesCents: "Extra project costs",
  expensePaymentDate: "When the costs are paid",
  plannedReceiptDate: "When the payment arrives",
  cashAccountingConfirmed: "Cash-basis accounting",
  timingArrangementConfirmed: "Payment timing agreed with the client",
  maxAdditionalSepCents: "Maximum you can put into retirement",
  minimumDesiredCashGainCents: "Minimum extra cash you want",
  canSplitPayment: "Client can split the payment",
  canRenegotiatePrice: "You can negotiate the price",
  nextYearPaymentLatestDate: "Latest date for a 2027 payment",
  objective: "Your goal",
};

/** Human description of a contract path, e.g. "2026 · Your spouse · W-2 taxable wages (box 1)". */
export function describePath(path: string, input: Pick<Draft, "people" | "years"> | CaseInput): string {
  const keys = normalizePath(path).split(".").filter(Boolean);
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const next = keys[i + 1];
    if (key === "years" && next !== undefined) {
      const year = input.years[Number(next)]?.year;
      parts.push(year ? String(year) : `Year ${next}`); i++; continue;
    }
    if (key === "incomes" && next !== undefined) {
      const yearIdx = Number(keys[keys.indexOf("years") + 1]);
      const row = input.years[yearIdx]?.incomes[Number(next)];
      parts.push(row ? personName(input, row.personId) : `Person ${Number(next) + 1}`); i++; continue;
    }
    if (key === "coverage" && next === "*") { parts.push("Every month"); i++; continue; }
    if (key === "coverage" && next !== undefined && /^\d+$/.test(next)) {
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      parts.push(months[Number(next)] ?? `Month ${Number(next) + 1}`); i++; continue;
    }
    if (key === "people" && next !== undefined) {
      const person = input.people[Number(next)];
      parts.push(person ? personName(input, person.id) : `Person ${Number(next) + 1}`); i++; continue;
    }
    if (key === "opportunity") { parts.push("Project"); continue; }
    if (key === "constraints") { parts.push("Your limits"); continue; }
    if (key === "valueCents" || key === "status" || key === "range") continue;
    parts.push(FIELD_LABELS[key] ?? key);
  }
  return parts.join(" · ") || path;
}

/* ---------- Static reference lists ---------- */

export const SUPPORTED_STATES = ["TX", "FL", "TN"];
export const US_STATES: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];
export function stateName(code: string | null): string {
  if (!code) return "State not set";
  return US_STATES.find(([c]) => c === code)?.[1] ?? code;
}

/** Situations outside the first release (see ENGINE_SPEC). Stored in `unsupportedFacts`. */
export const SCOPE_EXCLUSIONS: Array<{ id: string; label: string }> = [
  { id: "multiple_businesses", label: "More than one business, or a business owned with someone else" },
  { id: "s_corp_or_partnership", label: "An S corporation, LLC taxed as a partnership, or partnership income" },
  { id: "business_employees", label: "Employees in your business (affects SEP-IRA contributions)" },
  { id: "business_loss", label: "A business loss this year" },
  { id: "itemized_deductions", label: "You itemize deductions instead of taking the standard deduction" },
  { id: "investment_income", label: "Capital gains, dividends, rental, foreign or Social Security income" },
  { id: "other_credits", label: "Earned income credit, education credits or other refundable credits" },
  { id: "other_coverage", label: "Medicaid/CHIP, Medicare, or an offer of employer health coverage for anyone covered" },
  { id: "mid_year_change", label: "Coverage, household or eligibility changes during the year" },
  { id: "dependent_of_another", label: "Anyone can be claimed as a dependent on someone else's return" },
];
