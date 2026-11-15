# Claude 1 round 6 — integrated implementation handoff

Date: 2026-11-15. Worktree: `headroom-claude1-round6`; branch: `codex/finish-claude1-round6`. Codex continued from the published Claude 1 branch with the user's explicit approval. No unpublished QuickOffer implementation was available. No deploy/push is performed by this implementation agent.

## Dependencies and ownership

Normal merges adopted published Claude 1 `ebd52ad`, main `d220ce2`, Claude 3 `03ebf21`, `2e481ef`, `c37d6a4`, `a72f28b`, and Claude 2 `e5c9548`, `424b415`, `5bdaa4b`. Root's separate landing/research/calendar commits are in the same branch and are not claimed as this agent's work.

Root owns the landing and release/presentation. This implementation owns functional UI and scoped workflow CSS. Two bounded child tasks delivered import review and lifecycle UI. Root authorized narrow integration fixes to `domain/imports.ts`, `lib/client/import-pipeline.ts` and `lib/engine/assist/changes.ts` because published producer/consumer contracts did not yet make the real flow work. No tax arithmetic was added to UI.

## Delivered

| Area | Actual behavior | Check / evidence |
| --- | --- | --- |
| Offer-first entry | `/check?start=project`: real intake adapter with explicit AI consent, built-in fallback, exact source, distinct offers, typed questions, explicit costs and full dates. Local incomplete draft survives reload. No account. | Root's browser run created a real $12,000 manual proposal with explicit $0 costs, TX/single/age 34/SEP 0. Preserved original offer; 2027 not requested. |
| Household / year-income entry | `/check` creates an incomplete household without a fake project. Existing households can be reused. SEP already contributed/planned must be explicit before new-household conversion, because the current workspace target format cannot represent an unknown existing SEP amount. Remaining income/coverage facts stay unknown. | Typechecked. First-use profile schema and shared conversion used. |
| First decision | `evaluateOfferAsOffered` now has a real caller. One focused readiness question, count and expandable remaining list; document action beside it. The main result names baseline and settlement horizon. Other plan sections collapse while the first answer needs facts. | Engine case 2 needs only 2026. Root requested the focus adjustment after its actual manual run. Final screenshots belong to root. |
| Same-plan correction | Household/coverage editor opens in the same workspace. Base forecasts are preserved rather than accidentally storing the adapter's project-inclusive profit back into a forecast. Owner removal cannot orphan projects/retirement records. | Typechecked; no full-profile reset required. |
| Common documents | First document entry asks household identity, then opens the exact saved-plan multi-document review. Explicit person/year/period/months/payment mapping; source conflicts; amount corrections; prior-year sources reference-only; one semantic preflight and atomic commit. | 14 targeted import regressions passed. See below for narrow supported document-offer behavior. |
| Negotiation | Joined cobalt outcome/white payment panel and a compact ledger of at most 3 distinct engine choices. Original/current offer baselines, retirement separation, by-date measures, stale checks and nearest calculated options when the goal is impossible. | Case 1 figures rechecked after integration; no output hardcoded in components. |
| Client message | Editable subject/body before saving, copy and TXT download use edited text. Changing wording does not alter calculated payment terms. Nothing sends itself. | Typechecked; actual export artifact inspection belongs to release walkthrough. |
| Client response and receipt | Accepted/rejected/counteroffer, typed/manual or consented intake; original/current/version history. Smaller receipt explicitly chooses partial with dated remainder versus full lower settlement with reason. Common preview/commit and stale guards. | Canonical command integration fixed; targeted 20-test and 17-test groups passed. Details in `lifecycle-round6-integration.md`. |
| What changed | Retains the original sentence. Fully understood commands preview normally. Ambiguity is resolved in an explicit typed form, without appending phrases or rerunning regex against the user's answer. New-offer/client-response links open their dedicated flows. Edited text or changed revision invalidates the previous confirmation. | Typechecked. Legacy `answerAmbiguity` is no longer used by this UI. |
| Repeat use | Current actions are projected from saved facts; pending/completed/superseded remain distinct. Home/list display last saved change. SEP form commits canonical commands, keeps values on failure, rejects future actual dates and uses local calendar dates. | Action/calendars use root's single filing-date source; parent regression confirms 2028-04-18. |
| Exports | Current forecast PDF/JSON; historical decision records; current action calendar remain available. Stale package exports stay disabled. | Existing real endpoints preserved; root must inspect downloaded artifacts at release. |

## Important integration fixes

- Canonical `record_partial_receipt.remainderDate`, `settle_lower_total`, and `record_client_response` originally disagreed with the engine's temporary command shapes. These now produce validated preview changes and commit through the same canonical path. A small ordinary `record_receipt` cannot silently erase the rest of an expected payment.
- Additive `ImportDecision.reviewConfirmations` carries explicit single-payment/no-extra-cost and forecast-exclusion confirmations. A document offer cannot create an empty-expense project merely because no costs were found. Complex offers go through the full offer flow.
- Import corrections preserve prior evidence; switching annual/YTD methods requires explicit replacement and leaves unprovided remaining figures unknown. Prior-year-only extraction warnings conservatively make the document reference-only, including a 2025 W-2 whose legacy extractor omitted its year.
- UI explanations and forecast previews now invalidate when the workspace revision changes. Previously a loaded explanation could be displayed beside newer facts.
- Hero intake length is 8,000, matching the published request contract, with no silent truncation. Date questions read the native submitted value as well as React input events; this also fixed a browser-automation fill/event discrepancy found during root's walkthrough.

## Bounded verification

- `npm run typecheck`: passed after full dependency integration and workflow composition; final build records below.
- Import review / atomic-import groups: 14 passed.
- Lifecycle + engine assist: 20 passed; after the explicit ambiguous-smaller-receipt regression, lifecycle + existing round5 assist: 17 passed.
- Published financial decision cases 1/2/3 rechecked after the engine integration: 3 passed, 7 not selected. Case 1: −$3,616 as offered; +$8,310 same-price split; +$11,926 improvement versus as offered. Case 2: +$7,797, no 2027 facts. Case 3: unknown spouse wages blocks the result.
- `git diff --check`: passed at the checked stage; repeat only for the final diff.
- Full build and final 360px/UI/export walkthrough: coordinated with root because it owns the running dev server and judge artifacts. Do not call screenshots or downloads inspected until that pass is recorded.

## Review materials

- `docs/demo/round6-judge-script.md`: reproducible short English demo and network fallback.
- `docs/artifacts/round6/ui/case-{1,2,3}-importable.json`: actual input-only workspace exports for the existing Restore flow, including the published goal/terms where relevant. They contain no calculated output. Generated by `node scripts/demo/prepare-round6-plan.cjs` from the engine's synthetic case inputs. The raw engine input wrapper is not itself an app export.
- `docs/artifacts/round6/ui/developer-observations.md`: observed checks distinguished from customer research; no invented timings or conversion numbers.

## Remaining explicit boundaries

- No claim that this implementation alone verifies live AI, deployed cloud authorization or production deployment; root controls those integrations.
- The document offer target supports one expected payment only when the user confirms no extra costs. An offer with costs/unknown costs/multiple installments must use full offer review. Prior-year documents remain reference material; forecast estimates are entered explicitly rather than converting historical amounts silently.
- The old complete editor is retained at `/check?full=1` for compatibility. Normal own-data and document entry use the new scoped flow. No registration or payment gate is introduced.
- Actual 360px screenshots, final PDF/ICS/JSON visual inspection and final release commit are recorded by root. These are release checks, not missing simulated successes to fill with fabricated evidence.
