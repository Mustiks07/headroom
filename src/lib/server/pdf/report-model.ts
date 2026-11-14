import type { CaseInput, MoneyFact, ReadyComparison, ScenarioResult, YearResult } from "@/domain/contracts";

/** Renderer-independent report content, built only from the input and a fresh ReadyComparison. */
export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; tone?: "normal" | "muted" | "notice" }
  | { type: "keyValues"; rows: Array<[string, string]> }
  | { type: "table"; columns: Array<{ title: string; width: number; align?: "left" | "right" }>; rows: string[][] }
  | { type: "bullets"; items: string[] };

export interface ReportModel {
  title: string;
  subtitle: string;
  fingerprint: string;
  blocks: Block[];
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (cents: number | null | undefined): string => cents === null || cents === undefined ? "Unknown" : usd.format(cents / 100);
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "-" : ""}${usd.format(Math.abs(cents) / 100)}`;
const settlement = (cents: number) => cents > 0 ? `Repay ${money(cents)}` : cents < 0 ? `Additional credit ${money(-cents)}` : "None";
const yesNo = (v: boolean | null) => v === null ? "Not confirmed" : v ? "Yes" : "No";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fact(f: MoneyFact): string {
  const base = f.status === "unknown" ? "Unknown" : `${money(f.valueCents)} (${f.status})`;
  const range = f.range ? `; range ${money(f.range.lowCents)}-${money(f.range.highCents)}` : "";
  return `${base}${range}; source: ${f.sourceId}`;
}

const INCOME_FIELDS: Array<[keyof CaseInput["years"][number]["incomes"][number], string]> = [
  ["scheduleCProfit", "Business net profit (Schedule C)"], ["w2Box1", "W-2 wages (Box 1)"],
  ["socialSecurityWages", "Social Security wages"], ["medicareWages", "Medicare wages"],
  ["grossWages", "Gross pay"], ["payrollPretaxDeductions", "Pre-tax payroll deductions"],
  ["taxableInterest", "Taxable interest"], ["taxExemptInterest", "Tax-exempt interest"],
  ["existingSepContribution", "SEP contribution already made"],
];

function yearRows(years: [YearResult, YearResult]): string[][] {
  const row = (label: string, pick: (y: YearResult) => string) => [label, pick(years[0]), pick(years[1])];
  return [
    row("Income used for the subsidy (ACA MAGI)", y => money(y.magiCents)),
    row("Premium tax credit allowed", y => money(y.ptcCents)),
    row("Advance credit paid to the insurer", y => money(y.aptcCents)),
    row("Settlement when filing", y => settlement(y.aptcSettlementCents)),
    row("Federal income tax", y => money(y.federalIncomeTaxCents)),
    row("Self-employment tax", y => money(y.selfEmploymentTaxCents)),
    row("Employee Social Security and Medicare", y => money(y.employeeFicaCents)),
    row("Self-employed health insurance deduction", y => money(y.sehiDeductionCents)),
    row("Spendable cash after final settlement", y => money(y.spendableAfterSettlementCents)),
    row("Added to retirement (not spendable cash)", y => money(y.additionalRetirementCents)),
  ];
}

function coverageSummary(year: CaseInput["years"][number]): string[][] {
  const key = (m: (typeof year.coverage)[number]) => JSON.stringify([m.enrollmentPremium.valueCents, m.benchmarkPremium.valueCents,
    m.advancePtc.valueCents, m.ptcEligibilityConfirmed, m.sehiEligibilityConfirmed]);
  const sorted = [...year.coverage].sort((a, b) => a.month - b.month);
  const groups: Array<{ from: number; to: number; m: (typeof sorted)[number] }> = [];
  for (const m of sorted) {
    const last = groups[groups.length - 1];
    if (last && key(last.m) === key(m) && last.to === m.month - 1) last.to = m.month;
    else groups.push({ from: m.month, to: m.month, m });
  }
  return groups.map(g => [
    g.from === g.to ? MONTHS[g.from - 1] : `${MONTHS[g.from - 1]}-${MONTHS[g.to - 1]}`,
    g.m.enrollmentPremium.status === "unknown" ? "Unknown" : money(g.m.enrollmentPremium.valueCents),
    g.m.benchmarkPremium.status === "unknown" ? "Unknown" : money(g.m.benchmarkPremium.valueCents),
    g.m.advancePtc.status === "unknown" ? "Unknown" : money(g.m.advancePtc.valueCents),
    yesNo(g.m.ptcEligibilityConfirmed),
  ]);
}

export function buildReportModel(input: CaseInput, comparison: ReadyComparison, chosenScenarioId: string,
  completedActionIds: string[], generatedAt: Date): ReportModel {
  const chosen = comparison.scenarios.find(s => s.id === chosenScenarioId);
  const baseline = comparison.scenarios.find(s => s.id === comparison.baselineScenarioId);
  if (!chosen) throw new Error("Chosen scenario is not in the comparison.");
  const role = (personId: string) => input.people.find(p => p.id === personId)?.role ?? personId;
  const blocks: Block[] = [];
  const evidenceLabel = new Map(input.evidence.map(e => [e.id, e.label]));
  const sourceText = (ids: string[]) => ids.length ? ids.map(id => evidenceLabel.get(id) ?? id).join("; ") : "None listed";

  blocks.push({ type: "paragraph", tone: "notice", text:
    "Planning estimate based on the information entered. It is not tax or legal advice and not a Marketplace eligibility decision. " +
    "Review it with a tax professional before acting." +
    (input.isSynthetic ? " This report uses a SYNTHETIC example household, not a real person's records." : "") });
  blocks.push({ type: "keyValues", rows: [
    ["Generated", `${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Calculation fingerprint", comparison.calculationFingerprint],
    ["Engine version / rules version", `${comparison.engineVersion} / ${comparison.rulesVersion}`],
    ["Contract version", comparison.contractVersion],
  ] });

  blocks.push({ type: "heading", text: "Chosen option" });
  blocks.push({ type: "keyValues", rows: [
    ["Option", chosen.label],
    ["Compared with", baseline ? baseline.label : comparison.baselineScenarioId],
    ["Change in spendable cash, 2026 and 2027 combined, after final tax and subsidy settlement", signed(chosen.twoYearCashDeltaCents)],
    ["Added to retirement accounts (reported separately; not spendable cash, taxed when withdrawn)", money(chosen.grossAdditionalRetirementCents)],
    ["Income stress check", `${chosen.stress.status.replace(/_/g, " ")}${chosen.stress.worstCashDeltaCents !== null ? `; worst cash change ${signed(chosen.stress.worstCashDeltaCents)}` : ""}`],
  ] });
  if (chosen.stress.checkedDescription) blocks.push({ type: "paragraph", tone: "muted", text: chosen.stress.checkedDescription });
  const decisions: string[][] = [
    ...chosen.decisions.receipts.map(r => ["Payment received", r.date, money(r.amountCents)]),
    ...chosen.decisions.expenses.map(e => ["Expense deducted", String(e.year), money(e.amountCents)]),
    ...chosen.decisions.additionalSep.map(s => [`Additional SEP contribution (${role(s.personId)})`, String(s.year), money(s.amountCents)]),
  ];
  blocks.push({ type: "table", columns: [{ title: "What happens", width: 0.5 }, { title: "When", width: 0.2 }, { title: "Amount", width: 0.3, align: "right" }],
    rows: decisions.length ? decisions : [["No project decisions", "-", "-"]] });

  blocks.push({ type: "heading", text: "Both tax years for the chosen option" });
  blocks.push({ type: "table", columns: [{ title: "Item", width: 0.5 }, { title: "2026", width: 0.25, align: "right" }, { title: "2027", width: 0.25, align: "right" }],
    rows: yearRows(chosen.years) });
  blocks.push({ type: "paragraph", tone: "muted", text: "The advance credit is not deducted twice: the settlement line is the difference between the advance received and the credit allowed." });

  blocks.push({ type: "heading", text: "All options compared" });
  blocks.push({ type: "table", columns: [{ title: "Option", width: 0.4 }, { title: "Available", width: 0.15 },
    { title: "Cash change vs. baseline", width: 0.25, align: "right" }, { title: "Retirement added", width: 0.2, align: "right" }],
  rows: comparison.scenarios.map((s: ScenarioResult) => [
    `${s.label}${s.id === chosen.id ? " (chosen)" : ""}${s.id === comparison.baselineScenarioId ? " (baseline)" : ""}`,
    s.feasible ? "Yes" : "No", signed(s.twoYearCashDeltaCents), money(s.grossAdditionalRetirementCents)]) });
  const blocked = comparison.scenarios.filter(s => !s.feasible && s.infeasibilityReasons.length);
  if (blocked.length) blocks.push({ type: "bullets", items: blocked.map(s => `${s.label}: ${s.infeasibilityReasons.join(" ")}`) });

  blocks.push({ type: "heading", text: "Actions and deadlines" });
  blocks.push({ type: "table", columns: [{ title: "Action", width: 0.45 }, { title: "Due", width: 0.15 }, { title: "Status", width: 0.15 }, { title: "Sources", width: 0.25 }],
    rows: chosen.actions.length ? chosen.actions.map(a => [a.title, a.dueDate ?? "No fixed date",
      completedActionIds.includes(a.id) ? "Done (confirmed)" : "To do", sourceText(a.sourceIds)]) : [["No actions required", "-", "-", "-"]] });

  blocks.push({ type: "heading", text: "Assumptions and warnings" });
  blocks.push({ type: "bullets", items: [...chosen.assumptions, ...comparison.warnings].length
    ? [...chosen.assumptions, ...comparison.warnings] : ["No additional assumptions were reported."] });

  blocks.push({ type: "heading", text: "Your inputs" });
  blocks.push({ type: "keyValues", rows: [
    ["Case", `${input.title}${input.isSynthetic ? " (synthetic example)" : ""}`],
    ["State / county FIPS", `${input.state} / ${input.countyFips ?? "Not provided"}`],
    ["Filing status", input.filingStatus === "mfj" ? "Married filing jointly" : input.filingStatus === "single" ? "Single" : "Other"],
    ["People", input.people.map(p => `${p.role} (age ${p.ageAt2026Start} at start of 2026)`).join(", ")],
  ] });
  for (const year of input.years) {
    blocks.push({ type: "paragraph", text: `${year.year}: tax family of ${year.taxFamilySize}; ${year.coveredPersonIds.length} covered by the Marketplace plan; benchmark ${year.benchmarkStatus.replace(/_/g, " ")}; scope confirmed: ${yesNo(year.scopeConfirmed)}.` });
    blocks.push({ type: "table", columns: [{ title: `${year.year} income item`, width: 0.35 }, { title: "Person", width: 0.15 }, { title: "Value, status and source", width: 0.5 }],
      rows: year.incomes.flatMap(inc => INCOME_FIELDS.map(([k, label]) => [label, role(inc.personId), fact(inc[k] as MoneyFact)])) });
    blocks.push({ type: "table", columns: [{ title: "Months", width: 0.16 }, { title: "Plan premium", width: 0.21, align: "right" },
      { title: "Benchmark premium", width: 0.21, align: "right" }, { title: "Advance credit", width: 0.21, align: "right" }, { title: "Eligible", width: 0.21 }],
    rows: coverageSummary(year) });
    if (year.unsupportedFacts.length) blocks.push({ type: "bullets", items: year.unsupportedFacts.map(f => `Reported situation: ${f}`) });
  }
  const o = input.opportunity, c = input.constraints;
  blocks.push({ type: "keyValues", rows: [
    ["Project", `${o.title} (${role(o.ownerPersonId)})`],
    ["Project fee / extra expenses", `${money(o.grossRevenueCents)} / ${money(o.incrementalExpensesCents)}`],
    ["Expected payment date / expense date", `${o.plannedReceiptDate} / ${o.expensePaymentDate}`],
    ["Cash accounting confirmed / timing arrangement confirmed", `${yesNo(o.cashAccountingConfirmed)} / ${yesNo(o.timingArrangementConfirmed)}`],
    ["Maximum additional retirement contribution", money(c.maxAdditionalSepCents)],
    ["Minimum desired cash gain", money(c.minimumDesiredCashGainCents)],
    ["Can split payment / latest next-year date", `${c.canSplitPayment ? "Yes" : "No"} / ${c.nextYearPaymentLatestDate ?? "Not set"}`],
    ["Can renegotiate price", c.canRenegotiatePrice ? "Yes" : "No"],
    ["Objective", c.objective === "spendable_cash" ? "Most spendable cash" : "Retirement savings and cash"],
  ] });

  blocks.push({ type: "heading", text: "Sources" });
  blocks.push({ type: "bullets", items: input.evidence.length ? input.evidence.map(e => [
    `[${e.id}] ${e.label}`, `kind: ${e.kind}`, e.taxYear ? `tax year ${e.taxYear}` : "", e.page ? `page ${e.page}` : "",
    e.excerpt ? `excerpt: "${e.excerpt}"` : "", e.url ?? ""].filter(Boolean).join("; ")) : ["No sources recorded."] });

  blocks.push({ type: "heading", text: "Calculation trace for the chosen option" });
  for (const year of chosen.years) {
    blocks.push({ type: "table", columns: [{ title: `${year.year} step`, width: 0.3 }, { title: "Amount", width: 0.18, align: "right" }, { title: "Explanation and sources", width: 0.52 }],
      rows: year.trace.length ? year.trace.slice(0, 60).map(t => [t.label, money(t.amountCents),
        `${t.explanation}${t.sourceIds.length ? ` [${t.sourceIds.join(", ")}]` : ""}`]) : [["No trace items", "-", "-"]] });
  }

  return {
    title: "Headroom plan report",
    subtitle: input.title,
    fingerprint: comparison.calculationFingerprint,
    blocks,
  };
}
