# Claude 2 — round 4 handoff: deal-term search for a family goal

Branch `claude2`. Merged `origin/main` normally at the start and again before the push (latest: `1c9157a`). The integrator's round 3 fixes (SEP cash = set-aside minus unpaid agreed SEP minus contributions after the snapshot; actual payments) are kept and used by the search; `tests/engine/workflow-scenario.test.ts` still asserts the corrected $402.

## Contract

Implemented Claude 3's `DealPlanningEngine` (`src/domain/deal-planning.ts`) from these commits, taken as they are (no shared-contract edits by Claude 2):

- `f99b5d3` — deal planning contract v1.0 (additive to workspace v2.0)
- `7c6219d` — additive workspace event kinds
- `7884b1a` — `priceCents` is the TOTAL asked price; payments cover only the unpaid remainder

## Exports (`@/lib/engine`)

```ts
searchDealTerms(ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): Promise<DealSearchResult>
evaluateDecisionSensitivity(ws: HouseholdWorkspace, goal: DealGoal, variant: DealVariant, searchFingerprint: string): Promise<DecisionSensitivityResult>
DEAL_SEARCH_VERSION = "headroom-deal-1.0.0"          // label of the search layer
type EngineDealVariant = DealVariant & { scenario: ScenarioResult }  // returned variants also carry the exact v1 scenario
candidateContext(ws, projectId), type CandidateContext // shared preparation now used by compareWorkspaceOpportunity and the search
```

`DealSearchResult` = `ready` (1–3 variants + `recommendedVariantId`) | `no_feasible_terms` (`violated` + `relaxations`) | blocked (`needs_data`/`unsupported`). Blocked codes added by the search: `INVALID_DEAL_INPUT` (paths `dealPlanning.goal|terms|cash.…`), `DEAL_PROJECT_MISMATCH`, `AGREED_SEP_BUDGET_SHORTFALL`, `OFFER_NOT_CALCULABLE` (baseline "as offered" outside the supported range), `STALE_VARIANT` (sensitivity: terms no longer match recorded receipts). Workspace/model blocks are passed through with workspace paths.

Versions: `ENGINE_VERSION` stays `headroom-engine-1.2.0` — v1 `calculateComparison`, household evaluation and comparison outputs are unchanged (all earlier tests pass unchanged); the new behaviour is a new function, labelled by `DEAL_SEARCH_VERSION`. Fingerprints use `ENGINE_VERSION` + `RULES_VERSION` (`us-federal-aca-2026-2027.r3`) as the contract prescribes. Household layer `headroom-household-1.0.1`.

## What is searched (and how exactly)

One project's **unpaid** terms on top of every other commitment (other agreed projects, this project's received money, recorded and agreed SEP). Received lines are fixed facts: `Σ payments = priceCents − received`.

| Dimension | Search |
| --- | --- |
| Total asked price | every `price.stepCents` from min to max; above 60 points a coarser lattice of whole steps, then the simplest option is refined back to `stepCents` (`search.priceStepCents` reports the lattice actually used) |
| Schedule | the remainder split between 2026 and 2027 on a lattice (≤ 60 points, ≥ $50); within one tax year money goes to the earliest window first (tax depends only on the year; earlier is never worse for dated goals); each window's `maxShareBps` and `maxPayments` respected; a window crossing Jan 1 becomes `<id>-2026` / `<id>-2027`; 2027 payments only with `timingArrangementConfirmed` (constructive receipt) |
| Additional SEP | in ONE tax year: {0, the smallest amount that restores that year's credit (exact bisection on whole dollars), the most allowed}. Cap = min(goal `maxAdditionalSepCents`, SEP cash left after agreed goals and recorded payments); the legal limit is checked by the year engine on the year's whole profit |
| Fixed terms | when `newTermsConfirmed !== true` only the offer as it stands (+ SEP options) is evaluated; `exhaustiveWithinSpace: true` |

Each lattice point is an exact `evaluateYear` call (memoised by year/receipts/SEP). Chosen options are refined (most cash: split ±1 lattice step every $5, then every $1; simplest: lower price at `stepCents`) and then **re-run through the existing comparison path** (`run` → `scenarioFromPlan`), and every constraint is re-checked on that exact result; an option that fails is dropped with a warning. `verifiedExact` is therefore always `true` for returned variants. Not claimed: a global optimum between lattice points outside the refinement window, or gains from SEP amounts other than the three options. Typical run on the example: 2,304 exact year evaluations, 50–120 ms.

Purposes and choice: `simplest` (or `as_offered`) = lexicographically fewest changes (offer unchanged, fewer payments, no 2027 payment, no SEP, lower price); `most_cash`; then one of `earliest_money` / `most_retirement` / `lowest_risk` (largest distance to a credit limit among the 20 best) if it differs. Duplicates are removed. **Materiality**: `simplerVariantThresholdCents = max($100, 1% of the offered total)`; the simplest option is recommended if it is within that amount of the best, otherwise most cash. Baseline `accept_as_offered` = the same calculation shifted by the offer's cash (so "as offered" shows exactly $0).

## Dated money

`datedFlows` per variant: fixed received money, proposed payments, project expenses, extra SEP (at the return due date) and **this project's tax and credit settlement per year at the return due date** (`tax_settlement`, negative = paid). Identity tested on every variant: Σ non-fixed flows = `twoYearCashDeltaCents`.

Date targets:

- `project_receipts` — received facts + scheduled payments by the date (gross money, said so in the text).
- `project_available_cash` — scheduled payments − project expenses − extra SEP paid − a **pro-rata reserve** of the year's settlement as its money arrives. On the due date the reserve becomes the settlement, so it is never deducted twice. The reserve is a planning amount, not an estimated-tax (Form 1040-ES) calculation.
- `household_balance` — only when `cashCompletenessFor(goal, cash) === "household_complete"` and the date is between the snapshot and `completeness.through`; otherwise `achievedCents: null, met: null` with an explanation, and the project figures still apply. Balance = snapshot + listed flows after it + actual project lines/SEP contributions after the snapshot and not in `includedFactIds` + expected lines of agreed projects + this variant's payments − its expenses − extra SEP − unpaid agreed SEP at its due date − project reserve − `reserveCents`. `flows` must not repeat project lines or SEP (they are added from the workspace); other taxes count only if the user lists them.

## Infeasible goals

`violated` names the constraint (minimum cash with the best achievable amount; each date target with the best achievable figure; or "each goal alone is possible, not together"). `relaxations`, each changing ONE constraint with all others kept: `minimum_cash` (best possible), `date_target` (earliest later date, among dates where money moves, that reaches it with the cash goal kept), `price_max` (searched above the maximum at the same step, up to max + max(range, offer, $20,000); presented as "a target to discuss, not a price the client accepted"), `additional_sep` (amount above the current cap; states that it needs that cash and is retirement money). The test re-runs the search with the returned price and one step below it.

## Sensitivity (`evaluateDecisionSensitivity`)

No probabilities. Items: `credit-YYYY` exact threshold of other profit at which the year's credit is lost under the variant (`exact_threshold`, whole-dollar search of the year engine); `goal-2026-profit` first extra 2026 profit (in the option and its baseline alike) that breaks the cash goal, checked every $250 up to +$25,000 and at both credit limits (`interval_checked`); `december-payment` the effect of a December payment arriving on the first business day of 2027; `extra-sep` what happens if the extra SEP is not paid; every estimated or ranged forecast fact; declared ranges via the existing stress check. `firstChange` = the nearest numeric threshold. Tested on both sides of the threshold with `evaluateHouseholdWorkspace` after writing the terms in as agreed.

## Example input → output (`tests/engine/deal.test.ts`, fixture `tests/engine/deal-fixture.ts`)

Input: TN MFJ family of the demos; base profit $112,000 (2026) / $118,000 (2027) excl. projects; A agreed: $3,000 received 2026-10-02 + $3,000 expected 2026-12-01; B offered $12,000 on 2026-12-20; 2026 SEP goal $1,000, $2,500 set aside. Goal for B: ≥ +$4,000 vs declining B, ≥ $10,000 from B by 2027-01-10, ≤ $1,000 extra SEP. Terms: $12,000–$15,000 step $250; windows 2026-12-15…31 and 2027-01-04…10; ≤ 2 payments.

| Variant | Terms | Two-year cash | Notes |
| --- | --- | --- | --- |
| simplest | $12,000 on 2027-01-04, extra 2027 SEP $33 | +$8,268 | 2027 credit $16,621 kept; first sensitivity: $1 more 2027 profit loses it |
| most_cash (recommended) | $15,000: $9,002 on 2026-12-15 + $5,998 on 2027-01-04 | +$10,390 | settlements −$2,760 (2027-04-15), −$1,850 (2028-04-18) |
| most_retirement | $15,000: $10,250 + $4,750, extra 2026 SEP $1,000 | +$9,571 | + $1,000 retirement |

Other checked outputs: goal "$5,000 project cash by 2026-12-31" → simplest becomes $8,800 Dec / $3,200 Jan; goal +$12,000 with max price $13,000 → `no_feasible_terms`, best +$9,006, price relaxation $17,500; terms not confirmed → only the offer (−$3,616), extra SEP $2,598 would be needed.

## Tests (bounded)

`tests/engine/deal.test.ts` (12): contract invariants for every returned option (constraints, Σ payments, windows, price bounds, dated-flow identity, difference from best); independent cross-check — each variant written into the workspace as agreed terms and evaluated by `evaluateHouseholdWorkspace` gives the same MAGI, credit and two-year cash; different date targets → different terms; three parameterized profit/step combinations; unreachable goal with a working price relaxation; offer-only and `accept_as_offered`; incomplete cash (null snapshot, completeness ending before the date); hand layout of one household balance; snapshot facts counted once; SEP paid after the snapshot counted once and no extra SEP cash created; agreed project A searched with its deposit fixed and the workspace unchanged; sensitivity threshold on both sides; stale variant; the shared contract fixture.

Checks run: `npx tsc --noEmit` clean; `npx vitest run` 23 files / 115 tests pass; `npm run build` passes (no lint script in the project).

## Limits

- Single project per search; other projects are fixed as recorded. Two 2026/2027 tax years only; supported family/rule range of the existing engine (out-of-range points are skipped, the exact re-check drops failing options).
- Lattice search with local refinement — not a proof of global optimality; SEP limited to three options in one year.
- Within one tax year earlier windows are filled first, so a "later in December" option is never proposed (no tax difference); if a client prefers a specific date the user narrows the window.
- The project reserve and household balance are planning amounts: no quarterly estimated-tax or penalty calculation, no withholding; unpaid agreed SEP is placed on the return due date (paying earlier lowers the balance sooner).
- `paymentDateCandidates` counts window slots (earliest allowed date per window per year), not every calendar day.
- Not a CPA review; asked prices are proposals until the client confirms in writing.
