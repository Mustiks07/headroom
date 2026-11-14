# Claude 3 — round 2 handoff (backend, persistence, import, PDF, deployment)

Branch `claude3`, merged from `origin/main` @ `d6590ac` (fast-forward; integrator corrections kept: CSV expense-date/multi-value fixes, rule source links in PDF, engine 1.0.1 / rules r2). `main` was not changed.

**No external access was provided in this session** (no Supabase project, Vercel project, AI key or Stripe key in the environment). Everything below marked *verified* was verified locally on a production build (`next build && next start`) or by targeted tests. Nothing claims a live Supabase, AI provider, payment or public URL.

## 1. Saved plans after an engine/rules update

- `checkPlanCurrency(plan)` → `current` | `outdated_rules` (stored engine/rules ≠ current) | `fingerprint_mismatch` (same versions, stored result doesn't belong to the inputs).
- `previewPlanUpgrade(plan)` recalculates with the current engine, nothing saved: before/after figures for the chosen option (2-year cash vs declining, retirement, each year's PTC, settlement, federal tax, spendable cash), whether the option still exists / is feasible, completed actions kept vs dropped, new actions, feasible options. The previous option is pre-selected **only** if it still exists and is feasible; otherwise the user must choose.
- `confirmPlanUpgrade(repo, plan, preview, optionId)` saves the next revision (normal revision check + engine recompute) and appends a `rules_updated` event (old → new fingerprint and versions).
- Earlier revisions are kept: local repository keeps the last 20 per plan; cloud keeps them in `plan_revisions` (inserted by the server before each update). `repo.listRevisions(planId)`, `GET /api/plans/[id]/revisions`.
- UI seam (minimal, Claude 1's tree): new `src/features/plan/PlanUpgradePanel.tsx`, mounted in `PlanView` (banner → "Recalculate and compare" → table + option choice → "Use the updated plan" / "Keep the saved version for now"). PDF export is disabled while outdated (the server would refuse a stale export anyway); JSON download of the saved version stays available. History label added for `rules_updated`.
- Fixed-action evaluation from Claude 2's round 2 is not on `main` yet; when it lands, `previewPlanUpgrade` is the place to show "your agreed receipts/SEP under the new rules" next to the re-optimised option.

## 2. Cloud failure does not cut off the guest path

`createPlanRepository()` (hybrid) now tracks where each plan lives (`locationOf`). A cloud plan is never written locally, and a local plan is never written to the cloud.
- New plan + cloud failure after a guest session exists (network, timeout, 5xx, 401/expired session, missing tables) → `CloudSaveFailedError` (`operation: "create"`). Nothing is reported as saved. `repo.saveLocally(plan)` creates a separate browser plan on request.
- Update of a cloud plan fails → `CloudSaveFailedError("update")`; the offered action is "Save a separate copy in this browser" (new id, cloud version untouched) or JSON download.
- `list()` in cloud mode = cloud plans + this browser's plans. If the cloud fails it returns the browser plans and `cloudProblem()` explains what's missing.
- `clear()`: cloud delete fails → browser data is still removed, the guest session token is **kept** (so a retry can delete the cloud copy), and `PartialClearError` says plainly the cloud copy still exists.
- Server: an auth service with no HTTP status (network/DNS) or 5xx now returns 503, not 401.
- UI seams: `src/features/plan/StorageFallback.tsx` (buttons), used in `Workspace` (save notice, scrolled into view) and `PlanView` (failed update). `PlansList` shows the cloud problem notice and a "This browser only" badge. `describeStorageError` maps the new errors.

## 3. Import

Kept the integrator's CSV fixes. Added:
- Document kind hint for CSV/TXT (pay stub / Marketplace notice / project offer / W-2) in the source label, with one specific caveat per kind (YTD is partial, notice months, fee ≠ profit, prior-year W-2).
- Review UI (DocumentImport, already a Claude 3 seam from round 1): tax year + person selectors; "This figure is: a final, confirmed amount / an estimate" (income defaults to estimate, Marketplace monthly amounts to confirmed); **year-to-date or unstated-period income cannot be applied until the user decides** "starting point — I'll raise it" (applies as estimate and focuses the field) or "it already is my full-year forecast" (estimate). Monthly ↔ annual mismatches stay refused. Bank statements still produce no profit proposals.
- The file picker offers PDF/images only when AI extraction is actually available in this browser; otherwise CSV/TXT only, and a PDF upload says "Document analysis is unavailable. Enter the figures manually."
- Verified in the browser: pay-stub CSV → YTD decision required → applied as estimate ($48,250); then an invalid file → unavailable message, the applied value is unchanged (form not lost). Provider failure/refusal/partial match: targeted tests with a mocked SDK (503 with manual path; refusal → unavailable; a value not found in its own quoted line is dropped).

## 4. Paid AI endpoint protection

`/api/documents/extract` provider path now requires, in order: provider configured **and** durable quota store (Supabase + `SUPABASE_SECRET_KEY` + migration 003) — otherwise AI is reported unavailable everywhere; same-origin (403 cross-site); file ≤ 3 MB, real PDF ≤ 5 pages; explicit consent; valid anonymous guest session (401); atomic daily quota `headroom_consume_ai_quota` (global / per guest / per HMAC-hashed IP; 429; fails closed with 503); provider timeout 40 s, no retries (route `maxDuration` 60), ≤ 4,000 output tokens. Client `getCapabilities().aiExtraction` is true only when this browser also has the guest session.
- Works across Vercel instances: everything except the in-memory burst limiter (per warm instance only). Anonymous guests are cheap to recreate, so the per-guest cap is soft; the **global daily cap is the budget guard** (`AI_DAILY_LIMIT`, default 100). Recommended in addition: provider-console spend limit; Vercel Firewall rate-limit rule on the route; Supabase anonymous sign-in rate limit/CAPTCHA.
- Logs: only error class names/codes. No document text, amounts or provider payloads.

## 5. JSON restore and PDF

- `analyzePlanFile(text)` / `planFromAnalysis(analysis, optionId)`: size limit, JSON, kind (`headroom.saved-plan`, `headroom.case-input`, bare plan/input), `contractVersion` must be 1.0, `CaseInputSchema` with the failing path, fresh engine recompute (stored numbers ignored), notes for old engine/rules or tampered figures, option state `kept | missing | infeasible | none` (no silent replacement), completed actions kept only if they still exist for the kept option. `PlansList` restore uses it: a clean current file restores directly; otherwise the user reviews notes and picks an option.
- PDF: table rows taller than the remaining page continue on the next page with the header repeated (no text drawn off-page); long key/value and bullet items break per line; the calculation trace is no longer truncated at 60 rows; confirmed-$0 income facts are grouped per person and source (same facts, shorter report: family demo 8 → 7 pages). Official links and both years are kept.
- Verified visually: a real PDF downloaded from the browser (family demo, after a rules upgrade) and a stress PDF with a long project title, an 800-character source excerpt and a long unbroken URL (7 pages each, rendered to PNG and inspected).

## 6. Deployment

- `docs/DEPLOYMENT.md` and `supabase/README.md`: reproducible Vercel + Supabase steps, exact env list, behavior when each service is absent or failing. `.env.example` lists AI limits. `next.config.ts` adds basic security headers. Health check: `GET /api/capabilities`.
- Required env for the contest guest path: **none**. Recommended: `NEXT_PUBLIC_APP_URL`. Cloud save: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. AI: additionally `SUPABASE_SECRET_KEY`, `AI_PROVIDER=anthropic`, `AI_API_KEY` (+ optional `AI_MODEL`, `AI_DAILY_LIMIT`, `AI_GUEST_DAILY_LIMIT`, `AI_IP_DAILY_LIMIT`). Stripe test: `STRIPE_SECRET_KEY` (test), `STRIPE_ANNUAL_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`. No real payments; demo checkout stays labelled.

## Migrations

`202611140001_foundation.sql`, `202611140002_hardening.sql`, **new** `202611150003_round2.sql` (adds `rules_updated` to the `plan_events.kind` check, `plan_revisions` with owner RLS, `ai_usage` + `headroom_consume_ai_quota` executable only by `service_role`). **None applied to a live project.** `scripts/verify-rls.mjs` now also checks revisions, the quota table and the quota function.

## Shared contract change (additive)

`PlanEvent.kind` gains `"rules_updated"` (`src/domain/contracts.ts`). Consumers: `PlanView` history label (added), server schema and DB check (added). No field renamed; existing kinds unchanged. Claude 1/2: please keep it when merging.

## Checks run (finite)

- `npm run typecheck` ✔; `npm test` ✔ **55 tests / 12 files** (new: `round2-plans` — stale upgrade with the real engine, cloud failure/ownership/partial clear, JSON restore cases; `round2-ai-guard` — quota/consent/session/origin/provider failure with mocked session store and SDK; `round2-pdf` — long content with real engine, row taller than a page). `npm run build` ✔ (final build without any env).
- Browser, production build, no keys: family demo → save → reload → simulated older engine → banner, PDF disabled → recalculate → revision 2 + "Recalculated with updated rules" in history → PDF and JSON downloaded → JSON restored as a new plan → tampered option → choice required → pay-stub import with YTD decision → bad file, value kept. No page errors. Claude 1's `tests/ui/smoke.cjs` ✔ (family/ordinary reach scenarios, missing-spouse shows the needs-data state, 360 px).
- Browser, cloud failure: build with a non-existent Supabase URL, anonymous sign-in answered in the browser (Playwright route), server cannot reach Supabase → "Cloud save isn't working right now…" (no "Plan saved"), "Save in this browser instead" → local plan labelled "Saved in this browser", plans page notice + "This browser only" badge, Clear my data → honest partial message, guest session kept, browser plans removed.

## Not connected / needed from the user

1. Supabase project access (or the two public values + secret key set in Vercel) → apply the three migrations, enable anonymous sign-ins, run `scripts/verify-rls.mjs` once, check API owner handling with two browsers.
2. Anthropic API key (and the Supabase secret for the quota) → one real consented PDF import + one failure recovery.
3. Vercel project access → deploy `main` after the shared integration check, set `NEXT_PUBLIC_APP_URL`, verify the public URL in a clean browser (no deployment protection).
4. Stripe test keys only if a test-mode checkout should be shown; otherwise the labelled demo checkout remains.
