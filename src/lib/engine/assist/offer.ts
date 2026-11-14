/**
 * Offer "as offered" (round 5): what a client offer leaves the family on its own terms, using only
 * the tax years its unpaid lines fall in. A 2026-only offer needs no 2027 facts: tax years are
 * calculated independently by the year engine, so an untouched year changes by exactly $0.
 *
 * Attribution per year (identity tested): cash change = receipts − expenses − Δ self-employment tax
 * − Δ federal income tax + Δ premium tax credit (received or repaid at filing) − Δ SEP contributions.
 */
import type { BlockedComparison, TaxYear, YearResult } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { modelWarnings, stopToBlocked } from "../common";
import { buildYearModel, Issues, parseCase } from "../guard";
import { workspaceToEngineInput } from "../household/adapter";
import { projectHousehold } from "../household/projection";
import { engineWorkspaceFingerprint } from "../household";
import { formatUsd } from "../money";
import { EngineStop, type YearModel } from "../model";
import { ENGINE_VERSION, RULES_VERSION } from "../rules";
import { profitHeadroomDollars } from "../search";
import { evaluateYear, toYearResult } from "../year";

const YEARS: TaxYear[] = [2026, 2027];

export interface OfferYearEffect {
  year: TaxYear;
  receiptsCents: number;
  expensesCents: number;
  /** Increase in self-employment tax (positive = more tax). */
  selfEmploymentTaxChangeCents: number;
  /** Increase in federal income tax after credits (positive = more tax). */
  incomeTaxChangeCents: number;
  /** Change in the allowed premium tax credit (negative = less credit, repaid or not received at filing). */
  premiumTaxCreditChangeCents: number;
  cashChangeCents: number;
  creditBeforeCents: number;
  creditAfterCents: number;
  creditLost: boolean;
  magiBeforeCents: number;
  magiAfterCents: number;
  /** Extra business profit still possible before the year's credit is lost, with this offer (null: no credit or no limit found). */
  roomAfterCents: number | null;
  decline: YearResult;
  accept: YearResult;
}

export interface ReadyOfferEvaluation {
  status: "ready";
  projectId: string;
  title: string;
  /** Unpaid terms evaluated exactly as offered; received money is a fact in both sides. */
  receivedCents: number;
  unpaidCents: number;
  years: OfferYearEffect[];
  /** Sum over the years the offer touches; other years are unchanged by construction. */
  cashChangeCents: number;
  /** keep_agreed_terms = accept_as_offered for a project that is already agreed. */
  verdict: "accept_as_offered" | "keep_agreed_terms" | "review_terms";
  reasons: string[];
  baseline: { label: string; description: string };
  fingerprint: string;
  engineVersion: string;
  rulesVersion: string;
  warnings: string[];
}
export type OfferEvaluation = ReadyOfferEvaluation | BlockedComparison;

/** Credit room below which "accept as offered" still names the margin (not a fear message, a fact). */
export const THIN_ROOM_CENTS = 100_000;

export async function evaluateOfferAsOffered(raw: HouseholdWorkspace, projectId: string): Promise<OfferEvaluation> {
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) return { status: "needs_data", code: "INVALID_WORKSPACE", message: "Part of the household plan needs review before it can be calculated.",
    fields: parsed.error.issues.map(i => ({ path: i.path.map(String).join(".") || "(root)", reason: i.message })) };
  const ws = parsed.data;
  const pi = ws.projects.findIndex(p => p.id === projectId);
  const project = ws.projects[pi];
  if (!project) return { status: "needs_data", code: "CANDIDATE_MISSING", message: "Choose the offer to evaluate.", fields: [{ path: "projects", reason: `No project with id "${projectId}".` }] };
  const open = (lines: typeof project.receipts) => lines.filter(l => !l.actual && !l.cancelledAt && l.expected).map(l => l.expected!);
  const receipts = open(project.receipts), expenses = open(project.expenses);
  if (!receipts.length) return { status: "needs_data", code: "NOTHING_TO_DECIDE", message: `"${project.title}" has no unpaid receipts left to evaluate.`, fields: [{ path: `projects[${pi}].receipts`, reason: "All receipts are received or cancelled." }] };
  const touched = ([0, 1] as const).filter(yi => [...receipts, ...expenses].some(x => x.date.startsWith(`${YEARS[yi]}-`)));
  if (project.cashAccountingConfirmed !== true) {
    return { status: project.cashAccountingConfirmed === false ? "unsupported" : "needs_data", code: project.cashAccountingConfirmed === false ? "ACCRUAL_METHOD" : "CASH_METHOD_UNCONFIRMED",
      message: project.cashAccountingConfirmed === false ? "Accrual-method timing is not modeled." : "Confirm the business uses the cash method, so income counts in the year it is received.",
      fields: [{ path: `projects[${pi}].cashAccountingConfirmed`, reason: "Needed to know which tax year each payment counts in." }] };
  }

  const adapted = workspaceToEngineInput(ws, projectId);
  const issues = new Issues();
  const base = projectHousehold(adapted.input, issues, { years: touched, excludeProjectId: projectId });
  const derived = base ? parseCase(base.derivedInput, issues) : null;
  const models = new Map<number, YearModel>();
  if (derived) for (const yi of touched) { const m = buildYearModel(derived, yi, issues); if (m) models.set(yi, m); }
  const b = issues.toBlocked();
  if (b || !derived || models.size !== touched.length) return { ...b!, fields: b!.fields.map(f => ({ ...f, path: adapted.translatePath(f.path) })) };

  try {
    const years: OfferYearEffect[] = touched.map(yi => {
      const m = models.get(yi)!, y = YEARS[yi];
      const r = receipts.filter(x => x.date.startsWith(`${y}-`)).reduce((a, x) => a + x.amountCents, 0);
      const e = expenses.filter(x => x.date.startsWith(`${y}-`)).reduce((a, x) => a + x.amountCents, 0);
      const v = { profitDelta: r - e, additionalSep: 0 };
      const d = evaluateYear(m, { profitDelta: 0, additionalSep: 0 }), a = evaluateYear(m, v);
      const room = a.credit.ptc.ptc > 0 ? profitHeadroomDollars(m, v) : null;
      return { year: y, receiptsCents: r, expensesCents: e,
        selfEmploymentTaxChangeCents: a.credit.seTotal - d.credit.seTotal, incomeTaxChangeCents: a.federalIncomeTax - d.federalIncomeTax,
        premiumTaxCreditChangeCents: a.credit.ptc.ptc - d.credit.ptc.ptc, cashChangeCents: a.spendable - d.spendable,
        creditBeforeCents: d.credit.ptc.ptc, creditAfterCents: a.credit.ptc.ptc, creditLost: m.ptcEligible && d.credit.ptc.ptc > 0 && a.credit.ptc.ptc === 0,
        magiBeforeCents: d.credit.magi, magiAfterCents: a.credit.magi, roomAfterCents: room === null ? null : room * 100,
        decline: toYearResult(m, d), accept: toYearResult(m, a) };
    });
    const cash = years.reduce((s, y) => s + y.cashChangeCents, 0);
    const lost = years.filter(y => y.creditLost);
    const reasons: string[] = [];
    let verdict: ReadyOfferEvaluation["verdict"] = "accept_as_offered";
    if (lost.length) { verdict = "review_terms"; reasons.push(...lost.map(y => `On these terms the ${y.year} premium tax credit of ${formatUsd(y.creditBeforeCents)} is lost.`)); }
    if (cash <= 0) { verdict = "review_terms"; reasons.push(`On these terms the offer leaves ${formatUsd(cash)} after tax and credit changes.`); }
    if (verdict === "accept_as_offered" && project.status === "agreed") verdict = "keep_agreed_terms";
    if (verdict !== "review_terms") {
      reasons.push(`No credit is lost: the ${project.status === "agreed" ? "agreed terms add" : "offer adds"} ${formatUsd(cash)} after tax and credit changes; no change to the terms is needed for the subsidy.`);
      for (const y of years) if (y.roomAfterCents !== null && y.roomAfterCents < THIN_ROOM_CENTS)
        reasons.push(`${y.year}: ${formatUsd(y.roomAfterCents)} more profit would lose the credit; keep that in mind for further work this year.`);
    }
    const receivedCents = project.receipts.filter(l => l.actual).reduce((a, l) => a + l.actual!.amountCents, 0);
    const warnings = [...modelWarnings([...models.values()], derived), ...base!.warnings];
    const untouched = YEARS.filter((_y, yi) => !touched.includes(yi as 0 | 1));
    if (untouched.length) warnings.push(`${untouched.join(", ")} is not affected by this offer as offered, so its facts are not needed here. Moving a payment into ${untouched.join(", ")} is a different question (two-year terms).`);
    return { status: "ready", projectId, title: project.title, receivedCents, unpaidCents: receipts.reduce((a, x) => a + x.amountCents, 0), years, cashChangeCents: cash,
      verdict, reasons, baseline: { label: `Your plan without the unpaid terms of "${project.title}"`,
        description: `Your profit forecast, agreed projects${receivedCents ? `, ${formatUsd(receivedCents)} already received from "${project.title}"` : ""} and SEP-IRA contributions as recorded.` },
      fingerprint: await engineWorkspaceFingerprint(ws), engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, warnings: [...new Set(warnings)] };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e, `projects[${pi}]`);
    throw e;
  }
}
