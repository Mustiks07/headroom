# Round 6 — finish the decision journey

Owner: Codex. Read this before your individual `CLAUDE<N>_ROUND6.md`. This is the next implementation round after the integrated round 5 release. Instructions are deliberately larger than a list of cosmetic fixes: complete the known product gaps in this iteration. New findings may still require a later correction.

## The product we are completing

**Headroom helps a self-employed household decide what a client offer really leaves them, agree workable terms, and keep that decision current as income and payments change.** ACA health-insurance protection is central. It is not a general budget app, a chatbot that invents tax advice, or a promise to maximize every person's wealth.

The entry point is a concrete offer or the user's changing annual income. The repeat value is a new offer, changed terms, partial payment, updated income, SEP contribution or insurance notice that could change the next action. A full-year subscription is still a hypothesis, not evidence of retention.

An excellent round ends with this real path:

1. Paste an ordinary client email or upload a readable document.
2. Confirm the proposed facts with their source; answer only the missing questions needed for the selected decision.
3. See the result of accepting the offer, even when next year's information is not yet available. Explain any provisional basis.
4. Choose an outcome and realistic negotiation limits; compare at most three meaningful alternatives with cash, retirement, dates and uncertainty separated.
5. Prepare a client message. Record acceptance, rejection or a counteroffer without rewriting the original offer.
6. Record a partial or full payment. Keep the remaining amount, actions and calendar correct.
7. Update income or another fact. Explain what changed, what remains valid and the next useful action.
8. Reopen without registering; export a readable decision record and a restorable plan.

## Non-negotiable boundaries

- English app and exports. No login, signup, email wall or payment gate. Invisible guest sessions are plumbing. Preserve offline/browser-local manual calculation.
- Keep selected design C: `docs/design/c-open`. Preserve approved assets. No replacement brand exploration.
- All financial results come from the deterministic engine. AI extracts or proposes; it cannot decide the tax year, person, eligible months or legal eligibility by guessing.
- Integer cents at boundaries. Unknown is not zero; estimate is not confirmed. Deposits are not automatically profit. YTD is not a full year. Retirement principal is not spendable cash.
- Original offer, currently proposed terms, agreed terms, expected payments and actual receipts are different records.
- Changes require a visible preview and explicit apply. Stale proposals and double application must be refused or safely recognized. Never silently partially apply a group.
- Keep fixture provenance in fixture contexts. Remove repetitive developer/demo language from normal own-data journeys, not the truth about source data or payment status.
- No automatic sending of client messages, Marketplace submissions, retirement transfers or tax filing. Draft/export actions are real working functions.
- Do not claim real customer savings, customer payments, independent tax review or guaranteed optimality without evidence.
- No speculative bank connection, Gmail access, general chat, native app, investment recommendations, additional tax states or unbounded tax-case expansion in this round. These would dilute the verified core.

## Starting point and integration corrections

Merge the latest `origin/main` normally into your existing branch. Do not restart or overwrite another branch. Round 5 combines Claude 1 `51ba0fa`, Claude 2 `c074b94` and Claude 3 `7667644`, followed by Codex integration corrections.

Already corrected in integration: ambiguous payment references no longer pick a project; SEP updates ask for the contribution's tax year; manual project creation captures its original offer; short-screen hero entry remains visible; browser-local dates avoid UTC backdating; BasisWeb is wired privately with call quotas; PDF text is extracted server-side because this gateway rejected attachments. Read the integration handoff for actual verification and remaining limits. Do not undo these fixes.

Current versions: engine `headroom-engine-1.3.0`, household `headroom-household-1.0.1`, deal `headroom-deal-1.1.0`, rules `us-federal-aca-2026-2027.r3`. Bump affected versions for changed financial semantics; coordinate once, do not independently choose conflicting versions.

## Ownership and order

| Work | Claude 1 | Claude 2 | Claude 3 |
|---|---|---|---|
| First input, short question flow, source review | UI, accessibility | Readiness and semantic requirements | Intake, proposal/import contracts |
| Offer as written; feasible better terms | Render and explain | Calculation, robustness, search | Revision-bound API and storage |
| Negotiation and partial payments | Complete user flow | Effects on cash/tax/remaining goal | Commands, immutable history, idempotency |
| Documents across a saved household | Conflict/resolution UI | Meaning/year/person/period validation | Parsing, merge and atomic persistence |
| Actions, calendar, PDF | Usability and real export inspection | Correct labels, amounts and deadlines | Export rendering and lifecycle |
| Evidence for pitch | Timed usability protocol and screenshots | Scenario/alternative and economics report | Extraction/API benchmark and funnel |

Claude 3 owns additive public contracts in `src/domain/**` and publishes a **small contract commit first**, with examples in `docs/handoffs/round6-contract.md`. Claude 2 sends engine needs immediately and uses that commit. Claude 1 implements independent layout/questions/review states against the agreed interface while the other modules are being implemented. Use explicit unavailable/loading/error states, not fake successful numbers. Merge published dependency commits normally as they arrive. Waiting for a specific interface does not block independent assigned work.

The first contract must include an **incomplete onboarding draft** that survives reload before a valid HouseholdWorkspace exists, an explicit confirmed conversion, and typed answers to unresolved date/amount/person/project/year fields bound to the same source/proposal. Do not recreate the full mandatory profile merely to call readiness. Claude 3 edits README; Claude 1 supplies the final screenshots and copy in its handoff so they do not collide.

All three publish coherent increments, then their final handoff. Only Codex integrates `main` and production. No force push. No secret changes in Git. Existing Vercel/Supabase projects must be reused.

## Release priorities

**Required:** first-offer path, common semantic import, revision-safe decisions, counteroffer/rejection, partial receipt, honest uncertainty, consistent financial labels, guest persistence, useful exports, selected design and bounded verification.

**Finish in this round after those:** next-action view, document correction/replacement, return-to-plan experience, recovery/export polish, measured fixture benchmark, analytics report, business/presentation evidence. Each must be a working part of the same journey.

If a requirement is unsupported by a real dependency, implement a clear safe boundary and document the concrete missing integration. Do not mark a switch or mock as a completed function. Do not create additional speculative features to fill the UI.

## Shared acceptance set — finite, consequential

Use a small documented matrix; reuse existing tests and add regressions for actual financial/data failures. No coverage target or endless green reruns.

1. Own-data email/PDF → review → missing facts → accept-as-offered result → allowed terms → saved decision.
2. Same document twice; conflicting same-period values; two different adults; prior-year/YTD/annual/monthly ambiguity; resolved batch either applies once entirely or not at all.
3. Client counteroffer changes price/date, rejection preserves history, partial receipt preserves remainder; already received money survives renegotiation/cancellation.
4. Changed household revision makes old result/preview visibly stale before choose/apply/export; retry does not duplicate events or money.
5. Low-impact offer where no intervention is useful; near-cliff offer; incomplete spouse/coverage data; impossible cash goal; uncertainty that reverses the recommendation.
6. No AI key/quota/timeouts and cloud failure leave a usable manual path. Privacy consent and cross-guest isolation remain intact.
7. Actual 360px and desktop UI, keyboard focus, reduced motion, no accidental horizontal scroll. Inspect downloaded PDF, JSON restore and ICS, not only route status.
8. Time/correction metrics from labelled fixtures are separated from real users. Zero customer observations remain zero.

At handoff run typecheck, the relevant test group, one build and your actual journey. Repeat only after a related change/failure. Codex performs one combined release check on the final commit.

## Required handoff

Write `docs/handoffs/claude<N>-round6.md`: commit SHAs; completed requirements; exact routes/functions; migration/env changes by name only; checks and inspected artifacts; unresolved limits; dependency commits. Include an explicit table **implemented / verified / not verified**. Update current docs without erasing historical handoffs. No final deck yet: provide verified evidence and English copy for the deck after code freeze.
