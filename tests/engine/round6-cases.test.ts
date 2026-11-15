// Round 6 decision cases (SYNTHETIC households). Each case pins the decisive engine outputs; where the narrow independent
// oracle applies (TN MFJ, one CTC child, Schedule C only, uniform coverage, ≥250% FPL) the cash result is re-derived there.
// WRITE_CASES=1 npx vitest run tests/engine/round6-cases.test.ts → docs/artifacts/round6/scenarios/{decision-cases.md, inputs/*.json}
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { ChangeProposalSchema } from "@/domain/assistance";
import type { DealGoal, DealTermsSpace } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import {
  assessInputReadiness, DEAL_SEARCH_VERSION, ENGINE_VERSION, engineWorkspaceFingerprint, evaluateClientResponse, evaluateHouseholdWorkspace, evaluateOfferAsOffered,
  previewChange, RULES_VERSION, searchDealTerms, type EngineDealVariant, type EngineNoFeasibleTerms, type EngineReadyDealSearch,
} from "@/lib/engine";
import { annual, deal, dealWorkspace, T } from "./deal-fixture";
import { usd } from "./helpers";
import { oracle } from "./oracle";

const PREM = { 2026: usd(23013), 2027: usd(28122.84) }, BENCH = { 2026: usd(23013), 2027: usd(27789.36) };
const $ = (c: number | null | undefined) => (c === null || c === undefined ? "—" : `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const sections: string[] = [];
const inputs: Record<string, unknown> = {};
const write = (id: string, title: string, body: string[], input: unknown) => { sections.push([`## ${id}. ${title}`, "", ...body, ""].join("\n")); inputs[id] = input; };
/** Oracle two-year cash difference: owner profit per year (forecast + project money) and SEP total per year. */
const oracleDelta = (with_: [number, number], without: [number, number], sep: [number, number] = [usd(1000), 0], sepWithout: [number, number] = [usd(1000), 0]) =>
  ([2026, 2027] as const).reduce((a, y, i) => a + oracle(y, with_[i], sep[i], PREM[y], BENCH[y]).cash - oracle(y, without[i], sepWithout[i], PREM[y], BENCH[y]).cash, 0);
const optionRows = (vs: EngineDealVariant[], rec: string | null) => ["| Option | Terms | vs declining | vs offer as it stands | Retirement | Money by Dec 31, 2026 (received / free) | Holds | Client must agree |", "|---|---|---:|---:|---:|---:|---|---|",
  ...vs.map(v => { const d = v.moneyByDate.find(m => m.date === "2026-12-31");
    return `| ${v.id === rec ? "**Recommended** " : ""}${v.label.split(":")[0]} | ${$(v.terms.priceCents)}: ${v.terms.payments.map(p => `${$(p.amountCents)} ${p.date}`).join(" + ")}${v.terms.additionalSep ? `; SEP ${$(v.terms.additionalSep.amountCents)}` : ""} | ${$(v.comparisons.versusDeclineCents)} | ${$(v.comparisons.versusOfferedCents)} | ${$(v.retirementAddedCents)} | ${d ? `${$(d.receivedCents)} / ${$(d.availableCents)}` : "—"} | ${v.robustness.holds ? "yes" : "conditional"} | ${v.clientAgreement.required ? v.clientAgreement.changes.join(" + ") : "no"} |`; })];
const proposal = async (ws: HouseholdWorkspace, id: string, commands: unknown[]) => ({ ...ChangeProposalSchema.parse({ id, createdAt: "2026-11-16T10:00:00.000Z",
  base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) }, intent: "update", commands: [], ambiguities: [], resolvedDates: [], evidence: [], provenance: "manual", status: "proposed" }), commands }) as never;
const withPlan = (ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace) => { ws.dealPlanning = { version: "1.0", goals: [goal], termSpaces: [space], cashContext: null, packages: [] }; return ws; };

describe("round 6 decision cases", () => {
  it("1. near-cliff family: the offer as written loses the credit; the smallest change that holds is new dates at the same price", async () => {
    const ws = dealWorkspace(), d = deal();
    const asIs = await evaluateOfferAsOffered(ws, "B");
    if (asIs.status !== "ready") throw new Error();
    const r = await searchDealTerms(ws, d.goal, d.space, null) as EngineReadyDealSearch;
    const rec = r.variants.find(v => v.id === r.recommendedVariantId) as EngineDealVariant;
    expect([asIs.cashChangeCents, rec.terms.priceCents, rec.twoYearCashDeltaCents, rec.comparisons.versusOfferedCents]).toEqual([-usd(3616), usd(12000), usd(8310), usd(11926)]);
    // Independent oracle: owner profit = forecast + A ($3,000 received + $3,000 due Dec 1) + B as scheduled; agreed 2026 SEP $1,000.
    const declineP: [number, number] = [usd(118000), usd(118000)];
    expect(oracleDelta([usd(130000), usd(118000)], declineP)).toBe(asIs.cashChangeCents);
    expect(oracleDelta([usd(123400), usd(124600)], declineP)).toBe(rec.twoYearCashDeltaCents);
    write("1", "Near-cliff family: offer as written vs smallest change that holds", [
      "**Input.** Synthetic TN family (MFJ, one child under 15), Davidson County candidate benchmarks; 2026 profit $112,000 / 2027 $118,000 without projects; agreed project A ($3,000 received Oct 2 + $3,000 due Dec 1); offer B: $12,000 on Dec 20, 2026; agreed 2026 SEP goal $1,000 with $2,500 set aside. Goal: ≥ +$4,000 after both returns, ≥ $10,000 from B by Jan 10, 2027, extra SEP ≤ $1,000. Allowed: $12,000–$15,000, Dec 15–31 and Jan 4–10, ≤ 2 payments.",
      `**Offer as written:** ${$(asIs.cashChangeCents)} after both returns (2026 credit ${$(asIs.years[0].creditBeforeCents)} lost). Verdict: ${asIs.verdict}.`, "", ...optionRows(r.variants as EngineDealVariant[], r.recommendedVariantId), "",
      "**Action.** Ask the client to split the same price across December and January; keep the written confirmation that the January part is not available earlier.",
      "**Independent check.** Oracle (tests/engine/oracle.ts) gives the same two-year cash for the offer as written (−$3,616) and the recommended split (+$8,310), to the cent.",
      "**Limits.** County-level benchmark candidate; lattice search with exact re-check, not a global optimum; the higher price needs the client's agreement."], { workspace: ws, goal: d.goal, space: d.space });
  });

  it("2. ordinary profitable offer: accept as offered (no manoeuvre); no 2027 facts needed", async () => {
    const ws = dealWorkspace(80000);
    ws.forecasts = ws.forecasts.filter(f => f.year === 2026);
    expect(assessInputReadiness(ws, "new_offer", null, { projectId: "B" }).status).toBe("ready");
    const r = await evaluateOfferAsOffered(ws, "B");
    if (r.status !== "ready") throw new Error();
    expect([r.verdict, r.cashChangeCents]).toEqual(["accept_as_offered", usd(7797)]);
    // Outside the oracle's scope (its deduction scan reaches household income below 250% FPL): an identity check instead.
    const y = r.years[0];
    expect(y.cashChangeCents).toBe(y.receiptsCents - y.expensesCents - y.selfEmploymentTaxChangeCents - y.incomeTaxChangeCents + y.premiumTaxCreditChangeCents);
    write("2", "Ordinary profitable offer: accept as offered", [
      "**Input.** Same family, 2026 profit $80,000; 2027 facts not entered; offer B $12,000 on Dec 20, 2026.",
      `**Output.** Readiness: ready for 2026 only. ${r.reasons.join(" ")} Credit ${$(r.years[0].creditBeforeCents)} → ${$(r.years[0].creditAfterCents)}; ${$(r.years[0].roomAfterCents)} of extra 2026 profit still keeps it.`,
      `Attribution 2026: receipts ${$(r.years[0].receiptsCents)} − SE tax ${$(r.years[0].selfEmploymentTaxChangeCents)} − income tax ${$(r.years[0].incomeTaxChangeCents)} + credit change ${$(r.years[0].premiumTaxCreditChangeCents)} = ${$(r.years[0].cashChangeCents)}.`,
      "**Action.** Accept as offered.", "**Independent check scope.** Outside the oracle's income range (its scan goes below 250% FPL); the attribution identity above is checked instead.", "**Limits.** 2027 not affected by this offer; not asked."], { workspace: ws, projectId: "B" });
  });

  it("3. unknown spouse income: one question, no result (refuses to guess $0)", async () => {
    const ws = dealWorkspace();
    const row = ws.household.years[0].otherIncomes.find(i => i.personId === "spouse")!;
    for (const k of ["grossWages", "w2Box1", "socialSecurityWages", "medicareWages"] as const) row[k] = { valueCents: null, status: "unknown", sourceId: row[k].sourceId };
    const rd = assessInputReadiness(ws, "new_offer", null, { projectId: "B" });
    const ev = await evaluateOfferAsOffered(ws, "B");
    expect([rd.status, rd.questions[0].key, ev.status]).toEqual(["needs_data", "wages:spouse:2026", "needs_data"]);
    write("3", "Unknown spouse income: asks instead of assuming", [
      "**Input.** Case 1 family, but the spouse's 2026 wages are unknown.",
      `**Output.** Readiness \`${rd.status}\`; first question: "${rd.questions[0].question}" (${rd.questions[0].blocking}; if unknown: ${rd.questions[0].ifUnknown}). The offer evaluation returns \`${ev.status}\`; no figure is shown.`,
      "**Action.** Enter the spouse's expected full-year pay or confirm no wages.", "**Limits.** A year-to-date pay stub is not the annual amount."], { workspace: ws });
  });

  it("4. two independent income ranges: precision reported, recommendation conditional with the deciding fact named", async () => {
    const ws = dealWorkspace(), d = deal();
    ws.forecasts[0] = { ...annual("primary", 2026, 112000), annualNetProfit: { valueCents: usd(112000), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(100000), highCents: usd(125000) } } };
    const sp = ws.household.years[0].otherIncomes.find(i => i.personId === "spouse")!;
    sp.taxableInterest = { valueCents: usd(500), status: "estimated", sourceId: sp.taxableInterest.sourceId, range: { lowCents: 0, highCents: usd(2000) } };
    const rd = assessInputReadiness(ws, "new_offer", null, { projectId: "B" });
    const r = await searchDealTerms(ws, d.goal, d.space, null) as EngineReadyDealSearch;
    const rec = r.variants.find(v => v.id === r.recommendedVariantId) as EngineDealVariant;
    expect(rd.precision).toBe("range_changes_answer");
    expect(rec.robustness).toMatchObject({ basis: "declared_ranges", holds: false });
    expect(r.decisionFacts.length).toBeGreaterThan(0);
    write("4", "Two independent ranges (business profit and spouse interest)", [
      "**Input.** Case 1 with 2026 profit estimated $100,000–$125,000 (entered $112,000) and spouse taxable interest $0–$2,000 (entered $500).",
      `**Output.** Offer readiness precision: \`${rd.precision}\` (${rd.precisionNote}). Search: recommended option is \`conditional\` (holds across ranges: no). Deciding facts: ${r.decisionFacts.map(f => `${f.label} — ${f.effect}`).join(" ")}`,
      "", ...optionRows(r.variants as EngineDealVariant[], r.recommendedVariantId), "",
      "**Action.** Narrow the 2026 profit estimate first (updated P&L); then search again.",
      "**Independent check scope.** Credit loss across ranges is decided at the all-high end (monotone); cash at the documented finite set. Not a proof between checked points."], { workspace: ws, goal: d.goal, space: d.space });
  });

  it("5. client counteroffer: compared with declining, the previous offer and the original; the client's limit removes January", async () => {
    const ws = withPlan(dealWorkspace(), deal().goal, deal().space);
    const ev = await evaluateClientResponse(ws, { id: "resp-1", projectId: "B", recordedAt: T, sourceId: "demo-input", kind: "counteroffer",
      terms: { priceCents: usd(12500), payments: [{ amountCents: usd(12500), date: "2026-12-28" }] }, limits: { latestPaymentDate: "2026-12-31", priceFixed: false, maxPayments: null },
      refundCents: null, cancellationCostCents: null }, "2026-11-16");
    if (!("results" in ev)) throw new Error();
    const re = await searchDealTerms(ws, deal().goal, ev.restrictedSpace!, null) as EngineNoFeasibleTerms;
    expect([ev.meetsGoal, ev.results[0].amountCents, ev.results[1].amountCents, re.status, re.binding]).toEqual([false, -usd(3186), usd(430), "no_feasible_terms", ["price_max", "additional_sep"]]);
    write("5", "Client counteroffer: $12,500, all on Dec 28, no January payments", [
      "**Input.** Case 1; the client answers: $12,500 total, paid Dec 28, 2026; nothing in 2027.",
      `**Output.** ${ev.results.map(x => `${$(x.amountCents)} vs ${x.basis.label}`).join("; ")}. Meets the goal: ${ev.meetsGoal}. The next search uses only the December window.`,
      `Re-search with the client's limit: **no feasible terms**. ${re.violated.map(v => v.detail).join(" ")} Limits that alone would reach the goal: ${re.binding.join(", ")}. Closest valid option: ${re.nearest.map(n => `${n.variant.label} (${$(n.variant.twoYearCashDeltaCents)}, short ${$(n.shortfallCents)})`).join("; ")}.`,
      "**Action.** Explain to the client that a December-only payment of this size loses the subsidy; propose the split again or accept a smaller result knowingly.",
      "**Limits.** The $21,000 price relaxation is a figure to discuss, never presented as accepted."], { workspace: ws, response: "counteroffer $12,500 on 2026-12-28, latest 2026-12-31" });
  });

  it("6. partial receipt across years: received part counts in 2026, the rest in 2027; nothing doubled or lost", async () => {
    const ws = dealWorkspace();
    const pv = await previewChange(ws, await proposal(ws, "partial", [{ type: "record_partial_receipt", projectId: "A", lineId: "a2", amountCents: usd(1000), date: "2026-11-16",
      remainderDate: "2027-01-08" }]), { userDate: "2026-11-16" });
    if (!("changes" in pv)) throw new Error();
    expect([pv.status, pv.after!.cashDeltaCents, pv.changes[0].after]).toEqual(["ready", -usd(5), "$1,000 received on 2026-11-16; $2,000 still expected on 2027-01-08"]);
    // Oracle: 2026 profit 118,000 → 116,000; 2027 118,000 → 120,000.
    expect(oracleDelta([usd(116000), usd(120000)], [usd(118000), usd(118000)])).toBe(pv.after!.cashDeltaCents);
    write("6", "Partial receipt across tax years", [
      "**Input.** Case 1; of A's $3,000 due Dec 1, $1,000 arrives Nov 16, 2026; the rest ($2,000) is now expected on Jan 8, 2027.",
      `**Output.** ${pv.changes[0].before} → ${pv.changes[0].after}. ${pv.notes.join(" ")} 2026 credit ${$(pv.before!.currentYearSubsidyCents)} → ${$(pv.after!.currentYearSubsidyCents)}; cash vs the plan before: ${$(pv.after!.cashDeltaCents)}.`,
      "**Independent check.** Oracle on 2026 profit $116,000 / 2027 $120,000 vs $118,000 / $118,000 gives the same −$5.",
      "**Limits.** The rest is the expected amount minus what arrived, on the date the user gives; settling for less is a separate explicit event, never inferred from a smaller receipt."], { workspace: ws });
  });

  it("7. SEP paid in February 2027: the tax year must be stated — the two answers differ", async () => {
    const ws = dealWorkspace();
    const as = async (taxYear: 2026 | 2027) => { const pv = await previewChange(ws, await proposal(ws, `sep-${taxYear}`, [{ type: "record_sep_contribution", personId: "primary", taxYear, amountCents: usd(1500), paidDate: "2027-02-10" }]), { userDate: "2027-02-10" });
      if (!("years" in pv)) throw new Error(JSON.stringify(pv)); return pv; };
    const a = await as(2026), b = await as(2027);
    expect(a.years[0].after!.subsidyCents).not.toBe(b.years[0].after!.subsidyCents);
    write("7", "SEP-IRA contribution paid in February 2027", [
      "**Input.** Case 1; $1,500 paid into the SEP-IRA on Feb 10, 2027 (2026 goal $1,000).",
      `**Output.** For tax year 2026: 2026 credit ${$(a.years[0].after!.subsidyCents)}, 2027 credit ${$(a.years[1].after!.subsidyCents)}. For tax year 2027: 2026 credit ${$(b.years[0].after!.subsidyCents)}, 2027 credit ${$(b.years[1].after!.subsidyCents)}.`,
      "**Action.** The contribution's tax year is asked (from the SEP confirmation); it is never inferred from the payment date.", "**Limits.** Contributions for a year are allowed until that return's due date, including extensions."], { workspace: ws });
  });

  it("8. no useful change: keep the offer; and when only the offer is allowed, its result is shown as is", async () => {
    const ws = dealWorkspace(80000), d = deal({ minCash: 0 });
    const r = await searchDealTerms(ws, d.goal, d.space, null) as EngineReadyDealSearch;
    const rec = r.variants.find(v => v.id === r.recommendedVariantId) as EngineDealVariant;
    const fixed = await searchDealTerms(dealWorkspace(), deal({ newTerms: null, minCash: -5000 }).goal, deal({ newTerms: null, minCash: -5000 }).space, null) as EngineReadyDealSearch;
    expect([rec.purpose, rec.comparisons.versusOfferedCents]).toEqual(["as_offered", 0]);
    write("8", "Zero or negative improvement", [
      `**Input A.** 2026 profit $80,000; same goal search. **Output:** recommended "${rec.label}" — ${$(rec.twoYearCashDeltaCents)} vs declining, ${$(rec.comparisons.versusOfferedCents)} vs the offer. Nothing to negotiate.`,
      `**Input B.** Case 1, client has not agreed to discuss new terms. **Output:** only the offer is evaluated: ${fixed.variants.map(v => `${v.label.split(":")[0]} ${$(v.twoYearCashDeltaCents)}`).join("; ")}. Headroom does not invent a better option.`,
      "**Limits.** A different price or dates would need the client's agreement."], { workspace: ws, goal: d.goal, space: d.space });
  });

  it("9. impossible deadline: $15,000 by Dec 20 with a $13,000 price cap — no terms, binding limit and nearest option", async () => {
    const d = deal({ maxPrice: 13000, targets: [{ id: "dec20", kind: "project_receipts", byDate: "2026-12-20", minimumCents: usd(15000) }] });
    const r = await searchDealTerms(dealWorkspace(), d.goal, d.space, null) as EngineNoFeasibleTerms;
    expect(r.status).toBe("no_feasible_terms");
    expect(r.violated.map(v => v.id)).toContain("date_target");
    write("9", "Impossible deadline", [
      "**Input.** Case 1; goal adds ≥ $15,000 received from B by Dec 20, 2026; price capped at $13,000.",
      `**Output.** No feasible terms. ${r.violated.map(v => v.detail).join(" ")} Relaxations (one at a time): ${r.relaxations.map(x => x.explanation).join(" ")} Closest valid options: ${r.nearest.map(n => `${n.variant.label} (short ${$(n.shortfallCents)}; unmet: ${n.unmet.join(", ")})`).join("; ") || "none"}.`,
      "**Limits.** Relaxations are evaluated one at a time with every other limit unchanged."], { goal: d.goal, space: d.space });
  });

  it("10. unsupported household: refuses a recommendation", async () => {
    const ws = dealWorkspace(); ws.household.state = "CA";
    const rd = assessInputReadiness(ws, "new_offer", null, { projectId: "B" });
    const r = await searchDealTerms(ws, deal().goal, deal().space, null);
    expect([rd.status, r.status]).toEqual(["unsupported", "unsupported"]);
    write("10", "Outside the supported scope (California)", [
      `**Output.** Readiness \`${rd.status}\`: ${rd.unsupported[0].reason} The search returns \`${r.status}\`; no option or recommendation is shown. ${rd.precisionNote}`], { workspace: ws });
  });

  afterAll(async () => {
    if (!process.env.WRITE_CASES) return;
    const ev = await evaluateHouseholdWorkspace(dealWorkspace());
    const head = ["# Round 6 decision cases (synthetic)", "",
      `Generated by \`WRITE_CASES=1 npx vitest run tests/engine/round6-cases.test.ts\` with engine \`${ENGINE_VERSION}\`, deal \`${DEAL_SEARCH_VERSION}\`, rules \`${RULES_VERSION}\`. Every figure below comes from the engine; the test pins them. Households are synthetic; no customer data or customer results.`, "",
      "Sources: rule pack `data/rules/us-federal-2026.json` / `-2027.json` (IRS Rev. Proc. 2025-32, 2026-35; DRAFT 2026 Form 8962 Table 2; Rev. Proc. 2026-26 for 2027 applicable percentages; HHS 2025/2026 poverty guidelines), CMS Landscape PY2026/PY2027 Davidson County extracts (county candidates). See `docs/SOURCES.md` and `data/reference/source-manifest.json`.", "",
      "Independent check: `tests/engine/oracle.ts` — own constants, whole-dollar scans, no engine arithmetic; scope TN MFJ, one CTC child, Schedule C only, uniform coverage, income ≥ 250% FPL. It shares one input with the engine: the transcribed draft 2026 Table 2. Cases 1 and 6 are re-derived there to the cent; others state their check scope.", "",
      `Baselines are named in every row: "vs declining" = the plan without the unpaid terms; "vs offer as it stands" = the current client offer. Retirement is shown separately and never counted as spendable cash. Base household check: ${ev.status}.`, "",
      "Editable inputs: `docs/artifacts/round6/scenarios/inputs/case-<n>.json` (workspace + goal + terms) — load as a plan JSON or pass to the engine functions.", ""];
    mkdirSync("docs/artifacts/round6/scenarios/inputs", { recursive: true });
    writeFileSync("docs/artifacts/round6/scenarios/decision-cases.md", [...head, ...sections.sort((a, b) => Number(a.slice(3, 5)) - Number(b.slice(3, 5)))].join("\n"));
    for (const [id, v] of Object.entries(inputs)) writeFileSync(`docs/artifacts/round6/scenarios/inputs/case-${id}.json`, JSON.stringify(v, null, 2) + "\n");
  });
});
