# Claude 1 — round 2 handoff

Branch `claude1`, merged from `origin/main` (`d6590ac`) with a normal merge. No reset or force push. UI files only. No changes to the engine, server, migrations or shared contracts. No new dependencies.

## What changed

**1. Sample households start with the result** (`Workspace.tsx`, `DecisionOverview` in `ComparisonView.tsx`, `QuickInputs.tsx`)
- The first screen shows three tiles: **Your subsidy now** (risk state, income for the subsidy against the household limit, current credit), **If you accept as offered** (cash change against not taking it, the year the credit drops and how far, advance credit to repay and the filing year), and **Best option found within your limits** (option, cash change against not taking it *and* against accepting as offered, retirement shown separately, next two dated steps, Use this plan / Show the calculation).
- Next to the tiles is a short **Try changing** panel: price, payment date, owner's 2026 profit, retirement maximum, split payment plus latest date, negotiation. Every edit recalculates with the real engine. The full form opens only after **Edit everything**.
- Notes about the input data (synthetic data, county-candidate or illustrative benchmark) sit right under the result. All other warnings and assumptions are in a collapsed **All conditions and calculation notes (N)**.
- While loading, a skeleton is shown. `needs_data`/`unsupported` show the engine's own blocked state with **Add this** links, which open the full form and focus the field. If the comparison is blocked but the current-year check is ready, the risk card is shown as well.

**2. Own data is entered step by step** (`/check`)
- Steps are now *This year → A new project → Your plan*. The household is four collapsible sections (household, 2026 income, 2026 coverage, situations not covered), each with **Continue** and a one-line summary when closed. Sections stay mounted while closed, so typed text and "Add this" links keep working.
- Document import moved into a disclosure inside the income section.
- Hints now say where to find each number (profit, premium, benchmark, advance credit).
- The draft is validated against `CaseInputSchema` (`restoreDraft`) before restoring. A corrupt draft is discarded with a notice, never half-restored. The form renders only after the restore, so inputs start from the restored values.
- Unknown stays unknown. No zero is filled in for a spouse, and eligibility is never confirmed on the user's behalf (unchanged).

**3. Invalid money blocks calculation** (`MoneyField`, `invalidInputs.tsx`, `draft.ts`)
- Invalid text is no longer just a local error that leaves the old fact in the calculation. It is recorded in `draft.ui.invalid` (UI-only, stripped before `CaseInput`). This counts as an edit: results go stale at once.
- `buildCaseInput` refuses to calculate while any entry is invalid, so Use this plan, Recalculate and Save on the plan page stay unavailable. The list "Fix these amounts" links to each field.
- Empty means unknown; `0` and "None" mean a known zero. For required plain amounts (costs, retirement maximum, minimum gain, the quick price) an empty box is an error, not zero.
- Range low/high are validated (both ends needed, ordered, the estimate inside the range). A value typed outside an existing range is flagged instead of silently dropping the range.
- Invalid entries are kept in the browser draft and restored after a refresh.
- Markers are pruned when their field disappears (spouse removed, "No W-2 wages", switching back to the same amount every month).

**4. Clearer comparison**
- Each card shows **Compared with not taking it** and **Compared with accepting as offered** separately. The baseline toggle is gone. Retirement savings appear as a separate block, "Not counted in the cash above".
- Payments read plainly: "You receive $8,081 on Dec 20, 2026 and $3,919 on Jan 4, 2027." ISO dates in engine text are shown as readable dates (wording only).
- Unavailable options show **Why it isn't available** with the engine's reasons and have no Use button.
- "Best" is labelled **Best found within your limits**. Where the engine states a bounded search, the overview says so, e.g. "within about $26 of the exact best".
- On the plan page, "Compare all options again" marks the current option and offers **Switch my plan to this**.

**5. Drawer and accessibility**
- The calculation drawer traps Tab/Shift+Tab, closes on Esc and returns focus to the button that opened it.
- Engine paths like `years[0].coverage[*].enrollmentPremium` are expanded into real monthly inputs: one value "every month", or a per-month list if they differ. No unresolved path is shown.
- Rule sources and their DRAFT status from `src/domain/sources.ts` are kept.
- `needs_data` reasons drop the engine's internal prefix ("spouse: w2Box1 is unknown…"). The label already names the field in plain English.

**6. Reproducible real-path check** (`tests/ui/smoke.cjs`)
- Starts `next start` on a free port itself (or uses `BASE_URL`), uses the real engine and the browser-local repository, and **fails** if the family demo isn't `ready`.
- Covers: price $12,000 → $13,000 changes the amount; invalid price blocks saving; SEP limit $2,000 → an unavailable option with its reason and no Use button; save → refresh → revision 1 → Something changed → profit $121,000 → difference → revision 2 with history; missing-spouse facts; the invalid draft survives a refresh; five routes at 360 px; no page errors.
- If Playwright is missing it exits with code 2 and an install hint. **Claude 3:** please consider `playwright` as a devDependency plus `"check:ui": "node tests/ui/smoke.cjs"`. I didn't change `package.json` (integration owner).

## Checks run (final code)

- `npm run typecheck` ✔ · `npm test` ✔ (9 files, 45 tests) · `npm run build` ✔
- `node tests/ui/smoke.cjs` against the production build: **17/17 ok** (output above in item 6).
- Manual look on desktop and 360 px: family, ordinary and missing-spouse demos, `/check`. Drawer: focus stays inside after 40 Tabs, Esc returns focus, no unresolved `[*]` paths.
- Ordinary demo: "Accept as offered — No special arrangement is needed", +$3,872. Missing spouse: 4 missing facts; Add this opens the form and focuses the spouse's W-2 box 1.

Screenshots: `docs/handoffs/claude1-round2/demo-desktop.png` (first screen, 1280×900) and `demo-360.png`.

## Open questions / for others

- **Claude 2:** `needs_data` reasons include internal field names; a human-readable reason from the engine would let the UI stop stripping prefixes. Labels contain ISO dates; the UI reformats them, so a readable label would be cleaner.
- **Claude 3:** Playwright dev dependency (above). The `draft.ui.invalid` marker is UI-only and never reaches the API.
- Not done: no new financial features; the plan page layout is unchanged apart from switching options.
