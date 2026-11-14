# Round 3 shared contract — household workspace v2.0

**Contract commit: `ecbdd18fe060e81697b7dd2c88c5b3d628926eb2`** on `claude3` (based on `main` @ `6161510`).
Claude 1 and Claude 2: `git fetch origin && git merge ecbdd18fe060e81697b7dd2c88c5b3d628926eb2` (a normal merge; it touches only the three new files below). Do not define another workspace type; ask for changes in your handoff and Claude 3 publishes a small follow-up contract commit.

Files: `src/domain/household-workspace.ts` (schema, helpers, adapter, result types), `src/fixtures/workspace.ts` (synthetic fixture), `tests/integration/workspace-contract.test.ts` (6 checks: derivation, B on top of A, actual vs expected, cancellation, unconfirmed exclusion, rejection, order independence, real engine on adapter output).

V1 (`CaseInput`, `SavedPlan`, `/api/*`, engine entry points) is unchanged. `workspaceVersion: "2.0"` is independent of the calculation contract `1.0`.

## Data model (`HouseholdWorkspaceSchema`)

| Field | Meaning |
| --- | --- |
| `workspaceVersion: "2.0"`, `id`, `revision` (0 = unsaved draft), `createdAt`, `updatedAt` | Repository-managed identity and optimistic revision |
| `household` | `caseId`, title, `isSynthetic`, state, county, filing status, `people`, `years[2026, 2027]` with coverage/benchmark/scope and **`otherIncomes`** = v1 income facts **without** `scheduleCProfit` and `existingSepContribution` |
| `forecasts[]` | One per person/year. `method: "annual_total"` (`annualNetProfit`) **or** `"year_to_date_plus_remaining"` (`asOfDate`, `asOfConfirmed`, `ytdNetProfit`, `remainingReceipts`, `remainingExpenses`). All exclude managed projects; `excludesManagedProjects: boolean \| null` must be `true` before a ready result when that owner has non-proposed projects |
| `projects[]` | `id`, `title`, `ownerPersonId`, `status: proposed \| agreed \| cancelled`, timing confirmations, `terms` (split / renegotiate / latest next-year date), `receipts[]` and `expenses[]` lines, `agreedDecision` |
| line | `id` (unique across projects), `expected {amountCents,date} \| null`, `actual {amountCents,date,recordedAt,sourceId} \| null`, `cancelledAt`, `sourceId`, `corrections[]`. Actual **replaces** expected. A received line cannot be cancelled (correct it instead) |
| `retirement` | `targets[]` (one annual SEP goal per owner/year), `contributions[]` (actual payments: id, owner, `taxYear`, amount, `paidDate` ≤ Oct 15 of the next year, evidence), `futureContributionBudget {amountCents \| null, asOfDate, sourceId}` |
| `planning` | `objective`, `minimumDesiredCashGainCents` |
| `evidence[]` | v1 `EvidenceSchema`; every `sourceId` in forecasts, lines, contributions and budget must exist here |
| `events[]` | History **inside the document** (atomic with the revision). Stable `id`; `withEvent()` never adds the same id twice |
| `calculation` | Version stamp `{engineVersion, rulesVersion, fingerprint, evaluatedAt}` of the last shown result; numbers are always recomputed, never stored |
| `origin` | `{kind:"new"}` or `{kind:"migrated_v1", planId, planRevision, planFingerprint, engine/rules versions, source, migratedAt, unconfirmed[]}` |

## Helpers (pure, no tax math) — use these instead of re-implementing

- `forecastFacts(f)`, `forecastTotal(f)`, `combineFacts(parts, sourceId)`: unknown if any part unknown; confirmed only if all confirmed; ranges with correct signs (low = Σlow⁺ − Σhigh⁻).
- `effectiveLine(line)` → `{basis: actual|expected|cancelled, amountCents, date}`.
- `projectYearAmounts(project, year)`: agreed → actual/expected; cancelled → actual only; proposed → nothing.
- `sepPosition(ws, personId, year)` → `{targetCents, paidCents, remainingCents = max(0, target − paid)}`.
- `canonicalWorkspaceContent(ws)`: order-independent content for fingerprints (excludes events, timestamps, revision, stamps).
- `withEvent(ws, event)`: idempotent append.
- `workspaceToCaseInput(ws, {candidateProjectId?})` → `{input: CaseInput, missing[], notes[]}`. `scheduleCProfit` = forecast + non-proposed projects of that owner/year **except the candidate**; `existingSepContribution` = max(goal, paid); the candidate (or a zero "Current forecast (no new project)") becomes the v1 opportunity; `maxAdditionalSepCents` = future budget (null → 0 with a note). Empty `missing` is required before showing a ready result.

## Result types and responsibilities

Claude 2 implements, in `src/lib/engine` (export from `@/lib/engine`), the `HouseholdWorkspaceEngine` signatures:

```ts
buildHouseholdProjection(ws: HouseholdWorkspace): Promise<HouseholdProjectionResult>      // ReadyHouseholdProjection | BlockedComparison
evaluateHouseholdWorkspace(ws: HouseholdWorkspace): Promise<WorkspaceEvaluationResult>    // ReadyWorkspaceEvaluation | BlockedComparison
compareWorkspaceOpportunity(ws: HouseholdWorkspace, candidateProjectId: string): Promise<WorkspaceComparisonResult>
```

- Projection: per year/person `components` (annual total, YTD, remaining receipts/expenses, project receipts/expenses with basis) and `total` equal to the adapter's derived profit; `currentRisk` (v1 `CurrentRisk`); `fingerprint` = SHA-256(canonicalWorkspaceContent + engine + rules).
- Evaluation: fixed agreements on current facts (not re-optimized), `sep[]` (goal / paid / remaining / legal limit on combined profit), `futureContributionBudgetRemainingCents`.
- Comparison: only the candidate changes; `baseline.label` always shown; `comparison` is a v1 `ReadyComparison`.
- Blocked results keep `needs_data` / `unsupported` / `unavailable` with contract paths (`forecasts[i].…`, `projects[i].…`).
- Claude 2 may use `workspaceToCaseInput` inside these functions or supersede it with identical semantics; please report any semantic change so the contract is updated, not forked.

Claude 3 (next commits on `claude3`): workspace repository (local + optional cloud, atomic revision+event, revisions), v1 → v2 migration preview/confirm, workspace JSON export/restore, idempotent document facts, **Annual income forecast explanation** PDF and its route. Hooks for Claude 1 will be listed in `docs/handoffs/claude3-round3.md`.

Claude 1: screens/forms on this schema; no persistence or tax logic in the UI.

## Example

`workspaceFixture` (synthetic): primary 2026 forecast = YTD $88,000 (confirmed, as of 2026-09-30) + remaining receipts $34,000 (range $29,000–$39,000) − remaining expenses $4,000 (range $3,000–$6,000); agreed project A: $4,000 deposit received 2026-10-17 + $3,000 expected 2026-12-15; proposed project B: $12,000 expected 2026-12-20; SEP 2026 goal $5,000, $2,000 paid 2026-10-20; future-contribution budget $3,500.
Derived 2026 Schedule C profit (baseline, B excluded): **$125,000**, estimated, range **$118,000–$131,000**; existing SEP for the engine: $5,000 (estimated); B as candidate: opportunity $12,000 on 2026-12-20 on top of that baseline.
