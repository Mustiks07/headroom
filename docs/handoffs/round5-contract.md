# Round 5 shared contract — assistance v1.0

**Contract commit: `97b608c3a3bcf873b41ae59ae1270a8740b35eb7`** on `claude3` (based on `main` @ `6f18c1f`).
Claude 1 and Claude 2: `git fetch origin && git merge 97b608c3a3bcf873b41ae59ae1270a8740b35eb7` (normal merge). It adds `src/domain/assistance.ts`, `src/fixtures/assistance.ts`, `tests/integration/assistance-contract.test.ts` and two optional fields in `DealPlanningStateSchema`. Nothing existing changed shape.

Compatibility: v1 plans, v2 workspaces, round 4 `dealPlanning` and their JSON files stay valid. New stored fields are optional (`dealPlanning.decisionRecords`, `dealPlanning.calendar`). `canonicalWorkspaceContent`, `workspaceFingerprint` and `dealSearchFingerprint` are unchanged. Money: integer cents; dates `YYYY-MM-DD`; unknown = `null`.

## Pipeline and boundaries

```
document / pasted text ──► POST /api/documents/extract ──► ExtractionResult (+ facts) ──► ImportDraft (client)
                                                                 │ user reviews, groups confirm
user words ──► POST /api/assist/propose ──► ChangeProposal (typed commands, ambiguities)         ▼
                                              │ Claude 2 previewChange (copy, nothing saved)   applyConfirmedFacts / applyChangeProposal
                                              ▼                                                (one atomic workspace save + event)
                                       ChangePreview ──► user confirms ──► saved revision ──► POST /api/assist/explain (verified packet)
```

- A provider (LLM) **only** extracts figures or proposes commands; deterministic code parses cents/dates and validates; preview changes nothing; a confirmed command is saved atomically with its event. The model never gets JSON Patch, SQL, URL fetch, tool calls or outbound actions.
- Relative dates resolve against `AssistanceRequest.userDate` + `timeZone` (the user's), never the server clock; resolved dates are listed in `ChangeProposal.resolvedDates` for the confirmation screen.

## Types (`src/domain/assistance.ts`)

| Export | Meaning |
| --- | --- |
| `AssistanceRequestSchema` | `intent: start \| offer \| update \| explain`, `text` (≤ 4,000 chars, untrusted), `userDate`, `timeZone`, `base {workspaceId, revision, fingerprint} \| null`, `context` |
| `AssistanceContextSchema` | Minimal: people `{id, role}`, projects `{id, title, status, lines[{id, kind, label, expectedAmountCents, expectedDate, received, cancelled}]}`, forecast methods, goal ids. No income, SEP, premiums or documents. Built by Claude 3's `buildAssistanceContext(ws)` |
| `ExtractedFactSchema` | Stable `id` (document + field + locator), `documentId` (content hash), `documentKind`, whitelisted `field`, `value` (money+period / date / text), `valueAsPrinted`, `personCandidate \| null`, `taxYear \| null`, `asOfDate \| null`, `source {label, page, excerpt}`, `provenance: deterministic_text \| ai_model \| user_entered`, `review: extracted \| confirmed \| rejected \| conflict`, `conflictsWith[]` |
| `ImportDraftSchema` | Several documents accumulate into one draft: `documents[]`, `facts[]` |
| `InputReadiness`, `ReadinessQuestion`, `ReadinessIntent` | `status: ready \| needs_data \| unsupported`; intents `current_year_subsidy`, `new_offer`, `two_year_terms`, `agreed_plan_review`; questions with `path`, `question`, `reason`, typed `answer`, `allowUnknown`, `sourceRef` |
| `ChangeCommandSchema` (whitelist) | `add_offered_project`, `update_expected_payment`, `record_receipt`, `correct_fact` (payment or forecast field, with reason), `record_sep_contribution`, `update_forecast`, `change_goal`, `change_terms`. Anything else is rejected |
| `ChangeProposalSchema` | `id`, `createdAt`, `base {workspaceId, revision, fingerprint}`, `intent`, `commands[≤5]`, `ambiguities[]` (must be resolved before confirm), `resolvedDates[]`, `evidence[]`, `provenance: pattern \| ai_model \| manual`, `status: proposed \| confirmed \| applied \| rejected \| stale` |
| `ChangePreview`, `ChangePreviewSummary` | `changes[{commandIndex, path, label, before, after}]`, before/after summary (subsidy, settlement, agreed terms still meet goal, cash delta + baseline label; null when not computable), `staleDependencies[]`, `blockers[]` |
| `ExplanationPacket` | From a verified result: `facts[{ref, label, kind, value}]`, deterministic `statements` with `{ref}` placeholders, `limitations` |
| `ExplanationSchema` | `{packetId, text, references[], source: deterministic \| ai_model, unanswered[]}` |
| `DecisionRecordSchema` | Historical record: package/project ids, status, `recordedAt`, decision-time `workspaceRevision`, `searchFingerprint`, versions, `workspaceSnapshot` (without dealPlanning), goal, termSpace, cashContext, variant — never rewritten by later facts |
| `IssuedCalendarEventSchema` | `{uid, sequence, date, title, status: active \| cancelled, issuedAt}` — what was already exported, so later `.ics` files UPDATE/CANCEL instead of silently dropping events |
| `ASSIST_ERROR_CODES` | `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, `AI_UNAVAILABLE`, `AI_QUOTA_REACHED`, `AI_BUDGET_REACHED`, `SESSION_REQUIRED`, `PROVIDER_TIMEOUT`, `PROVIDER_REFUSED`, `PROVIDER_INVALID_OUTPUT`, `CROSS_ORIGIN`, `STALE_RESULT`, `PROPOSAL_STALE` |

## API (Claude 3)

| Route | Body | Response |
| --- | --- | --- |
| `POST /api/documents/extract` (existing, extended) | multipart `file`, optional `consent=provider` | `ExtractionResult` + additive `document {documentId, kind}` and `facts: ExtractedFact[]` |
| `POST /api/assist/propose` | `ProposeBodySchema` `{request, consentToProvider}` | `ProposeResponse {proposal, providerUsed, notes}`. Without a provider: deterministic patterns for common updates; otherwise a proposal with an ambiguity asking for the form |
| `POST /api/assist/explain` | `{packet: ExplanationPacket}` | `ExplainResponse {explanation, providerUsed}` — deterministic by default; a provider text is published only if every number/date matches the packet |
| `POST /api/export/decision-record` | `{workspace, recordId}` | Historical PDF "Decision recorded on …; figures as of …" |
| `POST /api/export/calendar` (extended) | `{workspace}` (current agreed-plan actions) or `{workspace, packageId}` (round 4) | `.ics` with stable UID/SEQUENCE and `STATUS:CANCELLED` entries for previously issued events that no longer apply |
| `GET /api/capabilities` (extended) | – | adds `aiTextProposals`, `aiExplanations` (separate from `aiExtraction`) |

All errors: `{ error: { code, message, fields? } }` with the codes above; AI failures never block the manual path.

## Responsibilities

- **Claude 2** — export from `@/lib/engine` the `AssistanceEngine` signatures: `assessInputReadiness(ws, intent, draft?)`, `previewChange(ws, proposal)`, `buildExplanationPacket(ws, subject, refId?)`. Validate command meaning (e.g. past receipt date OK as a fact, not as new terms), keep received facts/expenses, return ambiguities instead of guessing, never turn unknown into 0.
- **Claude 3** — extraction → `ExtractedFact` + draft merge/dedupe/conflicts; `applyConfirmedFacts` and `applyChangeProposal` (atomic, base revision/fingerprint check, idempotent event ids); propose/explain routes with durable AI budgets; decision records + historical export; current-plan calendar with cancellations; analytics allowlist; `docs/AI_DEPLOYMENT.md`.
- **Claude 1** — upload/paste/manual start, review cards with group confirm, short questions from readiness, proposal/preview/confirm UI, history/exports. Use Claude 3's client functions (listed in `docs/handoffs/claude3-round5.md`), not a second pipeline.

## Fixtures (`src/fixtures/assistance.ts`, synthetic)

`sampleDocuments` (P&L through Sep 30, 2026; client offer; payment confirmation), `extractedFactsFixture`, `importDraftFixture`, `changeProposalFixture` ("The remaining payment moved to January 8, 2027" → `update_expected_payment` of `proj-a/a-pay-2`), `explanationPacketFixture` (shape only).

## Follow-up contract (additive, research addendum)

Small commit after `97b608c`; optional fields only, so every earlier save stays valid and fingerprints don't change.

- `src/domain/decision-context.ts`: `OriginalOfferSchema` (price incl. deposit, offered payments, source kind/id, `user_confirmed | captured`, recordedAt), `DecisionContextSchema` (baseline, horizon, ≤ 3 alternatives with engine `comparisons`/`holds`, chosen/recommended flags, `recommendedVariantId`, deterministic `recommendationReasons`, copy of the original offer), `VariantComparisonsSchema`, `VariantRobustnessSchema`.
- `Project.originalOffer?` — set once (new offer command, or captured from the project lines at the first agreement for pre-round-5 data); agreed terms, chosen variants and the searched maximum price never overwrite it. Excluded from `canonicalWorkspaceContent`.
- `DealVariant.comparisons?` / `.robustness?` — the engine's existing extra fields now survive storage in a package.
- `ActionPackage.decisionContext?` (filled by `buildActionPackage` from the ready search) and `DecisionRecord.decisionContext?` (copied at agreement).
- `ExplainWorkspaceBodySchema` `{workspace, subject, refId?, consentToProvider}` — the server rebuilds the packet with `buildExplanationPacket`; `ExplainResponse.verification?` `{origin: server_recomputed | client_packet_unverified, workspaceId, workspaceRevision, fingerprint, engineVersion, rulesVersion, note}`. The legacy `{packet}` body still works and is labelled `client_packet_unverified`.
- `src/domain/insurance.ts`: `LocationLookup` (`single | ambiguous | not_available`, counties with `planDataYears`), `BenchmarkLookup` (`confirmed | county_candidate | not_available`, mirrors Claude 2's `resolveBenchmark`), `InsuranceSourceSchema` (kind, url, sha256, dataVersion, sourceDate), `BenchmarkLookupBodySchema`, `LocationQuerySchema`. Routes: `GET /api/insurance/location?zip=…|?state=..&q=…`, `POST /api/insurance/benchmark {workspace, year}`.
