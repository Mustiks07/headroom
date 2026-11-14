/**
 * Input readiness by intent (round 5). Pure: no network, AI, clock or storage.
 *
 * Uses the SAME guards as the calculations (household projection, profile/year guard, opportunity
 * checks), restricted to the tax years the chosen task needs, and turns their findings into a short,
 * ordered question set. No second readiness heuristic: if a question is listed, the calculation
 * would refuse without it; if the calculation would refuse, a question or an unsupported reason is listed.
 *
 *  - current_year_subsidy: 2026 only. Never needs 2027 or an offer.
 *  - evaluate_offer: the years the offer's unpaid lines fall in (as offered).
 *  - two_year_terms: 2026 and 2027 (moving money between years needs both).
 *  - review_agreed_plan: 2026, plus 2027 when agreed lines, SEP goals or a 2027 forecast exist there.
 *
 * Unknown stays unknown: a question accepts $0 only as a confirmed answer.
 */
import type { MoneyFact, TaxYear } from "@/domain/contracts";
import type { ImportDraft, InputReadiness, ReadinessIntent, ReadinessQuestion } from "@/domain/assistance";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "../guard";
import { workspaceToEngineInput } from "../household/adapter";
import { projectHousehold } from "../household/projection";
import { EngineStop, NO_VARIATION, type YearModel } from "../model";
import { checkedPositions, hasRanges, modelAt, modelAtPositions, rangeDims, UNCERTAINTY_SCALE } from "../uncertainty";
import { evaluateYear, solveCredit } from "../year";

const YEARS: TaxYear[] = [2026, 2027];

type Intent =
  | { kind: "current_year_subsidy" }
  | { kind: "evaluate_offer"; projectId: string }
  | { kind: "two_year_terms"; projectId: string }
  | { kind: "review_agreed_plan" };

/** Detailed answer shape (the contract's `answer.kind` is the coarse UI kind). */
export type AnswerSpec =
  | { kind: "boolean"; yesMeans: string }
  | { kind: "money"; period: "annual" | "year_to_date" | "monthly" | "remaining_year"; confirmedZeroAllowed: boolean }
  /** Several related amounts (e.g. pay stub boxes); "none" must be confirmed explicitly, never assumed. */
  | { kind: "money_fields"; fields: Array<{ path: string; label: string }>; confirmedZeroAllowed: boolean }
  | { kind: "date"; within: { from: string; through: string } | null }
  | { kind: "integer"; min: number; max: number }
  | { kind: "choice"; options: Array<{ value: string; label: string }> }
  /** Narrow a declared range: the answer is a narrower low/high or an exact value. */
  | { kind: "range"; lowCents: number; highCents: number }
  | { kind: "review"; what: string };

/** Contract question + engine detail (additive fields). */
export interface EngineReadinessQuestion extends ReadinessQuestion {
  code: string;
  /** All workspace paths the answer fills (`path` = the first). */
  paths: string[];
  year: TaxYear | null;
  answerDetail: AnswerSpec;
  /** calculation = nothing can be calculated without it; decision = calculated, but the answer may change the choice. */
  blocks: "calculation" | "decision";
  /** 0–9, lower = ask first: a range that flips the answer, then facts that can end support or the credit, household, income, coverage, confirmations. */
  priority: number;
  /** A document that typically answers it (never a past-year form for a future amount). */
  documentHint: string | null;
}

export type ReadinessPrecision = "no_result" | "exact" | "estimated" | "range_stable" | "range_changes_answer" | "range_not_yet_checked";

export interface EngineInputReadiness extends InputReadiness {
  questions: EngineReadinessQuestion[];
  unsupported: Array<{ code: string; reason: string; path: string }>;
  /** The project the offer/terms intents were assessed for (null when not applicable or not chosen). */
  projectId: string | null;
  yearsNeeded: TaxYear[];
  precision: ReadinessPrecision;
  precisionNote: string;
  /** Facts deliberately NOT asked for this task. */
  notNeeded: string[];
}

type Q = Omit<EngineReadinessQuestion, "path" | "answer" | "allowUnknown" | "sourceRef">;
/** Internal question draft (answer = detailed spec). */
type Draft = Omit<Q, "answerDetail"> & { answer: AnswerSpec };
const fin = ({ answer, ...rest }: Draft): EngineReadinessQuestion => finishQuestion({ ...rest, answerDetail: answer });
const COARSE: Record<AnswerSpec["kind"], ReadinessQuestion["answer"]["kind"]> = { boolean: "boolean", money: "money", money_fields: "money", date: "date",
  integer: "choice", choice: "choice", range: "money", review: "choice" };
function finishQuestion(q: Q): EngineReadinessQuestion {
  const d = q.answerDetail;
  const choices = d.kind === "choice" ? d.options.map(o => ({ id: o.value, label: o.label }))
    : d.kind === "integer" ? Array.from({ length: d.max - d.min + 1 }, (_x, i) => ({ id: String(d.min + i), label: String(d.min + i) })) : undefined;
  return { ...q, path: q.paths[0], answer: { kind: COARSE[d.kind], ...(choices ? { choices } : {}) },
    allowUnknown: q.blocks === "decision" || d.kind === "range", sourceRef: null };
}

type Raw = { code: string; path: string; reason: string };

const WAGE_FIELDS = ["grossWages", "w2Box1", "socialSecurityWages", "medicareWages", "payrollPretaxDeductions"] as const;
const INTEREST_FIELDS = ["taxableInterest", "taxExemptInterest"] as const;
const WAGE_LABELS: Record<string, string> = { grossWages: "Gross pay", w2Box1: "Taxable wages (W-2 box 1)", socialSecurityWages: "Social Security wages (box 3)",
  medicareWages: "Medicare wages (box 5)", payrollPretaxDeductions: "Pre-tax payroll deductions", taxableInterest: "Taxable interest", taxExemptInterest: "Tax-exempt interest" };
const COVERAGE_Q: Record<string, string> = { enrollmentPremium: "monthly premium of your plan", benchmarkPremium: "monthly benchmark (second-lowest-cost Silver) premium", advancePtc: "monthly advance premium tax credit" };

function personLabel(ws: HouseholdWorkspace, id: string | undefined): { who: string; whose: string } {
  const p = ws.household.people.find(x => x.id === id);
  if (!p || p.role === "primary") return { who: "you", whose: "your" };
  if (p.role === "spouse") return { who: "your spouse", whose: "your spouse's" };
  return { who: "a dependent", whose: "a dependent's" };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Turn guard findings into grouped questions. */
function toQuestions(ws: HouseholdWorkspace, raws: Raw[], owner: string): Draft[] {
  const out = new Map<string, Draft>();
  const add = (key: string, q: Omit<Draft, "id" | "paths"> & { path: string }) => {
    const prev = out.get(key);
    if (prev) { if (!prev.paths.includes(q.path)) prev.paths.push(q.path); return; }
    const { path, ...rest } = q;
    out.set(key, { id: key, paths: [path], ...rest });
  };
  for (const r of raws) {
    const ym = /household\.years\[(\d)\]/.exec(r.path) ?? /forecasts\[[^\]:]*:(\d{4})\]/.exec(r.path);
    let year: TaxYear | null = ym ? (ym[1].length === 4 ? Number(ym[1]) as TaxYear : YEARS[Number(ym[1])]) : null;
    const fIdx = /^forecasts\[(\d+)\]/.exec(r.path);
    if (fIdx) year = ws.forecasts[Number(fIdx[1])]?.year ?? year;
    const yi = year === null ? null : YEARS.indexOf(year);
    const income = /household\.years\[(\d)\]\.otherIncomes\[(\d+)\]\.(\w+)/.exec(r.path);
    const row = income ? ws.household.years[Number(income[1])].otherIncomes[Number(income[2])] : null;
    const pl = personLabel(ws, row?.personId);
    const coverageDoc = year === 2026 ? "Your 2026 Marketplace eligibility notice or plan summary (premium, benchmark plan, advance credit)"
      : "Your 2027 Marketplace plan and eligibility notice from open enrollment (a 2026 Form 1095-A does not give 2027 amounts)";
    switch (r.code) {
      case "SCOPE_UNCONFIRMED":
        add(`scope:${year}`, { code: r.code, path: r.path, year, priority: 1, blocks: "calculation", documentHint: null,
          question: `In ${year}, do any of these apply: itemized deductions, capital gains or dividends, rental, foreign or Social Security income, another business, the earned income credit or other special credits?`,
          reason: "Headroom calculates only households without these items; if one applies, the result would be wrong, so it says so instead.",
          answer: { kind: "boolean", yesMeans: "One applies: the case is outside what Headroom calculates." } });
        break;
      case "PTCELIGIBILITYCONFIRMED_UNCONFIRMED":
      case "SEHIELIGIBILITYCONFIRMED_UNCONFIRMED": {
        const ptc = r.code.startsWith("PTC");
        add(`${ptc ? "ptc" : "sehi"}-eligible:${year}`, { code: r.code, path: r.path.replace(/coverage\[\d+\]/, "coverage[*]"), year, priority: 1, blocks: "calculation", documentHint: null,
          question: ptc ? `For every month of ${year}: was the family enrolled through the Marketplace, with no offer of affordable employer or government coverage?`
            : `For every month of ${year}: was no subsidized employer health plan available to you or your spouse?`,
          reason: ptc ? "Without eligibility there is no premium tax credit to protect, and the answer changes completely."
            : "It decides whether premiums reduce business income (self-employed health insurance deduction), which moves the credit.",
          answer: { kind: "boolean", yesMeans: "Eligible in every month." } });
        break;
      }
      case "SPOUSE_MISSING": case "PEOPLE": case "FILING_STATUS":
        add(`people:${r.code}`, { code: r.code, path: r.path, year: null, priority: 2, blocks: "calculation", documentHint: null,
          question: r.code === "SPOUSE_MISSING" ? "Add your spouse (married filing jointly needs both spouses)." : cap(r.reason),
          reason: "The credit and the tax depend on who is in the tax family.", answer: { kind: "review", what: "household members" } });
        break;
      case "TAX_FAMILY":
        add(`family:${year}`, { code: r.code, path: r.path, year, priority: 2, blocks: "calculation", documentHint: null,
          question: `How many people are in your ${year} tax family (you, your spouse and dependents you claim)?`,
          reason: "The poverty line used for the credit depends on family size.", answer: { kind: "integer", min: 1, max: 10 } });
        break;
      case "FORECAST_MISSING": case "PROJECT_INCLUSION_UNCONFIRMED": case "PROJECTS_INCLUDED": case "AS_OF_MISSING": case "AS_OF_OUTSIDE": {
        if (r.code === "FORECAST_MISSING") {
          const fy = Number(/(\d{4})/.exec(r.reason)?.[1] ?? 2026) as TaxYear;
          add(`forecast:${fy}`, { code: r.code, path: `forecasts[${owner}:${fy}]`, year: fy, priority: 3, blocks: "calculation",
            documentHint: fy === 2026 ? "Your year-to-date profit and loss statement (net profit so far), plus what you still expect this year" : "Your own estimate for 2027 (no document exists yet)",
            question: fy === 2026 ? "What business profit do you expect for 2026: profit so far plus the rest of the year, or a full-year estimate?" : "What business profit do you expect in 2027 without this project?",
            reason: fy === 2026 ? "Business profit sets this year's household income for the credit." : "Moving a payment into 2027 adds it to 2027 income, so 2027 must be known.",
            answer: { kind: "money", period: "annual", confirmedZeroAllowed: true } });
        } else if (r.code === "PROJECT_INCLUSION_UNCONFIRMED" || r.code === "PROJECTS_INCLUDED") {
          add(`inclusion:${year}`, { code: r.code, path: r.path, year, priority: 4, blocks: "calculation", documentHint: null,
            question: `Does your ${year} profit forecast leave out the projects listed in Headroom?`,
            reason: "Projects are added separately; a forecast that already contains them would count them twice.", answer: { kind: "boolean", yesMeans: "The forecast leaves them out." } });
        } else {
          add(`asof:${year}`, { code: r.code, path: r.path, year, priority: 3, blocks: "calculation", documentHint: "The end date printed on your profit and loss statement",
            question: `Through which date does your ${year} year-to-date profit run?`, reason: "Only receipts after that date are added as the rest of the year.",
            answer: { kind: "date", within: year ? { from: `${year}-01-01`, through: `${year}-12-30` } : null } });
        }
        break;
      }
      case "INCOME_ROW_MISSING": case "FACT_UNKNOWN": {
        const field = income?.[3] ?? (/\.(\w+)$/.exec(r.path)?.[1] ?? "");
        if (r.path.startsWith("forecasts")) {
          add(`forecast-fact:${r.path}`, { code: r.code, path: r.path, year, priority: 3, blocks: "calculation",
            documentHint: /forecasts\[[a-z]/.test(r.path) ? null : "Your profit and loss statement",
            question: /forecasts\[[^\]]*:\d{4}\]/.test(r.path) ? `Does ${personLabel(ws, /forecasts\[([^\]:]+):/.exec(r.path)?.[1]).who} have business profit in ${year}? Enter it, or confirm none.` : `${cap(r.reason.split(" is unknown")[0])}?`,
            reason: "It is part of household income for the credit; an empty answer is not $0.", answer: { kind: "money", period: "annual", confirmedZeroAllowed: true } });
        } else if ((WAGE_FIELDS as readonly string[]).includes(field) || r.code === "INCOME_ROW_MISSING") {
          add(`wages:${row?.personId ?? r.path}:${year}`, { code: r.code, path: r.path, year, priority: 3, blocks: "calculation",
            documentHint: `${cap(pl.whose)} recent pay stub with year-to-date totals, or the expected full-year pay (a year-to-date stub is not the annual amount)`,
            question: `What will ${pl.who} earn in wages in ${year}? Enter the full-year amounts, or confirm no wages.`,
            reason: "Wages are household income for the credit; Headroom never assumes a spouse has no income.",
            answer: { kind: "money_fields", fields: WAGE_FIELDS.map(f => ({ path: r.path.replace(/\.\w+$/, `.${f}`), label: WAGE_LABELS[f] })), confirmedZeroAllowed: true } });
        } else if ((INTEREST_FIELDS as readonly string[]).includes(field)) {
          add(`interest:${row?.personId ?? r.path}:${year}`, { code: r.code, path: r.path, year, priority: 5, blocks: "calculation", documentHint: "Bank interest statements or Form 1099-INT",
            question: `How much interest will ${pl.who} receive in ${year} (taxable and tax-exempt)? Confirm none if there is none.`,
            reason: "Interest, including tax-exempt interest, counts in household income for the credit.",
            answer: { kind: "money_fields", fields: INTEREST_FIELDS.map(f => ({ path: r.path.replace(/\.\w+$/, `.${f}`), label: WAGE_LABELS[f] })), confirmedZeroAllowed: true } });
        } else {
          add(`fact:${r.path}`, { code: r.code, path: r.path, year, priority: 5, blocks: "calculation", documentHint: null, question: r.reason,
            reason: "Needed for the calculation; unknown is not $0.", answer: { kind: "money", period: "annual", confirmedZeroAllowed: true } });
        }
        break;
      }
      case "COVERAGE_UNKNOWN": {
        const field = /\.(\w+)$/.exec(r.path)?.[1] ?? "";
        add(`coverage:${field}:${year}`, { code: r.code, path: r.path, year, priority: 4, blocks: "calculation", documentHint: coverageDoc,
          question: `What is the ${COVERAGE_Q[field] ?? field} in ${year}? Enter one amount if it is the same every month, or month by month.`,
          reason: field === "advancePtc" ? "The advance already paid is compared with the final credit at filing (repayment or extra credit)."
            : "The credit is the benchmark premium minus your required contribution, limited to your premium.",
          answer: { kind: "money", period: "monthly", confirmedZeroAllowed: field === "advancePtc" } });
        break;
      }
      case "BENCHMARK_UNKNOWN":
        add(`benchmark:${year}`, { code: r.code, path: r.path, year, priority: 4, blocks: "calculation", documentHint: coverageDoc,
          question: `Where does your ${year} benchmark premium come from?`, reason: "Without a benchmark premium the credit cannot be calculated.",
          answer: { kind: "choice", options: [{ value: "marketplace_confirmed", label: "From my Marketplace notice or plan" }, { value: "county_candidate", label: "County estimate (less exact)" }] } });
        break;
      case "CTC_UNKNOWN": case "CTC_AGE":
        add(`ctc:${r.path}`, { code: r.code, path: r.path, year, priority: 6, blocks: "calculation", documentHint: null,
          question: r.reason, reason: "The child tax credit changes the tax on the same income.", answer: { kind: "boolean", yesMeans: "Qualifying child." } });
        break;
      case "CASH_METHOD_UNCONFIRMED":
        add("cash-method", { code: r.code, path: r.path, year: null, priority: 6, blocks: "calculation", documentHint: null,
          question: "Does your business count income when the money is received (cash method)?", reason: "It decides which tax year each payment counts in.",
          answer: { kind: "boolean", yesMeans: "Cash method." } });
        break;
      default:
        add(`fix:${r.code}:${r.path}`, { code: r.code, path: r.path, year, priority: 7, blocks: "calculation", documentHint: null,
          question: r.reason, reason: "The calculation needs this fixed first.", answer: { kind: "review", what: r.path } });
    }
  }
  return [...out.values()].sort((a, b) => a.priority - b.priority || (a.year ?? 0) - (b.year ?? 0));
}

function yearsFor(ws: HouseholdWorkspace, intent: Intent): Array<0 | 1> {
  if (intent.kind === "current_year_subsidy") return [0];
  if (intent.kind === "two_year_terms") return [0, 1];
  if (intent.kind === "evaluate_offer") {
    const p = ws.projects.find(x => x.id === intent.projectId);
    const open = p ? [...p.receipts, ...p.expenses].filter(l => !l.actual && !l.cancelledAt && l.expected) : [];
    return open.some(l => l.expected!.date.startsWith("2027-")) ? (open.some(l => l.expected!.date.startsWith("2026-")) ? [0, 1] : [1]) : [0];
  }
  const in2027 = ws.projects.some(p => p.status === "agreed" && [...p.receipts, ...p.expenses].some(l => !l.actual && !l.cancelledAt && l.expected?.date.startsWith("2027-")))
    || ws.retirement.targets.some(t => t.year === 2027) || ws.forecasts.some(f => f.year === 2027);
  return in2027 ? [0, 1] : [0];
}

/** Project the offer/terms intents refer to: explicit, else the only open proposed project, else the latest goal's project. */
function chooseProject(ws: HouseholdWorkspace, explicit: string | undefined): { id: string | null; candidates: HouseholdWorkspace["projects"] } {
  if (explicit) return { id: explicit, candidates: [] };
  const open = ws.projects.filter(p => p.status !== "cancelled" && p.receipts.some(l => !l.actual && !l.cancelledAt && l.expected));
  const proposed = open.filter(p => p.status === "proposed");
  if (proposed.length === 1) return { id: proposed[0].id, candidates: [] };
  const goal = ws.dealPlanning?.goals.at(-1);
  if (!proposed.length && goal) return { id: goal.projectId, candidates: [] };
  return { id: null, candidates: proposed.length ? proposed : open };
}

const INTENT_KIND = { current_year_subsidy: "current_year_subsidy", new_offer: "evaluate_offer", two_year_terms: "two_year_terms", agreed_plan_review: "review_agreed_plan" } as const;

/** Facts the start screen needs before any workspace exists (ws === null). */
function startQuestions(intent: ReadinessIntent): Draft[] {
  const q = (id: string, path: string, priority: number, question: string, reason: string, answer: AnswerSpec, documentHint: string | null = null): Draft =>
    ({ id, code: "START", paths: [path], year: id.includes("2027") ? 2027 : 2026, question, reason, answer, blocks: "calculation", priority, documentHint });
  const out: Draft[] = [
    q("start:state", "household.state", 1, "Which state do you live in?", "Headroom calculates households in states without a state income tax (TX, FL, TN).",
      { kind: "choice", options: [{ value: "TX", label: "Texas" }, { value: "FL", label: "Florida" }, { value: "TN", label: "Tennessee" }, { value: "other", label: "Another state" }] }),
    q("start:household", "household.people", 2, "Who is in your tax household: filing status, spouse and dependents?", "The credit depends on the tax family.", { kind: "review", what: "household members" }),
    q("start:profit:2026", "forecasts", 3, "What business profit do you expect for 2026 (profit so far plus the rest of the year)?", "Business profit sets this year's household income for the credit.",
      { kind: "money", period: "annual", confirmedZeroAllowed: true }, "Your year-to-date profit and loss statement"),
    q("start:coverage:2026", "household.years[0].coverage", 4, "What are your 2026 monthly premium, benchmark premium and advance credit?", "They decide the credit and what is repaid at filing.",
      { kind: "money", period: "monthly", confirmedZeroAllowed: false }, "Your 2026 Marketplace eligibility notice or plan summary"),
  ];
  if (intent === "new_offer" || intent === "two_year_terms") out.push(q("start:offer", "projects", 5, "What does the client offer: total price, payment dates, any deposit already received, and project costs?",
    "The offer is what is evaluated.", { kind: "review", what: "offer" }, "The client's offer or invoice"));
  if (intent === "two_year_terms") out.push(q("start:profit:2027", "forecasts", 6, "What business profit do you expect in 2027 without this project?", "Moving a payment into 2027 adds it to 2027 income.",
    { kind: "money", period: "annual", confirmedZeroAllowed: true }, "Your own estimate for 2027"));
  return out;
}

/** Where a pending (unconfirmed) document figure could answer a question. */
const DRAFT_FIELD_TO_QUESTION: Array<[RegExp, (id: string) => boolean]> = [
  [/^income\.scheduleCProfit$/, id => id.startsWith("forecast") || id.startsWith("start:profit")],
  [/^income\.(grossWages|w2Box1|socialSecurityWages|medicareWages|payrollPretaxDeductions)$/, id => id.startsWith("wages")],
  [/^income\.(taxableInterest|taxExemptInterest)$/, id => id.startsWith("interest")],
  [/^coverage\./, id => id.startsWith("coverage") || id.startsWith("start:coverage") || id.startsWith("benchmark")],
  [/^(opportunity|project)\./, id => id.startsWith("start:offer") || id === "project" || id === "offer-choice"],
];

function applyDraft(questions: EngineReadinessQuestion[], draft: ImportDraft | null | undefined): EngineReadinessQuestion[] {
  if (!draft) return questions;
  const pending = draft.facts.filter(f => f.review === "extracted" || f.review === "conflict");
  const out = questions.map(q => {
    const f = pending.find(x => DRAFT_FIELD_TO_QUESTION.some(([re, match]) => re.test(x.field) && match(q.id)) && (q.year === null || x.taxYear === null || x.taxYear === q.year));
    return f ? { ...q, sourceRef: `draft:${f.id}`, question: `${q.question} (Found in "${f.source.label}": ${f.valueAsPrinted} — confirm it or correct it.)` } : q;
  });
  const conflicts = draft.facts.filter(f => f.review === "conflict" || f.conflictsWith.length);
  const seen = new Set<string>();
  for (const f of conflicts) {
    const key = [f.id, ...f.conflictsWith].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(fin({ id: `conflict:${key}`, code: "DOCUMENT_CONFLICT", paths: [`draft.facts.${f.id}`], year: f.taxYear, priority: 0, blocks: "calculation", documentHint: null,
      question: `Two documents disagree on the same figure (${f.valueAsPrinted} in "${f.source.label}" and another value). Which one is right?`,
      reason: "Headroom never keeps the later value automatically.", answer: { kind: "choice", options: [f.id, ...f.conflictsWith].map(id => ({ value: id, label: id })) } }));
  }
  return out;
}

/**
 * What is needed before the chosen task can be answered, and how precise the answer will be.
 * `ready` means the corresponding calculation will run on the current facts:
 *  current_year_subsidy → evaluateHouseholdWorkspace / buildHouseholdProjection (2026),
 *  new_offer → evaluateOfferAsOffered, two_year_terms → compareWorkspaceOpportunity / searchDealTerms,
 *  agreed_plan_review → evaluateHouseholdWorkspace for every year with open commitments.
 * Unconfirmed document figures (draft) do not make anything ready; they are offered as answers to confirm.
 */
export function assessInputReadiness(raw: HouseholdWorkspace | null, intentName: ReadinessIntent, draft?: ImportDraft | null, opts: { projectId?: string } = {}): EngineInputReadiness {
  const base = { intent: intentName, unsupported: [] as EngineInputReadiness["unsupported"], notNeeded: [] as string[], projectId: null as string | null };
  if (raw === null) {
    const questions = applyDraft(startQuestions(intentName).map(fin), draft);
    return { ...base, status: "needs_data", yearsNeeded: intentName === "two_year_terms" ? [2026, 2027] : [2026], questions, precision: "no_result",
      precisionNote: "Start with these basics; documents you add can answer them after you confirm the figures.",
      notNeeded: intentName === "two_year_terms" ? [] : ["2027 facts: this task only involves 2026."] };
  }
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...base, status: "needs_data", yearsNeeded: [], precision: "no_result", precisionNote: "The plan has entries that need review.",
      questions: parsed.error.issues.slice(0, 10).map((i, n) => fin({ id: `schema:${n}:${i.path.join(".")}`, code: "INVALID_WORKSPACE", paths: [i.path.map(String).join(".") || "(root)"], year: null,
        question: i.message, reason: "This entry is not valid yet.", answer: { kind: "review", what: i.path.map(String).join(".") }, blocks: "calculation", priority: 1, documentHint: null })) };
  }
  const ws = parsed.data;
  const kind = INTENT_KIND[intentName];
  let projectId: string | undefined;
  if (kind === "evaluate_offer" || kind === "two_year_terms") {
    const chosen = chooseProject(ws, opts.projectId);
    if (!chosen.id) {
      const q = chosen.candidates.length
        ? fin({ id: "offer-choice", code: "OFFER_CHOICE", paths: ["projects"], year: null, priority: 1, blocks: "calculation", documentHint: null,
          question: "Which offer do you want to look at?", reason: "Several projects have unpaid amounts.", answer: { kind: "choice", options: chosen.candidates.map(p => ({ value: p.id, label: p.title })) } })
        : fin({ id: "project", code: "OFFER_MISSING", paths: ["projects"], year: null, priority: 1, blocks: "calculation", documentHint: "The client's offer or invoice",
          question: "What does the client offer: total price, payment dates, any deposit already received, and project costs?", reason: "There is no offer with an unpaid amount yet.",
          answer: { kind: "review", what: "offer" } });
      return { ...base, status: "needs_data", yearsNeeded: [2026], questions: applyDraft([q], draft), precision: "no_result", precisionNote: "Choose or add the offer first." };
    }
    projectId = chosen.id;
  }
  const intent: Intent = kind === "evaluate_offer" || kind === "two_year_terms" ? { kind, projectId: projectId! } : { kind };
  const years = yearsFor(ws, intent);
  const yearsNeeded = years.map(i => YEARS[i]);
  const notNeeded: string[] = [];
  if (!years.includes(1)) notNeeded.push("2027 facts: this task only involves 2026.");
  if (kind === "current_year_subsidy") notNeeded.push("A client offer: the current-year check uses your plan as it stands.");

  const raws: Raw[] = [];
  const unsupported: EngineInputReadiness["unsupported"] = [];
  const pi = projectId ? ws.projects.findIndex(p => p.id === projectId) : -1;
  if (projectId) {
    const p = ws.projects[pi];
    if (!p) return { ...base, projectId, status: "needs_data", yearsNeeded, precision: "no_result", precisionNote: "No such project.", notNeeded,
      questions: [fin({ id: "project", code: "CANDIDATE_MISSING", paths: ["projects"], year: null, question: "Which offer should be evaluated?", reason: "The project is not in this plan.",
        answer: { kind: "review", what: "projects" }, blocks: "calculation", priority: 1, documentHint: null })] };
    const open = p.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected);
    if (!open.length) raws.push({ code: "NOTHING_TO_DECIDE", path: `projects[${pi}].receipts`, reason: `"${p.title}" has no unpaid amount left: enter the unpaid amount and date, or record the offer.` });
    if (p.cashAccountingConfirmed === null) raws.push({ code: "CASH_METHOD_UNCONFIRMED", path: `projects[${pi}].cashAccountingConfirmed`, reason: "" });
    if (p.cashAccountingConfirmed === false) unsupported.push({ code: "ACCRUAL_METHOD", path: `projects[${pi}].cashAccountingConfirmed`, reason: "Accrual-method timing is not modeled." });
  }

  const adapted = workspaceToEngineInput(ws, projectId);
  const issues = new Issues();
  const proj = projectHousehold(adapted.input, issues, { years, ...(projectId ? { excludeProjectId: projectId } : {}) });
  // Profile/year guard: on the derived input when the projection worked; otherwise on the profile alone,
  // where the owner's profit is the projection's question (not asked twice).
  const profileInput = proj?.derivedInput ?? adapted.input.household;
  const profileIssues = new Issues();
  const input = parseCase(profileInput, profileIssues);
  const models: YearModel[] = [];
  if (input) for (const yi of years) { const m = buildYearModel(input, yi, profileIssues); if (m) models.push(m); }
  const ownerRows = new Set(ws.household.years.flatMap((y, yi) => y.otherIncomes.map((o, r) => (o.personId === adapted.ownerPersonId ? `years[${yi}].incomes[${r}].scheduleCProfit` : ""))));
  for (const list of [issues.unsupported, profileIssues.unsupported]) for (const x of list) unsupported.push({ code: x.code, path: adapted.translatePath(x.path), reason: x.reason });
  for (const list of [issues.needsData, profileIssues.needsData]) for (const x of list) {
    if (!proj && list === profileIssues.needsData && ownerRows.has(x.path)) continue;
    raws.push({ code: x.code, path: adapted.translatePath(x.path), reason: x.reason });
  }
  const drafts = toQuestions(ws, raws, adapted.ownerPersonId);

  if (kind === "two_year_terms" && pi >= 0) {
    const p = ws.projects[pi];
    if (p.timingArrangementConfirmed !== true) drafts.push({ id: "timing", code: "TIMING_UNCONFIRMED", paths: [`projects[${pi}].timingArrangementConfirmed`], year: 2027, priority: 8, blocks: "decision",
      question: "Would the client confirm in writing that a January payment is not payable or available to you earlier?",
      reason: "Without it, options that move money into 2027 are not searched (constructive receipt).", answer: { kind: "boolean", yesMeans: "January payments can be searched." }, documentHint: null });
    if (ws.retirement.futureContributionBudget.amountCents === null) drafts.push({ id: "sep-cash", code: "SEP_CASH_UNKNOWN", paths: ["retirement.futureContributionBudget.amountCents"], year: null, priority: 9, blocks: "decision",
      question: "How much cash could you put into a SEP-IRA for these years, if it helps?", reason: "Without it, no additional SEP-IRA option is searched.",
      answer: { kind: "money", period: "annual", confirmedZeroAllowed: true }, documentHint: null });
  }
  const questions = applyDraft(drafts.map(fin), draft);
  const blocking = questions.filter(q => q.blocks === "calculation");
  const common = { ...base, projectId: projectId ?? null, yearsNeeded, notNeeded };
  if (unsupported.length) return { ...common, status: "unsupported", questions: [], unsupported, precision: "no_result",
    precisionNote: "This situation is outside what Headroom calculates. The facts you entered can still be saved and exported." };
  if (blocking.length || !input || models.length !== years.length) return { ...common, status: "needs_data", questions, unsupported, precision: "no_result",
    precisionNote: `${blocking.length} answer${blocking.length === 1 ? "" : "s"} needed before a result.` };

  const { precision, note, rangeQuestion } = precisionOf(ws, models, intent, pi, proj?.derivedInput ?? null);
  if (rangeQuestion) questions.unshift(fin(rangeQuestion));
  return { ...common, status: "ready", questions, unsupported, precision, precisionNote: note };
}

function factStatuses(input: NonNullable<ReturnType<typeof parseCase>>, years: number[]): MoneyFact[] {
  return years.flatMap(yi => [...input.years[yi].incomes.flatMap(r => Object.values(r).filter((v): v is MoneyFact => !!v && typeof v === "object" && "status" in v)),
    ...input.years[yi].coverage.flatMap(m => [m.enrollmentPremium, m.benchmarkPremium, m.advancePtc])]);
}

function precisionOf(ws: HouseholdWorkspace, models: YearModel[], intent: Intent, pi: number, derived: NonNullable<ReturnType<typeof parseCase>> | null):
  { precision: ReadinessPrecision; note: string; rangeQuestion: Draft | null } {
  const ranged = models.filter(hasRanges);
  if (!ranged.length) {
    const est = derived ? factStatuses(derived, models.map(m => m.yearIndex)).some(f => f.status === "estimated") : false;
    return est ? { precision: "estimated", note: "Calculated exactly on your entries; some of them are estimates.", rangeQuestion: null }
      : { precision: "exact", note: "Calculated exactly on confirmed entries.", rangeQuestion: null };
  }
  if (intent.kind === "two_year_terms") return { precision: "range_not_yet_checked", rangeQuestion: null,
    note: "Your income ranges are checked for the option you choose (exact credit limits and the declared range ends); options are compared at your entered values." };
  // The answer for subsidy/agreed checks: is a credit kept in each year? Credit loss is monotone in income,
  // so it is decided at the all-high and all-low ends (uncertainty.ts). For an offer: credit kept AND cash sign.
  const offerProfit = (m: YearModel): number => {
    if (intent.kind !== "evaluate_offer" || pi < 0) return 0;
    const p = ws.projects[pi];
    return [...p.receipts.map(l => [l, 1] as const), ...p.expenses.map(l => [l, -1] as const)]
      .filter(([l]) => !l.actual && !l.cancelledAt && l.expected?.date.startsWith(`${m.year}-`)).reduce((a, [l, s]) => a + s * l.expected!.amountCents, 0);
  };
  const offerDelta = (m: YearModel): ((pos: (k: string) => number) => number) | null => {
    if (intent.kind !== "evaluate_offer" || pi < 0) return null;
    const d = offerProfit(m);
    return pos => { const mm = modelAtPositions(m, pos); return evaluateYear(mm, { profitDelta: d, additionalSep: 0 }).spendable - evaluateYear(mm, NO_VARIATION).spendable; };
  };
  try {
    const changes: string[] = [];
    for (const m of ranged) {
      const N = UNCERTAINTY_SCALE;
      const d = offerDelta(m);
      const keep = (k: number) => solveCredit(modelAt(m, k), { profitDelta: offerProfit(m), additionalSep: 0 }, false).ptc.ptc > 0;
      if (keep(N) !== keep(-N)) changes.push(`${m.year}: the premium tax credit is kept at the low end of your range and lost at the high end.`);
      if (d) {
        const vals = checkedPositions(m, [NO_VARIATION]).positions.map(p => d(p.pos));
        if (Math.min(...vals) < 0 && Math.max(...vals) > 0) changes.push(`${m.year}: the offer adds cash at some points of your range and costs cash at others.`);
      }
    }
    if (!changes.length) return { precision: "range_stable", rangeQuestion: null,
      note: "The answer is the same across your declared ranges (credit kept or lost at both range ends; offer cash checked at the range ends and every threshold crossing)." };
    const dims = ranged.flatMap(m => rangeDims(m).map(d => ({ m, d })));
    const first = dims[0];
    const fIdx = ws.forecasts.findIndex(f => f.personId === first.d.personId && f.year === first.m.year);
    return { precision: "range_changes_answer", note: changes.join(" "), rangeQuestion: {
      id: `range:${first.d.key}:${first.m.year}`, code: "RANGE_DECIDES", paths: [fIdx >= 0 ? `forecasts[${fIdx}]` : "forecasts"], year: first.m.year, priority: 0, blocks: "decision",
      question: `Can you narrow ${first.d.label.charAt(0).toLowerCase() + first.d.label.slice(1)} for ${first.m.year}? Your current range changes the answer.`, reason: changes[0],
      answer: { kind: "range", lowCents: first.m.persons.find(p => p.id === first.d.personId)!.ranges[first.d.field]!.low, highCents: first.m.persons.find(p => p.id === first.d.personId)!.ranges[first.d.field]!.high },
      documentHint: first.m.year === 2026 ? "An updated profit and loss statement or signed invoices" : null } };
  } catch (e) {
    if (!(e instanceof EngineStop)) throw e;
    return { precision: "range_not_yet_checked", note: `Part of your range is outside the supported calculation: ${e.message}`, rangeQuestion: null };
  }
}
