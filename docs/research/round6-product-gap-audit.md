# Headroom: complete the decision journey

15 November 2026. Read-only audit of the combined `codex/round5-integration` working tree. The parent is still integrating the provider and visual fixes; this is a next-round work inventory, not a release certificate. No code or tests were changed for this audit. Findings below are from actual source paths, not just handoff claims. Suggested reproductions have not all been executed in a browser.

Integration update during the audit: Codex has already added original-offer capture to manual `addProject`, corrected the mobile baseline/gross-only footer wording, and removed implicit SEP tax-year inference. Those fixes are confirmed in the working-tree source and should be preserved, not reassigned as unfinished. Codex subsequently reports binding `DealPanel` results to the saved workspace revision and a successful build; retain that invalidation as the flow expands. Broader pipeline and lifecycle completion below remains relevant. Codex also reports a real BasisWeb attachment rejection and is implementing text extraction for text-based PDFs; scan/photo support must not be claimed from a successful text call.

## Product decision

Finish one valuable loop: **offer → only the necessary facts → money left on the offered terms → better feasible terms → client response → agreement → actual payments → revised plan**.

The product already has considerably more financial depth than its first screen reveals. Adding unrelated tools would hide that strength. The next round should make the existing depth usable, close the gaps between separately written modules, and add the missing negotiation and partial-payment transitions. This can be a substantial release without becoming a budgeting app.

The strongest immediate payoff is: **“Here is what this offer leaves you; here is the smallest change that meets your goal; here is what to do if the client says no.”** The first answer must not force a two-year optimization or fabricate a need for one. Continuing use comes from real changed circumstances, payments and revised offers. Whether that supports an annual subscription is a research question, not a fact established by building a dashboard.

## What is actually present

| Capability | Implemented foundation | Remaining user-facing completion |
|---|---|---|
| Selected visual identity | Design C, Geist, cobalt, chrome scene, chartreuse, responsive comparison | Verify the actual release at laptop/mobile/zoom; consistent labels and reduced motion |
| Household calculation | Deterministic financial engine, 2026/2027, supported-case guards | Explain supported scope before substantial input; no unearned nationwide claim |
| Goal-based terms | Price/date/SEP constraints, no-feasible result, two cash baselines, robustness, date targets | First as-offered result; coherent goal labels on all views; client counteroffer loop |
| Minimal questions | `assessInputReadiness`, 1–3 question UI after a workspace exists | Connect to first use; use task-specific years; preserve imported facts |
| Offer-only evaluation | `evaluateOfferAsOffered`, attribution and tests | **No UI/API caller found**: only definitions and tests use it |
| Text changes | Proposal → preview → confirm → revision; pattern fallback | First pasted offer is not on this path; structured answers for model questions |
| Document extraction | Text/CSV reader, provider adapter, source evidence | One review pipeline across first use and saved plans; complete target support |
| Multi-document semantics | `ImportDraft`, merge/conflict checks, atomic group apply, engine fact validation | Current UI applies per file using the older path; cross-document checks not connected |
| Original offer | Model and `ensureOriginalOffer`; AI and now manual add-project capture it | Check first conversion/migration and preserve original across negotiation |
| Ongoing payments | Actual replaces expected; correction history; SEP paid vs target | Explicit partial receipt with remainder; consistent commands and validation |
| Saved decisions | Current action package and historical decision snapshot | Counteroffer/rejection history; clean stale/current distinction in every view |
| Export | Decision/current PDFs, JSON, current calendar with stable IDs | Repeat artifact verification against the final commit and own-data journey |
| Analytics | Anonymous daily event counters, sample/own dimensions | Counts are not unique users, conversion cohorts, retention or customer revenue |

## Findings that should become explicit tasks

### 1. First paste does not use the natural-language proposal capability

`src/features/start/HeroEntry.tsx` saves up to 20,000 characters then opens `/check?start=project&pasted=1`. `src/features/household/DocumentImport.tsx` wraps this text in `pasted-text.txt` and explicitly runs the deterministic document reader. `extractDocumentServer` returns from the text branch before its provider branch. Meanwhile the assistance contract accepts 4,000 characters and the proposal provider has a narrow schema.

Consequence: the homepage promises “paste or describe” while the effective first path depends on recognizable field labels. A successful AI update inside a saved plan does not demonstrate a successful first offer import.

Task: one first-use offer draft that can be populated by paste, supported document or manual entry. Run deterministic extraction first; when unresolved and the person consents, use the configured provider. Keep visible source, extracted amount/date, ambiguity and edit controls. Handle a long email deliberately rather than silently discarding decisive terms. A deposit already received and later balance are distinct. No AI arithmetic or auto-confirmation.

Acceptance: an ordinary email with fee, deposit, balance, costs and dates becomes an editable draft; two offered dates produce a question; price not stated remains unknown; no key/timeout leaves the text and manual path intact. Confirmation, then reload, preserves the same offer.

### 2. The fast as-offered result is implemented but unreachable

`src/lib/engine/assist/offer.ts` can evaluate only the years touched by the offer, with a cash attribution and a verdict. `rg evaluateOfferAsOffered src tests` finds no UI or route caller. `Readiness` receives an already built `HouseholdWorkspace`; `Workspace.tsx` still uses the older household/compare form.

Task: show the as-offered result before optional goal optimization. For a 2026-only offer, ask only the 2026 facts that the actual guard needs. Ask for 2027 when the person requests cross-year terms. State-dependent unsupported cases should be identified early with a useful reason and retained draft.

Do not promise “three questions total.” One to three at a time is a presentation rule; the actual number depends on confirmed data. Do not build a second readiness heuristic in the UI. Use a typed incomplete onboarding draft until a valid workspace can be created.

Acceptance: unknown 2027 does not block a fully specified 2026-only offer. A profitable ordinary offer can receive “accept as offered.” Unknown spouse income that can change the answer prevents an unconditional recommendation and points to exactly what is needed.

### 3. The two import UIs bypass the complete shared fact pipeline

`DocumentFacts.tsx` stores independent per-file `Doc` entries and calls `previewDocumentFacts`/`applyDocumentFact`. It does not call `mergeIntoDraft`, `applyConfirmedFacts` or the engine's `checkExtractedFacts`. `DocumentImport.tsx` mutates form paths through its own `prepare` function. The engine's richer fact checks are currently effectively a separate module, not the common application gate.

The saved-workspace `FactTarget` in `src/lib/client/workspace-facts.ts` supports only forecast, payment received and SEP contribution. The UI advertises pay stubs and Marketplace statements, but this path cannot apply wages, coverage figures or a new offer. First-use import supports more fields through a different implementation.

Task: share extraction, metadata resolution, semantic validation, cross-document review and confirmed atomic apply. First use and existing plans should differ in destination context, not money semantics. Extend typed targets for supported wages/interest, explicit coverage months and offered project terms. The server/provider does not decide whose income, which tax year or whether an invoice has been paid by matching amounts.

Acceptance: upload P&L + notice + offer, confirm one coherent group, obtain one revision, reload it; repeat same import and obtain no duplicates. Conflicting values for the same established target need a decision. Different people, periods or payments remain separate. A rejected field prevents the purported atomic group from partly applying. Existing-plan wage/coverage changes use the same review as onboarding.

### 4. Import semantics have hazards to fix before connecting the modules

| Source observation | Risk | Required treatment |
|---|---|---|
| `import-draft.ts:slotKey` treats missing person as `?` | Two spouses' unidentified forms can be presented as conflicting values of one person | Resolve identity/target; distinguish “cannot establish whether same fact” from a confirmed contradiction |
| `facts.ts:FIELD_MAP` maps taxable and tax-exempt interest to `interest`; its switch returns taxable-interest destination | Connecting the helper without correction loses the distinction | Preserve exact field identity through normalization and application |
| `normalizeExtractedFacts` forces coverage period to `monthly` | An annual extracted amount can be relabeled monthly | Preserve source period; require supported conversion or manual monthly facts |
| First `DocumentImport.targetPaths` maps coverage to all 12 months | A notice for part of a year becomes annual coverage silently | Extract or ask applicable months; never expand silently |
| `DocumentFacts.apply` loops through fields, skips a rejected result, then saves successful ones | A “use these figures” group can partly save | Use atomic group apply; tell the user when they deliberately choose a subset |
| `checkExtractedFacts` checks managed income inside P&L periods but the active UI does not call it | A managed payment can also remain inside baseline profit | Require explicit inclusion/exclusion review with a clear before/after composition |

Add focused regressions for these boundaries. They are meaningful money semantics, not a request for a new test suite per cosmetic change.

### 5. Original offer capture must cover every entry path

`workspace-commands.ts` captures `originalOffer` when applying `add_offered_project`. At the initial audit, `src/features/household-plan/ops.ts:addProject` did not; **Codex has fixed that during integration**. `workspaceFromCase` still creates lines directly and needs an explicit conversion-path check. Capturing an offer only at agreement cannot recover terms changed before that agreement.

Task: capture an immutable original offer at the first explicit user confirmation through every entry path. Later corrections to mistakenly entered original facts must be deliberate, dated and auditable; normal negotiation must not overwrite them. Old plans lacking an original must be labeled “captured from existing plan,” never retroactively presented as the original email.

Acceptance: manual offer A → changed offer B → chosen terms C → agreement → received payment → reopen; A is still available with its source and confirmation. Current comparisons say exactly whether their base is the original offer, latest counteroffer, current agreed schedule or declining the unpaid part.

### 6. Manual operations and confirmed commands have different invariants

Manual `ops.ts` and client `workspace-commands.ts` both mutate projects, receipts, SEP and forecasts. Engine `validateAndApply` also validates and applies command meanings. `WhatChanged` correctly previews using the function it will save, but business validation is still supplied separately by `previewChange`; `commitProposal` itself calls the client apply path.

Task: establish a single deterministic validation/application core for the overlapping operations; preserve public wrappers to minimize churn. Validation must apply at commit, not just in a disabled UI button. Use explicit user calendar date for business date checks, UTC only for event timestamps. Keep revision conflict checks, all-or-nothing application, stable retry IDs, original source and correction history.

Do not force every existing form through an oversized AI request. Manual entry can construct typed commands directly. There must be no provider requirement to record an actual payment.

Acceptance: manual/document/text versions of the same change produce equivalent financial state. Future actual receipts/contributions, an unknown target, stale revision and an already received line are handled consistently. A lost acknowledgment followed by retry adds neither a second contribution nor a second receipt.

### 7. The client-response loop ends at “shared” or “agreed”

`ActionPackage.status` has draft/shared/agreed/superseded. `PackageCard` exposes “I sent these terms” and “The client agreed.” There is no complete rejected/counteroffer transition that preserves the prior proposal, applies new negotiation bounds and explains the consequence.

Task: add **Client responded** with accepted, counteroffer and declined. Enter/paste the response, review concrete changes, then recalculate before replacing anything. Preserve original offer, previous proposal, response and current agreement as distinct states. Show a compact negotiation history, not a chat simulation. Produce an editable client-message draft without household financial details by default. Never send it or claim a signature/agreement automatically.

Acceptance: client refuses January payment; Headroom removes that unavailable option, recalculates permitted alternatives, shows revised money and explains when none meet the goal. No invented assumption that a higher price will be accepted. A counteroffer with missing date asks for it. Paid deposits remain facts even when the client declines further work; refund/cancellation obligations must be explicit if material to a comparison.

### 8. Partial receipts need a deliberate model transition

`recordActual` and `record_receipt` replace an entire expected line with one actual amount. This is valid for a completed payment that differs from expectation, but not enough for “the client paid $3,000 of the $12,000.” Without an explicit remaining line, the other $9,000 disappears from the open schedule.

Task: distinguish **partial payment**, **fully settled at this amount**, and **correction of a mistaken record**. A partial receipt is one atomic action that records the actual amount and retains an explicitly confirmed remaining amount/date. Preserve lineage and do not count the original expected line plus both children. Do not infer an extra payment merely because the receipt is smaller.

Acceptance: $12,000 expected → $3,000 received, $9,000 still due → remainder moved → remainder received. Cash/profit includes exactly $12,000 in the actual years. Calendar shows only open amounts. Re-import/retry remains idempotent. A genuine final $10,000 settlement is possible after explicit confirmation.

### 9. Display freshness and labels must follow financial meaning

The initial `DealPanel` marked search stale only when its local goal draft JSON changed. Household updates could change `ws` while the panel remained mounted with the same project key. **Codex reports this has now been fixed by binding the result to the saved workspace revision.** Preserve and extend this visible invalidation to the new intake, counteroffer and partial-payment flows; later package guards alone would not be sufficient.

The initial audit found that the mobile option-row footer always called the settled baseline “declining” and the by-date amount “gross payments.” **Codex corrected those footer claims during integration.** Actual goals support `accept_as_offered`, `project_available_cash` and `household_balance`, so shared presentation semantics still matter. Without a date goal, the main card can show year-end availability while mobile choice rows show `—`; keep this intentional or align it clearly.

Task: one shared result presentation descriptor from engine/contract metadata: metric kind, baseline, tax horizon, date, amount, conditions, precision. Consume it in desktop, mobile, summaries, explanation packets and PDFs. Bind result to workspace fingerprint, goal, term space, cash context and rules version. Invalidate display, selection and exports together; keep historical records readable as history.

Acceptance: change household income while options are visible; old results visibly stale and not selectable. Change baseline/date goal; every label and number retains its intended meaning on 360px and PDF. No retirement principal in spendable cash; no anticipated tax refund shown as bank balance today.

### 10. Ambiguities should be answered without rewriting the whole sentence

Provider proposal questions are free strings with empty option arrays. `WhatChanged` tells the person to add missing information to the sentence and run again. `answerAmbiguity` is a pattern-only rerun. This is an incomplete conversational form, especially for first use and counteroffers.

Task: typed unresolved fields with appropriate amount/date/person/project choices; bind answers to the existing draft and resolve deterministically where possible. Only use another provider call when interpreting new text is actually necessary. Preserve already confirmed facts and provenance; do not turn a provider-understood instruction into an unsupported pattern after one answer.

**Codex has removed** the pattern fallback's inference of SEP tax year from a paid date after April 15. Preserve that fix across the new path: if the message/document does not specify the contribution's tax year, ask; the paid calendar date alone is not the user's confirmation of tax year.

Acceptance: “They will settle the balance next Friday” with two projects → choose project → see absolute local date and precise change → confirm. An ambiguous SEP contribution asks whose/year separately. Quota failure during an optional rewrite retains the prepared draft.

### 11. Attention, dates, reminders and completion form one lifecycle

Current attention and current-calendar generation already exist. Do not replace them with a generic task tracker. Finish consistency: due dates use the user's local day (`attentionItems` still defaults to UTC date); next action is tied to an actual blocker/commitment; a receipt or completed contribution removes its open action; a superseded proposal should not keep demanding the old action. Avoid blanket cancellation of a fact that actually happened.

An `.ics` download is not a live calendar subscription. Keep the honest update/import note. No email/push automation is implied by the current implementation. A signed private calendar feed, email reminders or inbox connection is a separate optional product decision, not required to finish this release.

Acceptance: an overdue payment can be recorded, moved or deliberately cancelled; each has the right consequence. Re-export after date change retains UID and increments sequence; completed action no longer appears active. A historical PDF preserves the original decision while current export uses current facts.

### 12. Persistence, failure paths and judge artifacts need a finite release check

Preserve current anonymous guest/no-login flow, local fallback, JSON portability and safe cross-tab revision checks. Do not describe guest cloud storage as multi-device synchronization; `store.ts` correctly says it is private to that browser session. Late cloud failure should retain the pending edit and offer a separate local copy/export, not claim success.

Provider failure is not merely a spinner case: distinguish timeout, refusal, invalid output, quota exhaustion and unsupported file. The parent is handling the current BasisWeb integration; next-round developers must preserve it. Budgeting must match the provider's actual billing basis, and unknown USD cost stays unknown. Secret keys, raw documents, text and household amounts must not enter logs or analytics.

Verify actual generated PDFs, current `.ics`, JSON round trip and publicly opened routes. Preserve supplied final visual/presentation assets. Do not create screenshots that imply a workflow absent from the deployed build.

## Three-owner delivery plan

### Claude 3: contracts, intake, command integrity, lifecycle and observability

First publish small additive contracts and a short integration note. Required seams: incomplete intake draft + confirmed conversion; extended fact targets/metadata; typed ambiguities; negotiation response/history; partial receipt; shared commit semantics and user date; result descriptor fields if agreed with Claude 2. Preserve v1/v2 and existing round-5 readers.

Then deliver:

1. One extraction → review-draft pipeline for paste/files/manual and both first/existing plans, with provider fallback and explicit consent.
2. Atomic reviewed import and conflict resolution, supported wage/coverage/offer targets, target-aware dedupe and source lineage.
3. Common command core with commit-time validation, idempotency, original-offer capture and partial receipts.
4. Negotiation event storage and command semantics; no outbound sending. Keep historical records and current package/ICS behavior separate.
5. Provider capability/error/call-cap handling, bounded metadata-only health reporting; deployment/env/migration instructions if needed.
6. Analytics semantics accurate enough for the pitch: own/sample/internal-check distinction if adopted; valid starts/results/exports/return events; no paid-customer event from demo access. Current daily totals cannot be presented as unique conversion or retention. If adding attempt/session measurement, document precisely what it can and cannot establish, use bounded ephemeral identifiers, and collect no financial payload.
7. Current README/release facts, API/deployment documentation and a reproducible artifact-generation handoff. Do not write a polished deck with unverified metrics.

### Claude 2: financial meaning, first payoff, constraints and proof

Start immediately on pure logic using agreed additive types; keep existing API compatibility while Claude 3 publishes contracts.

1. Expose a stable as-offered evaluation contract and first-use readiness mapping. Ask only relevant years and facts.
2. Correct normalization hazards above, then make one semantic validator usable by imports and commands without duplicating calculations in the UI.
3. Validate counteroffer constraints, original/latest/agreed comparison bases, partial receipts and held deposits. Do not treat refusing an already agreed job as a cost-free option.
4. Return consistent result descriptors for money/horizon/baseline/precision; preserve tax/credit attribution identities and separate retirement from cash.
5. Make uncertainty actionable: identify the fact that changes the decision, retain declared ranges, show conditional rather than unconditional recommendations. Distinguish a fixed policy buffer from a mathematically guaranteed reserve. Keep “no feasible terms” meaningful and quantify only genuinely evaluated relaxations.
6. Source and scope review of release calculations. Keep unsupported cases explicit. No broad state/nationwide expansion in this round unless fully sourced and verified through the same guards; county candidates remain candidates.
7. Bounded proof pack: a favorable ordinary offer, a cliff-sensitive family, an ambiguous-income case, a client counteroffer, partial receipt crossing years, and a stale historical/current result. Every displayed money claim comes from the actual engine and version. Expose scenario inputs for judge editing.
8. Update the unit-economics calculation only with the research agent's sourced inputs and explicit assumptions. Product financial accuracy is separate from business LTV/CAC hypotheses.

### Claude 1: one complete browser journey and final visual quality

Start immediately on composition and reusable shells with existing supported data; consume the small shared contract commit before wiring mutations. Do not wait idle for a complete backend branch.

1. First offer review from paste/upload/manual; show source next to extracted terms; editable amounts/dates; explicit deposit vs balance; drafts survive errors/reload.
2. Readiness-first onboarding and as-offered payoff; ask 1–3 necessary questions at a time; unsupported state early; optional deeper optimization after value is visible.
3. One multi-document review with person/year/month decisions, visible contradictions, atomic confirm, removed/skipped/reused figures and no silent overwrite.
4. Goal and result layouts with correct descriptors, short recommendations, visible actual conditions, comparison details on demand and stale gating.
5. Client response and counteroffer loop; original/latest/chosen terms are distinguishable; copy/download client draft; explicit “you recorded agreement.”
6. Actual/partial/final payment choice, corrections, remaining schedule, SEP paid vs target, next action, history and current exports in the same plan.
7. Failure/empty/offline/unknown/unsupported/429 states retaining work; no dead buttons, fake payment success or signup screens.
8. Preserve design C: strong landing, calm work screens, correct typography/contrast/focus, reduced-motion-aware transitions and scrolling, no looping chrome or money countups. Verify 360px, short laptop viewport, 200% zoom, keyboard/focus recovery and large values/long names.
9. Real screenshots and a concise judge walkthrough from the final working build. Frontend images are product artifacts, not evidence of demand.

## Contract schedule that avoids three blocked developers

1. Claude 3 sends a contract delta early: exact schemas, functions, status enums, examples and compatibility. Claude 2 reviews monetary semantics; Claude 1 checks whether controls can represent unresolved values.
2. Each branch continues independent work immediately. Claude 1 can build shells and reuse current controls; Claude 2 works on pure financial functions; Claude 3 works on transport/persistence. Temporary local fixtures must be clearly development-only and cannot ship as a success path.
3. Integrate one vertical slice early: ordinary pasted offer → confirm → minimal readiness → as-offered result → save. This tests architecture before all three produce large final branches.
4. Integrate next vertical slices: conflicting documents; counteroffer; partial receipt and revised plan. Additive contract changes are named and communicated, not silently renamed in one branch.
5. Freeze interfaces, run the bounded checks, inspect release artifacts, then hand off. Each developer commits/pushes only their branch; Codex performs combined main integration and deployment.

## Finite acceptance matrix

| Journey | What must be visibly true | Primary owners |
|---|---|---|
| Own-data first offer | Ordinary language → reviewed source facts → no forced 2027 for 2026-only offer → actual result → reload | 1 + 3, readiness/result 2 |
| Benign offer | Clear positive outcome; no forced “optimization” or invented danger | 2 + 1 |
| Family near boundary | Correct cash/retirement/credit attribution, feasible terms, conditional promises | 2 + 1 |
| Two conflicting documents | Ask whose/year/month; conflict resolved explicitly; one atomic revision; retry no-op | 3 + 2 + 1 |
| Unknown spouse income | Unknown remains unknown; visible reason and meaningful next question/range | 2 + 1 |
| Client rejects January | Revised constraints, original preserved, new calculation or honest infeasible result | 3 + 2 + 1 |
| Partial receipt | Actual replaces the paid portion only; remaining amount/date explicit; no double count | 3 + 2 + 1 |
| Later income change | Agreed plan rechecked; stale options blocked; historical record unchanged | 2 + 3 + 1 |
| Provider unavailable | Text/draft retained, honest state, manual flow still completes | 3 + 1 |
| Save conflict/failure | No silent overwrite or fake cloud success; retry/local copy/export works | 3 + 1 |
| Judge artifacts | Guest public URL, current screenshot, readable PDF, valid ICS, JSON restore, correct repo links | 1 + 3, numbers 2 |

Per branch: typecheck, relevant focused tests and one build. After integration: one final cross-module test run, one compact UI smoke, deliberate browser review of the release journeys above and actual exports. Repeat only after relevant fixes. No arbitrary coverage target or cosmetic snapshot suite.

## Explicit boundaries and later hypotheses

This round should not add bank login, a full bookkeeping ledger, general budgeting, stock recommendations, a tax filing product, gamification, a marketplace of advisers or broad insurance shopping. Each introduces a different user promise and verification burden without completing the core loop.

Potential later extensions require evidence first: broader verified insurance data, more supported household/state cases, private calendar subscription, opt-in reminders, an adviser handoff package, or supported HSA/retirement alternatives. They are candidates, not promised release scope. The immediate adviser handoff can already be a truthful export of facts, decisions, assumptions and unresolved questions.

The presentation should distinguish three evidence categories: working software observed on the deployed build; sourced external market/competitor information; and unvalidated business hypotheses. A good feature inventory is not proof of customers or willingness to pay. The strongest demonstration is a realistic changed circumstance that the same saved plan handles correctly, with an explanation a non-tax-expert understands.
