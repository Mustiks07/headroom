# Claude 3 — round 3 handoff (shared workspace, durable facts, forecast explanation)

Branch `claude3`, merged from `origin/main` @ `6161510` (normal merge; integrator fixes kept: r3 upgrade with fixed agreements, saved-revision acknowledgement when an event write fails, completed-action matching, safe JSON scenario handling, local fallback). `main` not changed.

**No external access in this session** (no Supabase project, Vercel project, AI key or Stripe key). Everything below is verified locally (tests + production build + `next start`). Live RLS isolation, real AI extraction, payments and a public URL are **not** verified.

## Contract

- Schema commit: **`ecbdd18fe060e81697b7dd2c88c5b3d628926eb2`** (`src/domain/household-workspace.ts`, `src/fixtures/workspace.ts`, contract checks), described in [`round3-contract.md`](round3-contract.md).
- Additive follow-up in this round's main commit (SHA in `round3-contract.md`): `workspaceFingerprint(ws, engineVersion, rulesVersion)` — the reference SHA-256 of key-sorted `{content: canonicalWorkspaceContent(ws), engineVersion, rulesVersion}` used by the export route; human-readable dollar text in adapter notes. No type or field changed.

## Persistence (workspace v2)

- `createWorkspaceRepository()` (hybrid) / `createLocalWorkspaceRepository()` / cloud over `/api/workspaces`. Local key `headroom:v2:workspaces` (documents, last 20 revisions, original v1 snapshot); unreadable data is set aside under `…:unreadable`, never silently dropped.
- **Atomic revision + event**: history events live inside the workspace document, so one write stores both. `commitWorkspaceChange(repo, base, next, event)` with a stable `event.id` (from `newWorkspaceEvent`). Retrying after an unknown outcome returns the already stored revision instead of writing twice (`isSameSave`: same content, same event ids, revision + 1); any other stale write → `WorkspaceConflictError(current)`.
- Same location rules as plans: a workspace stays where it lives; a cloud failure after sign-in → `CloudSaveFailedError` (nothing reported as saved) and `saveLocally()` creates an explicit local copy. `/api/data` ("Clear my data") also deletes cloud workspaces; local clear removes `headroom:v2:*` with the other Headroom keys.
- Server: `/api/workspaces` (GET, POST `{workspace, expectedRevision: null, legacySnapshot?}`), `/api/workspaces/[id]` (GET, PUT `{workspace, expectedRevision}`, DELETE), `/api/workspaces/[id]/revisions` (`?legacy=1` for the original v1 snapshot). Full schema validation before any DB call (400 `INVALID_WORKSPACE` with paths); owner from the verified guest token; previous revision archived before update; a migrated workspace is removed again if its legacy snapshot can't be stored.
- Migration `supabase/migrations/202611160004_workspaces.sql`: `workspaces`, `workspace_snapshots` (`revision` / `legacy_v1`), owner RLS, immutable owner trigger. **Not applied to a live project.** `scripts/verify-rls.mjs` extended with workspace checks.

## V1 → v2 migration and JSON

- `previewV1Migration(plan, source)` → baseline per person/year (v1 profit fact with status/range/source), the v1 project and chosen option (agreed receipts), old "done" marks, questions (is the project agreed? what happened to each v1 existing SEP amount?), warnings. Nothing saved.
- `confirmV1Migration(plan, preview, answers)` → valid workspace or `PlanIntegrityError` (nothing partial). v1 profit becomes `annual_total` with `excludesManagedProjects: true` (v1 profit never included the opportunity). Agreed receipts keep their amounts/dates. SEP goal = v1 existing + agreed additional; **payments only from an explicit "paid" answer with amount and date**; "unknown" stays a goal with a note. Done marks go to `origin.unconfirmed`, never to payments. Save with `repo.save(ws, null, { legacySnapshot: plan })`; the v1 plan is not deleted.
- `exportWorkspaceJson(ws, legacySnapshot)` / `analyzeWorkspaceFile(text)`: v2 file validated whole; newer format → "made by a newer version of Headroom … nothing was imported"; damaged → path + "nothing was imported"; v1 saved-plan file → migration preview.

## Import as fact confirmation

- Document ids are content hashes (SHA-256 of the file) and evidence ids are `doc-<hash16>-<line|field>`: re-importing the same file yields the same ids.
- New proposal paths `project.paymentReceived`, `project.paymentReceivedDate` (CSV/TXT labels "Payment received", "Date received", "Deposit amount"…).
- `applyDocumentFact(ws, field, target)`: targets `forecast` (method-checked; YTD figure only as `ytdNetProfit`, with as-of date), `payment_received` (user picks the project line; actual replaces expected; an existing different actual → `needs_resolution`, or a correction with reason kept in `corrections`), `sep_contribution` (id from the evidence, so the same confirmation can't count twice). Returns `applied` (+ event to commit) / `duplicate` / `needs_resolution` / `rejected`. Never merges by similar amount. Bank statements still produce no profit proposals. Quota/page/time limits and log hygiene unchanged.

## Annual income forecast explanation

- `POST /api/export/forecast` `{workspace, year: 2026|2027, expectedFingerprint?}` → compact English PDF; client `exportForecastPdf(ws, year, fingerprint)`. 409 `STALE_RESULT` when the plan changed since the figures were shown; 400 for an invalid workspace.
- Content: household / year / as-of, revision, engine/rules, fingerprint; per person the forecast parts (confirmed vs estimate, ranges), managed project payments (received vs expected, with dates and sources) and the derived profit; 2026 subsidy position (ACA MAGI, 400% limit, credit, settlement, remaining profit headroom, status); projects table (offers marked "not included"); SEP goal / paid / still to pay; missing information; assumptions; sources; appendix with the engine trace. States clearly: not a complete self-employment ledger, not an official form, not a Marketplace decision, nothing is sent to HealthCare.gov.
- Numbers: the route uses Claude 2's `buildHouseholdProjection` automatically once it is exported from `@/lib/engine`; until then it runs the existing v1 `assessCurrentRisk` on `workspaceToCaseInput(ws)` (same engine 1.1.1 / r3; incomplete facts → "Not calculated" with the missing items, no numbers invented).
- **Real export checked**: `next start` + `curl -X POST /api/export/forecast` with the synthetic fixture → 200, `application/pdf`, 3 pages; text extracted and all pages rendered and inspected (a range wrapping inside the amount column was found and fixed by moving ranges to the Basis column). Artifact: `docs/artifacts/round3/annual-income-forecast-explanation-synthetic.pdf` (synthetic household; derived 2026 profit $125,000, range $118,000 to $131,000; MAGI $101,100; credit $12,943; repay $470; headroom $6,508). The detailed plan PDF is unchanged.

## Hooks for Claude 1 (all from `@/lib/client/api`)

`createWorkspaceRepository()`, `commitWorkspaceChange()`, `newWorkspaceEvent()`, `WorkspaceConflictError`, `CloudSaveFailedError` + `saveLocally()`, `previewV1Migration()` / `confirmV1Migration()` (show baseline, project, done marks and questions; save with `legacySnapshot`), `analyzeWorkspaceFile()` / `exportWorkspaceJson()`, `applyDocumentFact()` (then commit the returned event), `exportForecastPdf()`. Fingerprint for the stale check: `workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION)` from `@/domain/household-workspace`. No screens were rebuilt by Claude 3.

## Deployment readiness

- Migration order: 001 → 002 → 003 → 004 (`docs/DEPLOYMENT.md`, `supabase/README.md`). Env names unchanged (`.env.example`).
- Client bundle scan of `.next/static`: no secret values or server env names; only key-prefix checks (`sb_secret_` rejection).
- Misconfigured providers (placeholder AI key, placeholder Supabase secret, a `sk_live_` Stripe key) → capabilities all false/demo, and the full UI smoke passes on that server.
- `tests/ui/smoke.cjs`: optional `CHROMIUM_PATH` so the pinned Playwright can use a preinstalled Chromium (one-line config change).

## Checks run

- `npm run typecheck` ✔; `npm test` ✔ **82 tests / 18 files** (new: `workspace-contract` 6, `round3-workspace` 8 — two local revisions + reload, lost-ack retry without double write, stale conflict, schema rejection before write, cloud failure + local copy, repeated import/payment/SEP idempotency, correction, YTD guard, bank CSV, v1 migration with SEP answers/done marks/legacy snapshot, v2 JSON restore/newer/damaged/v1 routing, forecast PDF content + stale/invalid; `round3-workspace-api` 2 — 503 without cloud, 400 before any DB access).
- `npm run build` ✔ (production). `BASE_URL=… CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:ui` ✔ against a server with misconfigured providers.

## Not done / needs access

1. Supabase access → apply migrations 001–004, enable anonymous sign-ins, run `scripts/verify-rls.mjs` (two real guests incl. workspaces).
2. Anthropic key + Supabase secret → one real consented PDF import.
3. Vercel → deploy the integrated `main` and check the public URL in a clean browser.
4. Engine wording in the trace ("plus this option's receipts") comes from v1 `assessCurrentRisk`; Claude 2's projection should give current-forecast wording.
