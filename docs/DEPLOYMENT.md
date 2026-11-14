# Deployment and configuration

Owner: Claude 3. The integrated app builds and runs without external keys. Public deployment and optional provider connections still require configuration and verification. See [the integration review](handoffs/integration-review.md) for the checked local scope.

## Local

```sh
npm ci
npm run dev
```

Node 22 baseline. Copy `.env.example` to `.env.local` for service configuration. Use the committed lockfile; do not generate separate package-manager locks on different branches.

The financial engine, browser-local storage and PDF export are implemented. Missing optional cloud/AI configuration must preserve the guest path and return truthful service states.

## Supabase

Configure a project, apply `supabase/migrations/202611140001_foundation.sql`, enable anonymous sign-ins and configure only the actual app origins/redirects needed. No signup/login/email UI is to be built. An anonymous session is created by the adapter without requiring a person to register; if it fails, local mode remains usable.

- `NEXT_PUBLIC_SUPABASE_URL`: project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: publishable browser key (or a documented compatible legacy anon key).
- `SUPABASE_SECRET_KEY`: server-only secret, when a privileged backend operation actually requires it. Normal user access must remain owner-scoped/RLS-enforced.

Verify policies with two distinct guest sessions once. Do not assume that the presence of a migration file means it was applied or tested. Use private storage only if original document retention is explicitly implemented; no public document bucket. Default is to retain confirmed facts and minimal source metadata only.

## AI

- `AI_PROVIDER=none`: real manual entry, no pretend extraction.
- `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`: one configured server adapter. Provider/model validation is the adapter's responsibility; don't hardcode a model name that was not verified available.

Send only what the user agreed to submit. Never place AI credentials in a NEXT_PUBLIC variable, Git file, issue body or browser request. Extraction failures must return a useful retry/manual path. A missing key does not justify mock financial answers.

## Pricing / checkout

Default contest path: an explicitly labeled demo checkout, no card collection. The full judge journey is unlocked, including own-input calculations and export.

Optional Stripe **test-mode** variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ANNUAL_PRICE_ID`. Server-verified test purchases are recorded as test. Real billing is not required for this handoff and must not be claimed or silently enabled.

## Vercel

Import `Mustiks07/headroom`; root directory is the repo root, framework Next.js, Node 22, install `npm ci`, build `npm run build`, default framework output. Production should come from the integrated `main`, not one developer's incomplete branch. Branch previews can be used for development but are not the final submission.

Configure required environment variables in the Vercel dashboard for the intended environment; do not commit them. Set `NEXT_PUBLIC_APP_URL` to the actual deployed origin. Make the contest URL accessible in a clean browser without Vercel/team login or deployment protection.

The app itself contains **no registration or login pages**. Cloud session infrastructure must not create a hidden dependency that blocks judges. Core calculation and guest persistence remain available if external AI/cloud configuration is absent.

Check the exact deployed commit against `ACCEPTANCE.md`. Add the verified URL and actual deck path to README only when they exist. Do not label an integration enabled merely because environment variable names were added.

Official implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
