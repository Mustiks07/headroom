# Claude 3 — round 6 handoff (one reliable data and AI path)

Branch `claude3`, merged `origin/main` @ `2dc973b` (normal merge, no conflicts). `main` is unchanged; Codex integrates and deploys. No AI or cloud keys were available in this session. **No real provider request was made in round 6**, and no cloud project was created or changed.

## Commits

| SHA | What |
|---|---|
| **`03ebf21`** | **Contract** (merge this first): `src/domain/intake.ts`, `imports.ts`, `actions.ts`; three new commands; `OfferVersion` / `Project.offerVersions?`; new event kinds; round 6 analytics events; fixtures; `docs/handoffs/round6-contract.md` with examples |
| `2e481ef` | Negotiation/payment commands; save re-runs Claude 2's `validateAndApply`; `manualProposal` / `commitCommands`; original offer captured in `workspaceFromCase` and version history in `recordClientAgreement` |
| `c37d6a4` | First-offer intake (`POST /api/assist/intake`, built-in + checked provider reading), onboarding draft, typed answers, conversion, counteroffer command |
| `5eab276` | One import path (`applyImportGroup` / `commitImportGroup`), all targets, engine semantic check on the whole group |
| `a72f28b` | Current actions projection; calendar "Done" vs "Cancelled"; decision record lists what was recorded since the decision |
| `a1684a9` | Migration 006, AI call counters, developer data kind, analytics/ops reports |
| `c0e4b63` | Text PDFs read on the server without AI when AI is off or not allowed |
| `e675afc` | Evaluation corpus + runner, general reader fixes, hold-out, real exports after changes |
| (this commit) | README, privacy, AI_DEPLOYMENT, DEPLOYMENT, evaluation report, technical proof, handoff |

## Implemented / verified / not verified

| Requirement | Implemented | Verified | Not verified |
|---|---|---|---|
| Contract first: intake, draft, typed answers, imports, negotiation, partial receipt, actions, presentation metadata | yes (`03ebf21`) | contract tests; old v1/v2/round 4–5 data parse; fingerprints unchanged | — |
| Ordinary email → offers as written, ambiguities, unsupported parts, outage vs unsupported | yes | route tests; corpus over HTTP (built-in) | real BasisWeb reading (no key) |
| Provider values checked against the text, consent first, minimal context | yes | mocked provider tests (labelled) | real provider |
| Incomplete onboarding draft, reload, typed answers, explicit conversion with original offer | yes | tests | Claude 1 UI |
| Original offer at `workspaceFromCase`, manual `addProject`, AI creation, first agreement | yes | tests | — |
| One import path: targets (wages, taxable/tax-exempt interest, coverage months, forecast, payment, partial payment, SEP, new offer, reference) before conflicts; whole group or nothing; idempotent; stale; replacement keeps evidence | yes | tests | Claude 1 review UI; Claude 2's taxable/tax-exempt split in `checkExtractedFacts` |
| Manual and AI commands share semantics; save re-runs semantic checks | yes (`commitCommands`, `applyChangeProposal`) | tests + UI smoke (update preview/apply/retry) | Claude 1 moving manual forms in `ops.ts` onto `commitCommands` |
| Counteroffer / rejected / accepted with immutable original, versions; partial receipt; lower settlement | yes | tests; real-engine export run | Claude 2's financial validation of the new commands in `validateAndApply` |
| Historical PDF after changes; current package export refuses stale data | yes | real PDF rendered and read (2 pages, `verified`); `409` | — |
| Calendar: stable IDs, sequence, cancel obsolete, "Done" for completed | yes | ICS parsed with `icalendar` | Google import behaviour (documented as unreliable) |
| Current-action projection | yes (`currentActions`) | tests | Claude 1 view |
| Text PDF without AI; scans/photos refused | yes | corpus + tests | OCR (not implemented) |
| Quotas for all AI calls, failed calls counted, no retries | yes (unchanged + counters) | tests | live counters (migration 006 not applied) |
| Evaluation corpus with expectations, latency | yes | built-in measured | provider measured |
| Analytics funnel / ops report without personal data, zero state | yes | scripts syntax; route schema | live data (none observed by me) |

## Clients ready for Claude 1 (`@/lib/client/api`)

- **Intake:** `intakeOffer(request)` (falls back to the in-browser reader offline), `parseOfferText`, `draftFromIntake`, `loadOnboardingDraft` / `saveOnboardingDraft` / `clearOnboardingDraft`, `openQuestions`, `answerQuestion(draft, TypedAnswer)`, `offerCommand`, `onboardingToWorkspace(draft, () => workspaceFromCase(...), {userDate, ownerPersonId})`, `counterofferCommand(offer, projectId, respondedOn, receivedCents)`.
- **Import:** `mergeIntoDraft`, `applyImportGroup(ws, draft, decisions, {userDate})`, `commitImportGroup(repo, ws, draft, decisions, {userDate})`. The result is `applied | nothing_new | rejected{issues} | stale{currentRevision}`. Use `resolvesConflictWith: ["workspace"]` to replace a saved value.
- **Commands:** `commitCommands(repo, ws, stableId, commands, {userDate})` for manual forms (same checks as AI proposals; double submit = no-op), `commitProposal(repo, ws, proposal, {userDate})`, `CommandBlockedError.blockers`. A smaller receipt asks "partial or settled?" → `record_partial_receipt` or `settle_lower_total`. Client response → `record_client_response`. For a saved option, keep using `recordClientAgreement` (it now records the accepted version).
- **Actions/exports:** `currentActions(ws, userDate)`, `exportCurrentCalendar`, `CALENDAR_IMPORT_NOTE`, decision record export unchanged.
- **Analytics:** round 6 events in `ANALYTICS_EVENTS`; `trackPlanReopened(ws.updatedAt, dataKind)`; developer runs are detected automatically (`?dev=1` opts a browser in).

## Needs from Claude 2

1. `validateAndApply`: business checks for `record_partial_receipt`, `settle_lower_total` and `record_client_response`. Claude 3's own checks cover future dates, amount below expected, totals and closed projects.
2. `checkExtractedFacts`: separate taxable and tax-exempt interest. Claude 3's import already enforces the type by target.
3. Optional: an accepted counteroffer should replace the original as the decision baseline. The data is in `Project.offerVersions`.

## Migrations / env

- New: `supabase/migrations/202611180006_round6_ops.sql`, **not applied**. Apply after 005, then run `scripts/verify-rls.mjs` (2 new checks). Until it is applied, developer analytics rows and AI call counters are dropped with a warning. Nothing else depends on it.
- Env: **no new variables**. Intake uses the existing `proposal` feature and its quota (`AI_FEATURES`, `AI_*_CALL_LIMIT`). `MARKETPLACE_API_KEY` is still optional and unconfigured.

## Checks run (once each, repeated only after a related change)

- `npm run typecheck` ✔. `npm test` ✔ **180 tests / 34 files**. One run had a timing failure in `export-and-api` while a server was running; a rerun of the file and of the full suite passed.
- `npm run build` ✔. `node tests/ui/smoke.cjs` ✔ (including Claude 1's update preview → apply → retry, 360 px, no page errors). The client bundle has no secret values.
- Production server, real engine, synthetic data: intake, text-PDF extraction without AI, scan refusal, server-recomputed explanation, insurance lookup, historical PDF after partial receipt (rendered), current calendar after changes (parsed), stale package export `409`.
- Evaluation over HTTP (built-in only): dev 57/67 → 67/67 after fixes (optimistic); hold-out 24/28 (85.7%). See `docs/artifacts/round6/ai-evaluation.md`.

## Remaining limits

- Provider accuracy, latency and tokens on the corpus are unmeasured; the bounded steps are in `docs/AI_DEPLOYMENT.md`. BasisWeb dollar cost is unknown.
- Built-in reading misses phrases like "instead of", mixed per-period/YTD pay-stub lines and the 1099-INT "Box 1" label (hold-out). Review stays mandatory.
- No OCR or photos. ZIP lookup is not live.
- No payments, customers or retention observed. Analytics counts events, not people.
- README screenshots and final landing copy come from Claude 1's handoff. README text here describes the branch state; Codex adjusts it at merge.
