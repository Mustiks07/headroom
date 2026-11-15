# Deployment and configuration

Codex integrates production. Use existing GitHub `Mustiks07/headroom`, Vercel `headroom` in `mustiks07s-projects`, and existing Supabase. Production branch `main`; public app https://headroom-amber.vercel.app. Do not create another project or reset data.

Next.js/TypeScript runs on Vercel Node; no production Python runtime. Python references are development verification only. Node22, repo root, `npm ci`, `npm run build`, default framework output. Manual calculations/local guest plans need no credentials.

## Environment

- NEXT_PUBLIC_APP_URL: actual public origin.
- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: invisible guest configuration.
- SUPABASE_SECRET_KEY: server only, never NEXT_PUBLIC, Git or logs.
- AI: BasisWeb; exact variables/verified format limits in [AI_DEPLOYMENT.md](AI_DEPLOYMENT.md).
- MARKETPLACE_API_KEY: optional ZIP lookup, not currently configured.
- Stripe TEST variables are optional. Live billing is off; judges have no signup/card/entitlement gate. Access-preview events are not revenue.

Private values are in ignored .env.local and existing Vercel settings. Never replace working values with another clone's placeholders. Env changes require redeployment; Preview and Production differ.

## Database

Already applied, in order:

1. 202611140001_foundation.sql
2. 202611140002_hardening.sql
3. 202611150003_round2.sql
4. 202611160004_workspaces.sql
5. 202611170005_ai_budget_analytics.sql

To apply next (round 6, not applied yet):

6. 202611180006_round6_ops.sql (Claude 3: analytics `developer` data kind; anonymous `ai_calls_daily` counters + server-only `headroom_count_ai_call`). Apply after 005, then run `scripts/verify-rls.mjs`. Until applied, developer analytics rows and AI call counters are dropped with a logged warning; nothing else depends on it.

Anonymous sessions are invisible plumbing. RLS binds user rows to guests. Decision/calendar history lives inside workspace documents. Quota/spend/analytics functions are server-only. Migration005 applied November15; 26 live isolation checks passed. Do not rerun migrations or relax policies to mask client errors.

Only for a new environment: apply exact files in order, enable anonymous sessions, set origin and run scripts/verify-rls.mjs with private env.

## Release

1. Normal integration merges in an isolated branch; review contracts/saved-data compatibility.
2. Typecheck, relevant tests, one build, bounded actual UI path. Repeat only for related changes/failures.
3. Inspect real desktop/360px pages, downloaded PDF/ICS and JSON restore.
4. Secret scan without values; verify intended branch heads are ancestors; normal main merge/push, no force.
5. Confirm Vercel SHA/status and public clean-browser access.
6. Verify capabilities, guest path and actual synthetic text-PDF/proposal routes on production. Native parser dependencies must work on Vercel.
7. Record exact evidence/limits in the current integration handoff.

Security headers are in next.config.ts. Extraction route maxDuration60s with shorter provider timeouts. Parser/canvas server-externalized. Original documents are not stored.

## Current limits

No OCR/photos or live ZIP lookup. No-charge/test checkout. Complete first-offer semantic intake, cross-document atomic review and negotiation/partial-payment lifecycle are round6 requirements, not finished-feature claims.

Current [integration handoff](handoffs/integration-round5.md); historical [Supabase setup](handoffs/supabase-live-setup.md) and [first Vercel release](handoffs/vercel-live-release.md). Older handoffs describe their date, not today's configuration.
