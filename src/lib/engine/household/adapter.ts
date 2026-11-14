/**
 * Shared workspace (Claude 3 contract, src/domain/household-workspace.ts) → household engine input.
 *
 * Follows the contract semantics with three deliberate engine-side differences, reported in
 * docs/handoffs/claude2-round3.md so the contract adapter can be aligned (not forked):
 *  1. a candidate's lines that were ALREADY received stay in the baseline and are never part of the
 *     re-timed/re-priced offer (ROUND3_SHARED §2: received money cannot be moved by the optimizer);
 *  2. the budget for NEW SEP contributions is the set-aside amount minus agreed contributions not yet
 *     paid (ROUND3_SHARED §3), not the whole set-aside amount;
 *  3. "forecast excludes managed projects" must be confirmed whenever ANY project (also a proposed
 *     candidate) has a payment in that year, because a forecast that already contains B would count B twice.
 */
import type { CaseInput, MoneyFact } from "@/domain/contracts";
import { CONTRACT_VERSION } from "@/domain/contracts";
import { combineFacts, forecastFacts, remainingSepCash, type HouseholdWorkspace } from "@/domain/household-workspace";
import { DERIVED_SOURCE_ID } from "./projection";
import { HOUSEHOLD_ENGINE_INPUT_VERSION, type HouseholdEngineInput, type ProjectItem } from "./types";

export const OTHER_PROFIT_SOURCE = "derived-other-profit";

export interface AdaptedWorkspace {
  input: HouseholdEngineInput;
  ownerPersonId: string;
  /** Engine path → workspace path, for blocked results. */
  translatePath(path: string): string;
}

/** The single business owner: the candidate's / projects' owner, else the person with a non-zero forecast, else the primary. */
export function businessOwner(ws: HouseholdWorkspace, candidateProjectId?: string): string {
  const candidate = ws.projects.find(p => p.id === candidateProjectId);
  if (candidate) return candidate.ownerPersonId;
  if (ws.projects.length) return ws.projects[0].ownerPersonId;
  const withProfit = ws.forecasts.find(f => forecastFacts(f).some(x => x.fact.valueCents !== 0));
  return withProfit?.personId ?? ws.household.people.find(p => p.role === "primary")?.id ?? ws.household.people[0].id;
}

export function workspaceToEngineInput(ws: HouseholdWorkspace, candidateProjectId?: string): AdaptedWorkspace {
  const owner = businessOwner(ws, candidateProjectId);
  const evidence = [...ws.evidence];
  if (!evidence.some(e => e.id === OTHER_PROFIT_SOURCE)) {
    evidence.push({ id: OTHER_PROFIT_SOURCE, kind: "manual", label: "Business profit of a household member without a business, from their forecast" });
  }
  const zero = (sourceId: string): MoneyFact => ({ valueCents: 0, status: "confirmed", sourceId });
  const unknown: MoneyFact = { valueCents: null, status: "unknown", sourceId: DERIVED_SOURCE_ID };
  if (!evidence.some(e => e.id === DERIVED_SOURCE_ID)) {
    evidence.push({ id: DERIVED_SOURCE_ID, kind: "manual", label: "Derived by Headroom from your profit forecast, project payments and SEP-IRA records" });
  }

  const years = ws.household.years.map(hy => ({
    year: hy.year, taxFamilySize: hy.taxFamilySize, coveredPersonIds: hy.coveredPersonIds, coverage: hy.coverage,
    benchmarkStatus: hy.benchmarkStatus, unsupportedFacts: hy.unsupportedFacts, scopeConfirmed: hy.scopeConfirmed,
    incomes: hy.otherIncomes.map(other => {
      if (other.personId === owner) return { ...other, scheduleCProfit: unknown, existingSepContribution: zero(DERIVED_SOURCE_ID) };
      // Other household members: their own forecast (must be $0 — one business only); none → unknown (dependents: $0).
      const f = ws.forecasts.find(x => x.personId === other.personId && x.year === hy.year);
      const role = ws.household.people.find(p => p.id === other.personId)?.role;
      const profit: MoneyFact = f ? combineFacts(forecastFacts(f), OTHER_PROFIT_SOURCE)
        : role === "dependent" ? zero(OTHER_PROFIT_SOURCE) : { valueCents: null, status: "unknown", sourceId: OTHER_PROFIT_SOURCE };
      return { ...other, scheduleCProfit: profit, existingSepContribution: zero(OTHER_PROFIT_SOURCE) };
    }),
  })) as CaseInput["years"];

  const budget = remainingSepCash(ws);
  const household: CaseInput = {
    contractVersion: CONTRACT_VERSION, id: ws.household.caseId, title: ws.household.title, isSynthetic: ws.household.isSynthetic,
    state: ws.household.state, countyFips: ws.household.countyFips, filingStatus: ws.household.filingStatus, people: ws.household.people,
    years,
    opportunity: { title: "Current forecast (no new project)", ownerPersonId: owner, grossRevenueCents: 0, incrementalExpensesCents: 0,
      plannedReceiptDate: "2026-12-31", expensePaymentDate: "2026-12-31", cashAccountingConfirmed: true, timingArrangementConfirmed: true },
    constraints: { maxAdditionalSepCents: budget ?? 0, minimumDesiredCashGainCents: ws.planning.minimumDesiredCashGainCents,
      canSplitPayment: false, canRenegotiatePrice: false, nextYearPaymentLatestDate: null, objective: ws.planning.objective },
    evidence,
  };

  const itemPath = new Map<string, string>();
  const projects = ws.projects.map((p, pi) => {
    const items: ProjectItem[] = [];
    (["receipts", "expenses"] as const).forEach(kind => p[kind].forEach((line, li) => {
      itemPath.set(`projects[${pi}].items[${items.length}]`, `projects[${pi}].${kind}[${li}]`);
      items.push({ id: line.id, kind: kind === "receipts" ? "receipt" : "expense", expected: line.expected,
        actual: line.actual ? { amountCents: line.actual.amountCents, date: line.actual.date, sourceId: line.actual.sourceId } : null,
        cancelled: line.cancelledAt !== null, sourceId: line.sourceId });
    }));
    return { id: p.id, ownerPersonId: p.ownerPersonId, title: p.title, status: p.status, items };
  });

  const input: HouseholdEngineInput = {
    engineInputVersion: HOUSEHOLD_ENGINE_INPUT_VERSION,
    household,
    forecasts: ws.forecasts.map(f => f.method === "annual_total"
      ? { method: "annual_total" as const, personId: f.personId, year: f.year, netProfit: f.annualNetProfit, projectsExcluded: f.excludesManagedProjects }
      : { method: "year_to_date_plus_remaining" as const, personId: f.personId, year: f.year, asOfDate: f.asOfConfirmed ? f.asOfDate : null,
        ytdNetProfit: f.ytdNetProfit, remainingReceipts: f.remainingReceipts, remainingExpenses: f.remainingExpenses, projectsExcluded: f.excludesManagedProjects }),
    projects,
    sepContributions: ws.retirement.contributions.map(c => ({ id: c.id, personId: c.personId, taxYear: c.taxYear, amountCents: c.amountCents, paidDate: c.paidDate, sourceId: c.sourceId })),
    sepTargets: ws.retirement.targets.map(t => ({ personId: t.personId, taxYear: t.year, targetCents: t.targetCents })),
    futureSepBudgetCents: budget,
  };

  const translatePath = (path: string): string => {
    let out = path;
    const item = /^projects\[(\d+)\]\.items\[(\d+)\]/.exec(out);
    if (item) out = (itemPath.get(item[0]) ?? item[0]) + out.slice(item[0].length);
    out = out.replace(/^(forecasts\[\d+\])\.netProfit/, "$1.annualNetProfit").replace(/^(forecasts\[\d+\])\.projectsExcluded/, "$1.excludesManagedProjects")
      .replace(/^sepContributions/, "retirement.contributions").replace(/^sepTargets/, "retirement.targets")
      .replace(/^household\.years\[(\d)\]\.incomes/, "household.years[$1].otherIncomes")
      .replace(/^years\[(\d)\]\.incomes/, "household.years[$1].otherIncomes")
      .replace(/^years\[(\d)\]/, "household.years[$1]")
      .replace(/^(people|state|filingStatus|countyFips)/, "household.$1");
    const otherProfit = /^household\.years\[(\d)\]\.otherIncomes\[(\d+)\]\.scheduleCProfit/.exec(out);
    if (otherProfit) {
      const person = ws.household.years[Number(otherProfit[1])].otherIncomes[Number(otherProfit[2])]?.personId;
      out = `forecasts[${person}:${2026 + Number(otherProfit[1])}]`;
    }
    if (out.startsWith("opportunity.") && candidateProjectId) out = `projects[${ws.projects.findIndex(p => p.id === candidateProjectId)}].${out.slice(12)}`;
    if (out.startsWith("constraints.")) out = "retirement.futureContributionBudget";
    return out;
  };
  return { input, ownerPersonId: owner, translatePath };
}
