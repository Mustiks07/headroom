# Deployment and configuration

Owner: Claude 3; Codex performs production integration. The integrated app builds and runs without external keys. Supabase and the public Vercel deployment were configured and checked on November 15, 2026: see [the Supabase setup handoff](handoffs/supabase-live-setup.md) and [the live release handoff](handoffs/vercel-live-release.md). Production: **https://headroom-amber.vercel.app**. AI reading is off and checkout is in demo mode.

## Local

```sh
npm ci
npm run dev
```

Node 22 baseline. Copy `.env.example` to `.env.local` for service configuration. Use the committed lockfile; do not generate separate package-manager locks on different branches.

The financial engine, browser-local storage and PDF export are implemented. Missing optional cloud/AI configuration must preserve the guest path and return truthful service states.

## Supabase (optional cloud save)

**Existing Headroom project:** migrations 001–004 are already applied, their versions are recorded in `supabase_migrations.schema_migrations`, and anonymous sign-ins are enabled. Do not rerun the initial schema against that project. The instructions below are for a fresh project; future changes should use new migrations. Credentials are in ignored local environment files, never in this repository. A different clone or Vercel environment needs its own private environment configuration.

1. Create a project. **Authentication → Sign In / Providers → Anonymous sign-ins: on.** Keep email/OAuth UI unused; the app has none. Optionally enable CAPTCHA / the anonymous sign-in rate limit.
2. Apply, in order (SQL editor or `supabase db push`): `202611140001_foundation.sql`, `202611140002_hardening.sql`, `202611150003_round2.sql` (revision history, `rules_updated` events, AI quota table/function), `202611160004_workspaces.sql` (household workspaces v2: `workspaces` + `workspace_snapshots` for revisions and the original v1 plan), `202611170005_ai_budget_analytics.sql` (round 5: durable AI spend reservations for all AI features, anonymous daily analytics counters; server-only functions).
3. Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; optional server-only `SUPABASE_SECRET_KEY`.
4. Verify once with two guests: `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/verify-rls.mjs`.

Behavior: the browser silently signs in anonymously; the API verifies the bearer token and queries **as the guest** (publishable key + guest JWT), so RLS enforces ownership; `owner_id` is set from the verified token only. If sign-in fails → local mode with a truthful label. If the cloud fails **after** sign-in (network, 5xx, expired session, tables missing): nothing is reported as saved; the UI offers "Save in this browser instead" / "Save a separate copy in this browser" and JSON download; lists show browser plans plus a notice; "Clear my data" deletes browser data and says plainly if the cloud copy could not be deleted (the guest session is kept so a retry can delete it). Cross-device sync is not offered.

## AI document analysis (optional, paid provider)

- Default `AI_PROVIDER=none`: CSV/TXT import still works (deterministic, server-side); PDF/image upload shows "Document analysis is unavailable. Enter the figures manually." and the file picker offers only CSV/TXT.
- `AI_PROVIDER=anthropic`, `AI_API_KEY` (server only), optional `AI_MODEL` (default `claude-opus-5-5`). **Enabled only when Supabase + `SUPABASE_SECRET_KEY` + migration 003 exist**, because a public, login-free endpoint needs a durable spend guard.
- Controls that work on Vercel: 3 MB body, ≤ 5 PDF pages (parsed), magic-byte type check, explicit per-file consent, same-origin check, required guest session, 40 s provider timeout with no retries inside `maxDuration = 60`, ≤ 4,000 output tokens, and an atomic daily quota in Postgres (`AI_DAILY_LIMIT` global, `AI_GUEST_DAILY_LIMIT` per guest, `AI_IP_DAILY_LIMIT` per HMAC-hashed IP). The quota fails closed (503) if the store is unreachable.
- Not durable: the in-process burst limiter (per warm instance only). Anonymous guests can be re-created, so the per-guest cap is a soft limit; the **global daily cap is the real budget guard** — set it from your provider budget (rough upper bound per call: 5 PDF pages in + 4,000 tokens out). Also set a spend limit in the provider console and, if available, a Vercel Firewall rate-limit rule for `/api/documents/extract`.
- Logs contain only error class names / codes — never document text, amounts or provider payloads.

## Pricing / checkout

Default contest path: an explicitly labeled demo checkout, no card collection. The full judge journey is unlocked, including own-input calculations and export.

Optional Stripe **test-mode** variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ANNUAL_PRICE_ID`. Server-verified test purchases are recorded as test. Real billing is not required for this handoff and must not be claimed or silently enabled.

## Vercel

The existing `headroom` project in `mustiks07s-projects` is connected to GitHub `Mustiks07/headroom`, production branch `main`. Do not create a second project for the same release. Branch previews are separate from the public production alias. The public alias was checked without Vercel cookies or authorization headers; it returns the application directly.

Configured privately: the two public Supabase variables, server-only `SUPABASE_SECRET_KEY`, `AI_PROVIDER=none`, and production `NEXT_PUBLIC_APP_URL=https://headroom-amber.vercel.app`. Environment changes require a new deployment. Do not overwrite these settings with placeholder values from another clone.

Import `Mustiks07/headroom`; root directory is the repo root, framework Next.js, Node 22, install `npm ci`, build `npm run build`, default framework output. Production should come from the integrated `main`, not one developer's incomplete branch. Branch previews can be used for development but are not the final submission.

Configure required environment variables in the Vercel dashboard for the intended environment; do not commit them. Set `NEXT_PUBLIC_APP_URL` to the actual deployed origin. Make the contest URL accessible in a clean browser without Vercel/team login or deployment protection.

The app itself contains **no registration or login pages**. Cloud session infrastructure must not create a hidden dependency that blocks judges. Core calculation and guest persistence remain available if external AI/cloud configuration is absent.

Minimal production env: none (guest/local mode). Recommended: `NEXT_PUBLIC_APP_URL`. Cloud save adds the two public Supabase values; AI adds `SUPABASE_SECRET_KEY`, `AI_PROVIDER`, `AI_API_KEY` (+ limits). Security headers are set in `next.config.ts`. Health check: `GET /api/capabilities` (booleans only). Optional insurance ZIP lookup: server-only `MARKETPLACE_API_KEY` (see `docs/AI_DEPLOYMENT.md`, "Insurance data lookups"); without it the bundled CMS county extract and county-by-name lookup still work.

Check the exact deployed commit against `ACCEPTANCE.md`. Add the verified URL and actual deck path to README only when they exist. Do not label an integration enabled merely because environment variable names were added.

Official implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Release checklist (exact steps; round 4)

Claude 3 originally supplied this checklist without external service access. Codex subsequently configured and verified the existing Vercel/Supabase project; see the live handoffs above. Steps 1–4 below describe a NEW deployment only. Do not recreate the project, overwrite production env, rerun migrations 001–004 or weaken preview protection on the existing deployment. AI and live billing remain off.

1. **Vercel project** — Import `Mustiks07/headroom` → Framework preset *Next.js*, root `./`, install `npm ci`, build `npm run build`, output default, Node.js **22.x** (Project Settings → General). Production branch: `main` (only after Codex's combined review).
2. **Environment (Production)** — guest path needs nothing. Set `NEXT_PUBLIC_APP_URL=https://<your-production-domain>`. Optional, per feature:
   - cloud save: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
   - AI document analysis: additionally `SUPABASE_SECRET_KEY`, `AI_PROVIDER=anthropic`, `AI_API_KEY`, optional `AI_MODEL`, `AI_DAILY_LIMIT`, `AI_GUEST_DAILY_LIMIT`, `AI_IP_DAILY_LIMIT`;
   - Stripe TEST checkout (optional): `STRIPE_SECRET_KEY` (test key), `STRIPE_ANNUAL_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` + webhook endpoint `https://<domain>/api/checkout/webhook` for `checkout.session.completed`.
   `NEXT_PUBLIC_*` values are build-time: redeploy after changing them.
3. **Deployment protection** — Settings → Deployment Protection: disable Vercel Authentication for Production so judges can open the URL without a Vercel login.
4. **Supabase (only if cloud save is wanted)** — create the project; Authentication → Sign In / Providers → enable *Anonymous sign-ins*; SQL editor: run `supabase/migrations/202611140001_foundation.sql`, `…0002_hardening.sql`, `…0003_round2.sql`, `…0004_workspaces.sql`, `…0005_ai_budget_analytics.sql` in this order (deal planning, decision records and issued calendar events are stored inside the workspace document); Authentication → URL configuration: Site URL = production domain. Then locally: `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/verify-rls.mjs` (two anonymous guests; plans, events, revisions, workspaces, snapshots, AI quota, entitlements).
5. **Smoke on the deployed URL (clean browser profile)** — `/api/capabilities` shows the expected booleans; `BASE_URL=https://<domain> npm run check:ui` (add `CHROMIUM_PATH=…` where a preinstalled Chromium is used); then manually: demo → save → reload → export plan PDF, annual forecast PDF; if cloud is on, open the same URL in a second browser and confirm the first guest's plans are not listed.
6. **Function limits** — all routes run on the Node.js runtime; JSON bodies ≤ 3 MB (Vercel's 4.5 MB request limit is not reached); `/api/documents/extract` `maxDuration` 60 s, `/api/export/decision` 30 s, others default.

Exports added in round 4 (no new env): `POST /api/export/decision` (decision package PDF; requires the engine's `searchDealTerms`, otherwise 503 `DEAL_SEARCH_UNAVAILABLE`), `POST /api/export/calendar` (`.ics`); client-terms draft is built and downloaded in the browser.
