# Claude 2 — round 2 handoff (financial engine)

Branch `claude2`, merged with `origin/main` (`d6590ac`) by a normal merge; the integrator's fixes are kept (2027 QBI $415/$1,030, source links, forecast-based Marketplace action, refused payroll/SEP/coverage ranges).

- Engine `headroom-engine-1.1.0` (was 1.0.1), rules `us-federal-aca-2026-2027.r3` (was r2). Results changed, so saved fingerprints from r2 no longer match — by design.
- Shared contract unchanged. One **new, additive** engine entry point (below); existing `assessCurrentRisk` / `calculateComparison` keep their signatures and statuses.

## 1. Rules checked against primary sources (2026-11-14)

Network access to irs.gov was added for this session (a separate personal environment `headroom-official-sources`, hosts irs.gov/ssa.gov/hhs.gov/healthcare.gov only). PDFs and SHA-256 hashes: `data/reference/source-manifest.json`; per-value status: `data/rules/sources.json`.

| Rule | Source | Result |
| --- | --- | --- |
| QBI minimum deduction | [Form 8995 (2026) draft](https://www.irs.gov/pub/irs-dft/f8995--dft.pdf) lines 15–17 and [instructions](https://www.irs.gov/pub/irs-dft/i8995--dft.pdf) "Line 17" | **Discrepancy fixed.** Line 17 = greater of line 15 (already limited to 20% of taxable income) and the minimum. r2 capped the minimum by the taxable-income limit. Case: MFJ, spouse wages $31,600, profit $1,500, 2026 → QBI deduction $400 (not $159), taxable $394, tax $39 (not $64). Regression in `tests/engine/rules-r3.test.ts`. |
| Whole-dollar return | [2026 Form 1040 instructions draft](https://www.irs.gov/pub/irs-dft/i1040gi--dft.pdf) "Rounding Off to Whole Dollars"; [Form 8962 instructions draft](https://www.irs.gov/pub/irs-dft/i8962--dft.pdf) "Entering amounts from Form 1095-A" (dollars only) | **Discrepancy fixed.** r2 used cents on Form 8962 line 3; e.g. household income $106,600.40 must be entered as $106,600 (credit kept). If any amount is rounded, all must be: the return is now whole dollars (sum with cents, round each line total, 50¢ up). Cash flows stay in cents. Regression in `boundaries.test.ts`. |
| Tax Table | same 1040 draft, Tax Table | **Method verified on all 2,062 rows** (`data/reference/2026-tax-table.json`). **Finding:** the draft table's rows equal the method applied to **2025** brackets (single 11,925…, MFJ 23,850…), not the 2026 brackets of Rev. Proc. 2025-32; e.g. $25,000–25,050 shows $2,765/$2,526, but the 2026 brackets give $2,755/$2,507. The engine keeps the final 2026 brackets; the draft values are used only to verify the method. |
| 2027 refundable CTC | [Rev. Proc. 2026-35](https://www.irs.gov/pub/irs-drop/rp-26-35.pdf) §3.05(2): $1,800 | **Gap closed.** r2 refused 2027 cases needing the refundable part (`ACTC_NOT_TRANSCRIBED`). Now calculated (1–2 children). Regression in `rules-r3.test.ts`. |
| 2026 CTC / refundable | [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) §3.05: $2,200 / $1,700 | Confirmed. ACTC earned income = wages + Schedule C profit − half SE tax ([Schedule 8812 draft](https://www.irs.gov/pub/irs-dft/i1040s8--dft.pdf), Earned Income Worksheet) — confirmed. |
| EITC refusal boundary | Rev. Proc. 2025-32 §3.06, 2026-35 §3.06 | Replaced the hand-set bound with the official **completed phaseout amounts** (2026 single 19,540/51,593/58,629/62,974; MFJ 26,820/58,863/65,899/70,244; 2027 single 20,164/53,277/60,519/65,002; MFJ 27,684/60,787/68,029/72,512). EITC is zero when the greater of AGI and earned income reaches them; below them the take-home result is refused, not calculated. |
| QBI support limit | Rev. Proc. 2025-32 §3.26, 2026-35 §3.28(1) | 2026 $201,750 / $403,500 confirmed; 2027 now uses its own $208,300 / $416,600 (still inside the 24% bracket). |
| 2026 brackets, applicable-percentage tables 2026 and 2027 | Rev. Proc. 2025-32 §3.01; [2025-25](https://www.irs.gov/pub/irs-drop/rp-25-25.pdf), [2026-26](https://www.irs.gov/pub/irs-drop/rp-26-26.pdf) | Confirmed, no change. |
| Form 8962 lines 5, 8a, 8b | 8962 draft, Worksheet 2 and line instructions | Confirmed: line 5 decimals dropped (401 above 400%); 8a and 8b rounded to whole dollars. |
| SEHI/PTC valid solution | [Pub. 974 (2025)](https://www.irs.gov/pub/irs-pdf/p974.pdf) "Self-Employed Health Insurance Deduction and PTC" | Confirmed: any method is allowed if deduction + PTC computed with that deduction ≤ enrollment premiums. Engine method unchanged (largest valid whole-dollar deduction, monotonicity proof in `year.ts`). |
| Deadlines | IRC §7503 rule; Pub. 560 (SEP by return due date incl. extensions) | 2026 return 2027-04-15; 2027 return set to 2028-04-18 (April 15 Saturday; DC Emancipation Day observed Monday April 17) — derived, to be confirmed when IRS announces. SEP action now says "until the return due date (later if you file an extension)". |

AMT: not applicable in the supported range (ordinary income, standard deduction, taxable income below the QBI thresholds; tentative minimum tax stays below regular tax). Not separately coded; noted here.

## 2. Ranges now mean independent ranges

`src/lib/engine/uncertainty.ts`. Allowed ranges stay as the integrator set them (owner's profit, adults' taxable/tax-exempt interest); payroll/SEP/coverage ranges remain refused — a consistent W-2 box 1/3/5/gross/pre-tax range model was **not** added.

- Every allowed ranged amount can only raise household income after the SEHI/PTC solution. Therefore **credit loss** is decided exactly for every combination (at the all-high combination) and **validity** (below 100% FPL, possible EITC, SEP above the profit-based limit) at the all-low combination.
- The two-year cash change is not monotone. It is evaluated on a stated finite set: every combination of range ends (up to 6 ranges = 64 corners), each range swept with the others at low and at high ends, all ranges together, plus every subsidy-threshold crossing on those paths. The description says "the worst among the checked combinations, not a proven minimum". Years are independent and cash is additive, so the worst two-year value is the sum of each year's worst checked value.
- `fails_within_range` = a combination is invalid, or a premium tax credit kept at the entered values is lost, or a result meeting the target at entered values falls below it.
- At-risk state and the SEP buffer use the all-high combination (exact by the same monotonicity).

## 3. New: evaluate an agreed plan without re-optimizing

```ts
// src/lib/engine/index.ts (additive)
evaluateAgreedPlan(input: CaseInput,
  plan: { kind: ScenarioKind; label?: string; decisions: ScenarioResult["decisions"] },
  previous?: ScenarioResult | null): Promise<AgreedPlanEvaluation>
// AgreedPlanEvaluation = BlockedComparison | {
//   status: "ready"; engineVersion; rulesVersion; calculationFingerprint; caseId;
//   agreed: ScenarioResult | null;   // same decisions on current facts (id "agreed"), null if they can no longer be calculated
//   stillFeasible: boolean; reasons: string[];
//   changes: Array<{ year: TaxYear | null; item; label; previousCents; currentCents }>;
//   creditLostYears: TaxYear[]; warnings: string[] }
```

Same guards, rules and year calculation as the comparison. Receipts, expenses and SEP are kept exactly. Reasons explain impossibility: SEP above the current maximum or now above the legal limit, a 2027 payment when splitting is no longer allowed, timing confirmation withdrawn, payment after the latest acceptable date, dates outside 2026–2027, SEP for a non-owner. Warnings flag a lost credit, a missed desired gain, and agreed amounts that differ from the current offer/expenses. Example (tested): agreed split 8,093/3,907, then 2026 profit 118k → 121k → agreed plan keeps the receipts and reports the 2026 credit lost; `calculateComparison` separately proposes a smaller 2026 part that keeps it.

Suggested integration (Claude 1/3): on "Something changed", call `evaluateAgreedPlan(newInput, savedScenario, savedScenario)` first and show its changes/reasons, then `calculateComparison(newInput)` for new options. Types are exported from `@/lib/engine`; adding them to `src/domain/contracts.ts` would be additive if an API route needs them.

## 4. Search and feasibility

- SEP minimum: every whole dollar checked up to $8,000 (grid size raised from 4,000 to 8,000 points); above that the assumption states the bound (2 × step + $30).
- Counteroffer: now the **exact lowest whole-dollar price** — every dollar from the offer to the answer is checked (≤ $20,000 span; otherwise the text says a slightly lower price is possible). Regression: price − $1 does not reach break-even.
- Split: thresholds exact, $2 grid for the $12,000 demo, bound stated in the assumption.
- Checklist now follows each plan's decisions in **both** years: 2026 Marketplace estimate (with the expected household income including the SEP deduction), 2027 application/renewal income including the January part, SEP contribution per year, settlement set-aside per year.

## 5. Explanations

People are "You" / "Your spouse" / "Dependent N" and fields have plain names ("Your spouse's W-2 taxable wages (box 1) for 2026 is unknown…"); machine `code` and `fields[].path` are unchanged. Trace labels carry the year; explanations take the poverty-guideline year, wage base, SEP cap, CTC amounts, QBI minimum and due dates from that year's pack. Draft/derived status stays in the text.

## Sample number changes (synthetic demos, reason: whole-dollar return)

| | r2 | r3 |
| --- | ---: | ---: |
| Family current risk MAGI / headroom | $99,730.56 / $8,127 | $99,730 / $8,128 |
| Family 2027 baseline SEHI / PTC (premium $28,123 and benchmark $27,789 entered in whole dollars) | $10,470 / $17,651.36 | $10,471 / $17,652 |
| Accept as offered | −$3,435.55 | −$3,436 |
| SEP minimum | $3,599, +$5,361.45 | $3,598, +$5,362 |
| SEP $5,500 | +$3,800.45 | +$3,800 |
| Split (recommended) | 8,081 / 3,919, +$8,315.46 | 8,093 / 3,907, +$8,315 |
| Counteroffer | $16,001 | $16,001 (now proven lowest whole dollar) |
| Ordinary accept | +$3,872.22 | +$3,878 |

The independent oracle (`family-oracle.test.ts`, own constants, every whole-dollar SEHI scanned) was moved to the whole-dollar return and still matches every family scenario exactly in both years.

## Unsupported (unchanged unless noted)

Other states/filing statuses; more than one business; loss; dependent income; partial-year coverage or eligibility; payroll not reconciling; SS wages above the wage base; age 65; income below 100% FPL; possible EITC (now at the official phaseout ends); 3+ children needing the refundable CTC (Part II-B); accrual method; taxable income above the QBI threshold; payroll/SEP/coverage ranges. 2027 refundable CTC for 1–2 children is now **supported**.

## Verification

`npm run typecheck` ✓; `npm test` ✓ 52 tests (34 engine, including new `rules-r3.test.ts` and `agreed.test.ts`); `npm run build` ✓. Latency (container, warm): family comparison ≈ 100 ms, with two independent ranges ≈ 160 ms.

Not done: a CPA or independent professional review; a payroll-consistent wage range model; EITC calculation; confirmation of the 2028 due date; the 2026 Tax Table values from a final (non-draft) IRS publication.
