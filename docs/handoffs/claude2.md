# Claude 2 handoff — financial engine

Branch `claude2`. Status: **both entry points implemented and checked**; ready for UI/API integration. No shared contract or fixture was changed.

- Engine version: `headroom-engine-1.0.0`
- Rules version: `us-federal-aca-2026-2027.r1` (`data/rules/us-federal-2026.json`, `us-federal-2027.json`, `sources.json`)
- No AI, network, database, login, clock (`Date.now`) or randomness in `src/lib/engine/**`.

## Public signatures (unchanged contract)

```ts
// src/lib/engine/index.ts
assessCurrentRisk(input: CaseInput): Promise<RiskAssessment>
calculateComparison(input: CaseInput): Promise<ComparisonResult>
calculationFingerprint(input: CaseInput): Promise<string>   // SHA-256(canonical key-sorted input + engine + rules version)
ENGINE_VERSION, RULES_VERSION
```

Both run `CaseInputSchema.safeParse` themselves and never throw for domain problems.

- `assessCurrentRisk` uses **only `years[0]` (2026)**. No project amount and no 2027 data are needed (a zero-revenue opportunity is fine; 2027 may be all unknown). Returns MAGI, the 400% threshold, PTC, `advanceSettlementCents = APTC − PTC`, and `additionalProfitHeadroomCents` = extra **Schedule C profit** before the credit is lost, found by re-solving SEHI/PTC (not threshold minus revenue). States: `over_cliff` (line 5 = 401), `no_credit` (eligibility not confirmed, or benchmark below the contribution — explicitly "not an income cliff"), `at_risk` (headroom < 10% of the threshold, or the high end of a declared range loses the credit), `below_cliff`. If the full return is outside the take-home range (e.g. possible EITC), the risk is still returned with a warning.
- `calculateComparison` needs both years. Scenario `id` = `kind` (each kind at most once). `baselineScenarioId` is always `"decline"`; `twoYearCashDeltaCents` is relative to it. Options that the user's constraints forbid (no split / no renegotiation) or that do not help are **omitted, with a warning saying why**. Options that would help but violate a constraint (over SEP budget, unconfirmed timing, second payment after the latest date) are returned with `feasible: false` and `infeasibilityReasons` and are never recommended.
- Blocked results: `status` `needs_data` (unknown fact, missing income row, unconfirmed scope/eligibility, unknown benchmark, missing source id, baseline SEP above legal limit) or `unsupported` (outside scope), with `code`, English `message` and `fields[].path` in contract paths, e.g. `years[0].incomes[1].w2Box1`.
- `YearResult.trace` ids are `"<year>.<item>"` with input paths and source ids from `sources.json` plus evidence ids. `spendableAfterSettlementCents` excludes all SEP money; `additionalRetirementCents` is shown separately.

## Supported case (checked in `guard.ts`, not just described)

TX/FL/TN; single or MFJ; one sole-proprietor Schedule C (the opportunity owner, primary or spouse) without a loss; W-2 wages per person; taxable and tax-exempt interest; standard deduction; dependents (CTC qualifying children under 17 at year end; other dependents → $500 credit); full-year Marketplace coverage with the same PTC and SEHI eligibility in all 12 months; owner-only SEP; adults under 65 through the year; taxable income before QBI ≤ $201,750 single / $403,500 MFJ.

Refused with explicit codes: other states/filing statuses (`STATE_NOT_SUPPORTED`, `FILING_STATUS`), more than one business or non-owner SEP (`MULTIPLE_BUSINESSES`, `SEP_NON_OWNER`), loss (`LOSS`), dependent income, `unsupportedFacts`, `scopeConfirmed=false`, partial-year coverage or eligibility (`PARTIAL_YEAR_COVERAGE`, `PARTIAL_ELIGIBILITY`), payroll that does not reconcile (box 1 ≠ gross − pre-tax, Medicare/SS wage ordering) or SS wages above the wage base (`PAYROLL_MODEL`, `EXCESS_SS`), age 65 (`AGE_65`), CTC age conflicts, income below 100% FPL (`BELOW_100_FPL`: the exception's conditions are not modeled and APTC > 0 is not treated as proof), possible EITC (`EITC_POSSIBLE`: AGI and earned income under a conservative bound above the IRS phase-out ends), refundable CTC in 2027 (`ACTC_NOT_TRANSCRIBED`) or for 3+ children (`ACTC_THREE_PLUS`), accrual method (`ACCRUAL_METHOD`), receipts/expenses outside 2026–2027, taxable income above the support limit (`TAX_RANGE`). Unknown never becomes zero; a spouse missing from `incomes` is `needs_data` (`INCOME_ROW_MISSING`).

Implemented: Schedule SE per person (own SS wages only), employee FICA, Additional Medicare tax (Form 8959), NIIT, QBI (simplified form, $400 minimum from 2026, material participation assumed), Tax Table / rate schedule, CTC/ODC with phaseout, 2026 refundable CTC (1–2 children), SEP limit (20% of profit after half SE tax; annual cap $72,000 / $75,000), SEHI, Form 8962 annual (line 11) or monthly (lines 12–23, varying premiums) path, APTC settlement without repayment cap.

## Prototype errors fixed

| Prototype issue | Fix |
| --- | --- |
| Spouse wages reduced the owner's SS cap | Schedule SE per individual with that person's SS wages. $150k profit + spouse $80k wages → SE tax **$21,194.33** (prototype $16,975.23). |
| 175% FPL → 0.0539 | 2026 uses the transcribed DRAFT Table 2; the band method in exact decimal (half up, 4 places) reproduces **all 301** entries incl. 175 → **0.0540** and is used for 2027. |
| 2027 SS base / DC cap = 2026 values | $192,300 / $75,000. |
| Fixed-point / equality SEHI | Inequality `d + PTC(d) ≤ premium` solved exactly (method below). $23k counterexample: SEHI **$560**, PTC **$7,146**; no equality solution exists at ≥ 100% FPL, so the old method returned no credit. |
| Coarse $10 grid + one local refinement | Monotonicity proof + bisection for SEHI; threshold-aware bounded search for decisions. |
| Hard-coded final 32% bracket, simplified CTC | Brackets only to 24% with an explicit support limit; CTC phaseout/refundable rules or a refusal. |
| APTC > 0 implied below-100% eligibility | Below 100% is refused; SEHI choices never push income below 100%. |

## Rounding policy

Integer cents everywhere. Rates are exact decimals from the packs (parsed with decimal.js) applied with exact integer arithmetic — no binary floating-point multiplication. Rounding happens only where a form rounds: Schedule SE lines to cents (half up); half SE tax to cents; Form 8962 line 5 truncated, lines 8a and 8b to whole dollars (half up); SEHI chosen in whole dollars; Tax Table (band midpoint, whole dollars) below $100,000 taxable income, rate schedule to cents above; SEP limit rounded down to cents. Versus the historical audit this changes cash by ≤ $3 per year (Tax Table + cent-rounded SE lines); SEHI and PTC at the audit's decisions are identical.

## SEHI/PTC and search method

- **SEHI/PTC** (`year.ts: solveCredit`): with household income ≥ 100% FPL, PTC is non-decreasing and tax non-increasing in the deduction `d`, so cash is non-decreasing and `g(d) = d + PTC(d)` is strictly increasing. The valid set is `[0, d*]`; `d*` is found exactly by bisection even across the 133%/400% and rounding jumps. Equality is not required.
- **Decisions** (`search.ts`): SEP amount, 2026/2027 receipt split and counteroffer price move each year's solved MAGI monotonically. Upward jumps can occur only at structural thresholds (400% line, line-5 steps where the figure changes, 100%); each crossing is located by bisection and evaluated with its neighbours. Between thresholds the objective is piecewise linear; a ≤ 4,000-point grid plus a $1 scan around the best point bounds the gap by 2 × step + $20 rounding noise (stated in each scenario's assumptions). Ranges ≤ $4,000 are scanned at every dollar. The oracle test confirms the family choices.
- **SEP minimum**: smallest contribution with the most spendable cash within the user's budget (otherwise returned infeasible with the amount needed). **SEP buffer**: with declared ranges, the smallest contribution that keeps the credit with every range at its high end; without ranges, the user's own maximum contribution (labelled as such, with the remaining margin). **Split**: best 2026 portion; second part on the first 2027 business day (2027-01-04), checked against `nextYearPaymentLatestDate` and timing confirmations; expenses stay in their payment year. **Counteroffer**: lowest price ≥ the offer reaching break-even vs declining, or the user's desired gain; never a lower price.
- **Stress** (when any income fact has a `range`): all ranges moved together from low to high; 41 grid positions plus every threshold crossing for the option and for declining. `fails_within_range` when the conclusion at the entered values does not hold (credit lost, result falls below target, or a point becomes infeasible/unsupported); the worst two-year cash change is reported. Coverage ranges and independent (non-comonotone) combinations are not explored.
- **Ranking**: `spendable_cash` → highest two-year cash change among feasible options meeting `minimumDesiredCashGainCents` (decline only when that target is 0); `retirement_and_cash` → most retirement contribution among those, then cash. Retirement dollars are never added to cash. `recommendedScenarioId` is `null` (with a warning) when nothing meets the target.

## Demo results (synthetic, county-candidate benchmark, eligibility assumed)

`family-cliff` — current risk **at_risk**: MAGI $99,730.56, threshold $106,600, PTC $13,080, settlement +$333 (repay), headroom **$8,127** of extra profit. Recommended `split_payment` (with `retirement_and_cash`: `sep_buffer`).

| Scenario | Two-year cash vs decline | Retirement | 2026 MAGI / PTC | 2027 MAGI / PTC |
| --- | ---: | ---: | --- | --- |
| Decline (baseline) | $0 | $0 | 99,730.56 / 13,080 | 99,193.56 / 17,651.36 |
| Accept $12,000 Dec 20 | −$3,435.55 | $0 | 106,600.79 / 0 | 99,193.56 / 17,651.36 |
| Accept + SEP $3,599 | +$5,361.45 | $3,599 | 106,599.79 / 12,396 | unchanged |
| Accept + SEP $5,500 (user max) | +$3,800.45 | $5,500 | 104,870.79 / 12,568 | unchanged |
| Split $8,081 / $3,919 (Jan 4) | **+$8,315.46** | $0 | 106,560.66 / 12,400 | 102,497.70 / 17,314.36 |
| Counteroffer $16,001 | +$0.13 (break-even) | $0 | 106,600.13 / 0 | unchanged |

Against the indicative audit numbers: accept −$3,435 (same); SEP $3,600 → $3,599 (cents make $3,599 sufficient; +$5,361); SEP $5,500 +$3,799 → +$3,800 (Tax Table rounding); the fixed 4,000/8,000 split (+$8,306) is improved by the optimizer to 8,081/3,919 (+$8,315).

`ordinary-gig` — current risk **below_cliff** (MAGI $39,412.20, threshold $62,600, PTC $3,262, settlement −$862, headroom $28,067). Accept +$3,872.22; recommended `accept_now` with "No special action is needed"; split/counteroffer omitted because the constraints forbid them, SEP omitted because it adds no cash.

`missing-spouse-income` — both entry points return `needs_data` / `FACT_UNKNOWN` with paths `years[0].incomes[1].w2Box1`, `socialSecurityWages`, `medicareWages`, `grossWages`.

## Verification

`npm run typecheck` ✓, `npm test` ✓ (27 tests: 25 engine + 2 foundation), `npm run build` ✓.

`tests/engine` covers the ACCEPTANCE groups once each:

1. `boundaries.test.ts` — 301-entry Table 2 comparison; 2026/2027 band edges; FPL; line 5 at 100/133/400/above-400; credit at exactly 400%.
2. `sehi-ptc.test.ts` — $23k counterexample + independent exhaustive scan (transcribed table data, own arithmetic).
3. `payroll-sep.test.ts` — per-person SS cap; spouse wages in cash/FICA/MAGI; SEP base; negative/excess/existing SEP; over-budget SEP infeasible.
4. `family-oracle.test.ts` — **independent oracle**: own constants, no engine arithmetic, scans every whole-dollar SEHI deduction (scope: TN MFJ, one child, Schedule C only, ≥ 250% FPL). Matches every scenario exactly in both years (SEHI, MAGI, PTC, spendable to the cent), confirms the SEP and split choices cannot be beaten, cash excludes retirement and APTC is not subtracted twice; plus ≤ $5/year agreement with `audit-results.json` at its decisions.
5. `scenarios-blocks.test.ts` — expenses stay in their payment year when receipts split; a 2027 credit loss is not hidden; spouse unknown / omitted row; partial coverage, mixed eligibility, state, scope; current risk with no project and unknown 2027; EITC region refuses take-home but keeps risk; uncertainty range crossing the 400% line (minimum fails, buffer holds); ordinary project; fingerprint reproducibility.

Latency (container, Node 22, single measurement): family comparison ≈ 190 ms cold, ordinary ≈ 26 ms, current risk 2–35 ms. Target ≤ 1–2 s.

## Known limitations

- 2027 brackets come from the prototype's transcription of Rev. Proc. 2026-35; irs.gov was not reachable from this environment, so they were not re-read here. The 2027 refundable CTC amount is not transcribed (→ refusal where it matters). The 2027 return due date is set to 2028-04-18 (weekend + Emancipation Day) and should be confirmed.
- 2026 Table 2 is from the **DRAFT** Form 8962 instructions; 2027 figures are derived from the Rev. Proc. 2026-26 bands (no 2027 table exists yet).
- Below-100% FPL eligibility, partial-year coverage/eligibility, accrual method, itemizing, EITC, capital gains, other credits/deductions, state tax and QBI above the threshold are refused, not approximated.
- Uncertainty: only income-fact ranges, moved together; coverage ranges are ignored.
- Demos assume eligibility and county-candidate benchmarks. No CPA or independent professional review was performed; the oracle is an independent re-implementation by the same author over a narrow scope.

## Integration notes

- Claude 1: render `feasible`/`infeasibilityReasons`, `warnings` (they explain omitted options), `stress.checkedDescription`, and keep `additionalRetirementCents` separate from cash. Every number should come from these results.
- Claude 3: no new env, migration or dependency (decimal.js and zod were already in the lockfile). The engine imports JSON from `data/rules` and `data/reference` (works in the Next build and Vitest). `/demo` already calls `calculateComparison` and now receives a ready result.
