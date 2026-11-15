# Round 6 lifecycle integration

Implemented in the shared `codex/finish-claude1-round6` worktree; no separate commit, push or deployment by the lifecycle agent.

## Delivered

- `ProjectCard` in `src/features/household-plan/parts.tsx` accepts `onLifecycleSaved(saved, summary)`. With it, client response and received-payment controls use the common proposal, preview and atomic commit path. Existing expense forms and other sections are preserved. Parent owns the separate SEP edits in the same file.
- `src/features/lifecycle/ClientResponsePanel.tsx`: accepted/current terms, rejected and counteroffer flows; real `intakeOffer` adapter with explicit provider consent and manual recovery; exact remaining amounts/full dates; source excerpts; original/current/version history; received money kept; optional explicit negotiation limits saved atomically with the response when a term space already exists. Unsupported currency, more than six payments, multiple offers and mentioned receipts need explicit resolution instead of silently replacing fields.
- `ReceiptPanel.tsx`: smaller receipts require either a dated remainder or an explicit lower-final-settlement reason. The UI never manufactures the remainder line. Corrections use a reason and shared command.
- `CommandReview.tsx`: `manualProposal` → `previewChange` with the actual `applyChangeProposal` callback → `commitProposal` → reread authoritative workspace. A changed revision invalidates apply. Facts, calculated impact, missing facts and historical dependencies are distinguished. Client responses additionally call `evaluateClientResponse`; generic fixed-plan cash is deliberately suppressed for a proposed counteroffer, because it would misleadingly show no effect while the new project remains unaccepted.
- `NextActions.tsx`: actual projected actions, real due dates, completed/superseded history and explicit open callbacks. It does not manufacture reminders or fake completion.
- `TypedChangeDetails.tsx`: explicit action, target IDs, amount, date, person, year and estimate/confirmed controls for moved payments, received/partial/settled payments, SEP contributions and forecast updates. Emits `ChangeCommand[]` for the parent's shared preview/commit flow. A fully typed seed can be edited; unseeded required choices are left unanswered. It does not append answers to text, rerun a parser or persist facts itself.
- `lifecycle.css`: scoped C-style source/terms workbench, compact ledger and one cobalt outcome; 360px stacking, 44px controls, visible keyboard focus, Escape/back behavior, source disclosure on narrow screens, reduced motion. Response/payment drafts remain browser-local across reload and are removed after confirmed save. The existing app-wide data-clear function recognizes the `headroom.` key prefix.

## Explicit integration ownership exception

Parent/root authorized a bounded fix to `src/lib/engine/assist/changes.ts` after published Claude 2 and 3 contracts did not align. The UI correctly could not confirm responses because the shared command validated structurally but produced no preview changes. The canonical partial command also accessed a missing legacy `remaining` property.

The validator now supports canonical `record_partial_receipt` (`remainderDate`), `settle_lower_total` and `record_client_response`, while preserving the legacy engine-only payment schema. Canonical partial remainder comes from the original expected amount; client responses preserve actual receipts and produce explicit changes/events. No engine-to-client import cycle was introduced. Ordinary `record_receipt` of a smaller amount now refuses the ambiguous operation instead of silently deleting the remaining expected money. Existing shared backend handlers still own the committed history and command application.

## Verification

| Area | Implemented | Verified | Not yet verified here |
| --- | --- | --- | --- |
| Canonical partial/settlement/client response | Yes | `tests/integration/round6-lifecycle.test.ts` passes, including actual preview/apply and retry/history assertions | Production UI |
| Prior assistant/engine behavior | Yes | `tests/engine/assist.test.ts` passes | Broader final integration belongs to parent |
| Lifecycle UI typing | Yes | Final `npm run typecheck` passed after `TypedChangeDetails` and the canonical command fix | Final composed build belongs to parent |
| Desktop/360px focus, reflow, motion | Implemented | Code reviewed for scoped breakpoints and native controls | Root's actual browser walkthrough and screenshots |
| PDF/ICS/JSON | Existing paths preserved | No export changes in this child scope | Root/parent inspect current exported artifacts |

Targeted runs on 2026-11-15: **2 files / 20 tests passed** (`round6-lifecycle.test.ts`, `assist.test.ts`); after the additional ambiguous-receipt assertion, **2 files / 17 tests passed** (`round6-lifecycle.test.ts`, `round5-assist.test.ts`). The latter confirms the new smaller-receipt guard does not regress the existing assistance workflow.

## Material boundaries

- Accepting a saved alternative remains the saved package's existing agreement action; the lifecycle acceptance control explicitly accepts the current project payments. The backend refuses arbitrary package IDs on a generic accepted response.
- Cancelling agreed work can involve refunds or costs. The response evaluation leaves that financial outcome uncalculated when those facts are unknown; it does not present an invented zero-cost cancellation gain.
- A freeform client note is retained as context. Only explicit limit controls change future search constraints. If the project has no term space yet, the normal goal/terms editor supplies it after recording the response.
- Pasted content is never automatically sent to the client. Intake consent only covers the specified project context, and editing/reviewing a reply never implies acceptance or receipt.

## Final integration and actual browser verification

The final published Claude 2 command schema was merged in `0efa51f`; the temporary legacy payment normalization was removed. Canonical commands now retain cancelled expected lines and use the same IDs/event kinds as persistence. One upstream assertion was corrected to filter cancelled lines when counting unpaid terms. Lifecycle + round6 + the ten pinned decision cases: 24 passed; typecheck passed.

On the composed production build, the actual browser completed counteroffer preview/commit, partial receipt, reload and JSON export; the original $12,000 offer remained unchanged. A separate agreement → partial receipt run disabled stale current-package export while historical PDF and current ICS remained available. The two historical PDF pages were rendered and inspected. Desktop and 360px result/receipt checks passed without horizontal overflow. These are synthetic developer checks, not customer outcomes.
