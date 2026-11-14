# Versioned rule packs

Owner: Claude 2. Rule set id: **`us-federal-aca-2026-2027.r3`** (engine `headroom-engine-1.1.0`) (see `src/lib/engine/rules.ts`).

| File | Content |
| --- | --- |
| `us-federal-2026.json` | 2026 tax/ACA parameters. Applicable figure from the transcribed **DRAFT** 2026 Form 8962 Table 2 (`data/reference/2026-8962-table2.json`). |
| `us-federal-2027.json` | 2027 parameters. Table 2 is not published; the figure is interpolated from Rev. Proc. 2026-26 bands with the method that reproduces all 301 2026 entries (checked in `tests/engine`). |
| `sources.json` | Source ids referenced by packs, traces and actions, with status (final / DRAFT / derived / engine policy). |

Rules:

- Dollar parameters are stored as whole dollars, rates as decimal strings. The engine converts them to exact rational integer-cent arithmetic; nothing is evaluated in binary floating point.
- From r3 the return is prepared in whole dollars (Form 1040 "Rounding Off to Whole Dollars"; Form 8962 accepts dollars only). Actual cash flows (pay, withholding, premiums, APTC) stay in cents.
- Packs only contain what the supported range needs. Brackets stop at 24%: the support limit on taxable income before QBI (each year's official QBI threshold) keeps both years inside it. Values that are not transcribed are `null`; the engine refuses any case that would need them.
- `eitcSupportBoundDollars` holds the official EITC completed-phaseout amounts. It is a refusal boundary, not an EITC computation: returns whose AGI and earned income are both below it (by number of dependents, capped at 3) are `unsupported`.
- Every value and its check date are listed in `sources.json`; primary PDFs and hashes are in `data/reference/source-manifest.json`.
- Nothing is fetched during a calculation. A result is reproducible from its stored input + `engineVersion` + `rulesVersion`.
- Changing any value requires a new `packVersion` and rules-set id so old fingerprints stay meaningful.
