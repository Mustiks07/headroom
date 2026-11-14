# Round 2 integration review

Reviewed on 2026-11-15. This is the current release review; `integration-review.md` describes round 1.

## Integrated work

Normal merges, preserving all three histories:

| Branch | Reviewed tip | Contribution |
| --- | --- | --- |
| claude1 | `ef4256f` | Result-first demo, progressive own-data intake, invalid-value blocking, draft recovery, accessible calculation drawer |
| claude2 | `6d3424e` | Rules r3, return rounding, QBI/ACTC corrections, independent uncertainty ranges, fixed-agreement evaluation, counteroffer search |
| claude3 | `1f1ae63` | Explicit rule upgrades, local fallback, revision history, reviewed document periods, AI quotas, JSON restore and complete PDF |

The Workspace conflict was resolved by retaining Claude 1's layout and Claude 3's explicit local-save fallback. No login or service-key requirement was added to guest use.

## Integration corrections

1. **A recalculation must not silently renegotiate an agreement.** Wired `evaluateAgreedPlan` into both “Something changed” and rule upgrades. The saved receipt amounts/dates are evaluated first; new optimized proposals appear separately and require confirmation. In the synthetic family, raising baseline profit from $118,000 to $121,000 loses the 2026 credit under the old split even though a newly optimized split keeps a credit. This difference is now visible.
2. **Done does not mean done for a different amount.** Completed actions survive only when scenario kind, action id, exact title and deadline still match. Changed SEP amounts/payment schedules require review; the old confirmation remains in revision history. This is not yet an executed-contribution ledger.
3. **Saved input is untrusted.** Invalid agreed dates, years, negative/unsafe amounts and receipts that do not add up are rejected before evaluation. Damaged JSON scenario collections no longer reach an unchecked `.find()`.
4. **The tax-table source year was mislabeled.** The downloaded Form 1040 instructions are for 2025, despite a February 2026 document date. SHA-256: `24ad652c8f89a778990720873c13ff0d7fa35485a991a288bd9625804e5d932f`. The 2,062-row extract is now clearly a 2025 method reference. Engine calculations still use the correct year's Revenue Procedure brackets; this correction changes provenance, not the tax amounts.
5. **Browser verification is reproducible.** Playwright is pinned as a dev dependency; `npm run check:ui` checks the real result element when changing project price and verifies fixed-agreement credit loss.
6. **A saved upgrade is acknowledged even if its event fails.** A failure after the revision commit now returns the saved revision with a history warning; the UI reloads it instead of inviting a second save with the stale revision. The previous revision remains available.

Released engine version: `headroom-engine-1.1.1`. Rules: `us-federal-aca-2026-2027.r3`. Calculation contract: `1.0`.

## Checks actually performed

- Typecheck passed. **66 tests in 15 files passed**. Production build passed.
- The production server passed the bounded browser smoke flow: editable demo, invalid input, infeasible SEP, save/reopen, changed-income review, fixed-agreement warning, new revision, missing facts, JSON restore validation and mobile overflow checks.
- Additional browser review: a synthetic old-version plan paused PDF export, displayed the rule-upgrade comparison including fixed agreements, and saved revision 2; an income update then saved revision 3. No page errors were recorded.
- After the final recovery fix, a production-browser check deliberately failed only the upgrade history write. Revision 2 remained saved, the warning was visible, and the stale save button disappeared. Its screen was inspected as well.
- Visually inspected desktop demo, fixed-agreement review and mobile saved-plan screens. The demo's tall recommendation card and long mobile journey are improvement targets in round 3, not claimed finished design work.
- Downloaded the actual eight-page plan PDF from the production build, extracted its text, rendered all pages, inspected the page overview and first-page detail. It includes engine 1.1.1/rules r3, corrected source provenance, both years, cash and retirement separately, inputs, actions and full calculation trace. This is a household report, **not the contest pitch deck**.

These are local production checks with synthetic data. They are not a CPA review, a live Supabase/RLS test, proof of willingness to pay or a public-deployment check.

## Still open

- Public Vercel URL, optional provider credentials, deployed two-guest isolation and real provider behavior remain to be configured/checked. Guest manual input, calculations, local save and export work without these services.
- A public English deck of at most ten slides still needs to be assembled from the final deployed release; no placeholder deck has replaced user material.
- Current saved plans each model one opportunity. Several agreements, actual payments and actual SEP contributions need the additive round 3 workspace; do not present them as implemented.
- Current annual-profit inputs assume the user can supply a forecast. Round 3 will expose how that forecast was built and what has already been counted.
- The rule-upgrade path now acknowledges a saved revision when its event fails. Atomic revision/event writes or idempotent event recovery remain part of round 3 persistence work.

Next: [shared round 3 specification](../tasks/ROUND3_SHARED.md) and the three assignments linked there. Final integration remains a separate review, not three unchecked branch pushes.
