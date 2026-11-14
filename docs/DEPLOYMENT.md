# Deployment and configuration

Owner: Claude 3. The integrated app builds and runs without external keys. Public deployment and optional provider connections still require configuration and verification. See [the integration review](handoffs/integration-review.md) for the checked local scope.

## Local

```sh
npm ci
npm run dev
```

Node 22 baseline. Copy `.env.example` to `.env.local` for service configuration. Use the committed lockfile; do not generate separate package-manager locks on different branches.

The financial engine, browser-local storage and PDF export are implemented. Missing optional cloud/AI configuration must preserve the guest path and return truthful service states.

## Supabase (optional cloud save)

1. Create a project. **Authentication → Sign In / Providers → Anonymous sign-ins: on.** Keep email/OAuth UI unused; the app has none. Optionally enable CAPTCHA / the anonymous sign-in rate limit.
2. Apply, in order (SQL editor or `supabase db push`): `202611140001_foundation.sql`, `202611140002_hardening.sql`, `202611150003_round2.sql` (revision history, `rules_updated` events, AI quota table/function).
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

Import `Mustiks07/headroom`; root directory is the repo root, framework Next.js, Node 22, install `npm ci`, build `npm run build`, default framework output. Production should come from the integrated `main`, not one developer's incomplete branch. Branch previews can be used for development but are not the final submission.

Configure required environment variables in the Vercel dashboard for the intended environment; do not commit them. Set `NEXT_PUBLIC_APP_URL` to the actual deployed origin. Make the contest URL accessible in a clean browser without Vercel/team login or deployment protection.

The app itself contains **no registration or login pages**. Cloud session infrastructure must not create a hidden dependency that blocks judges. Core calculation and guest persistence remain available if external AI/cloud configuration is absent.

Minimal production env: none (guest/local mode). Recommended: `NEXT_PUBLIC_APP_URL`. Cloud save adds the two public Supabase values; AI adds `SUPABASE_SECRET_KEY`, `AI_PROVIDER`, `AI_API_KEY` (+ limits). Security headers are set in `next.config.ts`. Health check: `GET /api/capabilities` (booleans only).

Check the exact deployed commit against `ACCEPTANCE.md`. Add the verified URL and actual deck path to README only when they exist. Do not label an integration enabled merely because environment variable names were added.

Official implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
