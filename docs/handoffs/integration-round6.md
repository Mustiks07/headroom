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

Production deployment and a bounded live-provider/cloud smoke check are recorded below after deployment. No new environment variables are needed for this round. The intake route uses the existing proposal feature and quotas.

## Presentation evidence

Use the current case 1 above, not earlier prototype amounts. New CMS state/county analysis: `docs/research/round6-launch-decisions.md`. Economics: `docs/research/round6-economics.md`. Competitors and first-Cup evidence: `docs/research/round6-competition-pitch.md`. Proposed launch price is $29 per decision including 30 days of revisions; annual $99 is the repeat-use model to validate. The contest app remains free.
