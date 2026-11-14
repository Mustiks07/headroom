# Claude 1 handoff — selected Headroom direction
> **WITHDRAWN: the user rejected this visual direction on November 15, 2026.** Do not implement the mark, palette, typography or screen compositions below as a selected design. Continue functional round5 work. This file is retained as history; its visual implementation order is no longer active. Current colors are not a constraint for the new exploration.

Date: 15 November 2026. This folder is a proposal and asset handoff. It changes no production UI, release, README or user-provided final deck.

Start with [design-direction.md](design-direction.md), [design-tokens.json](design-tokens.json) and the selected images **02–06**. Image **01** explains the three alternatives; choose its **01 Clearance** mark. File **04-fact-review-desktop-concept-v1.png** is superseded and must not be presented as the final design.

## What stays and what changes

| Preserve | Change |
|---|---|
| Headroom name; guest access; English; browser-first product | Own h/lintel identity; exact self-hosted Inter + Instrument Serif typography |
| Warm neutral/forest foundation | Measured semantic tokens and quieter borders |
| Deterministic calculations and shared contracts | Result hierarchy: finding → baseline/horizon → terms → alternatives → evidence |
| Current-year ACA check without a fictional offer | Offer-first start plus documents/manual choices; keep current-year entry visible |
| Document import pipeline and confirmed facts | Adjacent source review, bulk consistent-fact confirmation, focused missing questions |
| Goal constraints; up to three meaningful variants | Short titles and aligned comparison rows instead of long algorithm-generated card headings |
| Draft, agreement, payment, SEP and export lifecycle | One coherent next action and explicit distinctions among proposed/shared/agreed/received |
| Useful expert detail, calculation trace, sources | Progressive disclosure for search-method detail and repeated technical notes |
| Existing stored data and backend contracts | No duplicate upload pipeline, no second state model, no frontend tax arithmetic |

## Implementation order

1. **Foundations and shell.** Apply tokens in `src/app/globals.css`; load licensed fonts in the existing layout using the repository's current Next guidance. Store fonts and OFL notices locally. Build a clean single-color SVG mark from the chosen geometry; do not ship the textured raster as the favicon. Update `src/components/SiteChrome.tsx`, preserving routes and keyboard access.
2. **Result composition.** Refactor `src/features/deal/DealPanel.tsx` and the existing result components. Use short UI titles instead of printing the full long variant label as a heading. Keep the financial label/baseline tied to the real `result.baseline`; do not use static copy that assumes every comparison is vs decline.
3. **Terms and execution.** In `src/features/deal/ChooseTerms.tsx`, keep draft preparation, saved package, shared and agreed states separate. A green button must never imply client agreement. Use exact records for amount/date/progress; show historical decision and current assessment separately once the backend supports them.
4. **Start and review.** Adapt `src/app/page.tsx`, existing Workspace and `src/features/household/DocumentImport.tsx` around the round-5 contracts. The screenshot is an interaction reference, not a new extraction service. Make available manual/CSV/TXT behavior truthful when PDF/image provider support is off.
5. **Responsive and states.** At <760px stack source and fact review; comparison becomes meaningful radio rows, not a shrunken three-column desktop table. Implement real pending, unknown, unsupported, stale, save conflict and export-error states. The final mock 04 specifically shows pending status.
6. **Bounded final verification.** Check actual desktop + 360px; keyboard/focus, reduced motion, 200% zoom and narrow reflow; ordinary-positive and cliff paths; source ambiguity, provider-off fallback, draft → agreement → actual payment → updated result, reload and real PDF/ICS. Run project-required typecheck, relevant smoke and build once after completion; repeat only after relevant fixes.

## Financial semantics are part of the design

- **The largest number is not “savings from Headroom”.** +$9,695 in the concept is the existing synthetic project's cash delta versus declining the terms, after both tax-year settlements. It is not available cash now.
- **Add the original-offer comparison when the engine supplies it.** If showing benefit from changing the offer, use the existing/new authoritative result field that compares revised terms with accepting the original offer under the same facts and horizon. If absent, omit the figure or show the exact unavailable reason. Do not subtract unrelated UI figures or invent a value.
- **Cash by date must be a first-class horizon.** Use the actual liquidity result when required starting cash/movements/reserves are ready. If they are missing, name what is missing. Expected project receipts remain receipts. Show retirement principal separately.
- **“More cash overall” is a selected example, not an automatic recommendation.** Date goal, cash constraints, price negotiability, timing feasibility, uncertainty and user's stated preference determine suitability. Do not select solely by the largest two-year total.
- **The $33 SEP option is fragile.** “Simplest” describes fewer requested changes, not guaranteed safety. Display engine sensitivity/review conditions and any required buffer. No “safe”/“protected” badge justified solely by the snapshot threshold.
- **The $14,000 price and split dates require client agreement.** Preparing or saving a draft is not agreement, and agreement is not receipt.
- **Snapshot dates are historical fixtures.** Nov 14, 2026 / Jan 4, 2027 come from the provided screenshot and must not be hardcoded into production or presented as currently executable without date validation.
- **When facts change, recalculate and preserve the historical record.** Do not silently update agreed terms, overwrite source evidence or assign a new fingerprint to old results.

## Components and interaction details

**Outcome heading:** one plain-language finding and one primary metric. Keep baseline and horizon adjacent at ≥14px. “Final settlement occurs in 2028” is meaningful context for the illustrated two-year result.

**Option list:** native radio group or equivalent accessible selection. A short title, main cash delta, separate retirement amount, and one-sentence tradeoff. Full terms appear for the selected row. When the choice changes, replace amounts immediately; do not count them up.

**Expected-payment timeline:** dates and amounts plus explicit proposed/agreed/received state. The generated hollow circles resemble radio buttons; implement small noninteractive timeline dots/lines instead. Recording a receipt is a separate control with amount and date.

**Source review:** keep document/year/person/period and excerpt linked to each fact. The final image has no payment-status preselection and an inactive confirmation button. Help text names the remaining action. Unknown is a permitted explicit answer and may keep only the affected result blocked. No unknown→zero or invoice→received conversion.

The mock includes empty fact checkboxes to depict pending review. Production should prefer a readable group summary and one “Confirm these facts” action for coherent facts, with separate controls only for exclusion/conflicts. Do not require pointless repeated checkbox clicks. If the main action is disabled, the reason must be visible and programmatically connected; consider keeping an enabled review action that takes the user to the first missing answer where that is clearer.

**Draft save:** “Draft saved in this browser” is more precise before facts are confirmed. Actual save/cloud state comes from the persistence result; the mock label is illustrative.

**Evidence drawer:** usable at full mobile width; source text selectable, figure/rule/source date available. Support Escape, close control, focus management and restoration. Avoid hover-only source links.

**Changed fact preview:** before → after, what changed, affected plan, what stays agreed, and the new estimate only when ready. Apply/Edit/Cancel; no hidden changes from a language-model response.

**Next action:** only one strongest action per context. After choosing terms it is draft preparation; after agreement it may be a payment to record or upcoming contribution. Remove completed and duplicate prompts.

## Motion and accessibility

Use the exact values in the token file as a starting point: 120ms feedback, 180ms disclosure, 220ms panel, at most 8px translation; 600ms changed-row tint with persistent text. Support reduced-motion explicitly. No confetti, balance counting, fake typing, fake OCR progress or animation that holds input.

UI font is Inter, numeric `tabular-nums lining-nums`; serif only for large marketing headings. Input/body 16px, secondary 14px, metadata 13px. Main button/input height 48px; target ≥44px. Focus 3px with 3px offset. The token contrast ratios are verified; actual CSS and rendered exports still require inspection.

The #D7DCD5 divider is decorative at 1.39:1 on white; input boundaries use #7A867E at 3.79:1. Do not reuse the decorative rule as a form control boundary. Semantic state always has text/icon in addition to color.

## Exact selected files and known limits

- `02-headroom-lockup-transparent.png`: 2172×724 RGBA. Alpha 0–255 verified. Raster concept, not SVG; slight generated tonal variation must become a flat solid fill in the native mark.
- `03-start-desktop-concept.png`: offer-first entry plus synthetic comparison preview.
- `04-fact-review-desktop-concept.png`: **final corrected pending state**, no radio preselected, confirmation inactive. Its synthetic source excerpt was authored for this design, not actually extracted.
- `05-comparison-desktop-concept.png`: selected outcome, dates/conditions and comparison.
- `06-comparison-mobile-concept.png`: mobile reference with horizon selector. Desktop must expose equivalent horizon choice; its omission from image 05 is not a functional instruction.
- `01-logo-explorations.png`: alternatives only.
- `04-fact-review-desktop-concept-v1.png`: superseded; kept solely for provenance.

Generated screens approximate typography and spacing; the token file governs the implementation. No actual field count, completion speed, usability gain, customer outcome or successful AI/backend execution was measured by this design work. Use real release screenshots in the final public deck/video and preserve the user's own final materials.

