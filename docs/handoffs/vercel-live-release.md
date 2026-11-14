# Headroom public release — November 15, 2026

Public app: **https://headroom-amber.vercel.app**. Direct synthetic example: **https://headroom-amber.vercel.app/demo?case=family-cliff**.

The first production deployment is `dpl_B4rYF4jaaDyXCyD1SV2YBLx4SRYc`, built from integrated `main` commit `1c9157afafd5996c245ff006749633ee61db78a4`. This handoff and README change no runtime code. The Vercel project is `mustiks07s-projects/headroom`; production follows `main`. Claude branches remain previews until integrated and reviewed.

## Verified on the public deployment

- Fresh HTTP requests without cookies, tokens or automatic redirect following returned 200 for `/`, `/check`, `/household`, `/demo?case=family-cliff` and `/api/capabilities`. No Vercel login redirect.
- The actual browser journey has no signup, email or card gate.
- Family example at $12,000: accepting as offered is -$3,436 versus declining; splitting gives +$8,315. Changing the offer to $6,000 recalculates to +$4,161 and recommends accepting without a special arrangement. These are synthetic example results, not customer savings.
- Opened the sample household on the production origin. Supabase guest save reported revision 1. Recorded the final payment as $3,200; revision 2 and the $125,200 forecast persisted after reloading the page.
- Downloaded the 2026 forecast PDF from the public server. Opened and rendered all three pages: updated $3,200 receipt and $125,200 profit, revision 2, source labels, assumptions and calculation trace are present and legible.
- Capabilities: cloud save enabled, local text import enabled, AI extraction disabled, checkout demo.

The public browser/PDF checks are deployment verification, not an independent audit of tax rules. The integrated runtime already has the bounded round 3 checks recorded in `integration-round3.md`; no unchanged full test loop was repeated for these deployment/documentation changes.

## Configuration and release ownership

Supabase migrations 001–004 and anonymous sessions are already configured; see `supabase-live-setup.md`. Do not reapply the initial schema. Credentials stay in private environment configuration. The public app URL was added to production environment settings after the first deployment; the documentation push triggers the subsequent deployment that picks it up.

No AI provider key or live billing is connected. Manual calculations, text import, cloud save and exports work independently. The deck is still a separate deliverable; this report is not a replacement for the user's final presentation.

Round 4 introduces goal-driven deal terms and action packages in developer branches. Do not label those features live before the combined UI, engine, persistence and real exports have been checked. In particular, replace any round 4 test-double PDF sample with the integrated engine's real export before presenting it as product output.

Local release evidence is kept outside Git in `artifacts/vercel-release` in the parent workspace: public-app screenshot, downloaded PDF and three rendered pages. It contains a synthetic household only.
