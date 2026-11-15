# Claude 3 — one reliable data and AI path

You own additive shared contracts, `src/app/api/**`, `src/lib/client/**`, `src/lib/server/**`, Supabase migrations, package/config and integration verification. Continue `claude3`; merge latest main. Read shared brief, actual integration corrections, audit and `docs/AI_DEPLOYMENT.md`. Do not overwrite current private service configuration or create new cloud projects.

## 0. Publish the interface first

Coordinate Claude 2's readiness/semantic needs and publish a small normal commit plus `docs/handoffs/round6-contract.md` with typed request/result examples. Cover first-offer intake, semantic multi-document review, counteroffer/client response, partial receipt, revision/fingerprint and presentation metadata. Keep v1/v2 saved plans readable; additive schemas/defaults and explicit upgrades only. Do not force Claude 1 to wait for the entire backend.

Include an incomplete onboarding draft with reload support and explicit conversion to a valid HouseholdWorkspace. Typed unresolved-field answers (date, amount, person, project, tax year) must attach to the original AI/import draft; do not require string concatenation plus regex reruns. Verify original-offer capture at `workspaceFromCase`/first save as well as manual `addProject` and AI creation.

## 1. A real first-offer intake

- Wire natural-language offer intake for ordinary pasted email, not only labelled TXT rows or updates inside an existing workspace. Reuse the provider/structured schema and source review; return proposed facts, ambiguities, provenance and unsupported parts.
- Extract as written: amount/currency, project, payment dates, costs if stated. Do not calculate taxes, infer unknown costs as zero, invent the tax year, or treat a quoted invoice as paid. Multiple projects/payments must remain distinct until matched.
- Consent before sending text/document content. Minimize context; never send another project unnecessarily. Keep original text in the local review where useful; don't put it in logs/analytics.
- Manual/TXT fallback remains usable with no provider, denied consent, timeout, malformed JSON, refusal or quota. Distinguish unsupported input from an outage so the user can recover.

## 2. Finish the common import pipeline

- Use one extraction→normalization→target resolution→conflict review→atomic apply path for first-use and saved households. Integrate Claude 2's semantic validator. Existing `ImportDraft` is groundwork, not completed UI integration.
- Add real destinations for wages, taxable and tax-exempt interest, coverage months, new offer, profit forecast, payment and SEP contribution. Existing saved-plan `FactTarget` only covers forecast/payment/SEP: close that gap.
- Resolve person/year/period/months/project before declaring a conflict. Two unidentified spouses' W-2s are unresolved targets, not automatically one contradictory field. Preserve distinct source IDs and exact excerpts.
- Validate the whole approved group before mutation; one invalid item means no partial save. Apply once, one revision, idempotent retry/reimport. Concurrent revisions yield a recoverable stale/conflict result.
- Replacement/corrected document preserves the earlier decision evidence. Same document hash is not a new payment. Do not persist originals or model payloads; confirmed minimal facts/excerpts may remain in the RLS-protected plan.

## 3. Unify manual and AI commands; finish negotiation/payment lifecycle

- Route manual forms and AI-confirmed proposals through shared command semantics; remove competing paths where they differ. Coordinate UI adoption with Claude 1.
- Add explicit counteroffer/rejected/accepted transitions with original offer immutable and current proposal versioned. Preserve accepted decision records and actual receipts. Don't let “rejected” erase money already earned/received.
- Add an atomic partial receipt command. It records the received portion and preserves a dated remainder without doublecount. A lower final settlement must be an explicit separate choice. Repeated submit/lost acknowledgement is a no-op or recognized already-applied result.
- Every command carries base revision/fingerprint, stable identity and minimal provenance. Preview and apply use the same command semantics; re-check stale state on the server/persistence boundary.
- Fix the existing commit-time gap explicitly: `commitProposal` must rerun the shared semantic validator, including future actual dates, actual-versus-expected status, person/year and payment totals. Passing schema/revision checks cannot bypass a business blocker that preview would reject.
- Ensure historical records remain exportable after changes, with correct historical labels/version verification. Current action package refuses stale data. Correction history is separate from pretending the old fact never existed.

## 4. AI provider reliability and real evaluation

- Current provider is BasisWeb at a fixed allowlisted destination with privately configured key; do not assume direct Anthropic IDs/prices. Parent integration proved text requests and text-PDF extraction. The gateway rejected a PDF attachment with HTTP400; don't undo server-side embedded-text extraction.
- Keep PDF size/page/text limits, parser cleanup, evidence matching against actual extracted text and unsupported scanned-document handling. Do not advertise OCR/photos as working without a real end-to-end test. If you can complete OCR with an existing authorized dependency within Vercel limits, document its actual behavior/cost; otherwise provide a useful paste/manual recovery and accurate capabilities.
- Align capabilities and UI accepted formats with actual provider support. Per-feature configuration must reflect tested readiness, not just presence of a key.
- Preserve per-guest/IP/global durable call caps for BasisWeb, failed-call accounting and no blind retries. Direct-provider unknown usage must retain the reservation. Gateway dollar cost stays unknown until its billing is independently understood.
- Validate structural and semantic outputs: source-supported extracted values, existing target IDs, explicit contribution year/person, and number-free optional explanatory framing around server-recomputed financial text. Model obedience to JSON schema is not evidence of accuracy.
- Build a small versioned evaluation corpus, ideally 8–12 varied documents/messages with permitted public/synthetic data: offer, counteroffer, invoice versus payment, W-2, coverage notice, YTD P&L, SEP confirmation, ambiguous date, duplicated and conflicting sources. Separate native text PDFs from scans and unsupported cases.
- Record expected facts, correct/incorrect/missing/unsupported fields, confirmation corrections, latency and usage on one configured model. Label mocks, developer tests and actual provider requests separately. Do not run broad expensive model sweeps or claim perfect accuracy on arbitrary documents.

## 5. Persistence, exports, actions and operational visibility

- Keep browser-local fallback and invisible guest cloud persistence. Exercise interrupted save/reload, stale revision, JSON restore, original offer/decision history and idempotent receipts. No account screen.
- Extend migrations only if needed; RLS server-only functions and cross-guest restrictions must remain. Use existing project; no destructive reset. Provide exact migration/environment names in handoff. Codex applies production migrations.
- Calendar uses stable event identity, sequence updates and cancellations for obsolete unpaid actions. Completed receipts disappear appropriately. Downloaded ICS is a snapshot, not an automatic calendar sync; UI wording and PDF must be honest.
- Inspect actual PDF after counteroffer/partial receipt/income change: original vs accepted terms, correct baseline/horizon/cash/retirement, assumptions and as-of revision. No stale results quietly repackaged as current. Ensure long labels/amounts and page breaks remain legible.
- Add a concise current-action projection for Claude 1 from real workspace facts, not a parallel editable reminder database. Actions must know pending/completed/superseded and their conditions.
- Analytics: explicit allowlisted funnel from own-data entry through source review, first useful result, terms, client response, repeat change and export. No amounts, names, emails, document text or provider payloads. Separate fixture/developer/own-data where reliably known; don't infer actual customerhood from an event.
- Provide a reproducible aggregate report with dates/denominators and zero-data state. Retention requires separate sessions/time; developer clicks are not retention. Subscription/price-choice events are not payments.
- Operational report should expose provider availability/error class/quota counts/latency and schema version without secrets/content. No public admin dashboard or privileged endpoint.

## 6. Commercial and release boundaries

- Full judge journey remains free of registration and card requirements. Planned pricing can be shown, but no simulated success counted as revenue. Do not silently enable real billing or subscriptions. Existing test checkout remains clearly no-charge.
- Current README/deployment/privacy/env examples must describe the actual integrated provider and storage; remove stale AI-off claims after verification and retain explicit unsupported cases.
- Own the README edit; consume Claude 1's final screenshots/copy, avoiding overlapping edits. Preserve approved final artifacts.
- Supply `docs/artifacts/round6/ai-evaluation.md`, machine-readable fixture expectations and `docs/demo/round6-technical-proof.md`: endpoint, actual result, source, limitations and reproduction. Never publish credentials or private account URLs.

## Delivery

Publish contracts early, then integration commits in coherent groups. Run typecheck, targeted data/command/isolation/provider-failure checks, one build and actual exports. A real provider test requires authorized env; if absent, accurately say mocked/not verified and provide Codex's exact bounded smoke steps. Final `claude3-round6.md` lists migration/env changes, clients ready for Claude 1 and remaining limits. Commit/push `claude3`; Codex merges main and deploys.
