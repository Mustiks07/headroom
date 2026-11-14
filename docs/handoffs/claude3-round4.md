# Claude 3 — round 4 handoff (deal-planning contract, durable state, evidence, action package)

Branch `claude3`, merged from `origin/main` @ `743de9d` (normal merge; kept the integrator's `remainingSepCash` / `includedContributionIds`, adapter partial-payment semantics and forecast-PDF inclusion rules). `main` not changed; Codex integrates.

**External services: not accessed, not verified** (no Vercel, Supabase, Anthropic or Stripe access). All checks below are local (tests, production build, `next start`).

## Contract

| Commit | Content |
| --- | --- |
| `f99b5d3089379029d65bb178771281816d039834` | `src/domain/deal-planning.ts` (goal, date-target kinds, terms space, cash context, variant, search result, sensitivity, action package, engine signatures, `dealSearchFingerprint`, `cashCompletenessFor`, `isPackageCurrent`), optional `workspace.dealPlanning` + cross-checks, fixture, contract tests |
| `7c6219df6a410652d9b5555daaa46bf0c66cfc6b` | additive event kinds `deal_planning_updated`, `deal_package_saved`, `deal_status_changed` |
| `7884b1ab220a1c4c27fbe03f2d2596845c25f46b` | clarification only: `priceCents` = total asked price incl. received; payments = unpaid remainder (Σ payments = price − received) |

Details and examples: [`round4-contract.md`](round4-contract.md).

## Implemented

1. **Durable goal/cash/action state** — stored inside the workspace document (`dealPlanning`), so it is saved atomically with the revision and its history event, restored by workspace JSON (verified equal after export → restore) and never dropped (schema knows the field). `src/lib/client/deal-state.ts`: `saveDealGoal`, `saveCashContext`, `saveActionPackage` (supersedes older packages of the same project; same package + same event id = idempotent retry), `setPackageStatus` (user-only: `terms_shared_by_user`, `client_agreed`), `setReminderStatus`, `currentSearchFingerprint`, `packageCurrency`. Local guest storage works without keys; cloud uses the existing `/api/workspaces` routes (no new migration needed).
2. **Document → reviewed fact** — `previewDocumentFacts(ws, extraction)` lists, per figure: found amount/date/period/tax year/source/excerpt, possible destinations (project payment lines, SEP contribution per adult, YTD/annual forecast field matching the person's method), still-needed inputs (`date`, `tax_year`, `as_of_date`, `status`, `correction_reason`), blockers and `alreadyApplied`. Rules: transfers between own accounts are not income; unknown period is never an annual total or 2026; one receipt never becomes the annual figure; equal amounts never choose the destination; re-importing the same file shows "already recorded" and `applyDocumentFact` returns `duplicate` (content-hash evidence ids). CSV/TXT/manual work without AI; no OCR is simulated.
3. **Client terms draft** — `buildClientDraft` (deterministic): total asked price (noting money already received), each unpaid payment and its date. Never includes household income, subsidy, taxes or SEP; `includeHouseholdDetails` only adds a generic reason sentence without amounts. `clientDraftNotes` (shown to the user, not in the message): Headroom doesn't send it, selection ≠ client agreement, invoice date alone doesn't move income. `clientDraftFile` for download. Nothing is sent automatically.
4. **Calendar (.ics)** — `buildCalendar` / `POST /api/export/calendar`: RFC 5545, CRLF, 75-octet folding, text escaping, all-day `VALUE=DATE` events (no timezone ambiguity), stable `UID` per workspace+project+action, `SEQUENCE` bumped when an action's date/title changes, done/cancelled and undated actions are not added (undated ones show their condition in the package/PDF). Dates come from the engine's actions; Claude 3 adds no deadlines of its own.
5. **Decision package PDF** — `POST /api/export/decision`: goal, baseline, chosen terms incl. fixed received amounts, result after both years, retirement separately, date goals, money by date with completeness statement ("only this project's money" unless the cash context is complete), ACA/credit by year, SEP goal/paid/remaining + remaining SEP cash, constraints, next actions, client draft (marked not sent), sources/warnings, versions/revision/fingerprint. Stale packages (fingerprint differs), superseded packages, payments that don't add up and **figures that differ from a fresh engine re-check** are refused (409). The annual forecast PDF and the plan PDF are unchanged.
6. **Transport/hooks for Claude 1** (all from `@/lib/client/api`): `saveDealGoal`, `saveCashContext`, `buildActionPackage(ws, readyResult, variantId, {includeHouseholdDetails})`, `saveActionPackage`, `setPackageStatus`, `setReminderStatus`, `packageCurrency` (show "search again" when stale), `currentSearchFingerprint`, `buildClientDraft`, `clientDraftNotes`, `clientDraftFile`, `buildCalendar` / `exportCalendarIcs`, `exportDecisionPdf`, `previewDocumentFacts` + `applyDocumentFact` (then commit the returned event with `commitWorkspaceChange`). Cloud failures keep using `CloudSaveFailedError` + `saveLocally` (no double success).
7. **Deployment** — exact Vercel/Supabase release checklist added to `docs/DEPLOYMENT.md` (Node 22, env per feature, deployment protection off, migrations 001→004, RLS script, deployed-URL smoke, function limits). No new env names; `.env.example` unchanged. Client bundle scan: no secret values or server env names.

## Dependency on Claude 2

`/api/export/decision` needs `searchDealTerms` exported from `@/lib/engine` (contract signature). Without it the route returns **503 `DEAL_SEARCH_UNAVAILABLE`** (checked on the production server) — no fake recommendation. The package builder, draft and calendar work on any ready result. Tests use an explicitly labelled test double (`tests/support/fake-deal-search.ts`) only to exercise storage/export plumbing.

## Checks run

- `npm run typecheck` ✔; `npm test` ✔ **110 tests / 23 files** (new: `deal-contract` 5, `round4-deals` 7 — atomic save + lost-ack retry + reload + JSON restore + supersede; stale after a payment and after a goal change (409 from both export routes); draft without household figures; ICS structure, stable UIDs, SEQUENCE bump, done/undated skipped, escaping; decision PDF content, tampered figures 409, missing engine 503; document preview destinations, transfer/unknown-period blockers, re-import → already recorded/duplicate).
- `npm run build` ✔; `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:ui` ✔ (guest path, 360 px, no page errors).
- Production server (`next start`): `/api/export/calendar` 200 `text/calendar`, parsed by the independent Python `icalendar` library (3 events, correct dates/UIDs/SEQUENCE/summaries); `/api/export/decision` 503 as expected; `/api/export/forecast` 200 for a round 3 workspace (old saves).
- Real files opened: decision PDF (3 pages, all rendered and inspected; label/purpose/SEP wording fixed after inspection), `.ics`, client draft. Samples in `docs/artifacts/round4/` — **the decision PDF's money is test-double placeholder data** (see README there).

## Not verified / needs access

1. Supabase: migrations 001–004, anonymous sign-ins, `scripts/verify-rls.mjs` with two real guests (incl. workspaces holding `dealPlanning`).
2. Vercel: deployment of the combined `main`, deployed-URL smoke in a clean browser.
3. Anthropic key + Supabase secret: one real consented PDF/image extraction.
4. Decision package with real numbers: after Claude 2's `searchDealTerms` is merged, regenerate the PDF and re-inspect.
