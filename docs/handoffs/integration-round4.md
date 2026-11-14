# Round 4 integrated review — November 15, 2026

Integrated branch heads: Claude 1 `c9beb5d`, Claude 2 `eeb6cf5`, Claude 3 `6ca4619`. Claude 1 already contained both other heads; ancestry was checked and its combined branch was merged normally into a Codex review branch based on production `5f66a5a`. Existing Supabase/Vercel configuration and release documentation were preserved. No new database migration or environment variable is required.

## What now works together

Household project → cash goal, SEP limit, optional dated goal → permitted prices/payment windows → up to three exact-checked choices from an approximate search → client draft → saved action package → PDF/calendar → recorded client agreement → actual payment → revised household/attention list. Unknown household balance stays unassessed. Unreachable goals have a separate no-terms result, with no false success card.

The engine remains `headroom-engine-1.2.0`, rules `us-federal-aca-2026-2027.r3`; household `headroom-household-1.0.1`, deal search `headroom-deal-1.0.0`.

## Corrections made during integration

1. **Deposit and total price:** the goal form used unpaid receipts as the full project price, contrary to the engine contract. Defaults now include actual received money plus open expected receipts; labels explicitly say total price. Regression: $3,000 deposit + $3,000 remaining → $6,000 total.
2. **Agreement replay:** `recordClientAgreement` now reuses the previous agreement event and returns the unchanged workspace on a retry, preserving subsequent received facts and avoiding a second SEP target increase. It is now async; the caller awaits it.
3. **Stale agreement:** the operation itself checks the current goal/terms/workspace fingerprint and that received + unpaid payments equal the total. The UI's disabled button is no longer the only freshness guard.
4. **Past payment windows:** new terms cannot silently backdate payments when the latest allowed date has passed. January searches create only valid remaining-year windows; overdue offered terms remain distinguishable from new proposals.
5. **Cloud smoke timing:** the UI check initially read the old result before cloud saving completed. It now waits for the actual saved revision before checking the new financial output. This was a test synchronization issue, not a fabricated cloud-save success.
6. **PDF layout:** client-draft lines use compact paragraph spacing so the inspected decision package does not spill a single final warning onto an otherwise empty page. No text or financial data removed.

## Bounded verification

- Integrated base: typecheck and 122 tests across 24 files passed.
- Added three targeted regressions for the actual total-price/date/agreement defects; all passed. Typecheck passed after the correction.
- Production build passed. The full existing browser smoke passed after its cloud-save wait was corrected: edited real family result, invalid input, SEP limit, saved/revised/reopened plan, missing spouse, own draft restore, received payment replacing expected, SEP goal/paid/remaining, goal search/no-feasible result, desktop and 360px routes, no page errors.
- Real browser with Supabase: sample household revision 1 → saved goal revision 2 → saved package revision 3 → client agreement revision 4 → recorded $5,925 first payment revision 5. Reload preserved the agreement and payment. The paid receipt left the attention list.
- Synthetic UI example: goal at least $4,000, additional SEP at most $1,000, asked price $12,000–$14,000, latest payment January 31, 2027. Most-cash choice: $14,000 total as $5,925 in 2026 + $8,075 on January 4, 2027; +$9,695 after both tax years relative to declining unpaid terms. This is a synthetic planning result, not a customer-saving claim.
- Real engine decision PDF and ICS downloaded through the running application. PDF figures matched the UI; calendar had four dated events with CRLF. The final rendered artifact is linked in `docs/artifacts/round4/README.md`; the earlier layout test-double remains explicitly labeled historical test data.

Production URL: https://headroom-amber.vercel.app. Vercel deployment `5DHRPjSC6SMpbBwqUfoXDxReTVXe` reported Ready for runtime commit `6f18c1f`. Unauthenticated HTTP checks returned 200 without redirects for the homepage, capabilities and household entry. A real browser created and saved a goal, calculated three terms, saved the selected package, downloaded the three-page PDF with matching figures and reopened the saved goal. AI remained off; guest cloud saving was on; checkout remained demo mode. These checks are not an independent CPA audit.

The supplementary public scripted run hit its old 10-second timeout waiting for v1 revision 2. A focused replay completed the same update with successful API responses and a persisted revision 2; the smoke wait now permits 30 seconds. This is not reported as an entirely green public suite. A separate public v2 check verified $3,200 received on December 16, 2026 (distinct from the expected December 15), $1,500 SEP paid on November 10, 2026, and revision 3 after reload. The earlier complete local browser smoke remains the full-suite result; no runtime behavior changed in this documentation/test-only follow-up.

## Known limits and next work

After agreement, inputs change and the old package fingerprint becomes historical: current exports correctly refuse it, but users need an archived decision export plus a current agreed-plan calendar. Round 5 assigns that lifecycle to Claude 3 and its UI to Claude 1; do not relabel old numbers as fresh to bypass the guard.

Document extraction and workspace fact helpers exist; a seamless document-first household setup and natural-language commands do not yet. AI is still disabled on production. No user interviews, live payments or proven retention are claimed. Detailed next assignments: `docs/tasks/ROUND5_SHARED.md` and `CLAUDE1_ROUND5.md`, `CLAUDE2_ROUND5.md`, `CLAUDE3_ROUND5.md`.

Keep the current supported tax scope, no-registration path, actual-vs-expected semantics, cents boundary and guest data isolation. Research may change positioning/pricing hypotheses; it must not silently expand tax support or become invented traction.
