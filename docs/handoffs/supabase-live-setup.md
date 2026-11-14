# Supabase live setup — November 15, 2026

Codex connected the integrated round 3 application (`743de9d`) to the user's Headroom Supabase project. This checks a local production Next.js build against **real hosted Supabase**; it is not a verified public Vercel deployment.

## Completed

- Added `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY` to ignored `.env.local` files in the main and Codex review working copies. No credentials are committed. Other clones and Vercel environments do not inherit ignored files through Git.
- Applied the four repository migrations in order, in one transaction, through the authenticated Supabase SQL editor: `202611140001`, `202611140002`, `202611150003`, `202611160004`.
- Recorded all four versions, names and SQL in `supabase_migrations.schema_migrations`. Protected that service table with RLS and revoked `anon` / `authenticated` access to it and its schema.
- Confirmed all eight public application tables exist with RLS enabled: `plans`, `plan_events`, `document_sources`, `entitlements`, `plan_revisions`, `ai_usage`, `workspaces`, `workspace_snapshots`.
- Enabled anonymous sign-ins and verified that the setting survives a dashboard reload. No login, signup or email screen was added to Headroom.

## Checks against the live service

- Existing two-guest isolation check: **21 checks passed**. Guest A can write and read their own records; B cannot read/change/delete A's plan, read its history/sources, change its workspace, attach foreign snapshots or mint entitlements. Guests cannot invoke the server-only AI quota function. Removed the two test users and their test data afterward.
- Built the production app with the real configuration. `/api/capabilities` returned `cloudSave: true`, `aiExtraction: false`, `checkoutMode: demo`, `localTextImport: true`.
- Opened the sample household through the actual browser UI. It saved to a private guest session in Supabase as revision 1. Recorded a synthetic $3,200 payment on December 16 instead of the expected $3,000. Revision 2 persisted, and revision 1 was archived.
- Confirmed the exact test row in hosted Supabase, including amount/date and archived revision. Reloaded the browser: private guest save status, revision 2 and $125,200 forecast were retained. A synthetic demonstration workspace remains in that browser for inspection.
- Checked generated public `.next/static` assets: the server secret is absent. Both local environment files are ignored by Git. No password or secret was placed in source, documentation or client assets.

## For the three developers

The database and guest mode are now ready. Keep the existing guest-token/RLS path; normal reads/writes must not switch to the service key. Do not recreate the initial tables or rerun migrations 001–004. Round 4 schema changes, if required, need a new migration. Keep secrets outside handoffs and Git.

The runtime configuration still needs to be set privately for each separate local clone and for the eventual Vercel deployment. `AI_PROVIDER=none` remains intentional until the user supplies the model-provider key. Real billing is not enabled. Browser guest identity does not imply cross-device synchronization.
