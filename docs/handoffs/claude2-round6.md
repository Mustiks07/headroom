# Claude 2 — round 6 handoff: decisions users can trust and act on

Branch `claude2`. Merged normally: `origin/main` @ `2dc973b` (round 5 integration, round 6 assignments) and Claude 3's round 6 contract `03ebf2161472340b875284ff0ee944d1a9c9e2a1`. Claude 3's later implementation commits (`2e481ef`, `c37d6a4`, `5eab276`) were not merged; Codex integrates them. No migrations, no env changes. Versions: engine `headroom-engine-1.3.0` (unchanged: existing tax/credit results are the same), deal `headroom-deal-1.2.0` (option selection changed), rules `us-federal-aca-2026-2027.r3`, household `headroom-household-1.0.1`.

Commits in this round: `1155a05` (contract needs sent first), `e5c9548`, `424b415`, `dea9430`, `5bdaa4b`, `8ac369b`, and this handoff commit.

## Contract needs and status

`docs/handoffs/claude2-round6-contract-needs.md` was pushed at the start (`1155a05`). Covered by `03ebf21`:
- partial receipt, settle-lower and client response commands;
- `MONEY_MEASURES` and `ResultBinding`;
- import targets with separate interest kinds and coverage months.

Still requested (all small and additive):
- a `record_refund` command (engine-local now);
- the measures `settled_cash_year` and `credit_change`;
- `versusOriginalOfferCents` and `results` on stored variants;
- the readiness question fields (`key`, `meaning`, `blocking`, `acceptableSources`, `ifUnknown`);
- `limits`, `refundCents` and `cancellationCostCents` on the client response.

## What changed (engine, `@/lib/engine`)

| Area | Function / type | What it does now |
|---|---|---|
| First payoff | `evaluateOfferAsOffered(ws, projectId)` | Offer as written, only the years it touches (a 2026 offer needs no 2027 facts). Adds `results: MoneyResult[]` (two-year and per-year cash, credit change, gross by payment date) with basis and precision. Verdict is accept_as_offered / keep_agreed_terms / review_terms. |
| Questions | `assessInputReadiness(ws \| null, intent, draft?, {projectId})` | Every question carries `key`, `meaning`, `blocking` (blocks_result / refines_result), `acceptableSources` and `ifUnknown`. Same guards as the calculation, so completing the shown questions makes the calculation ready (tested). |
| Import | `checkExtractedFacts(ws, facts, today, hints)` | Taxable and tax-exempt interest stay separate, and the W-2 boxes (1, 3, 5, gross, pre-tax) stay separate; a box 1 ≠ gross − pre-tax mismatch is a conflict. The document's period is kept (coverage is never forced to monthly); coverage needs explicit months **and** confirmation, and annual amounts are divided only over confirmed months. Each check has `needs[]` (person, tax_year, months, period, as_of_date, date, project_line, managed_inclusion, same_payment). |
| Commands | `validateAndApply`, `previewChange` | Validates the contract's `record_partial_receipt` (remainder = expected − received, on `remainderDate`; a full amount, a future receipt or a past remainder is refused; retry is a no-op), `settle_lower_total` (explicit, reason kept) and `record_client_response`. For a counter, the total must equal received + unpaid, dates cannot be in the past, and received money is kept. A rejection cancels unpaid lines, keeps received money and states that refund/costs are unknown. The engine-local `record_refund` is a deduction in the year paid and cannot exceed money received. |
| Negotiation | `evaluateClientResponse(ws, response, userDate)`, `responseFromCommand`, `restrictTerms` | A counteroffer is evaluated as written through the same search, against declining, the offer it replaces, the original offer and the household's last proposal. Missing dates or a wrong total become questions. The client's limits narrow the next search, and a removed date is never re-offered. Declining agreed work with unknown refund/costs is `not_calculable`, never free. |
| Options | `searchDealTerms` → `EngineReadyDealSearch` / `EngineNoFeasibleTerms` | Each option carries `comparisons` (vs declining, vs the offer as it stands, vs the original offer), `results` descriptors, `clientAgreement` and `moneyByDate`. Cosmetic duplicates are removed. Reversal facts name the declared range that flips a conditional recommendation, and whether another shown option survives it. With no feasible terms, the result gives the closest options inside every hard limit with an exact shortfall (cash or date goal), plus `binding` limits (those whose single relaxation reaches the goal). |
| Descriptors | `src/lib/engine/descriptors.ts` | `MoneyResult` with metric (the contract's `MONEY_MEASURES` names plus requested `settled_cash_year` and `credit_change`), basis (decline_unpaid_terms, original_offer, latest_client_offer, agreed_terms, household_proposal, plan_before_change, none), year/date/horizon and precision (exact, estimated_inputs, range_checked, conditional, not_calculable). |

## Scenario evidence (`docs/artifacts/round6/scenarios/decision-cases.md`)

There are ten pinned synthetic cases (`tests/engine/round6-cases.test.ts`), each with editable inputs (`inputs/case-<n>.json`). Regenerate them with `WRITE_CASES=1 npx vitest run tests/engine/round6-cases.test.ts`.

| # | Case | Decisive output |
|---|---|---|
| 1 | Near-cliff family | Offer as written −$3,616 (2026 credit $13,170 lost). Recommended: same $12,000 as $5,400 Dec 15 + $6,600 Jan 4 → +$8,310 vs declining, +$11,926 vs the offer, $3,745 free by Dec 31; the client must agree to the dates only. **Oracle: same to the cent.** |
| 2 | Ordinary offer | **Accept as offered**, +$7,797, no 2027 facts needed (attribution identity checked) |
| 3 | Unknown spouse income | One question; no figure (`needs_data`) |
| 4 | Two independent ranges | `range_changes_answer`; recommendation conditional; deciding fact named |
| 5 | Counteroffer $12,500 on Dec 28, no January | −$3,186 vs declining, +$430 vs the previous offer; re-search with the client's limit: no feasible terms, binding price_max / additional_sep, closest option short $5,039 |
| 6 | Partial receipt across years | $1,000 in 2026 + $2,000 in 2027; −$5 vs before. **Oracle: same.** |
| 7 | SEP paid Feb 2027 | Tax year 2026 vs 2027 gives a different 2026 credit, so the year is asked, never inferred |
| 8 | No useful change | Accept as offered ($0 vs the offer); offer-only shows its −$3,616 honestly |
| 9 | Impossible deadline | Date goal violated; price relaxation $21,000 (to discuss); closest options with shortfall |
| 10 | California household | **Refuses**: unsupported, no recommendation |

**Independent check.** `tests/engine/oracle.ts` (moved from the family-oracle test) uses its own constants and whole-dollar scans, and no engine arithmetic. Its scope is TN MFJ, one CTC child, Schedule C only, ≥ 250% FPL. It shares the transcribed draft 2026 Table 2 with the engine, and re-derives 2027 from Rev. Proc. 2026-26 independently. Primary sources were not re-fetched in this session: tax-year values come from the round 2–4 verified rule pack.

**Real app.** A production build was run locally (`next start`) with `POST /api/assist/explain {workspace, subject: "deal_choice"}` on case 1. It returned `origin: "server_recomputed"`, engine 1.3.0, and the same figures (+$8,310; $3,745 by Dec 31; +$11,926 vs the offer). Saved in `docs/artifacts/round6/scenarios/api-explain-case1.json`. For Claude 3: the explanation formatter prints a negative as `$-3,616.00`; it should be `−$3,616.00`.

## Business model (`docs/research/round6-economics.md`, `scripts/business/round6-economics.ts`)

- Re-checks the researchers' figures: 11 of 11 match.
- AI cost is a variable **A**, because the BasisWeb dollar cost is unknown; direct Opus prices are a reference only.
- CAC is staged: CPC → qualified → activated → paid, plus free AI of non-buyers and other acquisition.
- Conservative, base and upside scenarios, with break-even paid conversion at 1× and 3×.
- Sensitivity and $100M ARR requirements: 1,010,102 households at $99, about 505k new a year at 50% renewal, about $24.4M a year of acquisition at base CAC. A target, not a forecast.
- Base annual $99: CAC $48.35, LTV36 ÷ CAC 2.49×. A $29 decision cannot carry paid search at base inputs.
- Recommendation (to test): $29 per decision in low-CPC/partner channels, then $49 for 90 days, annual only after repeat use. All of it is modelled, not measured.

## Implemented / verified / not verified

| Item | Implemented | Verified | Not verified |
|---|---|---|---|
| Offer as written + descriptors | yes | tests, case 2, real API (deal) | UI caller (Claude 1) |
| Readiness fields; agreement with calculation | yes | tests | onboarding-draft conversion (Claude 3's `onboardingToWorkspace`) end to end |
| Import semantics (interest, W-2, months, needs) | yes | tests | Claude 3's `applyImportGroup` calling it on real documents |
| Partial / settle-lower / client response / refund | yes (refund engine-local) | tests, cases 5–6 | Claude 3's commit path with these validators |
| Counteroffer evaluation and narrowed search | yes | case 5, tests | UI flow |
| Nearest alternatives, binding, reversal facts | yes | cases 4, 5, 9 | — |
| Decision cases + oracle | yes | 10 cases pinned; cases 1, 6 by oracle | primary-source re-fetch in this session |
| Economics model | yes | arithmetic re-checked | any real price, conversion, CAC, retention or gateway cost |

Checks run once on the final code: `npx tsc --noEmit` passes, `npx vitest run` passes (32 files / 179 tests), `npm run build` passes, and the local production server returned the explain response above.

## Limits

- Supported scope is unchanged: TX/FL/TN, single or MFJ, one Schedule C owner, 2026–2027, full-year uniform coverage. California and other cases are refused.
- Lattice search with exact re-check; "closest" and "binding" are within the checked range.
- Refunds and costs of ending agreed work count only when entered.
- The client's agreement is not proof that a January payment counts in 2027 (constructive receipt), and the engine says so.
- County benchmarks remain candidates.
