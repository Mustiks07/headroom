# Round 6 contract (Claude 3)

Additive only. v1 plans, v2 workspaces and round 4/5 data parse unchanged; new optional fields are excluded from fingerprints. Implementations follow in later Claude 3 commits; until then the three new command types return `NOT_AVAILABLE_YET` from `applyCommand`.

## Files

| File | What |
| --- | --- |
| `src/domain/intake.ts` | `IntakeRequestSchema`, `IntakeResult`, `ProposedOffer` / `ProposedPayment` (as written), `UnresolvedField`, `TypedAnswer`, `OnboardingDraftSchema`, `OnboardingConversion`, `PROVIDER_STATUSES` |
| `src/domain/imports.ts` | `ImportTargetSchema` (forecast, wages, interest taxable/tax-exempt, coverage months, payment, partial_payment, sep, new_offer, reference_only), `ImportDecisionSchema`, `ImportApplyResult` |
| `src/domain/assistance.ts` | three new `ChangeCommand`s: `record_partial_receipt`, `settle_lower_total`, `record_client_response` (accepted / rejected / countered) |
| `src/domain/decision-context.ts` + `household-workspace.ts` | `OfferVersionSchema`; `Project.offerVersions?`; event kinds `partial_receipt_recorded`, `payment_settled_lower`, `client_response_recorded` |
| `src/domain/actions.ts` | `CurrentActionSchema` (projection, not a reminder database), `MONEY_MEASURES` (one label per money measure), `ResultBindingSchema` (workspace/revision/fingerprint/versions, current vs historical) |
| `src/lib/client/analytics-events.ts` | round 6 funnel events and `developer` data kind (needs migration 006 for storage) |
| `src/fixtures/round6.ts` | sample offer email, intake result, onboarding draft, import decisions, lifecycle commands, current action |

## 1. First-offer intake

`POST /api/assist/intake`

```json
{"purpose":"first_offer","text":"…ordinary client email…","userDate":"2026-11-15","timeZone":"America/Chicago","consentToProvider":true,"project":null}
```

→ `IntakeResult`

```json
{"intakeVersion":"1.0","draftId":"draft-…","outcome":"proposed","provenance":"ai_model","providerStatus":"used",
 "offers":[{"id":"offer-1","title":"Booking site redesign","currency":"USD",
   "totalPrice":{"amountCents":1200000,"asWritten":"$12,000","excerpt":"Budget is $12,000 for the whole project"},
   "payments":[{"id":"offer-1-p1","amountCents":400000,"amountAsWritten":"$4,000","date":null,"dateAsWritten":null,"condition":"when we sign","status":"expected","excerpt":"$4,000 when we sign"},
               {"id":"offer-1-p2","amountCents":800000,"amountAsWritten":"$8,000","date":"2027-01-15","dateAsWritten":"around January 15","condition":"on delivery","status":"expected","excerpt":"…"}],
   "costs":[],"costsStated":false,"taxYearStated":null,"negotiable":{"price":null,"schedule":null}}],
 "questions":[{"id":"q-offer-1-p1-date","kind":"date","subject":{"kind":"payment","ref":"offer-1-p1","field":"date"},"question":"When do you expect the $4,000 payment (\"when we sign\")?","reason":"…","options":[],"blocking":true,"source":{"draftKind":"intake","draftId":"draft-…","excerpt":"$4,000 when we sign"}}],
 "unsupported":[],"notes":[]}
```

- `costsStated:false` = costs unknown, not $0. `taxYearStated` only when written. A quoted invoice is `expected`; "paid"/"received" text is `said_received` and still needs confirmation.
- `providerStatus` tells an outage (`timeout`, `quota`, `unavailable`, `invalid_output`, `refused`) from no consent (`not_consented`) or AI off (`disabled`); `outcome:"unsupported_input"` is input Headroom can't use (e.g. another currency), `nothing_found` is text without offer terms. Manual entry stays available in every case.
- Counteroffer: `purpose:"counteroffer"` with `project:{projectId,title,openPayments}` — the only plan context sent.

## 2. Onboarding draft and typed answers

`OnboardingDraft` lives in the browser (`localStorage["headroom.onboarding.v1"]`) before any workspace exists: text (only while the user keeps it), offers, document facts, questions, answers, Claude 1's profile draft (opaque). Answers are `TypedAnswer`s bound to a question id (`date`, `amount`, `person`, `project`, `tax_year`, `months`, `choice`, `unknown`) — never text appended and re-parsed.

Client functions (next commit, `@/lib/client/api`): `loadOnboardingDraft()`, `saveOnboardingDraft(d)`, `draftFromIntake(result, text)`, `answerQuestion(draft, answer)` (updates the bound offer/payment), `onboardingToWorkspace(draft, caseInput, forecasts)` → `OnboardingConversion` (`converted` | `needs_answers` | `invalid`). Conversion creates the project with the shared `add_offered_project` command, so `originalOffer` is captured (`assistant_text` or `user_entered`).

## 3. Common import

`applyImportGroup(repo, ws, draft, decisions: ImportDecision[], {userDate})` → `ImportApplyResult`:

```json
[{"factId":"w2-a-box1","target":{"kind":"wages","personId":"primary","year":2026,"field":"w2Box1"},"resolvesConflictWith":[],"correctedAmountCents":null},
 {"factId":"w2-b-box1","target":{"kind":"wages","personId":"spouse","year":2026,"field":"w2Box1"},"resolvesConflictWith":[],"correctedAmountCents":null}]
→ {"status":"applied","revision":5,"eventId":"evt-import-…","applied":2,"referenceOnly":0}
```

Claude 2's `checkExtractedFacts` runs on the whole group first (with the user's persons/months/links as hints); any `needs_resolution`, unresolved conflict or invalid target → `rejected` with per-fact issues and nothing saved. Same group again → `nothing_new`. Different revision than reviewed → `stale`.

## 4. Negotiation and payments (commands)

```json
{"type":"record_client_response","projectId":"proj-b","response":"countered","respondedOn":"2026-11-20","packageId":null,
 "counter":{"totalPriceCents":1300000,"unpaid":[{"amountCents":500000,"date":"2026-12-15"},{"amountCents":800000,"date":"2027-01-06"}],"note":"…"}}
{"type":"record_partial_receipt","projectId":"proj-b","lineId":"b-pay-1","amountCents":300000,"date":"2026-12-15","remainderDate":"2027-01-10"}
{"type":"settle_lower_total","projectId":"proj-a","lineId":"a-pay-2","amountCents":250000,"date":"2026-12-20","reason":"…"}
```

- `countered`: new `offerVersions` entry (`client_counteroffer`, open); unpaid expected lines replaced by the counter terms; received lines kept; `originalOffer` untouched; project back to `proposed` for evaluation.
- `accepted`: project `agreed`; open version `accepted` (appends `accepted_terms`); a matching package becomes `client_agreed` with its decision record.
- `rejected`: project `cancelled`, unpaid expected lines cancelled, received money stays; version `rejected`.
- Partial receipt: the line gets `actual` = received part; a new line `<lineId>-rest` expects the remainder on `remainderDate`. Amount ≥ expected is refused (record the full receipt instead). Settled-lower: actual < expected, no remainder, explicit reason.
- All go through `applyChangeProposal` / `commitProposal` (base revision + fingerprint, stable event ids = retry no-op) and, from round 6, Claude 2's `validateAndApply` business checks at commit time too.

## 5. Actions and presentation

`currentActions(ws, userDate): CurrentAction[]` — pending / completed / superseded from saved facts (expected and overdue payments, partial remainders, SEP still to pay, open client responses, agreed package reminders). Calendar export uses the same projection. `MONEY_MEASURES` gives the one label per measure; `ResultBinding` is attached to shown/exported results (`basis: current | historical`).

## Needs from Claude 2

`validateAndApply` must understand the three new commands (blockers for future actual dates, amount ≥ expected for a partial, unknown line, rejected project with open package). Until it does, Claude 3's `applyCommand` checks are the only ones for those commands. `checkExtractedFacts` should map `income.taxableInterest` and `income.taxExemptInterest` to separate fields (now both `interest`).
