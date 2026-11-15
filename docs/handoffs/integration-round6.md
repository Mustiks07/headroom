# Round 6 combined release

Date: November 15, 2026 (user timezone Asia/Qyzylorda).

Integrated UI: `75de104`, canonical engine merge `0efa51f`, backend merge `c1d18d7`, production fixes and evidence `2d86bdcc6ca33e59f949574821b691f963c84510`. Codex completed Claude 1 after the external session stopped. Claude 2 and 3 published their finished branches; neither is pending.

## Verified on the combined production build

- TypeScript and production build passed. Initial full suite: 208/209; the one outdated P&L fixture was updated to require explicit exclusion confirmation and its affected test passed. Canonical command group: 24 passed. Payment-window regression: 1 passed. No claim that the legacy round 2-5 browser script covers this release.
- Actual browser: family, ordinary and missing-fact journeys; offer-first creation; no-AI text PDF and P&L review; counteroffer; partial receipt and dated remainder; agreement and reload; historical decision PDF and current calendar; stale current-package guard. Mobile at 360px checked.
- Case 1 at the same $12,000 fee: original terms -$3,616 vs declining; $5,400 December 15, 2026 plus $6,600 January 4, 2027 gives +$8,310 vs declining, +$11,926 vs original terms, no additional retirement contribution. These are illustrative engine results under the documented inputs, not customer savings.
- Actual downloaded PDF/ICS/JSON and screenshots are in `docs/artifacts/round6/ui/`. Six pages across the exported PDFs were visually checked. The calendar uses April 18, 2028 for the 2027 federal return deadline.
- Supabase migration `202611180006_round6_ops.sql` applied successfully after 001-005. All 28 two-guest isolation checks passed, including the two new AI-counter access checks. Only aggregate operational counts are recorded by that migration.

## Public release verification

Application commit `aaef913` was deployed successfully to [headroom-amber.vercel.app](https://headroom-amber.vercel.app); [Vercel deployment](https://vercel.com/mustiks07s-projects/headroom/FbkehuEqcQomQ4gHiHdiAEfyNDyr). No new environment variables were required. The intake route uses the existing proposal feature and quotas.

The public browser restored case 1, calculated the original -$3,616, searched the saved constraints, returned the same $5,400/$6,600 schedule and +$8,310 result, saved the chosen terms, downloaded a four-page decision PDF and reopened revision 3. The plan list confirmed guest-cloud storage. Actual production artifacts: `production-as-written.jpg`, `production-saved-terms.jpg`, `production-decision.pdf` in the UI artifact directory.

Two bounded live BasisWeb smoke requests (not a general accuracy benchmark):

- Offer email `m1`: HTTP 200, response provenance provider, all 10 expected checks matched, 6.152 seconds.
- Text W-2 PDF `d2`: HTTP 200, provider provenance, all 3 required checks matched, 6.547 seconds. One additional `income.payrollPretaxDeductions` field was reported; the input contains a Box 12 code D retirement deferral, and the response remains `review_required`. The scorer does not store the extra value, so this is recorded as an extra field rather than an independently validated extraction. No 100% general accuracy claim is made.

Reports: `docs/artifacts/round6/eval/results/production-intake-smoke.json` and `production-document-smoke.json`. No credentials, raw personal documents or user-supplied financial data were published. The checks use the repository's synthetic corpus.

## Presentation evidence

Use the current case 1 above, not earlier prototype amounts. New CMS state/county analysis: `docs/research/round6-launch-decisions.md`. Economics: `docs/research/round6-economics.md`. Competitors and first-Cup evidence: `docs/research/round6-competition-pitch.md`. Proposed launch price is $29 per decision including 30 days of revisions; annual $99 is the repeat-use model to validate. The contest app remains free.

## Submission artifacts and README

`docs/presentation/headroom-business-cup.pdf` contains exactly ten English 16:9 slides, individually generated in the selected C style, with working app/repository links and source links. Every page was rendered with Poppler and visually inspected after PDF assembly. The five-minute speaker outline, evidence index, model assumptions and submission description are in `docs/presentation/README.md`. These files are a prepared package, not an organizer submission receipt.

The redesigned README uses an ImageGen chrome subject with deterministic SVG typography, an unaltered actual result screenshot, and a compact workflow SVG. Editable composition sources are retained under `assets/readme/source/`. The complete local Markdown preview was reviewed at GitHub content width and 360px; images loaded and there was no page overflow. All local links and the skill's image/SVG audit passed. Application code was unchanged during presentation/README packaging.
