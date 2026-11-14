# Bounded verification and release acceptance

The user explicitly does not want endless tests. This is a finite check list, not an invitation to add arbitrary coverage or repeatedly rerun green suites. Run checks affected by a change. One full run after integration; repeat only the checks affected by a subsequent fix.

## Foundation checks

`npm run typecheck`, `npm test`, `npm run build`. The initial two tests check shared fixture compatibility and unknown ≠ zero. They do **not** certify a financial engine, database or finished product.

## Financial regression groups — Claude 2

1. Official FPL/applicable-table boundaries: 100/133/175/400/above-400; one comparison against the supplied 301-entry table, not 301 separately authored tests.
2. SEHI/PTC inequality counterexample, and a justified choice across discontinuities.
3. Each spouse's Social Security cap, plus correct cash inclusion and SEP limit consequences.
4. Negative/excess/existing SEP contributions, and contribution within legal but outside user cash budget.
5. Independent family scenario: both years, explicit baseline, correct cash/retirement split and no duplicate APTC repayment.
6. Receipt/expense timing and two-year comparison; a moved receipt cannot silently move an expense or hide next-year credit loss.
7. Missing spouse facts and unsupported coverage/tax situations return a structured block; current-year risk does not require known next-year income.
8. Uncertainty crossing an internal boundary and an ordinary positive project with no special intervention.

Keep these groups small and meaningful. Add a regression when an actual failure is found. No coverage-percentage target or tests that simply mirror private helper implementation.

## Integration checks — Claude 3

- One local persistence round trip: save, reload, update revision, reopen, clear.
- When Supabase is configured: two independent sessions cannot access each other's plans/events/source metadata, including by guessed ID. Verify both policies and the API owner handling once.
- Missing AI/cloud configuration returns truthful capability/error states and preserves manual/local use. One real extraction with provider configuration and one failed/unsupported import recovery.
- PDF and JSON exports contain the current calculation fingerprint, chosen action, both years and correct cash/retirement labels. Stale results cannot be exported as current.
- Test/demo checkout is marked and not counted as a live payment. No secrets or user documents in tracked files or client bundle.

## Three actual user journeys — integrated build

1. **Family:** open guest demo → change an input → calculate → constrain pension amount → compare permitted split payment → choose → save → export → refresh → report changed income → see revised plan.
2. **Ordinary:** complete a supported case where the new project improves cash without requiring a special intervention; edit to own values. No fabricated loss or compulsory upsell.
3. **Missing data:** spouse income unknown → see exactly what is missing → enter/confirm it → result changes → inspect a source. Also open current-risk assessment with no project and unknown next-year forecast.

One automated browser smoke path may cover the first journey; perform the other two deliberately on the release build. Do not write a large brittle E2E suite for every animation or text label. Test values must alter the real engine result.

## Judge-facing artifact check

Before publishing the final release, inspect what judges actually open:

- Public URL works in a clean browser without login, platform protection or real payment; mobile layout usable.
- No `ENGINE_NOT_IMPLEMENTED`, fake cloud saves, seeded-output-only calculator or dead primary buttons in release flow.
- All UI/errors/generated reports in English. Synthetic data and county-candidate limitations remain visible.
- PDF deck ≤10 slides, readable, no broken screenshots, and numbers/limitations match the deployed commit and rule version.
- Public GitHub README links to the actual app/deck, explains running the code and the actual supported cases. No invented customer/accuracy claims.

Record the deployed commit, checked URL, short check result and any limitation in the final handoff. Do not rerun every test solely to generate a longer report.
