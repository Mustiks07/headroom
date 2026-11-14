# Claude 3 — round 5 handoff (AI pipeline, confirmed changes, finished execution)

Branch `claude3`, merged from `origin/main` @ `6f18c1f` (normal merge; kept total-price-incl-deposit, agreement replay without second SEP, package freshness, new-payment dates, SEP snapshot semantics). `main` not changed; Codex integrates.

**No AI provider key was available: no real provider request was made, no model/latency/usage observation exists.** Production stays `AI_PROVIDER=none`. Supabase/Vercel were not touched (no new project, no login); migration 005 is prepared, not applied.

## Contract

- **`97b608c3a3bcf873b41ae59ae1270a8740b35eb7`** — `src/domain/assistance.ts` (request/context, ExtractedFact, ImportDraft, InputReadiness, whitelisted ChangeCommand, ChangeProposal, ChangePreview, ExplanationPacket/Explanation, DecisionRecord, IssuedCalendarEvent, API bodies, error codes), optional `dealPlanning.decisionRecords` / `dealPlanning.calendar`, fixtures, contract tests. Described in [`round5-contract.md`](round5-contract.md) (`c600edf`). No later contract change.

## What is implemented

1. **AI adapter** (`src/lib/server/extraction/anthropic.ts`): official SDK 1.8.0, `client.messages.parse` + `zodOutputFormat` (GA `output_config.format`, checked against the structured-outputs docs on 2026-11-16), model from `AI_MODEL`, `effort: "low"`, `maxRetries: 0`, **server-side fallback removed** (no silent switch to another, possibly pricier model), refusal/`max_tokens` → unavailable, actual token usage returned.
2. **Durable budget for all AI endpoints** (`src/lib/server/ai-budget.ts`, migration `202611170005_ai_budget_analytics.sql`): worst-case cost reserved atomically per call (global / guest / hashed-IP daily USD budgets) and settled with actual usage; dated price table (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per MTok); unpriced model or unreachable store → AI off (fail closed), manual path continues. Separate capabilities `aiExtraction`, `aiTextProposals`, `aiExplanations` via `AI_FEATURES`; each needs the guest session and per-request consent.
3. **Documents → facts** — `/api/documents/extract` now also returns `document {documentId (content hash), kind}` and `facts: ExtractedFact[]` (deterministic as-of date from "January 1 – September 30, 2026", "through …", "as of …"; person always unknown; provenance). Document kinds read from text: P&L, pay stub, Marketplace notice, client offer, invoice, payment confirmation, SEP confirmation, W-2, prior-year return, bank statement. Fields actually read: the `EXTRACTION_FIELDS` whitelist (profit, wages/SS/Medicare/gross/pre-tax, interest, SEP, monthly premium/benchmark/APTC, project title/fee/expenses/dates, payment received + date). A P&L's "Total expenses" is not proposed as a project expense. `src/lib/client/import-draft.ts`: `toExtractedFacts`, `mergeIntoDraft` (same document = no-op; different values for the same field/period/target = `conflict`; equal values from different documents are kept, not merged), `applyConfirmedFacts` (user-confirmed group → one atomic change with one `document_imported` event, or nothing; conflicts need `resolvesConflict`; re-applying = `nothing_new`).
4. **Text → typed proposals** — `POST /api/assist/propose`: with consent + enabled provider the model returns references and values *as written*; Headroom validates ids against the minimal context and parses cents/dates itself (`toProposal`); otherwise (or on timeout/refusal/budget) deterministic patterns (`proposeFromPatterns`): moved payment, received payment, SEP contribution, simple new offer. Relative dates resolve against the user's date (`resolveDate`). Ambiguities (several payments, person, tax year) become questions; `answerAmbiguity` re-runs deterministically. Only the 8 whitelisted command types exist.
5. **Confirmed apply** — `src/lib/client/workspace-commands.ts`: `applyCommand` (single implementation for all command types), `applyChangeProposal` (same workspace + base revision + engine fingerprint, else `PROPOSAL_STALE`; no open ambiguities; all-or-nothing; one revision, one event per command with ids from the proposal), `commitProposal` (apply + atomic save; lost-ack retry returns the stored revision; already applied = no-op). Claude 1 can route manual forms through `applyCommand` to avoid two paths (seam, not done by Claude 3).
6. **Explanations** — `POST /api/assist/explain` with an engine `ExplanationPacket`: deterministic text by default; a provider rewrite is published only if every number/date matches the packet (`onlyPacketFigures`), otherwise the deterministic text plus a note.
7. **Decision lifecycle** — `appendDecisionRecord` stores the decision-time snapshot (workspace without dealPlanning, goal, terms, cash, variant, versions, original fingerprint) when the user records the client's agreement (one-line seam in `src/features/household-plan/ops.ts` `recordClientAgreement`) or shares terms (`setPackageStatus`); idempotent. `POST /api/export/decision-record`: "Decision recorded on …; figures as of plan revision …", verified against its own snapshot when engine/rules match (`X-Headroom-Record: verified`), otherwise shown as an archived record; lists facts recorded since (received/moved payments). The current decision export still refuses stale packages.
8. **Current calendar** — `currentPlanEvents` / `buildCurrentCalendar` / `exportCurrentCalendar` (and `POST /api/export/calendar` without `packageId`): open agreed payments, open actions (payment receipts not duplicated), remaining SEP goals dated at the return due date with the Pub. 560 extension caveat. Stable UID; moved event → same UID, SEQUENCE + 1; no-longer-relevant event → `STATUS:CANCELLED`, SEQUENCE + 1 (kept for 60 days); issued list saved in `dealPlanning.calendar`. `CALENDAR_IMPORT_NOTE` states honestly that files don't self-update and Google's file import may ignore cancellations.
9. **Analytics** — allowlist extended with the round 5 funnel; `trackEvent(event, {dataKind: sample|own|unknown, inputPath: document|paste|manual|provider|none})`; strict server schema; anonymous daily counters (`analytics_daily`, server-only function) + `scripts/analytics-report.mjs`. Spec: `docs/analytics-funnel.md`. Empty stays empty; sample ≠ customer.

## Hooks for Claude 1 (`@/lib/client/api`)

Extraction: `extractDocument` (response now includes `document`, `facts`), `emptyImportDraft`, `mergeIntoDraft`, `applyConfirmedFacts` → `commitWorkspaceChange`. Text: `buildAssistanceContext(ws)`, `proposeChange(request, {consentToProvider})`, `answerAmbiguity`, Claude 2's `previewChange`, then `commitProposal(repo, ws, proposal)`; `CommandError` codes (`PROPOSAL_STALE`, `AMBIGUOUS`, …). Explanations: `explainResult(packet, {consentToProvider})`. Lifecycle: `exportCurrentCalendar(repo, ws)`, `CALENDAR_IMPORT_NOTE`, decision records in `ws.dealPlanning.decisionRecords` + `POST /api/export/decision-record {workspace, recordId}`. Capabilities: `aiExtraction`, `aiTextProposals`, `aiExplanations`. Analytics: `trackEvent(name, dims)`.

## API examples

```http
POST /api/assist/propose
{"request":{"intent":"update","text":"The remaining payment moved to January 8, 2027","userDate":"2026-11-16","timeZone":"America/Chicago",
 "base":{"workspaceId":"…","revision":3,"fingerprint":"…"},"context":{…buildAssistanceContext(ws)…}},"consentToProvider":false}
→ 200 {"proposal":{"commands":[{"type":"update_expected_payment","projectId":"proj-a","lineId":"a-pay-2","newAmountCents":null,"newDate":"2027-01-08"}],
       "ambiguities":[],"provenance":"pattern",…},"providerUsed":false,"notes":[]}
POST /api/export/decision-record {"workspace":{…},"recordId":"rec-…-agreed"} → 200 application/pdf, X-Headroom-Record: verified
POST /api/export/calendar {"workspace":{…}} → 200 text/calendar, X-Headroom-Events: "6 current, 0 cancelled"
```

## Migrations / env

- New: `supabase/migrations/202611170005_ai_budget_analytics.sql` (`ai_spend`, `ai_reservations`, `analytics_daily`; RLS on, no client grants; `headroom_reserve_ai_spend`, `headroom_settle_ai_spend`, `headroom_count_event` executable by `service_role` only). Apply after 001–004. New user data (proposals) is not stored server-side; decision records/calendar live inside the existing RLS-protected workspace row. `scripts/verify-rls.mjs` adds checks that guests can't read/write the new tables/functions.
- Env (names only): `AI_FEATURES`, `AI_DAILY_BUDGET_USD`, `AI_GUEST_DAILY_BUDGET_USD`, `AI_IP_DAILY_BUDGET_USD` (plus existing `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, Supabase). Details: `docs/AI_DEPLOYMENT.md`; `.env.example` and `docs/DEPLOYMENT.md` updated.

## Checks run

- `npm run typecheck` ✔; `npm test` ✔ **134 tests / 27 files** (new: `assistance-contract` 3, `round5-assist` 6 — extract → review → atomic apply → retry no-op; all-or-nothing on a bad decision; conflict across documents and equal values not merged; NL moved payment → exact command → confirm → lost-ack retry → already applied → stale refused; ambiguity → answer; relative date from the user's date; SEP person/tax-year questions; provider timeout/budget/invented id/invented explanation figure → deterministic fallback with settled usage (mocked provider/store); agreement → historical record (idempotent) → current export 409 → historical PDF verified → current calendar → paid = CANCELLED, moved = SEQUENCE+1, SEP reminder → record still exports with "recorded since" → JSON round trip). `round2-ai-guard` updated to the spend budget.
- `npm run build` ✔; `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:ui` ✔ (guest path, 360 px, no page errors); client bundle has no secret values.
- Production server (`next start`): `/api/capabilities` shows the three AI flags false; historical record PDF 200 (`verified`, 2 pages, rendered and inspected); current calendar 200 parsed by Python `icalendar` (6 events incl. the $4,000 remaining SEP); propose route returns the exact command without a provider.
- Artifacts: `docs/artifacts/round5/` (synthetic source documents, `expected-facts.json` from the real deterministic route, decision-record PDF — **money from the labelled test double**, current-plan `.ics`).

## Remaining external steps

1. Apply migration 005 to the live Supabase project; run `scripts/verify-rls.mjs`.
2. Provide the Anthropic key privately → follow the provider smoke in `docs/AI_DEPLOYMENT.md` (synthetic PDFs, compare with `expected-facts.json`, record model/tokens/cost; optional Haiku/Sonnet comparison), then decide `AI_FEATURES`/`AI_MODEL`/budgets.
3. After Claude 2's `previewChange` / `assessInputReadiness` / `buildExplanationPacket` / real `searchDealTerms` are merged, regenerate the decision-record artifact with real figures.
