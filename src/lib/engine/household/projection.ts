/**
 * Pure household projection: one profit forecast per owner/year + managed project payments
 * + owner/year SEP records → the derived v1 CaseInput used by the existing guards and year math.
 *
 * Invariants (docs/tasks/ROUND3_SHARED.md):
 *  - one active forecast method per owner/year; both exclude managed projects, and that exclusion
 *    must be confirmed before any result is given;
 *  - year-to-date + remaining = YTD net profit + remaining receipts − remaining expenses
 *    (actual YTD expenses are already inside YTD net profit);
 *  - an actual project amount REPLACES the expected amount of the same item (never added);
 *  - agreed projects' expected items count, proposed ones only in a what-if, cancelled expected
 *    items never; actual amounts count even if the project was later cancelled;
 *  - ranges add with signs: low = low receipts − high expenses, high = high receipts − low expenses;
 *  - SEP belongs to owner + tax year: planned total = max(target, actually paid), remaining =
 *    max(0, target − paid); lowering a target never "refunds" a paid contribution;
 *  - unknown never becomes zero; duplicates with the same id are idempotent only if identical.
 */
import type { CaseInput, MoneyFact, TaxYear, TraceItem } from "@/domain/contracts";
import { Issues } from "../guard";
import { formatUsd } from "../money";
import type { HouseholdEngineInput, Project, ProjectItem, ProfitForecast, SepContribution } from "./types";

export const DERIVED_SOURCE_ID = "headroom-household-projection";
const YEARS: TaxYear[] = [2026, 2027];

export interface ProfitComponent {
  id: string;
  label: string;
  source: "annual_total" | "ytd_net_profit" | "remaining_receipts" | "remaining_expenses" | "project_receipt" | "project_expense";
  basis: "forecast" | "actual" | "expected";
  projectId: string | null;
  itemId: string | null;
  date: string | null;
  /** Signed effect on business profit (expenses negative). */
  cents: number;
  lowCents: number;
  highCents: number;
  status: "confirmed" | "estimated";
  sourceIds: string[];
}

export interface YearSep {
  targetCents: number | null;
  paidCents: number;
  /** SEP-IRA total used in the calculation: max(target, paid). */
  plannedTotalCents: number;
  /** Agreed but not yet paid: max(0, target − paid). */
  remainingCents: number;
  contributionIds: string[];
}

export interface YearProjection {
  year: TaxYear;
  method: ProfitForecast["method"];
  asOfDate: string | null;
  components: ProfitComponent[];
  profitCents: number;
  lowCents: number;
  highCents: number;
  status: "confirmed" | "estimated";
  sep: YearSep;
}

export interface HouseholdProjection {
  ownerPersonId: string;
  years: YearProjection[];
  /** Managed-project items counted, by item id → basis. */
  counted: Record<string, "actual" | "expected">;
  sepBudget: { budgetCents: number | null; reservedCents: number; availableCents: number | null };
  derivedInput: CaseInput;
  warnings: string[];
}

export interface ProjectionOptions {
  /** Tax-year indexes to project (2026 = 0). */
  years: Array<0 | 1>;
  /** Leave this project's NOT-yet-actual items out (editing it, or evaluating it as a candidate). */
  excludeProjectId?: string;
  /** Also count this PROPOSED project's expected items (what-if). */
  includeProposedId?: string;
  /** Only what already happened: actual project amounts and SEP contributions actually paid. */
  factsOnly?: boolean;
}

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x);

/** Records with the same id must be identical (idempotent re-import); otherwise the conflict needs review. */
function dedupe<T extends { id: string }>(records: T[], path: string, what: string, issues: Issues, warnings: string[]): T[] {
  const seen = new Map<string, T>();
  records.forEach((r, i) => {
    const prev = seen.get(r.id);
    if (!prev) { seen.set(r.id, r); return; }
    if (canonical(prev) === canonical(r)) warnings.push(`A repeated ${what} record (${r.id}) was counted once.`);
    else issues.need("DUPLICATE_RECORD", `${path}[${i}].id`, `Two different ${what} records share the id "${r.id}". Choose which one is correct; they are not merged automatically.`);
  });
  return [...seen.values()];
}

const yearOf = (date: string) => Number(date.slice(0, 4));
const factStatus = (f: MoneyFact): "confirmed" | "estimated" => (f.status === "confirmed" ? "confirmed" : "estimated");
const lowOf = (f: MoneyFact) => f.range?.lowCents ?? f.valueCents!;
const highOf = (f: MoneyFact) => f.range?.highCents ?? f.valueCents!;

/** Which managed-project items count, and with which basis. */
export function countedBasis(project: Project, item: ProjectItem, opts: Pick<ProjectionOptions, "excludeProjectId" | "includeProposedId" | "factsOnly">): "actual" | "expected" | null {
  if (item.actual) return "actual";
  if (opts.factsOnly) return null;
  if (!item.expected || item.cancelled || project.status === "cancelled") return null;
  if (project.id === opts.excludeProjectId) return null;
  if (project.status === "agreed") return "expected";
  return project.id === opts.includeProposedId ? "expected" : null;
}

export function projectHousehold(input: HouseholdEngineInput, issues: Issues, opts: ProjectionOptions): HouseholdProjection | null {
  const before = issues.count;
  const warnings: string[] = [];
  const h = input.household;
  const owner = h.opportunity.ownerPersonId;
  const personIds = new Set(h.people.map(p => p.id));
  const evidence = new Set(h.evidence.map(e => e.id));
  const source = (id: string, path: string) => { if (!evidence.has(id)) issues.need("SOURCE_MISSING", path, `The source reference "${id}" is missing from the household's evidence list.`); };

  const projects = dedupe(input.projects, "projects", "project", issues, warnings);
  const contributions = dedupe(input.sepContributions, "sepContributions", "SEP-IRA contribution", issues, warnings);
  const itemIds = new Map<string, string>();
  projects.forEach(p => {
    const path = `projects[${input.projects.indexOf(p)}]`;
    if (p.ownerPersonId !== owner) {
      issues.bad("MULTIPLE_BUSINESSES", `${path}.ownerPersonId`, `"${p.title}" belongs to someone other than the business owner; only one sole-proprietor business is supported.`);
    }
    p.items.forEach((item, ii) => {
      const ip = `${path}.items[${ii}]`;
      const other = itemIds.get(item.id);
      if (other && other !== p.id) issues.need("DUPLICATE_RECORD", `${ip}.id`, `Payment or expense id "${item.id}" is used by two projects.`);
      itemIds.set(item.id, p.id);
      if (!item.expected && !item.actual) issues.need("ITEM_EMPTY", ip, `A ${item.kind} of "${p.title}" has neither an expected nor an actual amount.`);
      source(item.sourceId, `${ip}.sourceId`);
      if (item.actual) source(item.actual.sourceId, `${ip}.actual.sourceId`);
      for (const d of [item.expected?.date, item.actual?.date]) {
        if (d && !YEARS.includes(yearOf(d) as TaxYear)) issues.bad("OUTSIDE_YEARS", ip, `A ${item.kind} of "${p.title}" dated ${d} is outside 2026–2027.`);
      }
    });
  });

  // ------------------------------------------------------------------ SEP --
  contributions.forEach(c => {
    const i = input.sepContributions.indexOf(c);
    if (c.personId !== owner) issues.bad("SEP_NON_OWNER", `sepContributions[${i}].personId`, "Only the business owner's SEP-IRA is modeled.");
    source(c.sourceId, `sepContributions[${i}].sourceId`);
    const latest = `${c.taxYear + 1}-10-15`;
    if (c.paidDate < `${c.taxYear}-01-01` || c.paidDate > latest) {
      issues.need("SEP_DATE", `sepContributions[${i}].paidDate`, `A contribution for ${c.taxYear} paid on ${c.paidDate} is outside that year's contribution period (through the extended return due date, at the latest ${latest}). Check the tax year.`);
    }
  });
  const targetKeys = new Set<string>();
  input.sepTargets.forEach((t, i) => {
    const key = `${t.personId}.${t.taxYear}`;
    if (targetKeys.has(key)) issues.need("DUPLICATE_RECORD", `sepTargets[${i}]`, `There are two SEP-IRA targets for ${t.taxYear}; keep one.`);
    targetKeys.add(key);
    if (t.personId !== owner) issues.bad("SEP_NON_OWNER", `sepTargets[${i}].personId`, "Only the business owner's SEP-IRA is modeled.");
  });
  const sepFor = (year: TaxYear): YearSep => {
    const mine = contributions.filter(c => c.taxYear === year && c.personId === owner);
    const paidCents = mine.reduce((a, c) => a + c.amountCents, 0);
    const target = input.sepTargets.find(t => t.taxYear === year && t.personId === owner)?.targetCents ?? null;
    if (target !== null && target < paidCents && !opts.factsOnly) {
      warnings.push(`The ${year} SEP-IRA target (${formatUsd(target)}) is below what was already contributed (${formatUsd(paidCents)}); the paid amount stays in the calculation. Removing an excess contribution is a separate step with your plan provider.`);
    }
    if (opts.factsOnly) return { targetCents: target, paidCents, plannedTotalCents: paidCents, remainingCents: 0, contributionIds: mine.map(c => c.id).sort() };
    return { targetCents: target, paidCents, plannedTotalCents: Math.max(target ?? 0, paidCents), remainingCents: Math.max(0, (target ?? 0) - paidCents),
      contributionIds: mine.map(c => c.id).sort() };
  };

  // ------------------------------------------------------------- forecasts --
  input.forecasts.forEach((f, i) => {
    if (!personIds.has(f.personId)) issues.need("FORECAST_PERSON", `forecasts[${i}].personId`, "This forecast refers to a person who is not in the household.");
    else if (f.personId !== owner) {
      const zero = f.method === "annual_total" ? f.netProfit.valueCents === 0 : false;
      if (!zero) issues.bad("MULTIPLE_BUSINESSES", `forecasts[${i}]`, "Business profit for a second person is not supported; only one sole-proprietor business is modeled.");
    }
    if (input.forecasts.findIndex(g => g.personId === f.personId && g.year === f.year) !== i) {
      issues.need("FORECAST_CONFLICT", `forecasts[${i}].method`, `There are two active ${f.year} profit forecasts. Choose either the annual total or year-to-date plus remaining; they are never added together.`);
    }
  });

  const counted: Record<string, "actual" | "expected"> = {};
  const years: YearProjection[] = [];
  for (const yi of opts.years) {
    const year = YEARS[yi];
    const fi = input.forecasts.findIndex(f => f.personId === owner && f.year === year);
    const base = `forecasts[${fi}]`;
    if (fi < 0) { issues.need("FORECAST_MISSING", "forecasts", `Add a ${year} business profit forecast (annual total, or year-to-date plus the rest of the year). A missing forecast is not $0.`); continue; }
    const f = input.forecasts[fi];
    const components: ProfitComponent[] = [];
    const add = (id: string, label: string, src: ProfitComponent["source"], fact: MoneyFact, sign: 1 | -1, path: string) => {
      if (fact.status === "unknown" || fact.valueCents === null) { issues.need("FACT_UNKNOWN", path, `${label} for ${year} is unknown. Enter it or an estimate; it is not treated as $0.`); return; }
      source(fact.sourceId, `${path}.sourceId`);
      if (fact.valueCents < 0 && src !== "ytd_net_profit") issues.need("NEGATIVE", path, `${label} cannot be negative.`);
      const lo = sign > 0 ? lowOf(fact) : -highOf(fact), hi = sign > 0 ? highOf(fact) : -lowOf(fact);
      components.push({ id, label, source: src, basis: "forecast", projectId: null, itemId: null, date: null, cents: sign * fact.valueCents,
        lowCents: lo, highCents: hi, status: factStatus(fact), sourceIds: [fact.sourceId] });
    };
    let asOfDate: string | null = null;
    if (f.method === "annual_total") {
      add("annual_total", "Annual business profit forecast (without managed projects)", "annual_total", f.netProfit, 1, `${base}.netProfit`);
    } else {
      asOfDate = f.asOfDate;
      if (!asOfDate) issues.need("AS_OF_MISSING", `${base}.asOfDate`, `Enter the date your ${year} year-to-date profit runs through.`);
      else if (yearOf(asOfDate) !== year || asOfDate >= `${year}-12-31`) {
        issues.need("AS_OF_OUTSIDE", `${base}.asOfDate`, `The as-of date ${asOfDate} must fall inside ${year} and before December 31, so the remaining part of the year is after it.`);
      }
      add("ytd_net_profit", `Net profit through ${asOfDate ?? "the as-of date"} (actual; expenses to date already deducted)`, "ytd_net_profit", f.ytdNetProfit, 1, `${base}.ytdNetProfit`);
      add("remaining_receipts", "Expected receipts for the rest of the year (without managed projects)", "remaining_receipts", f.remainingReceipts, 1, `${base}.remainingReceipts`);
      add("remaining_expenses", "Expected deductible expenses for the rest of the year (without managed projects)", "remaining_expenses", f.remainingExpenses, -1, `${base}.remainingExpenses`);
    }

    // Managed projects: an actual replaces the expected amount of the same item.
    let projectItemsThisYear = false;
    for (const p of projects) {
      p.items.forEach((item, ii) => {
        const dates = [item.expected?.date, item.actual?.date].filter(Boolean) as string[];
        if (dates.some(d => yearOf(d) === year)) projectItemsThisYear = true;
        const basis = countedBasis(p, item, opts);
        if (!basis) return;
        const amount = basis === "actual" ? item.actual!.amountCents : item.expected!.amountCents;
        const date = basis === "actual" ? item.actual!.date : item.expected!.date;
        if (yearOf(date) !== year) return;
        if (basis === "expected" && asOfDate && date <= asOfDate && p.id !== opts.includeProposedId && p.id !== opts.excludeProjectId) {
          issues.need("PAYMENT_STATUS_UNKNOWN", `projects[${input.projects.indexOf(p)}].items[${ii}].actual`,
            `"${p.title}": the ${item.kind} expected on ${date} is on or before your as-of date. Record whether and how much was actually ${item.kind === "receipt" ? "received" : "paid"}.`);
        }
        counted[item.id] = basis;
        const sign = item.kind === "receipt" ? 1 : -1;
        const replaced = basis === "actual" && item.expected && (item.expected.amountCents !== amount || item.expected.date !== date)
          ? ` (replaces the expected ${formatUsd(item.expected.amountCents)} on ${item.expected.date})` : "";
        components.push({ id: `project.${p.id}.${item.id}`, label: `"${p.title}" ${item.kind} ${basis === "actual" ? (item.kind === "receipt" ? "received" : "paid") : "expected"} ${date}${replaced}`,
          source: item.kind === "receipt" ? "project_receipt" : "project_expense", basis, projectId: p.id, itemId: item.id, date,
          cents: sign * amount, lowCents: sign * amount, highCents: sign * amount, status: basis === "actual" ? "confirmed" : "estimated",
          sourceIds: [basis === "actual" ? item.actual!.sourceId : item.sourceId] });
      });
    }
    if (projectItemsThisYear && f.projectsExcluded !== true) {
      issues.need(f.projectsExcluded === null ? "PROJECT_INCLUSION_UNCONFIRMED" : "PROJECTS_INCLUDED", `${base}.projectsExcluded`,
        f.projectsExcluded === null
          ? `Confirm that your ${year} forecast leaves out the projects managed in this plan; otherwise they would be counted twice.`
          : `Your ${year} forecast includes managed projects. Enter the forecast without them (the projects' own payments are added separately), so nothing is counted twice.`);
    }
    const profitCents = components.reduce((a, c) => a + c.cents, 0);
    const lowCents = components.reduce((a, c) => a + c.lowCents, 0);
    const highCents = components.reduce((a, c) => a + c.highCents, 0);
    years.push({ year, method: f.method, asOfDate, components, profitCents, lowCents, highCents,
      status: components.every(c => c.status === "confirmed") ? "confirmed" : "estimated", sep: sepFor(year) });
  }

  // Owner's v1 fields are derived, never a second independent total.
  for (const yi of opts.years) {
    const row = h.years[yi].incomes.find(r => r.personId === owner);
    if (!row) continue;                                           // the v1 guard reports the missing row
    const r = h.years[yi].incomes.indexOf(row);
    if (row.scheduleCProfit.status !== "unknown") {
      issues.need("PROFIT_NOT_DERIVED", `household.years[${yi}].incomes[${r}].scheduleCProfit`,
        "Business profit in this plan comes from the forecast and project payments. Leave the separate profit total empty so it cannot be counted twice.");
    }
    if (row.existingSepContribution.status !== "unknown" && row.existingSepContribution.valueCents !== 0) {
      issues.need("SEP_MIGRATION", `household.years[${yi}].incomes[${r}].existingSepContribution`,
        "Record SEP-IRA contributions as paid amounts with dates, and the agreed yearly target separately. An older planned amount is not treated as paid.");
    }
  }

  if (issues.count > before) return null;

  const reservedCents = opts.factsOnly ? 0 : YEARS.reduce((a, y) => a + sepFor(y).remainingCents, 0);
  const sepBudget = { budgetCents: input.futureSepBudgetCents, reservedCents,
    availableCents: input.futureSepBudgetCents === null ? null : input.futureSepBudgetCents - reservedCents };

  // Derived v1 input: the existing guards and year calculations run unchanged on it.
  const derived: CaseInput = structuredClone(h);
  if (!derived.evidence.some(e => e.id === DERIVED_SOURCE_ID)) {
    derived.evidence.push({ id: DERIVED_SOURCE_ID, kind: "manual", label: "Derived by Headroom from your profit forecast, project payments and SEP-IRA records" });
  }
  for (const yp of years) {
    const yi = YEARS.indexOf(yp.year);
    const row = derived.years[yi].incomes.find(r => r.personId === owner);
    if (!row) continue;
    row.scheduleCProfit = { valueCents: yp.profitCents, status: yp.status, sourceId: DERIVED_SOURCE_ID,
      ...(yp.lowCents !== yp.highCents ? { range: { lowCents: yp.lowCents, highCents: yp.highCents } } : {}) };
    row.existingSepContribution = { valueCents: yp.sep.plannedTotalCents, status: "confirmed", sourceId: DERIVED_SOURCE_ID };
  }
  derived.opportunity = { ...derived.opportunity, title: "Current household forecast", grossRevenueCents: 0, incrementalExpensesCents: 0 };
  return { ownerPersonId: owner, years, counted, sepBudget, derivedInput: derived, warnings: [...new Set(warnings)] };
}

/** Trace lines that show where each year's business profit and SEP total come from. */
export function projectionTrace(p: HouseholdProjection, year: TaxYear): TraceItem[] {
  const yp = p.years.find(y => y.year === year);
  if (!yp) return [];
  const items: TraceItem[] = yp.components.map(c => ({
    id: `${year}.profit_source.${c.id}`, label: `${c.label} (${year})`, amountCents: c.cents,
    inputPaths: c.projectId ? [`projects[id=${c.projectId}].items[id=${c.itemId}]`] : [`forecasts[${year}].${c.source}`],
    sourceIds: c.sourceIds,
    explanation: c.basis === "actual" ? "Actual amount; it replaces the expected amount for this payment." :
      c.basis === "expected" ? "Expected amount of an agreed (or the evaluated) project; replaced by the actual amount once recorded." :
        c.lowCents !== c.highCents ? `Range ${formatUsd(c.lowCents)} to ${formatUsd(c.highCents)} (signed effect on profit).` : "Forecast amount.",
  }));
  items.push({ id: `${year}.profit_source.total`, label: `Business profit used for ${year}`, amountCents: yp.profitCents, inputPaths: [], sourceIds: [DERIVED_SOURCE_ID],
    explanation: `${yp.method === "annual_total" ? "Annual forecast" : `Year-to-date profit through ${yp.asOfDate} plus the rest of the year`} plus managed projects, each counted once.` +
      (yp.lowCents !== yp.highCents ? ` Range ${formatUsd(yp.lowCents)} to ${formatUsd(yp.highCents)}: low receipts with high expenses, and high receipts with low expenses.` : "") });
  items.push({ id: `${year}.sep_records`, label: `SEP-IRA for ${year}: agreed target and paid`, amountCents: yp.sep.plannedTotalCents, inputPaths: ["sepTargets", "sepContributions"],
    sourceIds: ["irs-pub-560"],
    explanation: `Target ${yp.sep.targetCents === null ? "not set" : formatUsd(yp.sep.targetCents)}; paid ${formatUsd(yp.sep.paidCents)} (${yp.sep.contributionIds.length} contribution${yp.sep.contributionIds.length === 1 ? "" : "s"}); still to pay ${formatUsd(yp.sep.remainingCents)}. Retirement money, not spendable cash.` });
  return items;
}

export type { SepContribution };
