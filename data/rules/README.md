# Versioned rule packs

Owner: Claude 2. Rule set id: **`us-federal-aca-2026-2027.r1`** (see `src/lib/engine/rules.ts`).

| File | Content |
| --- | --- |
| `us-federal-2026.json` | 2026 tax/ACA parameters. Applicable figure from the transcribed **DRAFT** 2026 Form 8962 Table 2 (`data/reference/2026-8962-table2.json`). |
| `us-federal-2027.json` | 2027 parameters. Table 2 is not published; the figure is interpolated from Rev. Proc. 2026-26 bands with the method that reproduces all 301 2026 entries (checked in `tests/engine`). |
| `sources.json` | Source ids referenced by packs, traces and actions, with status (final / DRAFT / derived / engine policy). |

Rules:

- Dollar parameters are stored as whole dollars, rates as decimal strings. The engine converts them to exact rational integer-cent arithmetic; nothing is evaluated in binary floating point.
- Packs only contain what the supported range needs. Brackets stop at 24%: the support limit on taxable income before QBI (the conservative 2026 QBI threshold) keeps both years inside it. Values that are not transcribed (e.g. the 2027 refundable CTC amount) are `null`; the engine refuses any case that would need them.
- `eitcSupportBoundDollars` is a refusal boundary, not an EITC computation: returns with AGI and earned income below it (by number of dependents, capped at 3) are `unsupported`.
- Nothing is fetched during a calculation. A result is reproducible from its stored input + `engineVersion` + `rulesVersion`.
- Changing any value requires a new `packVersion` and rules-set id so old fingerprints stay meaningful.
