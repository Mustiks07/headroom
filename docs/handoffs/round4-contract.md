# Round 4 shared contract — deal planning v1.0

**Contract commit: `f99b5d3089379029d65bb178771281816d039834`** on `claude3` (based on `main` @ `743de9d`).
Claude 1 and Claude 2: `git fetch origin && git merge f99b5d3089379029d65bb178771281816d039834` (normal merge; it adds `src/domain/deal-planning.ts`, `src/fixtures/deal-planning.ts`, `tests/integration/deal-contract.test.ts` and one optional field + validation in `src/domain/household-workspace.ts`). Do not create another goal/result type; ask in your handoff and Claude 3 publishes a small follow-up commit.

Compatibility: v1 `CaseInput`/`SavedPlan` and workspace `2.0` are unchanged; `workspace.dealPlanning` is **optional**, so existing saves and JSON files stay valid. `canonicalWorkspaceContent` / `workspaceFingerprint` are unchanged (deal state has its own fingerprint). Money: integer cents. Dates: `YYYY-MM-DD`.

## Storage representation

`HouseholdWorkspace.dealPlanning?: DealPlanningState` — stored inside the workspace document, so goals, terms, cash context and packages are saved atomically with the revision and its event, restored by workspace JSON, and never dropped on restore (the schema knows the field).

```ts
DealPlanningState = { version: "1.0", goals: DealGoal[], termSpaces: DealTermsSpace[] /* one per project */, cashContext: CashContext | null, packages: ActionPackage[] }
```

Cross-checks in `HouseholdWorkspaceSchema`: goal/terms/package project ids exist; package goal exists; `cashContext.includedFactIds` are existing project line ids or SEP contribution ids; cash flow / snapshot sources are in `evidence`.

## Schemas (`src/domain/deal-planning.ts`)

| Export | Meaning |
| --- | --- |
| `DealGoalSchema` | `projectId`; `minimumTwoYearCashDeltaCents` (spendable cash after final settlement of 2026 + 2027 vs `baseline`, retirement excluded); `baseline: "decline_unpaid_terms" \| "accept_as_offered"`; `maxAdditionalSepCents` (null = limited by remaining SEP cash and law); `dateTargets[≤3]` |
| `DateTargetSchema` | `kind`: `project_receipts` (gross money from the project by the date), `project_available_cash` (project's contribution to available money by the date), `household_balance` (needs a complete cash context); `byDate`, `minimumCents` |
| `DealTermsSpaceSchema` | `price {minCents, maxCents, stepCents ≥ 100}` (asked, never assumed agreed; always bounded), `paymentWindows[1–4] {earliest, latest, maxShareBps}` summing to ≥ 100%, `maxPayments`, `newTermsConfirmed: boolean \| null`, `allowAdditionalSep` |
| `CashContextSchema` | `snapshot {date, balanceCents, sourceId} \| null`, `includedFactIds` (facts already in the balance — never added again), `flows[] {id, date, signed amountCents, kind, status confirmed\|expected, label, sourceId}`, `reserveCents`, `completeness {confirmed, from, through}` (confirmed requires a snapshot and an interval) |
| `DealVariantSchema` | `purpose` (simplest / most_cash / earliest_money / most_retirement / lowest_risk / as_offered), `terms {priceCents, payments[] (unpaid only), additionalSep \| null}`, `twoYearCashDeltaCents`, `retirementAddedCents` (separate), `datedFlows[] {date, amountCents, kind, basis fixed\|proposed\|estimated}`, `dateTargets[] {achievedCents, met}`, `aca[] {year, magiCents, ptcCents, creditLost}`, `constraints[] {id, satisfied, detail}`, `actions[] {id, title, dueDate \| null, dueCondition, kind, sourceIds}`, `differenceFromBestCents`, `verifiedExact` |
| `DealSearchResult` | `ReadyDealSearch` (`status: "ready"`, `variants[1–3]`, `recommendedVariantId`) \| `NoFeasibleTerms` (`status: "no_feasible_terms"`, `violated[]`, `relaxations[]` of exactly one constraint) \| v1 `BlockedComparison` (`needs_data` / `unsupported` / `unavailable`). Incomplete data ≠ no solution. |
| `DealSearchMeta` (in ready/no-feasible) | `goalId`, `projectId`, `workspaceFingerprint`, `searchFingerprint`, versions, `baseline {kind, label, description}`, `horizon {from, through, settlementThrough}`, `search {priceStepCents, paymentDateCandidates, sepStepCents, evaluated, exhaustiveWithinSpace, note}`, `cashCompleteness: project_only \| household_complete \| household_incomplete`, `simplerVariantThresholdCents`, `warnings` |
| `DecisionSensitivityResult` | ready: `items[] {factKind, path, currentCents, thresholdCents, direction, outcomeChange, checked: exact_threshold \| interval_checked \| condition}`, `firstChange`; or `BlockedComparison`. No confidence percentages. |
| `ActionPackageSchema` | `workspaceRevision` (informational), `searchFingerprint`, versions, `goalId`, `projectId`, `variant` snapshot, `clientDraft {subject, body, includesHouseholdDetails, generatedAt} \| null`, `reminders[] {uid (stable), actionId, title, date \| null, condition, sequence, status open\|done\|cancelled, sourceIds}`, `specialistNote`, `status: draft \| terms_shared_by_user \| client_agreed \| superseded` (only the user advances it; nothing is sent automatically) |

Helpers: `emptyDealPlanning()`, `dealSearchFingerprint(workspaceFp, goal, space, cash, engineVersion, rulesVersion)` (SHA-256 of key-sorted content; goal timestamps and record order ignored), `cashCompletenessFor(goal, cash)`, `isPackageCurrent(pkg, freshSearchFingerprint)`.

## Responsibilities

- **Claude 2** implements in `src/lib/engine` and exports from `@/lib/engine` the `DealPlanningEngine` signatures:
  ```ts
  searchDealTerms(ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): Promise<DealSearchResult>
  evaluateDecisionSensitivity(ws: HouseholdWorkspace, goal: DealGoal, variant: DealVariant, searchFingerprint: string): Promise<DecisionSensitivityResult>
  ```
  `workspaceFingerprint` = `engineWorkspaceFingerprint(ws)`; `searchFingerprint` = `dealSearchFingerprint(...)`. Received payments, recorded SEP, other projects and existing SEP goals are fixed; use the integrated `remainingSepCash` / `includedContributionIds`.
- **Claude 3**: persistence of `dealPlanning`, document → reviewed fact, client terms draft, `.ics` export, decision package PDF, routes and deployment. Exports read variant money only from the engine result (no recalculation in PDF/UI) and refuse stale fingerprints.
- **Claude 1**: goal/terms/cash forms, variants view, choosing terms, package/exports via Claude 3 hooks (listed in `docs/handoffs/claude3-round4.md`).

## Example

`dealWorkspaceFixture` (synthetic, inputs only): round 3 family + `dealGoalFixture` — B must leave ≥ $4,000 more cash than declining B after both years, ≥ $3,000 from B by 2027-01-10 (`project_receipts`), ≤ $1,000 extra SEP; `dealTermsFixture` — ask $12,000–$14,000 in $250 steps, up to 2 payments in Dec 2026 and/or Jan 2027 (each window may hold 100%), client open to new terms; `dealCashFixture` — project-only (no snapshot, completeness not confirmed).

Shape of a ready result (field illustration only — NOT an engine result; numbers come from Claude 2):

```json
{ "status": "ready", "goalId": "goal-b", "projectId": "proj-b", "searchFingerprint": "…", "cashCompleteness": "project_only",
  "baseline": { "kind": "decline_unpaid_terms", "label": "Your plan without project B", "description": "…" },
  "variants": [{ "id": "v1", "purpose": "simplest", "terms": { "priceCents": 0, "payments": [{ "id": "p1", "date": "2027-01-05", "amountCents": 0 }], "additionalSep": null },
    "twoYearCashDeltaCents": 0, "retirementAddedCents": 0, "datedFlows": [], "dateTargets": [{ "targetId": "t-jan10", "achievedCents": 0, "met": true, "explanation": "…" }],
    "aca": [], "constraints": [], "actions": [], "differenceFromBestCents": 0, "verifiedExact": true }],
  "recommendedVariantId": "v1" }
```
