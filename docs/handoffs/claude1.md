# Claude 1 handoff — UI and user journey

Status: **UI implemented on `claude1`, waiting on the real engine (Claude 2) and storage/extraction/PDF/capabilities (Claude 3).** Every financial number the UI shows comes from `assessCurrentRisk` / `calculateComparison` results. No fixture outputs, no second formula. On this branch the foundation stubs are still in place, so the public flow truthfully shows "calculation isn't available" and "saving isn't available" states.

## Routes

| Route | What it does |
| --- | --- |
| `/` | Hero ("Plan your income. Protect your health-insurance subsidy."), CTAs **Check my subsidy** / **Try a sample household** / **Check a new project**, how it works, 3 sample cards (described from input facts only), supported scope, $99 teaser |
| `/check` (`?start=project`) | Own-data workspace. Blank profile = all unknown. Draft autosaves in `localStorage` (`headroom.check.draft.v1`); restores after refresh |
| `/demo` / `/demo?case=<id>` | Picker, or an editable workspace seeded from `getDemoCase`. Clearly labeled synthetic. Auto-runs risk + comparison, so a result appears without typing |
| `/plan/[id]` | Saved plan: figures of the chosen option, checklist with dated actions + confirm-to-complete, **Something changed** (income / spouse income / project or payment / coverage → recalc → input diff + before/after + reselect option → save revision + `PlanEvent`), history, PDF/JSON export, delete plan, Clear my data, optional client note draft (never sent) |
| `/plans` | Saved plan list, delete, **Restore from JSON** (validates `CaseInputSchema`, recalculates with the engine, saves as a new plan; falls back to "Open in the calculator"), Clear my data |
| `/pricing` | $99 / year per household. **"Demo checkout. No payment will be collected."** No card fields; flag kept in `localStorage` only |
| `/privacy`, `/terms`, 404 | Plain English |

No login, signup, email or payment gate anywhere.

## Workspace behavior

- Steps: **1 Your household** (document import, household basics, 2026 income per adult, 2026 coverage, scope checklist, **Check my subsidy**) → **2 Compare options** (project, limits, 2027 facts, **Compare options**) → **3 Your plan**. A sticky household summary and a mini risk status stay on the side (above content on mobile).
- `src/features/household/draft.ts`: a UI draft that mirrors `CaseInput` but allows unanswered state/filing status/ages. `buildCaseInput()` only enforces what the contract needs to be well-formed; eligibility and missing facts are left to the engine's `needs_data`/`unsupported`.
- Money facts (`MoneyField`): clearing a box makes the fact `unknown`/`null`; zero only through explicit "None" / "No W-2 wages" / "No interest". Estimate/Confirmed selector, an optional declared range, and a source chip. Any edit switches `sourceId` to `manual-entry` (added to `evidence`).
- Spouse appears automatically with MFJ; income rows/taxFamilySize stay aligned to people; covered people are chosen separately.
- 2027 is only asked for in the Compare step. Copying 2026 → 2027 is an explicit button, and the copies are marked as estimates.
- The current-risk check sends a zero opportunity titled "Current forecast (no new project)" (allowed by TZ 3.1). It never needs 2027.
- Any edit marks results stale immediately: a banner appears, the explanation is hidden and "Show the calculation" is disabled. They recalculate automatically about 450 ms after typing stops. Limits controls (SEP max, minimum gain, split payment + latest date, renegotiation, objective) re-run `calculateComparison`.
- `needs_data` / `unsupported` fields are listed with human labels (`describePath`) and an **Add this** button that switches step, scrolls and focuses the field. `unsupported` offers a JSON download of the entered data. `unavailable` shows the engine's message and code. Thrown errors show a retry, and the form is kept.
- Comparison: cards in engine order (no UI ranking). The recommended badge only appears on `recommendedScenarioId` when that option is feasible, and infeasible options show their reasons. The baseline is always labeled, with a switch between the engine baseline and "Accept as offered". The rebase is a subtraction of two engine deltas. Retirement is always a separate metric. The details panel has a waterfall built only from differences of engine fields, with any remainder shown as "Other effects in the calculation" (never hidden), a 2026/2027 table with deltas, actions, assumptions, and a settlement-timing note.
- Calculation drawer (dialog, Esc closes, focus returns): trace items → input paths (with value/status/source from the exact input that produced the result) → evidence or rule IDs, plus engine/rules version and fingerprint.
- Document import: 3 MB client limit. `unavailable` → "Document analysis is unavailable. Enter the figures manually." `review_required` → per-field excerpt/page/tax year, a year-mismatch warning, and **Use this figure** / **Skip**. Nothing applies automatically.

## Contract use / proposals for Claude 3 (no shared contract changed)

1. **Saving:** `saveNewPlan` calls `repo.save({...plan, revision: 0}, null)` and treats the returned plan as authoritative. Updates call `repo.save(plan, plan.revision)` and expect the repository to increment. A thrown error with `409`/`conflict`/`revision` in its message is shown as a conflict message.
2. **Storage label:** UI reads an optional `storageMode(): "local" | "cloud"` on the repository object if present (proposed additive helper), else `GET /api/capabilities` → `cloudSave`. With neither, it says only "Saved." (never claims cloud).
3. **Extraction:** for money paths, `proposedValue` should be **integer cents** (or a `MoneyFact`). Paths use contract dot paths (`years.0.incomes.1.w2Box1`; `[n]` also accepted). `evidence.id` becomes the fact's `sourceId`.
4. **Engine paths in `fields`/`inputPaths`:** dot or bracket paths into `CaseInput`. Coverage paths like `years.0.coverage.5.enrollmentPremium` map to the "same every month" field.
5. **Scope checklist** writes IDs into `unsupportedFacts` on both years and sets `scopeConfirmed` (true only on explicit "None of these apply"): `multiple_businesses, s_corp_or_partnership, business_employees, business_loss, itemized_deductions, investment_income, other_credits, other_coverage, mid_year_change, dependent_of_another`. Claude 2: any non-empty list should yield `unsupported`.
6. **Checkout:** UI-only demo flow. If Claude 3 wants `/api/checkout` (Stripe test mode), wire it inside `src/features/pricing/DemoCheckout.tsx`.
7. **JSON file format:** `{ kind: "headroom.saved-plan", contractVersion, exportedAt, plan: SavedPlan }`. Import also accepts a bare `SavedPlan` or `{ kind: "headroom.case-input", input }`. Stored numbers are never trusted.

## Checks actually run

- `npm run typecheck` ✔, `npm test` ✔ (2 foundation tests), `npm run build` ✔ (on the committed stub state).
- `tests/ui/smoke.cjs` (Playwright, `BASE_URL=… node tests/ui/smoke.cjs`) against `next start` with stubs: ✔. This covers the landing CTA, no login copy, all 3 demos reaching a result/state, missing-field focus, and no horizontal scroll at 360 px on 5 routes.
- **Ready-path journey verified once with temporary local fakes** (an engine returning `ReadyComparison`/`needs_data` and a localStorage repo; **not committed**, stubs restored before commit). The journey: family demo → results → uncheck split payment → stale banner → recalculated recommendation; baseline switch; drawer opens/focuses/Esc closes; Use this plan → `/plan/id`; confirm an action; Something changed → profit edit → outdated banner → recalc → diff "Business profit $118,000 → $125,000" → save → history shows both events → JSON download → reload keeps revision 3 → restore JSON from `/plans` → new plan; missing-spouse demo → needs_data list → Add this focuses `f-years-0-incomes-1-w2Box1` → document review applies $45,000 as confirmed; 360 px compare without horizontal scroll; no page errors.

## Remaining / after integration

- Re-run the ACCEPTANCE three journeys on the integrated build with the real engine. Finding headlines and the waterfall remainder should then be read against real numbers. If the engine's `spendableAfterSettlementCents` reconciles exactly, the "Other effects" row disappears by itself.
- Confirm Claude 3's repository revision semantics match item 1 above, and that `exportPlanPdf` rejects stale plans as needed. The UI disables export while a change is pending.
- Real UI screenshots for the deck should be taken from the integrated deployment, not from this branch.
