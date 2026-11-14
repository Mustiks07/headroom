# Claude 1 — round 4 handoff (family goal → deal terms → action → update)

Branch `claude1`. Normal merges only; no reset or force push; `main` untouched:
- `origin/main` @ `743de9d`, then `1c9157a`;
- Claude 3's contract **`f99b5d3`**;
- `origin/claude3` @ **`6ca4619`**, which also includes `7c6219d` (event kinds), `7884b1a` (price clarification) and the package/exports;
- `origin/claude2` @ **`eeb6cf5`** (`searchDealTerms`, `evaluateDecisionSensitivity`).

No engine, contract, persistence or PDF code changed by me. UI, styles and the UI smoke only.

## Implemented

1. **Goal-first entry.** "Find terms for my goal" appears on any project with unpaid payments, and as "Find terms" in the attention list. It opens a compact goal form (`src/features/deal/GoalForm.tsx`):
   - how much more to keep after both tax years (empty = as much as possible);
   - the SEP-IRA maximum;
   - an optional money-by-date goal with an explicit meaning: *Paid by the client* (`project_receipts`), *This project's money we can use* (`project_available_cash`) or *Our total balance* (`household_balance`, which asks only for balance, as-of date, reserve and a completeness confirmation).

   Price range, latest payment date, number of payments and "has the client said new terms are possible" open on request. Received deposits are shown as fixed.

   `model.ts` turns the form into the contract's `DealGoal`, `DealTermsSpace` and `CashContext` (format checks only). It saves them with Claude 3's `saveDealGoal` / `saveCashContext` as a plan revision, then calls Claude 2's `searchDealTerms` on the saved workspace.
2. **Up to three calculated options** (`DealPanel.tsx`). Purpose title (Simplest / More cash overall / More money by your date / More into retirement / More room if income rises / As offered) and the engine's pick. Each card shows:
   - total asked price, unpaid payments with dates, extra SEP;
   - cash after both tax years vs. the named baseline;
   - retirement separately;
   - date goals ✓/✗ with the engine's explanation;
   - credit lost by year;
   - "X less cash than the option with the most cash — with fewer changes to ask for".

   The search space and precision come from `search` (combinations, steps, "not a proof of the global optimum…"). Changing the goal marks results stale and disables choosing.
3. **When it doesn't work.**
   - `no_feasible_terms` gets its own non-success card: the violated limits, then the computed single-limit relaxations. "Use this in my goal" copies the value into the form; a relaxation without a value is explanation only.
   - `needs_data` / `unsupported` / `unavailable` have their own states, with "Fix this" for forecast paths.
   - An incomplete balance goal shows only project money ("doesn't say whether your household will cover every bill").
   - A failed save keeps the typed goal and says nothing was searched.
4. **Money by date.** Each option's "Money by date & details" shows a timeline of `datedFlows` marked Received / If agreed / Estimate (settlements on return due dates), then ACA by year, every limit ✓/✗ and the new actions. Cash after both tax years stays a separate figure.
5. **What changes the answer.** A disclosure loads Claude 2's `evaluateDecisionSensitivity`: the first thing that could change the answer, items with thresholds and how they were checked (solved exactly / checked across a range / depends on an unconfirmed fact). Forecast paths have "Go to this figure".
6. **Choice → action** (`ChooseTerms.tsx`, Claude 3 hooks):
   - The preview uses `buildActionPackage`: client draft with copy and .txt download, an optional general reason without household amounts, `clientDraftNotes`, and next actions.
   - "Save these terms to my plan" is enabled only while `currentSearchFingerprint` matches the result. It calls `saveActionPackage`.
   - The "Chosen terms" section survives reload: Chosen → Shared → Client agreed steps, decision PDF (`exportDecisionPdf`) and calendar (`exportCalendarIcs`) while current, client draft, and reminders the user can mark done (`setReminderStatus`).
   - "I sent these terms" calls `setPackageStatus`.
   - "The client agreed" (after an explicit confirm) is one atomic edit `recordClientAgreement` (`ops.ts`): the package status becomes `client_agreed`, the project's unpaid lines are replaced by the package's payments (received lines kept), the project is agreed, and an extra SEP raises the goal from max(goal, paid). Claude 3's `setPackageStatus` only records the status, which is why this edit exists.
7. **Coming back.** "What needs attention next" on the overview lists:
   - due/overdue and next expected agreed payments;
   - a forecast above (or close to) the subsidy limit;
   - lost credit or infeasibility of the plan as agreed;
   - SEP still to contribute vs. set-aside cash;
   - chosen terms not yet sent;
   - open dated package actions within 14 days (receive-payment ones are left to the payment lines, so they disappear once recorded);
   - offers awaiting a decision;
   - recently recorded facts.

   "My income changed" (round 3) shows the plan as agreed on the new figures first. The v1 demo and all earlier routes are unchanged.

Also fixed: 360 px overflow on the plan page (grid items `minmax(0,1fr)`, wrapping headers), the cash-context source evidence, and the smoke selector clash.

## Checks (final code, production build, real engine and storage, synthetic sample)

- `npx tsc --noEmit` ✔ · `npm test` ✔ 122 tests / 24 files · `npm run build` ✔.
- `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:ui` ✔. Earlier checks are kept; new: the goal search returns 3 calculated options with one pick, and an unreachable goal shows "no terms" with no success card.
- Browser journey, desktop 1365 px:
  1. Sample plan (A agreed with its deposit, SEP goal) → B, goal keep ≥ $4,000, SEP ≤ $1,000, ≥ $3,000 from B by Jan 10, 2027, ask $12k–$14k, ≤ 2 payments, client open → 3 options (Simplest +$8,268 with $33 extra SEP; **More cash overall +$9,695**: $5,925 Nov 14, 2026 + $8,075 Jan 4, 2027; More into retirement +$9,284 + $500 SEP). Search: 1,513 combinations.
  2. Keep ≥ $20,000 with max price $13,000 → no feasible terms. Best achievable $9,005, relaxation "keep at least $9,005", no price up to $33,000 works.
  3. Balance goal without the completeness confirmation → project-only result with the warning.
  4. Details, money by date and sensitivity; choose; client draft preview; save the package.
  5. PDF and .ics downloaded. "I sent the terms" → "The client agreed": B's lines become $5,925 + $8,075.
  6. Record B's first payment → its reminder leaves the attention list.
  7. Reload → revision 11 with the package.
  8. Income +$3,000 → the plan as agreed loses the 2026 credit ($12,445 → $0) shown before keeping; attention shows "Your 2026 forecast is above the subsidy limit".

  No page errors; 360 px has no horizontal scroll.
- Files opened:
  - decision PDF: 4 pages, all rendered and looked at. Figures match the UI (+$9,695, payments, settlements −$1,815 / −$2,490), status "Chosen in Headroom (not yet shared)", "Headroom has not sent anything".
  - `.ics`: 4 VEVENTs (two receipts, two settlement reserves), stable UIDs, CRLF.

Screenshots (inspected by eye) in `docs/handoffs/claude1-round4/`:
- `goal-form-desktop.png`, `variants-desktop.png`, `variants-360.png`
- `no-feasible-terms-desktop.png`, `no-feasible-terms-360.png`
- `chosen-terms-360.png`, `income-change-after-agreement.png`, `household-plan-desktop.png`
- `decision-package-pdf-pages.png`

## Limits / notes for others

- After "client agreed", the workspace contains the new terms, so the package's search fingerprint is no longer current. Claude 3's exports then refuse it (409) — by design. The UI says to download the summary and calendar **before** recording agreement. A Claude 3 follow-up could allow exporting an agreed package as a historical record.
- **Claude 2:** the "Simplest" option can carry a tiny extra SEP ($33 in the sample) to keep the 2027 credit. That is correct but surprising to a person; the card shows it plainly. Engine payment dates start at "today" in the first window (Nov 14, 2026 in the sample).
- `recordClientAgreement` maps the variant to a v1 `ScenarioKind` only for labels/history (`sep_minimum` / `split_payment` / `accept_now` / `renegotiate`).
- Not verified here: public Vercel URL, live Supabase cloud mode of the new state (Claude 3 / integrator), real AI document import. All checks are local with synthetic data.
