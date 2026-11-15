# C continuation — design proposals for round 6

**Status: proposed continuation, not a deployed screen or a replacement for the approved C hero.** Created November 15, 2026 with the built-in image generator after the user rejected the generic lower-page cards. The established cobalt/chrome/lime identity stays. Neither this board nor its demonstration figures are customer evidence.

- [Landing below the hero](01-landing-continuation.png): a sequence of three distinct compositions rather than three equal feature cards.
- [Review → terms → client response](02-workspace-journey.png): three generously sized desktop states using the same visual language.
- [Exact generation prompts](prompts.md): one built-in generation per board, with existing C images as references.

The generated images were visually inspected: text is legible, the brand is coherent, no made-up outcome charts or customer metrics appear, and the financial result includes its baseline and settlement horizon. These are raster references; they have not passed DOM, responsive or accessibility checks. Implement them as working HTML/CSS and real controls, never as a giant image of a screen.

Codex integration review: label the main delta **“Extra cash after both tax settlements”** when it is relative to declining; it is not the family's total cash balance. Keep the baseline and horizon adjacent. The “Saved in this browser” label must reflect the actual local/cloud save state. Do not show a paid/confirmed/consented state until that action occurred.

## What changes from the current UI

The current page relies on repeated outlined boxes with similar text density. Replace that rhythm with a large problem statement, a visual explanation, a product workbench and a contrasting update section. Within the app, use one dominant result and compact supporting rows. Do not enlarge every heading or wrap every group in a new card.

The approved hero, logo assets and Geist font stay. Chrome stays only in the landing hero. Working screens use white/cool canvas, cobalt navigation and selected state, chartreuse primary actions, ink text, and amber for a real unresolved condition. Use the existing native concave H mark, not a raster extraction from these pictures.

## 01 — landing continuation

1. **Problem statement:** asymmetric two-column composition. Left: “The price isn’t what you keep.” plus two concise supporting sentences. Right: illustrative client offer and three simple labels explaining what affects the answer. The $12,000 is an input illustration, not savings.
2. **Working preview:** heading “Make the terms work for you.” A narrow three-step rail controls one large product preview. Selecting a step changes the actual explanation/preview; it must not be an inert decorative nav. A compact alternatives ledger introduces the decision UI. If no household is loaded, the preview must not pretend to have calculated outcomes.
3. **Repeat value:** full-width cobalt section, with the client’s changed payment request connected to the before/after control. Show the purpose of returning: a changed input changes a decision. The button should enter the appropriate real workflow or continue an existing plan, not a fake processing state.

Implementation corrections to the generated picture: use the existing precise footer link **“Privacy & your data”** rather than the broad “Your data stays yours” wording; remove duplicated full site navigation if the normal header is already present. In the real landing preview, clearly distinguish inactive illustrative content from editable controls. Do not create a second independent calculator just for the marketing preview.

## 02 — working journey

### Review

Use a 38/62 source-and-facts grid on desktop. Source text has one highlighted evidence span and a real source action. Facts form aligned rows, with label, value, source/status and edit action. Open one focused unresolved question at a time; don't hide other blockers without a count or next-step explanation. Different source values need a comparison state rather than replacing the row silently.

“Nothing changes until you confirm” describes actual atomic apply. The approval/consent indicator appears only after the user really approved that processing. An unanswered blocking question disables Continue with an associated explanation. Preserve the original text and typed answers on reload.

### Terms

One joined focal area: cobalt outcome at left, white actionable payment terms at right. The main figure names the amount, comparison baseline and tax settlement horizon; dates and client agreement are beside the terms. A compact alternatives ledger below selects the detailed option rather than showing three competing walls of text.

The board's **+$8,300** refers only to the existing illustrative round-5 fixture: same $12,000 price, $400 in 2026 and $11,600 on January 4, 2027, compared with declining, across 2026–2027 with final settlement in 2028. It is layout content, never a hardcoded app result or a claimed customer's saving. Actual amount, dates, retirement and source text must come from the current engine result. If the selected baseline/horizon changes, every label changes with it. The unselected rows deliberately contain no invented alternative outcomes.

Place the horizon switch before the result in accessible reading order even though the generated board places it beside the alternatives. A pending/no-result screen cannot show the ready-result figure. “Prepare client reply” opens a real editable draft; nothing sends itself.

### Client response

A narrow source/history rail keeps the original offer and client's actual words. The wider area shows precisely which proposed terms changed, then recalculation and apply. Proposed dates are not actual receipts. The board's December/January change has no computed saving: it deliberately says the new timing needs calculation.

Keep the original offer immutable. Client response creates a new proposal, and apply remains disabled until a current revision-bound calculation is reviewed. Full dates/year are required in production; resolve ambiguous “January 8” explicitly if the source/context is insufficient. A partial-payment action is distinct from a lower final settlement. Lifecycle labels represent recorded events, not a decorative progress bar that auto-advances.

## Implementation scale

- Max working width: 1200px inside a 1280px page; 48/32/20px responsive gutters.
- Geist only. Desktop work title 36–44px; mobile 28–32px. Body/input 16px/24px. Relevant conditions at least14px. Main outcome64px desktop/48px mobile; tabular figures, full signs and dates.
- Neutral boundaries and horizontal rules establish structure. One subtle shadow for a source sheet or landing tray; no shadow on each row. Avoid matching the generated tiny text literally.
- Corners: controls12px, workbench16–20px. Do not let large rounding erase row alignment. Use existing color tokens and measured contrast pairs from `../c-open/tokens.json`.

## Mobile and keyboard behavior

At360px, source becomes a collapsed summary before the editable facts; opening it stays in reading order. Question controls stack. Terms become outcome → baseline/horizon → payments → alternatives → primary action. Comparison rows show purpose and amount without a wide table. Keep cash and retirement distinct. Counteroffer before/after values stack under their labels. Full-width primary action remains in document flow or a safe-area footer that cannot cover validation/focus.

Every interaction has a native label, keyboard operation, visible3px focus ring and target>=44px. Selection has text/radio state as well as color. Source highlights need explicit field-to-excerpt links. Disabled actions explain the missing prerequisite; errors preserve entered values. Respect200% zoom and no page-level horizontal scrolling.

## Motion

Keep hero entrance once<=450ms. Workbench/panel changes180–220ms with <=8px movement, no delay before input is usable. A changed row may tint briefly while persistent before/after text remains. No looping chrome, parallax, simulated loading percentages, money count-ups or number animation during comparison. Reduced motion removes transforms/scroll animation; use immediate changes or <=80ms opacity.

## Delivery boundary

Claude1 implements this composition only alongside the actual round6 flow and checks the real screens/exports. Claude2/3 own calculation/command meaning. The generated reference does not authorize invented capabilities or arbitrary financial copy. Keep approved final materials unchanged. Codex can review the resulting app against these proposals and the existing C reference together.
