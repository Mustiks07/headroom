# Round 3 integration review

Reviewed and integrated by Codex, November 15, 2026 (user timezone). This describes the current local production build; it is not a claim of verified public deployment.

## Included branches

Base: `6161510`. Combined merge: `9faaa5b`.

- Claude 1: `eb1b706` — result-first demo, household UI, annual/YTD intake, payments, SEP, income-change review, migration and exports. This branch already contained the following two heads.
- Claude 2: `f4636cb` — household aggregation, fixed agreements, comparison on top of existing projects, common SEP limits and competitor workflow.
- Claude 3: `c6f7b90` — workspace schema/repository, atomic revisions, migration, reviewed document facts, annual forecast PDF and cloud migration.

All three heads are ancestors of the combined release. Integration corrections are in the commit containing this review. Current versions: `headroom-engine-1.2.0`, `headroom-household-1.0.1`, `us-federal-aca-2026-2027.r3`. V1 financial formulas are unchanged by the integration corrections; the version change invalidates older calculation stamps affected by household behavior.

## What works together

The guest can enter annual profit or year-to-date plus remaining receipts/expenses, create a household workspace, evaluate a new offer on top of agreed projects, record actual payments, track SEP goals versus paid amounts, revise income, reopen the saved plan and download a sourced forecast explanation. No account or service key is needed for this local path.

The current forecast, evaluation of fixed agreements and new proposals are separate. Actual payments replace expected amounts, including after cancellation; retirement principal remains separate from spendable cash. The UI is English and supports a 360 px viewport.

## Corrections during combined review

1. **SEP cash did not decrease after a new contribution.** Merely decreasing the unpaid target created false new capacity. Added backwards-compatible snapshot inclusion IDs and shared cash helpers, wired into manual/document entries and both adapters. Example: $3,500 available against a $3,000 unpaid target leaves $500. Paying $1,500 leaves $2,000 available against $1,500 unpaid: still $500. Refreshing the balance does not subtract that payment again. Existing commitments over the available budget block another recommendation until reviewed.
2. **Shared adapter and engine disagreed about partial payments.** Already received candidate payments now stay in baseline; only unpaid lines become the opportunity. Actuals count for proposed/cancelled projects too. Exclusion confirmations, missing historical status, owner choice and reserved SEP capacity now follow the same semantics. Forecast PDF uses the same inclusion rules.
3. **UI could not apply new terms after a deposit.** Added review of an agreed project's remaining payments; acceptance preserves actual lines, replaces only unpaid receipts and does not duplicate an identical acceptance.
4. **Evidence needed updating.** Corrected the competitor workflow's remaining SEP capacity from $1,402 to $402 after the $1,000 payment. Removed an unsupported absence claim about untested paid competitor features. Updated README, current assignments and the synthetic forecast export to this release.

## Bounded verification

- Full suite after financial/integration changes: **98 tests across 21 files passed**. Typecheck and production build passed. After adding the exact competitor-budget assertion, that affected test passed again; the final wording change was checked with a fresh production build and targeted browser inspection.
- Production browser smoke: editable family comparison, retirement constraint, saved plan update/history, changed-income evaluation, missing spouse data, invalid draft retention, actual $3,200 replacing expected $3,000, SEP goal/paid/remaining, saved workspace reload and six routes at 360 px. No page errors.
- Additional browser journey: review unpaid terms while preserving a $4,000 deposit; accept; record $1,500 SEP; verify $500 remains after existing goals; reload; inspect household/demo desktop/mobile.
- Downloaded the real annual forecast PDF through the UI. Rendered and visually reviewed **all three pages**: figures/assumptions, project and SEP facts, calculation trace and page layout. The [committed synthetic export](../artifacts/round3/annual-income-forecast-explanation-synthetic.pdf) is from this build. It is an example export, not the contest pitch deck.
- Added three focused integration tests for adapter/PDF consistency, SEP cash and accepting unpaid terms after a deposit. No coverage target or repeated unchanged full-suite runs.

## Remaining limits and next work

- Public Vercel URL, live Supabase policies/migrations, real AI extraction and real checkout have **not** been verified in this review. Local success is not evidence that those services are configured. The contest deck/public submission still needs its own artifact review.
- Current tax scope remains TX/FL/TN, supported single/MFJ households and one Schedule C. There is no independent professional tax review or observed paid conversion.
- Exact multi-payment proposed offers currently get accept/decline; richer term search is next. Existing agreed remaining receipts can be regrouped by current comparison with its warning. No full bank-balance-by-date promise is made.
- Legacy SEP snapshots use an as-of day. A late-entered same-day payment already reflected in that balance should be followed by confirming a fresh balance; the app cannot infer the intraday order from a date alone.
- The source report's competitor observations are limited to the specific public workflows exercised. Screenshots/repository existence do not prove quality, official contest participation or paid demand.
- [Round 4](../tasks/ROUND4_SHARED.md) adds goals, feasible deal terms, dated cash and an action package. These are assignments, not shipped claims. Codex remains responsible for combined main integration.
