# Financial engine specification

Owner: **Claude 2**, branch `claude2`. Entry points: `assessCurrentRisk` and `calculateComparison` in `src/lib/engine/index.ts`. Both accept the shared `CaseInput`, return the documented union asynchronously, and require no network/API key. All numerical UI output must originate here.

## Product responsibility

First assess the current-year ACA subsidy risk without requiring a new project or next-year income. Then, when requested, calculate the effect of an opportunity and feasible interventions. The first-year assessment must not be blocked merely because next year's forecast is unknown. A cross-year comparison must not guess missing next-year values.

Current risk includes MAGI, the correct household threshold, PTC, APTC settlement and, when computable, remaining **additional Schedule C profit** before credit is lost. Remaining profit is derived by re-solving the actual model under listed assumptions; it is not threshold minus gross revenue. If eligibility gives no credit for another reason, do not label this an income cliff.

## Supported-case contract

Initial release: federal planning for TX/FL/TN; single or married filing jointly; one sole-proprietor Schedule C business without a loss; ordinary W-2 income attributed to each spouse; ordinary taxable/tax-exempt interest; standard deduction; qualifying children where the applicable tax credit calculation is implemented; owner-only SEP without eligible employees or conflicting-plan complications.

The input stores months separately. First fully implement and verify the full-year constant-coverage case. Only accept changing coverage/eligibility if a real monthly calculation path is implemented and checked. Otherwise return `unsupported` with the exact reason. Different APTC payments alone can be summed correctly and do not imply different enrollment/benchmark premiums.

Guard before presenting a take-home result: unsupported state income tax; multiple businesses/owners requiring allocation; S-corp or partnership; itemization; capital gains/qualified dividends; rental/foreign/Social Security income; ACA addbacks not modeled; unimplemented refundable credits/EITC; special tax situations; unsupported filing status; partial eligibility; missing source/eligibility confirmation. The complete supported profile must be checked, not merely described in a comment.

Do not silently ignore tax credits that could materially change a low-income family's outcome. Either implement them or block that affected case. Candidate scenarios that move into an unsupported region must be marked infeasible/unsupported, not optimized using incomplete taxes. Core PTC unit functions can still be tested separately below the supported full-return range.

`scopeConfirmed` must be true, required adult-income rows must exist, covered IDs must refer to actual people, and facts must be known or explicitly estimated. A spouse omitted from `incomes` is not a zero-income spouse. Confirm that no excluded tax situation applies. Do not invent eligibility from a positive APTC amount.

## Money, years and sources

- Wire format: integer cents; intermediate calculations: Decimal with explicit rounding.
- Full-year income is the annual forecast, not YTD plus an already annualized amount a second time.
- Explicit years 2026 and 2027, including tax parameters and the prior-year FPL used for Marketplace coverage. No dependence on system clock.
- Store rule version and source IDs in trace. `data/reference/2026-8962-table2.json` is transcribed from an **IRS draft instruction**, retain that status.
- Follow the relevant form's rounding stages. Do not apply JavaScript/Python binary `round` everywhere. On the 175% FPL example the 2026 applicable figure is **0.0540**, not 0.0539.
- Reference prototype figures can change when correcting a documented form-rounding error. Explain a change and update the expected fixture; never bend a correct formula to reproduce a known-bug prototype.

## Income and payroll

For each self-employed individual, net SE earnings generally start from 92.35% of net Schedule C profit. Social Security uses that individual's wage base after **their own** Social Security wages. Do not subtract a spouse's wages from the other spouse's cap. Medicare and Additional Medicare have their own rules; implement or reject affected ranges.

Keep W-2 Box 1, Social Security wages, Medicare wages, gross cash pay and payroll pretax deductions distinct. `grossWages - payrollPretaxDeductions` is not assumed equal to an arbitrary imported W-2 number without checking the supported payroll model. Separate payroll deductions from taxes. For take-home deltas, fixed family income appears on both sides; do not omit it from one side.

Taxable and tax-exempt interest are both cash income, but their AGI/MAGI treatments differ. ACA MAGI is not taxable income: standard deduction and QBI do not reduce ACA MAGI. A separate per-person/per-family trace should make this distinction visible.

## ACA and SEHI

1. Determine tax household size separately from the eligible coverage family.
2. Use the appropriate FPL region/year. Initial states use the contiguous-US table.
3. Apply the Form 8962 Worksheet 2 logic: above exactly four times FPL goes to 401; otherwise truncate the percentage at the specified form stage. At exactly 400%, credit is not automatically zero; at above 400%, the current-law upper eligibility limit applies.
4. Use the applicable figure from the source table. 2026: below 133% is 2.10%; at 133% starts 3.14%; 300–400% is 9.96%. 2027 upper rate is 10.22%.
5. PTC is constrained by eligible enrollment premium and benchmark less required household contribution, with the correct annual/monthly path.
6. APTC is an advance, not a second deduction. `aptcSettlement = aptc - finalPtc`; positive means repayment, negative means additional credit.
7. For tax years after 2025 do not apply the old repayment caps. Losing entitlement and repaying advances are related but distinct amounts.

SEHI and PTC are coupled. The permitted solution must satisfy the rules for both and `allowed deduction + computed PTC <= eligible enrollment premium`, along with earned-income/plan/coverage constraints. Do not require equality when a valid inequality solution gives the proper result. Pub. 974's available 2025 edition supplies this method discussion; year-specific 2026/2027 eligibility and repayment changes must come from their current sources.

Choose a valid solution using an explicit objective. A coarse $10 search followed by one local refinement is not automatically a proof of the global optimum on a discontinuous function. Use a justified critical-point/interval method, or a sufficiently complete bounded search with demonstrated correctness and reasonable latency. Do not call a checker independent if it just invokes the same tax and PTC functions.

Below 100% FPL, APTC > 0 is not sufficient by itself. The applicable exception has several conditions; don't default them to true. Employer/government coverage, dependency and enrollment requirements must be checked. CHIP eligibility can change the covered family even when tax family size remains three.

## Verified parameters and remaining responsibility

| Parameter | 2026 | 2027 | Primary source |
| --- | ---: | ---: | --- |
| FPL used for one person | $15,650 | $15,960 | HHS prior-year guidelines |
| Additional-person FPL step | $5,500 | $5,680 | HHS prior-year guidelines |
| Family-of-three 400% FPL | $106,600 | $109,280 | Derived from the above |
| Standard deduction single / MFJ | $16,100 / $32,200 | $16,600 / $33,200 | IRS Rev. Proc. 2025-32 / 2026-35 |
| Social Security wage base | $184,500 | $192,300 | SSA |
| Defined contribution annual cap | $72,000 | $75,000 | IRS Notices 2025-67 / 2026-66 |
| Maximum child tax credit | $2,200 | $2,300 | IRS, subject to eligibility and phaseouts |

Do not stop at this table: transcribe all tax brackets needed for the supported range, QBI limitations, payroll and credit rules. The legacy engine's hardcoded final 32% bracket and simplified child credits do not justify claiming arbitrary income support.

Owner SEP generally uses the effective 20% rate on net self-employment earnings after the deductible half of SE tax, subject to applicable limitations. Validate existing plus proposed contributions, year and owner. Negative/excess contributions are errors. Confirm owner-only eligibility rather than recommending an employer contribution scheme without accounting for employees.

## Scenarios and objective

Produce the baseline and `accept_now` first. Search only interventions authorized by constraints. Every scenario carries structured receipts, expenses and additional SEP contributions in `decisions`, not just an English paragraph.

Expenses follow their stated payment/deduction timing. Do not proportionally move costs to 2027 simply because receipts are split. Timing must be supported by cash-accounting and actual/constructive-receipt assumptions; unknown timing suitability blocks that intervention.

Default ranking maximizes spendable cash after settlement over the two tax years, subject to feasibility and user budget. Retirement principal is reported separately before future withdrawal tax. For `retirement_and_cash`, explain the tradeoff and never present gross retirement dollars as equally spendable dollars.

Calculate minimum SEP and a plan that tolerates declared income uncertainty. A fixed $2,000 buffer is merely a user-specified scenario, not a universal safety margin. Search relevant discontinuities inside uncertainty ranges, not only endpoints. Report what was checked, worst cash result and failure status; do not fabricate confidence percentages.

For renegotiation search at or above the offered price and show the target: break-even vs refusal or the user's desired gain. Do not return a lower price and call it a minimum counteroffer. Non-monotonic regions require a valid search, not unexamined global binary-search assumptions.

For cross-year receipt changes, show both tax-year consequences and the final settlement horizon. Income and subsidy of 2027 settle in 2028. This is after-settlement economics, not a modeled bank balance on December 31. No double subtraction of APTC repayment when insurance is already modeled net of final PTC.

## Reference fixtures

`reference/legacy/engine.py` is the old prototype with known bugs, never a production dependency. `data/reference/audit-results.json` records an independently checked narrow family calculation; it is not a verified tax return. `scripts/reference/audit_reference.py` is the portable limited comparison used to inspect it.

The Davidson family uses annual premiums $23,013.00 (2026), $28,122.84 (2027), and a 2027 county-candidate benchmark $27,789.36. Adults 38 then 39; one child under 15; profit $118,000 in each baseline year; offer $12,000; no project expenses. The fixture assumes eligibility and address availability, explicitly.

Indicative rounded deltas vs refusing: accept December −$3,435; SEP $3,600 gives +$5,361 cash and $3,600 retirement; SEP $5,500 gives +$3,799 cash and $5,500 retirement; $4,000/$8,000 split gives +$8,306 cash. Preserve assumptions and correctly document any change from formal rounding or a corrected rule. Do not hardcode these numbers in the product.

Three known regression families:

- Profit $23,000, annual actual/benchmark premium $7,800: the old fixed-point approach could return zero PTC despite a valid nonzero solution. Test the inequality solver separately from full-return eligibility.
- Profit $150,000 with **spouse** wages $80,000 and no own W-2 wages: SE tax before additional Medicare is $21,194.325; old code produced $16,975.225 by sharing the wage cap incorrectly.
- FPL percentage 175 in 2026: applicable figure 0.0540. The supplied 301-value table catches this without repeating the interpolation code in a test.

## Bounded verification and handoff

Implement the limited regression groups in `ACCEPTANCE.md`. Test meaningful boundaries and one independently derived family scenario, not every helper or CSS element. Keep one clear independent oracle with documented scope. Run the relevant suite after engine changes; once green, integrate rather than repeatedly inventing more tests.

Handoff must list supported cases, actual source/rule versions, public function behavior, sample deltas, guard conditions, latency observation and remaining exclusions. The engine is done only when both a standalone current-risk assessment and actual editable scenario comparison work.

## Round 5 additions (assistance layer, `src/lib/engine/assist`)

Engine `headroom-engine-1.2.0`, rules `us-federal-aca-2026-2027.r3` are unchanged: tax results of v1, household and round 4 entry points are the same. Deal-search **selection** changed (below); its numbers per option are the same calculation.

- **Readiness by intent** (`assessInputReadiness(ws | null, intent, draft?, {projectId})`): runs the same guards as the calculations, only for the tax years the task needs. A current-year check needs 2026 only; an offer as offered needs the years its unpaid lines fall in; two-year terms need 2026 and 2027; an agreed-plan review needs 2027 only when commitments or a forecast exist there. Questions are grouped (one wage question per person/year, one coverage question per field/year) and ordered: a range that flips the answer, eligibility/scope, household, income, coverage, confirmations. `unsupported` is never mixed with missing. Precision: exact / estimated / range stable / range changes answer / range checked after choice. Credit loss across a range is decided at the all-high and all-low ends (monotone, see uncertainty.ts); offer cash is checked on the documented finite set.
- **Offer as offered** (`evaluateOfferAsOffered`): years are calculated independently, so an untouched year changes by exactly $0. Per year: cash = receipts − expenses − ΔSE tax − Δincome tax + Δpremium tax credit − ΔSEP (identity tested). Verdict `accept_as_offered` when no credit is lost and cash > 0.
- **Document facts** (`checkExtractedFacts`): YTD profit is never annualized, prior-year forms are reference only, invoices/offers are expected money, transfers/loans/refunds are not income, coverage months are not extended, conflicts are never resolved by "last wins", and managed payments inside a P&L period are flagged.
- **Changes** (`validateAndApply`, `previewChange`): whitelisted commands only. Received money is never moved, an expected payment cannot be proposed in the past, a receipt cannot be in the future, and a deposit is part of the total price. A SEP contribution paid on the cash-snapshot day reduces the SEP cash (stated) unless the snapshot ids include it. Before/after is shown for the current-year credit and settlement, cash against the plan before the change, the agreed terms re-evaluated (not re-optimized), and stale packages/actions. Relative dates resolve against the user's date (`resolveRelativeDate`).
- **Deal search selection policy**: options are ordered by the smallest change of terms: the offer as it stands < the household's own extra SEP < new dates at the offered price < a different price. The recommendation is the first option that meets the goal and **holds**. With declared income ranges, holds means every credit is kept at the high end and the worst checked cash still meets the goal. Without ranges, it means every kept credit has at least $1,000 of extra-profit room (`FRAGILE_ROOM_DOLLARS`). If nothing holds, the smallest change is recommended and marked conditional. A price change is labelled "More cash, if the client agrees"; allowing a price range is not the client's agreement. Each option shows cash against both baselines (decline unpaid terms; offer as it stands). `decomposeVersusOffer` splits the difference into dates → price → SEP on one path with a full recalculation per step, so the parts add up exactly; another order gives other step sizes with the same total. The materiality threshold max($100, 1% of the offer) is still reported and used to say when more cash is only marginal.
- **Household balance**: a fact dated on the snapshot day is decided by `includedFactIds`; without it the balance is not calculated (null, reason given).
- **Explanations** (`buildExplanationPacket`): statements use `{ref}` placeholders to packet facts taken from results calculated now. `numbersNotInPacket` rejects provider text with other figures. The standard answers (why worse, why January, client refuses, what changes) are answered or return the missing fact. `verifyDecisionRecord` recalculates a record on its own snapshot only with the same engine/rules; otherwise the record is archived as recorded.
- **Insurance data** (`resolveBenchmark`): the result is confirmed (the user's Marketplace document for that year), a county candidate (second-lowest Silver from the CMS plan-year county extract for the covered members' ages, three oldest children under 21), or not available. Ages are priced only where the factor is verified in `data/reference/age-factors-verified.json` (0–14, 21, 38, 39, 40). There is no year carry-over, no county from a ZIP and no averages. Covered members price the benchmark; the tax family sets the poverty line.
