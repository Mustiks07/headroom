# Claude 3 handoff — backend and integration

Branch: `claude3`. Status: **backend part complete; integration pending the claude1/claude2 handoffs** (both branches were still at the foundation commit when this was written).

## What works without any keys

| Area | Behavior | Where |
| --- | --- | --- |
| Local plans | Versioned `localStorage` repository (`headroom:v1:plans`). Survives reload; `save(plan, null)` → new id, revision 1; `save(plan, n)` requires stored revision `n`, otherwise `PlanConflictError` (nothing overwritten); events per plan (idempotent by id); `remove` deletes plan + events; `clear` removes all Headroom keys. No in-memory Map. | `src/lib/client/local-repository.ts` |
| Save integrity | Every save (local and cloud) and every PDF export re-runs the shared engine on the submitted input, rejects `STALE_RESULT` (fingerprint mismatch), unknown/infeasible chosen scenario and unknown completed actions, and stores the **freshly computed** comparison — client numbers are never trusted. | `src/lib/client/plan-integrity.ts` |
| Storage mode label | `getStorageMode()` → `cloud` / `local` / `unavailable` with truthful English `label` + `detail`. | `src/lib/client/repository.ts` |
| CSV/TXT import | Deterministic, server-side, whitelisted fields, redacted source line, YTD/prior-year/duplicate warnings, bank statements are **not** classified as profit. Nothing is auto-applied. | `src/lib/server/extraction/text.ts` |
| PDF/image import | Without a provider: `{status:"unavailable", warnings:["Document analysis is unavailable. Enter the figures manually."]}`. Size ≤ 3 MB, PDF ≤ 10 pages, magic-byte type check, 415 for unsupported, 413 too large, 429 burst limit. | `src/lib/server/extraction/index.ts` |
| PDF report | US-Letter English report from a fresh engine result: chosen option vs baseline, both years, cash vs retirement separated, settlement shown as repay/additional credit, all options, actions with due dates + sources, assumptions/warnings, inputs (roles/ages only, no names), sources, trace, fingerprint on every page. | `src/lib/server/pdf/*` |
| JSON | `exportPlanJson(plan)` (`format: headroom.plan`), `exportCaseJson(input)` for blocked/unsupported cases, `importPlanJson(file)` (re-verified with the engine), `readCaseInputFromJson`. | `src/lib/client/features.ts` |
| Checkout | Demo checkout: unlocks, collects no card, `isRealPayment: false`, label says no payment was made. Remembered in the browser (`headroom:v1:entitlement`). | `src/lib/server/checkout.ts` |
| Analytics | Event names only (whitelist), logged server-side; no amounts, inputs, ids or documents. | `/api/analytics` |
| Capabilities | `GET /api/capabilities` → `{cloudSave, aiExtraction, checkoutMode, localTextImport}`; never values. | `src/lib/server/env.ts` |

## Prepared integrations that need keys (not verified live)

- **Supabase cloud save** — invisible anonymous sign-in in the browser (`signInAnonymously`, no UI); the API verifies the bearer token with `auth.getUser` and queries **as the user** with the publishable key, so RLS enforces isolation. `owner_id` comes from the verified token only. Unknown/other-owner ids → 404. Revision conflict → 409 with `current`. If config or sign-in fails, the app stays in local mode with a truthful label. **Not applied/verified against a live project yet.**
- **AI extraction (Anthropic)** — `AI_PROVIDER=anthropic`, `AI_API_KEY`, optional `AI_MODEL` (default `claude-opus-5-5`). Official SDK, structured output schema restricted to the field whitelist, server-side fallback opt-in, the model copies values *as printed* and the server converts to cents and requires the value to appear in the quoted line. Document text is treated as data; model notes are not shown. Requires explicit `consent=provider` per upload. **No real provider call has been made yet (no key).**
- **Stripe TEST mode** — `STRIPE_SECRET_KEY` (`sk_test_`/`rk_test_` only; live keys are ignored), `STRIPE_ANNUAL_PRICE_ID`, optional `STRIPE_WEBHOOK_SECRET`. Checkout session, server-side session verification (`GET /api/checkout?session_id=`), signed webhook; entitlements recorded as `test`, never `live`. **Not verified (no keys).**

## Env names (no values)

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server only, optional: entitlements + deleting the anonymous user on clear), `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ANNUAL_PRICE_ID`. Placeholders are treated as not configured.

## Migrations

- `supabase/migrations/202611140001_foundation.sql` (foundation, reviewed)
- `supabase/migrations/202611140002_hardening.sql` (new): immutable `owner_id`, payload size limits, append-only `plan_events` (select/insert/delete only), no client writes to `entitlements`.
- Neither is applied to a live project yet. Setup steps: `supabase/README.md`; one-time two-guest check: `scripts/verify-rls.mjs`.

## API (as in ARCHITECTURE.md)

`POST /api/assess`, `POST /api/calculate` (400 malformed; 200 for ready/needs_data/unsupported; 503 when the engine says `unavailable`), `POST /api/documents/extract`, `GET/POST /api/plans`, `GET/PUT/DELETE /api/plans/[id]`, `GET/POST /api/plans/[id]/events`, `DELETE /api/data`, `POST /api/export` (`{input, chosenScenarioId, expectedFingerprint?, completedActionIds?}` → PDF; 409 stale/infeasible, 422 needs_data/unsupported, 503 engine unavailable), `POST/GET /api/checkout`, `POST /api/checkout/webhook`, `POST /api/analytics`, `GET /api/capabilities`. Errors: `{error:{code,message,fields?}}`.

## For Claude 1 (UI) — import only from `@/lib/client/api`

- `createPlanRepository()` (+ `storageMode()`), always use the plan **returned** by `save` (it carries the assigned id/revision and recomputed comparison). Catch `PlanConflictError` (offer reload), `PlanIntegrityError` (`STALE_RESULT` → recalculate), `StorageUnavailableError` (keep form, show message).
- `extractDocument(file, { consentToProvider })` — **additive optional parameter**. For PDF/images show what will be sent and pass `consentToProvider: true` only after the user agrees; check `getCapabilities().aiExtraction` first. Never apply fields automatically.
- `ExtractionResult.fields[i]` convention (no contract change, documented in `extraction-fields.ts`): `path` is one of `EXTRACTION_FIELDS` (`income.*`, `coverage.*`, `opportunity.*`, person/month chosen by the user during review); `proposedValue` is `ProposedFieldValue` (`{kind:"money", amountCents, period, asPrinted}` | `{kind:"date", date, asPrinted}` | `{kind:"text", text}`); `evidence` is a contract `Evidence` (`kind:"document"`) — add it to `input.evidence` and set the fact's `sourceId` to `evidence.id` when the user confirms.
- `exportPlanPdf(plan)`, `exportPlanJson(plan)`, `exportCaseJson(input)`, `importPlanJson(file)`, `startCheckout()`, `verifyCheckout(sessionId)`, `getLocalEntitlement()`, `trackEvent(name)`, `clearLocalData()`.
- "Clear my data" = `createPlanRepository().clear()` (cloud rows via `/api/data` when in cloud mode + all local keys + session token).

## Shared contract

`src/domain/contracts.ts` and fixtures are **unchanged**.

## Checks run (this increment)

- `npm run typecheck` ✔, `npm test` ✔ (18 tests: 2 foundation + 16 integration), `npm run build` ✔.
- Integration tests use a labelled test double for the engine (`tests/support/fake-engine.ts`) only to exercise storage/export plumbing: local round trip (save → reload → revision → conflict → events → remove → clear); stale/tampered/infeasible rejection; real CSV import + bank-statement refusal + unsupported file + no-provider PDF + consent gate; PDF content (fingerprint, chosen option, both years, retirement label) and stale-export refusal; truthful capabilities; 503 cloud without config; demo checkout not a payment; analytics whitelist; Stripe signature.
- Manual: `next start` smoke of capabilities, CSV extract, checkout, plans 503.

## Remaining

- Merge `origin/claude2` then `origin/claude1`, rerun acceptance journeys on the integrated build.
- Supabase project + keys → apply migrations, run `scripts/verify-rls.mjs`, check API owner handling once.
- AI key → one real extraction + one failure recovery. Vercel project + deployed URL check.
