# Claude 2 — round 5 handoff: readiness, document facts, change preview, explanations, sturdier choices

Branch `claude2`. Merged normally: `origin/main` at `6f18c1f` (start), `714ab84` (research memo and assignment additions), `befa110` (addendum and design). Shared contract: Claude 3's **assistance v1.0 `97b608c3a3bcf873b41ae59ae1270a8740b35eb7`** (merged alone, not the rest of `claude3`). No shared-contract file was changed. No env variables or migrations. Engine `headroom-engine-1.2.0`, rules `us-federal-aca-2026-2027.r3`, deal search `headroom-deal-1.0.0`: the tax results are unchanged, and only the deal-search **selection** changed (see 4). Round 4 integrator fixes are kept: total price includes the deposit, an agreement replay adds no second SEP, package freshness, no backdated windows, and the SEP cash snapshot.

All new code is in `src/lib/engine/assist/*` (exported from `@/lib/engine`), plus `src/lib/engine/deal/search.ts`, `data/reference/age-factors-verified.json`, `tests/engine/{assist,round5-scenarios}.test.ts`, `scripts/business/unit-economics.ts`, `docs/research/round5-unit-economics.md` and an `ENGINE_SPEC.md` addendum.

## Exports (contract `AssistanceEngine` + engine extensions)

```ts
assessInputReadiness(ws: HouseholdWorkspace | null, intent: ReadinessIntent, draft?: ImportDraft | null, opts?: { projectId?: string }): EngineInputReadiness
previewChange(ws, proposal: ChangeProposal, opts?: { userDate?: string; now?: string; apply?: (ws, p) => Promise<{ workspace }> }): Promise<EngineChangePreview | BlockedComparison>
buildExplanationPacket(ws, subject: "current_year" | "deal_choice" | "agreed_plan", refId?: string): Promise<EngineExplanationPacket | BlockedComparison>
// engine extras
evaluateOfferAsOffered(ws, projectId): Promise<ReadyOfferEvaluation | BlockedComparison>          // one offer on its own terms, only the years it touches
checkExtractedFacts(ws, facts: ExtractedFact[], today: string, hints?: FactReviewHints): FactCheckReport   // + normalizeExtractedFacts, METADATA_NEVER_FROM_AMOUNT
validateAndApply(ws, proposal, userDate, nowIso): ApplyOutcome                                       // pure: blockers, noOps, notes, changes, events
resolveRelativeDate(phrase, userDate): string | null
renderStatements(packet, statements): string;  numbersNotInPacket(packet, text): string[]
decomposeVersusOffer(ws, goal, terms): TermsDecomposition | BlockedComparison
verifyDecisionRecord(record: DecisionRecord): { status: "reverified" | "differs" | "archived_only" | "invalid", recorded, recomputed, message }
evaluateTermsExact(ws, goal, terms): ExactTerms | BlockedComparison                                  // exact terms, decline + offer baselines
resolveBenchmark(ws, year): confirmed | county_candidate | not_available;  checkCoverageFacts(ws, year); BENCHMARK_SOURCES
FRAGILE_ROOM_DOLLARS = 1000, ROBUST_ROOM_DOLLARS = 5000
type EngineDealVariant = DealVariant & { scenario; comparisons: { versusDeclineCents, versusOfferedCents|null }; robustness: { holds, basis, roomCents, worstCashInRangesCents } }
```

## What each part does

1. **Readiness by intent.** It uses the same guards as the calculations (household projection, year guard, opportunity checks), limited to the years the task needs:
   - `current_year_subsidy` → 2026 only; no 2027 and no offer;
   - `new_offer` → the years the unpaid lines fall in;
   - `two_year_terms` → 2026 and 2027;
   - `agreed_plan_review` → 2027 only when commitments or a forecast exist there.

   `status: "ready"` means the matching calculation runs; the test checks this against `evaluateHouseholdWorkspace` / `evaluateOfferAsOffered`. Questions are grouped (one wage question per person and year; one coverage question per field and year). Each has `answer.kind` from the contract plus `answerDetail` (money_fields, period, confirmed $0 allowed), `blocks: calculation | decision`, `priority` and `documentHint`. A future amount is never pointed to a past-year form. An unconfirmed draft figure becomes `sourceRef: "draft:<id>"` and does not count as an answer; a draft conflict becomes the first question. `unsupported` is a separate status with an empty question list. Precision is one of: `exact | estimated | range_stable | range_changes_answer | range_not_yet_checked` (the last for two-year terms, which are checked per chosen option). When a declared range flips the answer, the first question is `RANGE_DECIDES`. With `ws = null`, a short start question set is returned.
2. **Offer as offered.** Years are calculated independently, so an untouched year changes by exactly $0. The per-year attribution is cash = receipts − expenses − ΔSE − Δincome tax + Δcredit, an identity checked in the tests. The verdict is `accept_as_offered`, `keep_agreed_terms` (for an agreed project) or `review_terms`. A thin margin is named without alarm.
3. **Document facts.** Rules:
   - YTD profit is never annualized and goes only to `forecast.ytdNetProfit`;
   - a managed payment received inside the P&L period is flagged (`MANAGED_PAYMENT_INSIDE`);
   - a full-year profit together with a YTD profit, or a full-year profit below YTD, is a conflict;
   - prior-year returns and documents are `reference_only`;
   - an invoice or offer is never a receipt;
   - transfers, loans and refunds are `not_income`;
   - coverage months are not extended;
   - APTC above the premium is a conflict;
   - the same line twice is `duplicate`;
   - person, year, period and line link must come from the document or the user (`METADATA_NEVER_FROM_AMOUNT`).

   `confirmableTogether` lists only consistent facts with a known destination.
4. **Deal choice policy** (assignment §4 and addendum). Options are ordered by the **smallest change of terms**: the offer as it stands < the household's own extra SEP < new dates at the offered price < a different price. The recommendation is the first option that meets the goal and **holds**:
   - with declared ranges, every kept credit survives at the all-high end and the worst checked cash still meets the goal;
   - otherwise, every kept credit has at least $1,000 of extra-profit room.

   If nothing holds, the smallest change is recommended and a warning says it is conditional; nothing is labelled "safe". Price or schedule changes with more cash are labelled **"More cash, if the client agrees"**. Every option carries its cash against both baselines (`comparisons`). `decomposeVersusOffer` splits the difference as offer → dates → price → SEP with a full recalculation per step, so the parts add up exactly. For an already agreed project the as-offered option reads **"Keep the agreed terms"**, and declining the unpaid part is flagged as not a free choice (unknown refund/costs ≠ $0). Materiality max($100, 1% of the offer) is still reported and says when more cash is marginal.
5. **Change preview.** Whitelisted commands are validated and applied to a copy (`validateAndApply`):
   - received money is never moved or re-dated (a correction needs a reason and keeps history);
   - no expected payment before the user's date, and no receipt after it;
   - a new offer's total equals received + unpaid;
   - a retry is a no-op; a stale fingerprint gives `PROPOSAL_STALE`; ambiguities become blockers;
   - a SEP contribution consumes SEP cash (`includedContributionIds` semantics), and one paid on the snapshot day is stated;
   - `resolvedDates` are cross-checked with `resolveRelativeDate`.

   The preview shows before/after current-year credit and settlement, cash against the plan before the change (2026 + 2027 when both are calculable, otherwise the year named), agreed terms re-evaluated (not re-optimized), and stale packages/calendar actions.
6. **Explanations.** Statements use `{ref}` placeholders to packet facts taken from results calculated now. `deal_choice` with a package id refuses a stale package (`STALE_RESULT`). The answers to *why worse / why January / client refuses / what changes* are computed: e.g. "If all $15,000 were paid on 2026-12-15… −$1,039 instead of $10,390, because the 2026 premium tax credit would be lost". Unanswerable ones return the exact missing fact. `numbersNotInPacket` catches invented figures, but only figures: Claude 3's route should keep deterministic templates as the default. Limitations always say the difference is against the named baseline and is not savings caused by Headroom. `verifyDecisionRecord` recalculates a record on **its own snapshot** only with the same engine and rules; otherwise it returns `archived_only`, never "re-verified".
7. **Insurance data.** `resolveBenchmark` returns `confirmed` (the user's Marketplace document for that year), `county_candidate` (second-lowest Silver from the CMS plan-year extract for the covered members' ages; three oldest children under 21; the EHB share is noted), or `not_available` with a concrete request. Only ages whose factor is verified in the repo are priced: 0–14, 21, 38, 39, 40 (`data/reference/age-factors-verified.json`). The full CMS curve was not re-read because **cms.gov is not reachable from this session**. There is no 2026→2027 carry-over (an identical copied 2027 benchmark is flagged), no county from a ZIP and no averages. Independent check: the resolver gives $1,917.76/month (2026) and $2,315.78 (2027); the fixture's entered figures are $1,917.75 and $2,315.78, a one-cent per-member rounding difference.

## Real outputs (synthetic households; `tests/engine/round5-scenarios.test.ts`)

| Scenario | Input | Output | Practical action | Limitation |
| --- | --- | --- | --- | --- |
| 1 Cliff deal | $112k profit, A agreed ($3k received + $3k due), offer B $12,000 on Dec 20; goal ≥ +$4,000, ≥ $10,000 by Jan 10; asked $12k–15k | As offered: **−$3,616** (2026 credit $13,170 lost). Recommended: **$12,000 as $5,400 Dec 15 + $6,600 Jan 4 → +$8,310**, $3,804 of room, +$11,926 vs the offer. "More cash, if the client agrees": $15,000 → +$10,390, only $202 of room | Ask the client to split the same price; get written confirmation that the January part is not available earlier | County benchmark candidate; lattice search, not a global optimum |
| 2 Ordinary | $80k profit, same $12,000 offer, no 2027 facts | **Accept as offered: +$7,797**; 2026 credit $16,443 → $14,854, $29,204 of room | Accept; nothing to negotiate | — |
| 3 Uncertainty flips | $104k profit with range $90k–$125k, offer $4,000 | Readiness: `range_changes_answer`; first question: narrow the profit range. At the entered value: accept, +$2,774 | Update the P&L before deciding | Credit decided at range ends; cash on the checked set |
| 4 Deposit received | A: $3k received, $3k due Dec 1; goal ≥ +$2,500; asked $6,000–7,000 | Recommended **$6,750 total: $3,750 on Dec 15** (deposit fixed) → +$2,598; +$515 vs the agreed terms. With goal ≥ $2,000: **"Keep the agreed terms"**. Then "remaining payment moved to January 8, 2027" → preview changes exactly one line; 2026 credit $13,107 → $13,423, cash −$8 against the plan before; paying it twice → no-op | Confirm the move, then record the payment | Ending the agreement is not compared (costs unknown) |

## Rounding and uncertainty

Figures come from the existing year engine: whole-dollar return rounding (r3) and integer cents at boundaries. Room is in whole dollars: `room = $0` means $1 more profit loses the credit. Ranges are independent; credit loss is monotone, so it is decided at the all-high and all-low ends. Cash is checked on the documented finite set and reported as the worst checked value. No probabilities, and no "safe".

## Business: unit economics (`docs/research/round5-unit-economics.md`)

The script recomputes 22 memo figures exactly with rational arithmetic; the memo needs no correction. With the required two-stage CAC = CPC / (visitor→qualified × qualified→paid), the base case (35% × 5%, $1 CPC, free intake and $5 other cost per payer) gives a fully loaded CAC of $69.34 against annual $99. Contribution is $69.47, horizon LTV $121.57 at an assumed 50% renewal, LTV:CAC **1.75**, below the memo's 3:1 bar; decision and season do not pay back in their horizons. The biggest levers are paid conversion, CPC and renewal. All of these are assumptions, not measured results.

## For Claude 1 (UI)

- Show the recommended option first. Show "More cash, if the client agrees" with the client-agreement note.
- Show `comparisons.versusDeclineCents` and `versusOfferedCents` as two labelled numbers, and never call either "savings". Use `decomposeVersusOffer` steps for "where the difference comes from".
- When `robustness.holds === false`, show the room or the range note.
- Show readiness questions 1–3 at a time, in `priority` order. `allowUnknown` keeps unknown; a confirmed $0 is a separate answer.
- Insurance: show the resolver status and its notes. A county candidate is never shown as the confirmed benchmark.
- UI purpose labels (`DealPanel.tsx`) are the UI's own. The engine now recommends `simplest` in the default example (round 4 recommended `most_cash`).

## For Claude 3 / Codex (backend)

- **One apply path.** Pass `apply: applyChangeProposal` to `previewChange`, so the after-figures are computed on exactly what will be saved. Call `validateAndApply(...).blockers` (or the preview) before `commitProposal`. Claude 3's `applyCommand` does not check backdated expected dates, future receipts or the deposit-inclusive total, and my validator does. `userDate` should be the request's `userDate`.
- Explanations: use `renderStatements` as the deterministic default. `numbersNotInPacket` is a necessary check, not proof of meaning.
- Decision records: export "verified" only when `verifyDecisionRecord(...).status === "reverified"`.
- Metadata never inferred from an amount: `METADATA_NEVER_FROM_AMOUNT` (person, tax year, period, as-of, project line, received vs expected, gross vs net, coverage months, same payment).
- **Changed a Claude 3/integrator test:** `tests/integration/deal-ui-boundaries.test.ts` picked "a variant that adds SEP" from the default example, which the new policy no longer shows. Its input now uses offer-only terms (`deal({ newTerms: null, minCash: -5000 })`), where a SEP option exists; the test's intent (agreement once, retry keeps facts and the SEP target) is unchanged.

## Checks

`npx tsc --noEmit` passes. `npx vitest run` passes: 28 files / 145 tests, including the new `assist` (13) and `round5-scenarios` (4) groups. `npm run build` passes. `node --experimental-strip-types scripts/business/unit-economics.ts` reproduces the document's tables.

## Known limits

- Single business owner; one project per search; TX/FL/TN; 2026–2027; the existing supported tax scope (no new forms).
- County data only for Davidson County, TN, and ages 0–14/21/38/39/40. Other counties and ages ask for the Marketplace benchmark.
- Lattice search with refinement, not a global optimum. The room policy ($1,000) is a documented choice, not a law.
- Household balance needs a complete cash context; overdue unpaid expected lines are not added to the balance.
- The provider path is not exercised here (AI off). Explanations and readiness work without a provider.

## Update — second pass (after `origin/main` `c5f29dd`, design C)

Merged `origin/main` up to `c5f29dd` (design C selected). Design C changes no formulas; the engine is unaffected.

**Confirmed already done (unchanged):**
- questions only for the years and facts the task needs;
- two baselines on every option;
- "More cash, if the client agrees";
- smallest change that holds;
- room/range sensitivity;
- dated cash separate from the two-year result;
- preview with no-ops and stale detection;
- explanation packets;
- insurance resolver.

**Added in this pass:**
- `EngineDealVariant.clientAgreement` = `{ required, changes: ["price" | "dates"], note }`. The note explicitly says the offer as it stands applies until the client agrees in writing; the household's own SEP never requires the client. Example: the recommended $12,000 split needs only `["dates"]`; the $15,000 option needs `["price", "dates"]`.
- `EngineDealVariant.moneyByDate`: points at each payment date, December 31, 2026 and both return due dates. Each point has `receivedCents` (gross in by that date) and `availableCents` (after project costs, extra SEP paid and a pro-rata reserve for this project's tax). This is money by a date, kept separate from the two-year result and retirement. The last point equals `comparisons.versusDeclineCents` (tested). Example: by 2026-12-31, $5,400 received and $3,745 available; after both returns, +$8,310.
- The `deal_choice` explanation states three separate quantities (money by date / after both returns / retirement), the result against the offer as it stands, and which terms need the client's agreement. It uses only referenced facts. For a saved package, the engine fields come from a fresh search on the same fingerprint.
- Economics: `scripts/business/unit-economics.ts` now also recomputes the 13 figures of `HEADROOM_PAID_VALUE_STRATEGY.md`; all match. Free intake is now counted for non-buyers only, as in the strategy script. Base annual LTV:CAC is 1.76 at a fully loaded CAC of $68.98. The document says to label every figure "modelled" and never call it sales.

**Blocking contract (Claude 3):** `docs/handoffs/claude2-contract-request-round5.md` asks for four optional fields in `DealVariantSchema` (`comparisons`, `robustness`, `clientAgreement`, `moneyByDate`). Until then, saved packages and decision records drop them; explanations of current packages work around it.

**Checks of this pass:** `npx tsc --noEmit` passes, `npx vitest run` passes (28 files / 145 tests), `npm run build` passes, and the economics script reproduces its tables.

## Update — contract `29c6ab4` merged

Merged Claude 3's contract follow-up `29c6ab4ea0bad46b3bd52086e0a16c0bce86c833` normally. As a normal merge of that SHA, it also brought its ancestors on `claude3`, i.e. Claude 3's round 5 backend. No conflicts; no engine change was needed. `comparisons` and `robustness` are now stored with packages and decision records: `DealVariantSchema.parse(variant)` keeps them (tested). `clientAgreement` and `moneyByDate` are not in that commit and are still requested in `claude2-contract-request-round5.md`. Checks: `npx tsc --noEmit` passes, `npx vitest run` passes (29 files / 152 tests), build passes.

## Update — contract `36edf1e` merged

Merged `36edf1e0f352a445948376e67f063cc642581948` normally (with its parent `00beeaf`, Claude 3's backend follow-up). `DealVariantSchema` now has `clientAgreement` and `moneyByDate` with the engine's exact shape, so saved packages and decision records keep all four engine fields (tested). The contract request is closed. The explanation's fresh-search fallback for packages stays as a harmless safeguard for packages saved before this contract.

