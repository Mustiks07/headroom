# Claude 1 — round 3 handoff (household journey and first impression)

Branch `claude1`. Normal merges only (no reset or force push; `main` untouched):
- `origin/main` @ `6161510`
- Claude 3's contract commit **`ecbdd18`**
- `origin/claude3` @ **`c6f7b90`** (workspace repository, v1 migration, JSON, forecast PDF)
- `origin/claude2` @ **`f4636cb`** (household engine)

The only conflict was `tests/ui/smoke.cjs` (a duplicated `CHROMIUM_PATH` comment). No engine, contract, persistence or PDF-generator code was changed by me.

## Implemented

**1. First screen (family demo)**
- A one-sentence verdict, e.g. "Taking this project as offered leaves your family $3,436 worse off. Split the payment instead: +$8,315."
- Below it, three equal compact tiles: Subsidy now · Accept as offered · Best within your limits.
- The CTA (`Use “Split the payment”`, Show the calculation, See all options) sits directly under the tiles.
- One sentence explains both baselines and that retirement money is never counted as cash.
- The synthetic and benchmark notes stay visible. Steps, conditions and the bounded-search note are in a disclosure.
- On 360 px the best option comes first, inside the first screen.
- Mobile navigation is a 2×2 grid; "My plans" is no longer clipped.

**2. Annual forecast without an invented project (`/check`)**
- Business profit is entered as either a whole-year estimate, or profit so far (with a confirmed as-of date) + client payments still expected − expenses still expected.
- Switching method asks for confirmation and removes the other method's figures. Each field has a plain-language hint and an optional range.
- A "How this adds up" box shows each part, the total and its range, and flags unknown parts. Unknown blocks the result; it is never $0.
- `scheduleCProfit` is derived with the contract's `forecastTotal`; it is no longer a second editable total.
- Before a project comparison the user must confirm that the forecast leaves the project out.
- The current-year check needs no 2027 figures. "Make this my household plan" saves the checked figures as a workspace.

**3. One household plan (`/household`, `/household/[id]`)**
- Uses Claude 3's `createWorkspaceRepository` / `commitWorkspaceChange`: one atomic revision plus history event per change.
- **Where you stand:** current subsidy, expected profit with range, and the next step (next expected payment, or SEP still to contribute).
- **Profit composition:** the engine's components, marked received/expected, with sources.
- **Plan as agreed on today's figures:** from `evaluateHouseholdWorkspace`. Shows the open-agreements cash effect, per-year MAGI vs limit, credit, settlement and legal SEP maximum. Lost-credit years and infeasibility are stated, never re-optimized.
- **Projects and payments:** expected vs actual per line. "Record received/paid" shows the replacement before saving ("replaces … — not added on top"). "Correct" requires a reason and keeps history. Expected payments can be cancelled; received ones can't.
- **New client offer:** starts as a proposal with editable conditions. "Compare options" uses `compareWorkspaceOpportunity` and shows "Compared with: Your plan without “B” …". Agreeing turns B's chosen payments into agreed lines; a SEP amount raises the yearly goal from max(goal, paid). Missing project facts get a "Fix this" link to the conditions form.
- **SEP-IRA:** yearly goal / already contributed / left to contribute / legal maximum, with a list of recorded contributions. "Record a contribution" asks for amount, paid date (validated Jan 1 – Oct 15 of the next year), tax year and confirmation. The goal can be edited; lowering it never refunds anything. The future-contribution budget is shown with the engine's remaining amount.
- **Save failures:** a change that didn't save stays pending (Try again with the same event id · save a copy in this browser after a cloud failure · discard). A conflict reloads the latest revision.
- **History, export, restore:** event history; JSON export; v2/v1 JSON restore; delete.

**4. Executed actions**
- The old single-plan checklist no longer lets SEP actions be ticked "done". It points to recording the contribution in a household plan.
- Converting a v1 plan (`MigrationReview`, Claude 3's `previewV1Migration` / `confirmV1Migration`) shows:
  - the baseline and the chosen option;
  - whether the project is agreed;
  - for each SEP amount: paid (amount + date), only planned, or unknown;
  - old done marks, kept unconfirmed and shown on the plan as "Please confirm from your records".
- The original plan is kept (`legacySnapshot`).

**5. Income changed**
- "My income changed" covers business profit (either method) or wages/interest, per person and year.
- "Check the effect on my plan" shows the plan as agreed on the new figures first: credit before → after, open-agreements cash before → after, lost-credit warning.
- "Keep these figures" saves them without any new agreement. New options for proposals stay separate.

**6. Defects**
- An invalid range is now stored as one draft entry with both typed ends (`low`/`high`). A reload restores exactly what was typed and still blocks the calculation (checked: `70x` / `65000`).
- The upgrade table labels the right column "New option: <label>" and says it is not the saved arrangement recalculated.
- Save errors keep the `/check` draft and the pending plan change.

**7. Export**
- "2026 / 2027 forecast explanation (PDF)" calls Claude 3's `exportForecastPdf` with `workspaceFingerprint`. It is disabled while a change is unsaved or a result is stale.
- Copy says it is not an official form and Headroom doesn't send it anywhere.
- Real download: 4 pages, title "Annual income forecast explanation – Our 2026-2027 household plan – 2026".

## Checks (final code)

- `npm run typecheck` ✔ · `npm test` ✔ 95 tests / 20 files · `npm run build` ✔
- `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:ui` ✔ 22/22. Added: the household plan records an actual $3,200 instead of the expected $3,000 (profit $125,000 → $125,200); SEP shows goal $5,000 / paid $3,500 / left $1,500; the plan reopens at revision 3; `/household` fits 360 px.
- Browser journey (production build, real engine and repository, synthetic sample):
  1. Open plan (rev 1).
  2. Record A's final payment; then a $1,500 SEP contribution (legal max $23,233 shown).
  3. Close the tab and reopen (rev 3, facts kept).
  4. New offer "Logo refresh" $5,000: blocked until cash accounting is confirmed via "Fix this", then compared on top of A.
  5. Agree to the option; YTD profit $88k → $91k: the plan as agreed loses the 2026 credit ($12,523 → $0) — shown before keeping.
  6. Spouse wages $6,000 reviewed and kept; the forecast PDF downloads (rev 8, history complete, no page errors).
- `/check` own data: Texas, single, YTD $41,000 + $15,000 expected → risk ready (MAGI $47,547, credit $1,744) with no 2027 data. "Make this my household plan" shows the same $1,744.

Screenshots (looked at by eye, not only DOM checks), in `docs/handoffs/claude1-round3/`:
- `demo-first-screen-1365.png`, `demo-first-screen-360.png`
- `household-plan-desktop.png`, `household-plan-360.png`
- `income-change-review.png`, `new-offer-on-top-of-agreed.png`
- `sep-goal-paid-left.png` (top of the plan after recording a contribution: next step "Contribute $1,500 more")
- `check-ytd-forecast.png`

## Notes for others / remaining

- **Claude 2:** for the sample, B's recommended option is "Accept + SEP-IRA contribution $1" (+$5 vs. accept). It is technically within limits but looks odd to a person. Consider a minimum meaningful improvement before recommending a SEP variant. Engine component labels contain ISO dates; the UI reformats them.
- **Claude 3:** Claude 2 lists four adapter differences in its handoff (received lines of a candidate; budget minus unpaid goals; exclusion check for proposed candidates; status of lines due before the as-of date). The UI uses the engine results throughout. The only remaining adapter use is `workspaceToCaseInput(ws, {candidate}).input` as the drawer/payment-wording input inside the comparison panel; it differs only when a candidate already has received lines.
- A household-plan edit of the profile itself (state, people, coverage) is not offered on the plan page. Those come from `/check` when the plan is created.
- Not verified: Supabase/cloud mode (no access), the public URL, real AI document import.
