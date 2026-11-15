# Claude 1 — complete the product experience

You own `src/app/**` except API, `src/components/**`, `src/features/**`, `public/**` and bounded UI checks. Read `AGENTS.md`, `ROUND6_SHARED.md`, the integration handoff, selected C references and `docs/research/round6-product-gap-audit.md`. Continue `claude1`; merge latest main normally. This is implementation, not a design proposal.

## 1. First useful answer with much less form filling

- Keep the actual offer textarea prominent on desktop and mobile. Accept natural client language, not just `Project fee:` labels. Use Claude 3's intake interface, show consent before external processing, preserve pasted text on failure and offer manual correction.
- Offer/document intake should open one review: price, currency, payment dates, project costs and title with exact source excerpts. Missing costs/date are unknown; do not fill zero or today's date silently. A date spanning tax years requires the exact year.
- Connect Claude 2's existing `evaluateOfferAsOffered` and readiness flow to the UI. It currently has no product caller. A current-year result should not demand a complete next-year forecast just to start. Ask for next-year information when a cross-year option needs it.
- Replace the initial long mandatory questionnaire with short purposeful groups, normally 1–3 related questions at a time. Display why a question matters and what document supplies it. Preserve completed answers and allow back/edit/reload.
- If insufficient data prevents a responsible result, show the next blocking question or a meaningful conditional range. Do not substitute a confident answer. Unsupported filing/business/coverage situations get an explicit boundary.
- Use the incomplete onboarding draft before the full household schema is valid. Inline controls resolve dates, amounts, person, project and year against the existing proposed facts; don't make users append magical phrases and rerun regex parsing to answer a question.
- Keep a year-income entry without fabricating a client project. Existing households should reuse confirmed information and ask only what changed.

## 2. One document review, before and after saving

- Adopt the common `ImportDraft`/semantic validation/atomic apply flow from Claude 2/3. Retire the separate per-file partial-apply behavior in `DocumentFacts` and align first-use `DocumentImport` with it.
- Support the fields that are actually accepted: offer, profit forecast, wages, interest, coverage and SEP/payment confirmation. Do not advertise a document whose relevant fields cannot be applied to a saved plan.
- Resolve person, tax year, period, relevant months, project/payment and estimate-vs-confirmed status before applying. A W-2 belonging to another adult is not automatically a conflicting same-person value. A prior-year return is context until the user explicitly uses it as an estimate.
- Present different source values side by side. Let the user select a source, correct a value or leave it unknown. Never use last upload wins. Explain why an annual premium cannot fill twelve monthly cells unchanged.
- One confirmation applies the chosen valid group as one saved revision. If one member is invalid, keep the whole group uncommitted with a useful correction path. Retry/reimport does not duplicate payments or contributions.
- Allow a corrected/replacement document without deleting the provenance of a prior decision. User-facing source labels must be concise and meaningful.

## 3. Negotiation as a complete flow

- From each project show original offer, current proposal and agreed terms clearly. Display both comparison baselines when relevant: versus declining and versus accepting the original/current offer. Labels and dates must come from the result metadata.
- Show at most three genuinely distinct choices, a clear recommendation and reason, material assumptions, cash by date, final cash after settlements, separate retirement principal and client agreement required.
- Add client-response actions: accepted; declined; counteroffer/new constraints. The counteroffer can be pasted or entered, reviewed, then evaluated. Old decisions remain visible as history. Rejection does not imply deleting earned/received money.
- Editable client message with copy/download works; don't claim it was sent. Recording acceptance is explicit. User can return from a rejected option to another feasible one without reconstructing their household.
- Make impossible goals useful: explain the specific limiting constraint, the closest valid option if the engine supplies one, and which change would make the goal reachable. Do not let UI invent a price or savings figure.
- Immediately mark results stale when the workspace fingerprint/revision changes, not just when the goal form changes. Disable choosing an outdated option and offer recomputation. Re-read the authoritative workspace after apply.

## 4. Payments and repeat use

- When a receipt is smaller than expected, ask whether it is a partial payment or a fully settled lower total. Partial payment preserves the remaining amount and asks for its date. Use Claude 3's atomic command; do not create the remainder manually in the UI.
- A short “What changed?” path must handle payment received/moved, new offer, changed forecast, SEP contribution and client response. Show exact before/after facts and changed outcome before apply. Ask which project/person/year when ambiguous.
- Build a focused next-action view: open relevant decision, expected payment due/overdue, unconfirmed fact, remaining SEP action or changed-plan review. Use saved facts and real dates. No fake urgency, invented risk score or generic habit dashboard.
- Mark completed actions explicitly and distinguish planned from executed. Dates and deadlines need source/condition where material. Use the local calendar date consistently.
- Make continuing an existing plan obvious from home. Show last confirmed facts/last decision and next action, not a full form reset. Keep guest-local and guest-cloud status understandable.

## 5. Polish every judge-facing screen in selected C

**User correction, November15:** only the hero currently feels designed; the lower landing and other screens are visually insufficient. The existing repeated card composition is not approved. Preserve C's identity and hero assets, but redesign the lower-page narrative, review, terms, client-response and current-plan compositions with stronger typography, information hierarchy and purpose-specific layouts. Read `docs/design/c-round6/README.md` and inspect both generated boards before implementing the visual continuation. These are new composition proposals with explicit semantic corrections, never a screenshot pasted over the app or hardcoded financial results. Keep all functional requirements from this assignment.

- Compare home, review, result and mobile against `docs/design/c-open` images. Preserve cobalt/chrome/lime/Geist; keep chrome on landing only. Financial result pages prioritize reading.
- Remove repetitive “demo/synthetic/example” chrome from own-data journeys; keep a single truthful context label on fixture journeys. Pricing must distinguish a proposed price from a completed payment; every function stays accessible for judges.
- Short, purposeful motion: <=450ms initial hero, 180–220ms panel/disclosure, small translations; reduced motion removes it. No fake money count-up, looping scene or fake loading progress.
- Desktop, 360px and zoom/reflow: input/CTA usable, no clipped values, no sticky controls hiding errors/focus, 44px targets, native labels, keyboard/escape/focus restoration.
- All result areas, especially mobile choice rows, must use the same baseline and money-by-date definition. Never label household balance as gross project receipts. Explain estimated or unavailable values at the relevant figure.
- Clean empty/loading/failure/saved/stale states; no silent no-op buttons. Preserve drafts on refresh. Make delete/backup/restore discoverable with appropriate existing confirmations.

## 6. Exports and pitch-ready evidence

- Inspect real downloaded decision PDF, current calendar and restored JSON after the full journey. Coordinate layout fixes with Claude 3. Historical records and current plan must be clearly distinguished.
- Record a reproducible English 2–3 minute judge script using the completed path, with a short manual fallback if AI/network fails. Update `docs/demo/round6-judge-script.md`.
- Produce actual screenshots of home/review/options/counteroffer/update and 360px result under `docs/artifacts/round6/ui/`. Label fixture screenshots in their metadata/context; do not replace an approved deck or create fake app screens.
- Create a small usability protocol and results table: input path, missing questions, time to first supported answer, corrections, time to agreed terms, failure/recovery. Your own runs are developer observations, not user research. Coordinate metrics/events with Claude 3.
- Bring landing copy into agreement with real functionality. Supply final README screenshots/copy to Claude 3 in the handoff; Claude 3 owns editing README. Do not add fabricated testimonials, logos, customer counts or savings counters.

## Acceptance and delivery

Complete the common finite matrix plus one own-data entry journey and a 360px counteroffer/partial-payment journey. Typecheck, relevant UI checks and one build. Handoff must list real dependency commits and precise remaining gaps. Commit and push `claude1`; do not deploy or merge main. If another developer's contract is pending, finish independent UI/states/assets and publish your dependency need, not an empty “blocked” handoff.
