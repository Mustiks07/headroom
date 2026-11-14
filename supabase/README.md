# Supabase setup (Headroom)

1. Create a project. In **Authentication → Providers (Sign In / Providers)** enable **Anonymous sign-ins**. Do not enable any sign-up UI; the app has none.
2. Apply the migrations in order (SQL editor or `supabase db push`):
   - `migrations/202611140001_foundation.sql`
   - `migrations/202611140002_hardening.sql`
3. Set in Vercel (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   and optionally `SUPABASE_SECRET_KEY` (server only; used just for demo/test entitlements and deleting the
   anonymous user on "Clear my data").
4. Optional: enable CAPTCHA/rate limits for anonymous sign-ins in Auth settings. If sign-in fails, the app stays in local mode.
5. Verify once with two guest sessions: `node scripts/verify-rls.mjs` (needs the two public env vars).

Normal reads and writes use the user's own JWT with the publishable key, so RLS (`auth.uid() = owner_id`)
enforces isolation. `owner_id` is set by the server from the verified token, never from the request body.
