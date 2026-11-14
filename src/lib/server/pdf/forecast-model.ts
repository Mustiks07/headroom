import type { MoneyFact, RiskAssessment, TaxYear } from "@/domain/contracts";
import {
  effectiveLine, forecastFacts, sepPosition, workspaceToCaseInput, type HouseholdWorkspace, type ProjectLine,
} from "@/domain/household-workspace";
import { resolveSource } from "@/domain/sources";
import { money, type Block, type ReportModel } from "./report-model";

const signed = (cents: number) => `${cents < 0 ? "-" : ""}${money(Math.abs(cents))}`;
const factText = (f: MoneyFact) => f.status === "unknown" || f.valueCents === null ? "Unknown" : money(f.valueCents);
/** Status plus the declared uncertainty range (kept out of the narrow amount column). */
const basisText = (f: MoneyFact) => `${STATUS_LABEL[f.status]}${f.range ? `, range ${money(f.range.lowCents)} to ${money(f.range.highCents)}` : ""}`;
const FIELD_LABEL: Record<string, string> = {
  annualNetProfit: "Full-year net profit forecast (excluding projects listed below)",
  ytdNetProfit: "Net profit so far this year (already after this year's expenses)",
  remainingReceipts: "Expected receipts for the rest of the year (excluding listed projects)",
  remainingExpenses: "Expected deductible expenses for the rest of the year",
};
const STATUS_LABEL: Record<string, string> = { confirmed: "Confirmed fact", estimated: "Estimate", unknown: "Missing" };

export interface ForecastReportInput {
  ws: HouseholdWorkspace;
  year: TaxYear;
  risk: RiskAssessment | null;
  fingerprint: string;
  engineVersion: string;
  rulesVersion: string;
  generatedAt: Date;
}

/**
 * "Annual income forecast explanation": how the year's self-employment profit forecast was built
 * (facts vs estimates, managed projects, SEP, sources, missing data) plus the subsidy position the
 * engine computed on it. Built only from the validated workspace and a fresh engine result.
 */
export function buildForecastModel({ ws, year, risk, fingerprint, engineVersion, rulesVersion, generatedAt }: ForecastReportInput): ReportModel {
  const yi = year === 2026 ? 0 : 1;
  const adapter = workspaceToCaseInput(ws);
  const name = (personId: string) => {
    const p = ws.household.people.find(x => x.id === personId);
    return p?.role === "primary" ? "You" : p?.role === "spouse" ? "Your spouse" : personId;
  };
  const sourceLabel = (id: string) => resolveSource(adapter.input, id)?.label ?? id;
  const usedSources = new Set<string>();
  const asOfDates = ws.forecasts.filter(f => f.year === year && f.method === "year_to_date_plus_remaining")
    .map(f => (f as { asOfDate: string }).asOfDate).sort();
  const blocks: Block[] = [];

  blocks.push({ type: "paragraph", tone: "notice", text:
    "This explains how the annual self-employment profit forecast below was built from the facts and estimates entered in Headroom. " +
    "It is a planning explanation: not a complete self-employment ledger, not an official form, and not a Marketplace eligibility decision. " +
    "Headroom does not send anything to HealthCare.gov; if you report an income estimate there, use your own judgment and records." +
    (ws.household.isSynthetic ? " This explanation uses a SYNTHETIC example household, not a real person's records." : "") });
  blocks.push({ type: "keyValues", rows: [
    ["Household / tax year", `${ws.household.title} / ${year}`],
    ["Forecast as of", asOfDates.length ? asOfDates.join(", ") : `${ws.updatedAt.slice(0, 10)} (date the plan was last updated; full-year figures)`],
    ["Generated", `${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Plan revision", ws.revision > 0 ? String(ws.revision) : "Not saved yet"],
    ["Engine version / rules version", `${engineVersion} / ${rulesVersion}`],
    ["Forecast fingerprint", fingerprint],
  ] });

  blocks.push({ type: "heading", text: `How the ${year} profit forecast was built` });
  const people = ws.household.years[yi].otherIncomes.map(i => i.personId);
  for (const personId of people) {
    const derived = adapter.input.years[yi].incomes.find(i => i.personId === personId)!.scheduleCProfit;
    const forecast = ws.forecasts.find(f => f.personId === personId && f.year === year);
    const rows: string[][] = [];
    if (forecast) {
      for (const part of forecastFacts(forecast)) {
        usedSources.add(part.fact.sourceId);
        rows.push([FIELD_LABEL[part.key] ?? part.key, basisText(part.fact),
          part.fact.valueCents === null ? "Unknown" : `${part.sign < 0 ? "minus " : ""}${factText(part.fact)}`, sourceLabel(part.fact.sourceId)]);
      }
    } else {
      rows.push(["No forecast entered", "Missing", "Unknown", "-"]);
    }
    for (const project of ws.projects.filter(p => p.ownerPersonId === personId && p.status !== "proposed")) {
      const lineRows = (lines: ProjectLine[], sign: 1 | -1, noun: string) => lines.forEach(l => {
        const e = effectiveLine(l);
        if (!e.date?.startsWith(`${year}-`) || e.basis === "cancelled" || (project.status === "cancelled" && e.basis !== "actual")) return;
        const src = e.basis === "actual" ? l.actual!.sourceId : l.sourceId;
        usedSources.add(src);
        rows.push([`${project.title}: ${l.label ?? noun} (${e.basis === "actual" ? "received" : "expected"} ${e.date})`,
          e.basis === "actual" ? "Confirmed fact" : "Estimate", `${sign < 0 ? "minus " : ""}${money(e.amountCents)}`, sourceLabel(src)]);
      });
      lineRows(project.receipts, 1, "payment");
      lineRows(project.expenses, -1, "expense");
    }
    rows.push([`Forecast net profit used for ${year}`, basisText(derived), factText(derived), "Derived in Headroom"]);
    blocks.push({ type: "paragraph", text: `${name(personId)}${forecast ? ` — method: ${forecast.method === "annual_total" ? "full-year total" : "year to date plus the rest of the year"}` : ""}${forecast && forecast.excludesManagedProjects !== true ? " — not yet confirmed that the entered amounts exclude the listed projects" : ""}` });
    blocks.push({ type: "table", columns: [{ title: "Part of the forecast", width: 0.36 }, { title: "Basis", width: 0.21 },
      { title: "Amount", width: 0.17, align: "right" }, { title: "Source", width: 0.26 }], rows });
  }
  blocks.push({ type: "paragraph", tone: "muted", text: "Actual payments replace the expected amount of the same payment; they are never added on top. Proposed (not yet agreed) projects are not included. Received payments stay included even if a project was cancelled." });

  blocks.push({ type: "heading", text: `${year} subsidy position on this forecast` });
  if (year !== 2026) {
    blocks.push({ type: "paragraph", text: "The current-year subsidy check covers 2026. 2027 effects are part of the two-year comparison in Headroom." });
  } else if (risk?.status === "ready") {
    const r = risk.risk;
    blocks.push({ type: "keyValues", rows: [
      ["Household income for the subsidy (ACA MAGI), forecast", money(r.forecastMagiCents)],
      ["Income limit for this household (400% of the poverty line)", money(r.thresholdMagiCents)],
      ["Estimated premium tax credit for the year", money(r.subsidyCents)],
      ["Expected settlement when filing", r.advanceSettlementCents > 0 ? `Repay ${money(r.advanceSettlementCents)}` : r.advanceSettlementCents < 0 ? `Additional credit ${money(-r.advanceSettlementCents)}` : "None"],
      ["Additional business profit before the credit is lost", r.additionalProfitHeadroomCents === null ? "Not applicable" : money(r.additionalProfitHeadroomCents)],
      ["Status", r.state.replace(/_/g, " ")],
    ] });
  } else {
    blocks.push({ type: "paragraph", text: `Not calculated: ${risk ? risk.message : "the forecast is incomplete."}` });
  }

  const managed = ws.projects;
  if (managed.length) {
    blocks.push({ type: "heading", text: "Projects in this plan" });
    blocks.push({ type: "table", columns: [{ title: "Project", width: 0.34 }, { title: "Status", width: 0.14 }, { title: "Received", width: 0.17, align: "right" },
      { title: "Still expected", width: 0.17, align: "right" }, { title: "Cancelled", width: 0.18, align: "right" }],
    rows: managed.map(p => {
      let received = 0, expected = 0, cancelled = 0;
      for (const l of p.receipts) {
        const e = effectiveLine(l);
        if (e.basis === "actual") received += e.amountCents;
        else if (e.basis === "expected" && p.status !== "cancelled") expected += e.amountCents;
        else cancelled += l.expected?.amountCents ?? 0;
      }
      return [p.title, p.status === "proposed" ? "Offer only (not included)" : p.status, money(received), money(expected), money(cancelled)];
    }) });
  }

  const sepRows = people.map(personId => ({ personId, ...sepPosition(ws, personId, year) })).filter(s => s.targetCents !== null || s.paidCents > 0);
  if (sepRows.length) {
    blocks.push({ type: "heading", text: `${year} SEP-IRA contributions` });
    blocks.push({ type: "table", columns: [{ title: "Owner", width: 0.3 }, { title: "Annual goal", width: 0.23, align: "right" },
      { title: "Already paid", width: 0.23, align: "right" }, { title: "Still to pay", width: 0.24, align: "right" }],
    rows: sepRows.map(s => [name(s.personId), s.targetCents === null ? "No goal set" : money(s.targetCents), money(s.paidCents), money(s.remainingCents)]) });
    const paid = ws.retirement.contributions.filter(c => c.taxYear === year);
    if (paid.length) blocks.push({ type: "bullets", items: paid.map(c => { usedSources.add(c.sourceId); return `${name(c.personId)}: ${money(c.amountCents)} paid ${c.paidDate} (${sourceLabel(c.sourceId)})`; }) });
    blocks.push({ type: "paragraph", tone: "muted", text: "Retirement contributions are not spendable cash. A lower goal does not undo a contribution already made." });
  }

  const missing = [...adapter.missing.map(m => m.reason), ...(risk && risk.status !== "ready" ? risk.fields.map(f => f.reason) : [])];
  blocks.push({ type: "heading", text: "Missing information" });
  blocks.push({ type: "bullets", items: missing.length ? [...new Set(missing)] : ["None for this year's forecast."] });

  const assumptions = [
    ...adapter.notes.filter(n => !/^\d{4} /.test(n) || n.startsWith(`${year} `))
      .map(n => people.reduce((text, id) => text.replace(` for ${id}:`, ` for ${name(id).toLowerCase()}:`), n)),
    ...(year === 2026 && risk?.status === "ready" ? [...risk.risk.headroomAssumptions, ...risk.warnings] : []),
  ];
  blocks.push({ type: "heading", text: "Assumptions" });
  blocks.push({ type: "bullets", items: assumptions.length ? [...new Set(assumptions)] : ["No additional assumptions."] });

  blocks.push({ type: "heading", text: "Sources" });
  blocks.push({ type: "bullets", items: [...usedSources].map(id => {
    const e = ws.evidence.find(x => x.id === id);
    return e ? [`[${e.id}] ${e.label}`, e.kind, e.taxYear ? `tax year ${e.taxYear}` : "", e.page ? `page ${e.page}` : "", e.excerpt ? `"${e.excerpt}"` : ""].filter(Boolean).join("; ") : `[${id}]`;
  }) });

  if (year === 2026 && risk?.status === "ready" && risk.risk.trace.length) {
    blocks.push({ type: "heading", text: "Appendix: subsidy calculation trace" });
    blocks.push({ type: "table", columns: [{ title: "Step", width: 0.32 }, { title: "Amount", width: 0.18, align: "right" }, { title: "Explanation and sources", width: 0.5 }],
      rows: risk.risk.trace.map(t => [t.label, t.amountCents === null ? "See explanation" : signed(t.amountCents), `${t.explanation}${t.sourceIds.length ? ` [${t.sourceIds.join(", ")}]` : ""}`]) });
  }

  return { title: "Annual income forecast explanation", subtitle: `${ws.household.title} - ${year}`, fingerprint, blocks };
}
