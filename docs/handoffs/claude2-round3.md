# Claude 2 — round 3 handoff (household engine)

**Subsequent integration correction:** the [combined review](integration-round3.md) resolves the adapter differences listed below and fixes SEP cash consumption. In the workflow example, free capacity after the $1,000 payment is **$402**, not $1,402. Current versions are engine 1.2.0 / household 1.0.1; the rest of this handoff records the branch as delivered.

Branch `claude2`: normal merge of `origin/main` (`6161510`), then of Claude 3's contract commit **`ecbdd18`** (`src/domain/household-workspace.ts`, fixture, contract test). Nothing reset or force-pushed; main untouched. The integrator's round 2 corrections (engine 1.1.1, AgreedPlan validation, 2025 Tax Table attribution) are kept — and I accept that correction: the downloaded Form 1040 instructions were the 2025 edition, not 2026 as my round 2 handoff said.

- Versions: v1 `ENGINE_VERSION` stays **`headroom-engine-1.1.1`**, rules **r3**, because no v1 result changed (round 2 parity is tested). The household layer is new code, labelled `headroom-household-1.0.0`; any future change of household results must ship with a new `ENGINE_VERSION`.
- v1 entry points (`assessCurrentRisk`, `calculateComparison`, `evaluateAgreedPlan`) unchanged. `assessCurrentRisk`'s body moved to `risk.ts` and shared helpers to `common.ts` (no behaviour change).

## Entry points (contract signatures, exported from `@/lib/engine`)

```ts
buildHouseholdProjection(ws: HouseholdWorkspace)            // ReadyHouseholdProjection & { sepBudget, profitSources } | BlockedComparison
evaluateHouseholdWorkspace(ws: HouseholdWorkspace)          // ReadyWorkspaceEvaluation & { fixedPlan: FixedPlanDetails } | BlockedComparison
compareWorkspaceOpportunity(ws: HouseholdWorkspace, id)     // ReadyWorkspaceComparison & { baselineProjection, warnings } | BlockedComparison
engineWorkspaceFingerprint(ws)                              // = contract workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION)
```

Results are the contract types plus extra fields (structural subtypes). Blocked results keep `needs_data` / `unsupported` with **workspace paths** (`forecasts[0].excludesManagedProjects`, `projects[0].receipts[0].actual`, `retirement.contributions[1]`, `household.years[0].otherIncomes[1].w2Box1`, …).

- **Projection**: per year/person `components` (annual total, YTD, remaining receipts/expenses, each project line with basis actual/expected and refs) and `total` = the derived Schedule C profit with signed range; `currentRisk` = v1 `CurrentRisk` on the derived facts; `profitSources` and `sepBudget` (set-aside, reserved unpaid goals, available).
- **Evaluation**: `agreed.result` is a `ScenarioResult` (id `agreed-plan`) = the open commitments (agreed lines not yet received + SEP still to pay) on top of **only what already happened**; its decisions are the agreed amounts/dates, never re-optimized. `stillFeasible`/`reasons` cover a SEP goal above the legal limit on the year's combined profit, paid SEP above the limit (no automatic change; correct with the provider), and unpaid goals above the set-aside money. `creditLostYears` = years where the open agreements push income over the credit limit. `sep[]` with `legalLimitCents`; `fixedPlan.years[]` with the full `YearResult` (trace starts with "where this year's profit comes from"), risk state, headroom; `notChecked` (e.g. no set-aside amount entered); `pendingYears` when 2027 facts are missing.
- **Comparison**: baseline = everything except the candidate's lines that have **not** happened; the candidate's received lines stay in the baseline; the v1 comparison (`compare`) runs on the candidate's open lines only, so SEP options are **additions** to the owner/year total and the new-SEP limit is `set-aside − unpaid agreed goals`. Editing an agreed project with several remaining payments treats the remaining amount as one offer on its first date (its agreed schedule is shown by the evaluation). A proposed offer with several payments gets decline + "accept on its schedule" only (options need one payment).

## Invariants implemented (`src/lib/engine/household/projection.ts`)

One forecast per owner/year (two → `FORECAST_CONFLICT`, never added); YTD + remaining receipts − remaining expenses, YTD expenses never subtracted again; ranges low = Σlow⁺ − Σhigh⁻; actual replaces expected; agreed lines count, proposed only when evaluated, cancelled expected lines never, received money always (also after cancellation); an agreed line expected on/before the YTD as-of date without an actual → `PAYMENT_STATUS_UNKNOWN`; SEP total = max(goal, paid), still to pay = max(0, goal − paid), lowering a goal never "refunds"; unknown is never zero (missing forecast for an adult → needs data; dependants without a forecast → $0, they cannot own the business here). All tax, SEHI/PTC, SEP-limit and rounding logic is the unchanged round 2 code run on the derived v1 input.

## Requested contract alignment (Claude 3) — engine follows ROUND3_SHARED here

1. `workspaceToCaseInput` puts a candidate's **already received** lines into the v1 opportunity, so the split/counteroffer optimizer could move or re-price received money. Engine: received lines stay in the baseline; only open lines are the offer (§2 "received payment cannot be moved").
2. Adapter `maxAdditionalSepCents = budget ?? 0` ignores unpaid agreed goals. Engine: `budget − Σ(goal − paid)` (§3 "reserved contributions reduce it"). Contract fixture: $3,500 − $3,000 = **$500**, not $3,500.
3. Adapter requires `excludesManagedProjects === true` only for non-proposed projects. Engine also requires it when only a proposed candidate has a line in that year (a forecast that already contains B would count B twice).
4. Engine also asks for the actual status of an agreed line expected before the YTD as-of date (adapter does not).
Fingerprint: identical formula to the follow-up `workspaceFingerprint` in `8ab1984` (verified against a verbatim copy); contract fixture = `22f1109c41f13d1e58920b3b0f0ecb26c6df80c34d17ea7667e6952444afd2d9` with engine 1.1.1 / r3.

## Verified examples (inputs → outputs)

| Case (tests/engine/household.test.ts unless noted) | Result |
| --- | --- |
| Contract fixture: YTD $88,000 + remaining $34,000 (29–39k) − $4,000 (3–6k) + A ($4,000 received, $3,000 expected) | 2026 profit **$125,000**, range **$118,000–$131,000**; B evaluated as +$12,000 on that baseline |
| Family $118,000 + proposed B $12,000 as a workspace | Every scenario, label and delta identical to v1 `calculateComparison(familyCase)` (split +$8,315) |
| A agreed $6,000 + B proposed $3,000 | Projection $124,000; B baseline $124,000; accept adds only B; declining B = plan with A; editing A → baseline $118,000 |
| A expected $12,000, actual $11,500 | $129,500, one component (actual) |
| A cancelled after $4,000 received, $8,000 expected | $122,000 |
| A $4,000 received + $8,000 open, re-negotiated | Baseline $122,000; every option moves/receives only $8,000 |
| YTD $80k (78–82k) + $30k (25–35k) − $5k (4–7k) | $105,000, low $96,000, high $113,000 |
| SEP goal $3,600, paid $2,000, set-aside $1,000 | still to pay $1,600 → infeasible; same payment twice → rejected; goal lowered to $1,000 with $2,500 paid → total $2,500, nothing refunded |
| Goal $15,000 with profit $60,000 | not allowed, year result null, legal limit reported, amount unchanged |
| Agreed split 8,093/3,907, base 118k → 121k | agreed plan `over_cliff`, `creditLostYears [2026]`, receipts unchanged; new option keeps the credit |
| Workflow (`workflow-scenario.test.ts`): A + B, $4,000 set-aside; then goal $3,598, $1,000 paid; base 121k | B options −$7,597 / SEP $3,598 +$1,201 / split +$4,155; $2,598 still to pay, $1,402 free; after correction: credit lost, extra SEP $2,789 infeasible, new split +$4,155 |

## Competitor comparison

`docs/research/competitor-workflow.md`: the same reproducible scenario run in MyTaxQuarter, ACAIndex and Bracketsight (headless Chromium, no signup); ProjectionLab from public docs only (paid); Business Cup 2.0 public repositories (HESTi, Case Desk, CASHOUT, Claro; one empty) and three Devpost projects from their READMEs/pages; assessment by the five weighted criteria, product and contest separately. Network for these hosts was added to my personal environment `headroom-official-sources`.

## Commands

`npx tsc --noEmit` ✓ · `npm test` ✓ 85 tests in 18 files (engine 48) · `npm run build` ✓.

## Limitations

- Single business owner; projects of another person are refused. No new taxes/states.
- Multi-payment **proposed** offers: no SEP/split/counteroffer search (exact schedule only).
- Ranges come from forecast facts; project amounts have no ranges.
- `currentRisk` and the fixed plan use the same guards: e.g. possible EITC still blocks take-home results.
- Contract differences 1–4 above remain until Claude 3 aligns the adapter; the UI should consume the engine results, not the adapter's derived opportunity.
- Competitor observations are single runs on one synthetic household; no CPA review of anything.
