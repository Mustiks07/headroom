# Headroom — design direction / Round 5
> **Archived / rejected by the user on November 15, 2026. Do not implement this direction.** The following selection language records the earlier proposal, not current authorization. Preserving the warm-neutral/forest palette was an inferred choice, not a user requirement. New exploration must consider actual visual references and materially different compositions without a fixed palette. Functional accuracy and accessibility requirements remain useful independently of this style.

**Recommendation:** a calm decision desk, built around clear space, evidence and dates.  
**Date:** 15 November 2026. **Status:** design proposal, not a released interface.  
**Reviewed baseline:** `headroom-review` at supplied runtime `6f18c1f`, README, round-5 briefs, current homepage/styles/decision components, round-4 public screenshot, and business research memo. No production files or final user materials were changed.

## What to open

| File | Role | Recommendation |
|---|---|---|
| [01-logo-explorations.png](01-logo-explorations.png) | Three original image-generated identity routes | Review the alternatives; select **01 Clearance** |
| [02-headroom-lockup-transparent.png](02-headroom-lockup-transparent.png) | Selected horizontal raster lockup, genuine RGBA transparency | Identity reference; redraw as clean SVG before shipping |
| [03-start-desktop-concept.png](03-start-desktop-concept.png) | Homepage / offer-first entry | Selected direction |
| [04-fact-review-desktop-concept.png](04-fact-review-desktop-concept.png) | Source review and one consequential question | Selected direction, planned workflow |
| [05-comparison-desktop-concept.png](05-comparison-desktop-concept.png) | Outcome, expected payments and options | Selected direction |
| [06-comparison-mobile-concept.png](06-comparison-mobile-concept.png) | Responsive comparison | Selected direction |
| [design-tokens.json](design-tokens.json) | Exact proposed color/type/space/motion values | Implementation specification |
| [claude1-handoff.md](claude1-handoff.md) | Scope, sequencing, concrete component guidance | Implementation handoff |
| [generation-prompts.json](generation-prompts.json) | Six initial prompts plus the fact-review correction | Reproducibility |
| [asset-manifest.json](asset-manifest.json) | File sizes, alpha, hashes and provenance | Asset verification |

All six images were actually produced using the built-in **image_gen** tool. They are raster design references. They are neither frontend code nor evidence that a planned feature works. Every screen is visibly marked DESIGN CONCEPT and synthetic/illustrative. Original tool exports remain intact under the Codex generated-images directory; selected copies are local to this folder.

## The decision behind the appearance

Headroom helps a self-employed household decide what to agree with a client, understand the tax/ACA implications, and keep the resulting obligations current. The interface should feel like a thoughtful financial document that becomes actionable: a legible answer, a short comparison, a dated plan, evidence within reach.

The current product already contains useful calculations, scenario constraints, drafts and lifecycle states. Its screenshot gives too much weight to long machine-shaped titles, nested card borders, repeated buttons and search-method notes. The eye finds three green numbers before it understands their common baseline or when money becomes available. The opportunity is to edit hierarchy, not add a decorative dashboard.

The new visual grammar has four parts:

1. **Room:** the logo's detached lintel and deliberate whitespace give the name a specific visual idea.
2. **A decision sheet:** one selected result and its conditions occupy the top of the work area.
3. **A dated ledger:** expected receipts, received money and settlement amounts have different labels and positions.
4. **An evidence margin:** source excerpts sit beside facts; sources are not buried in an end-of-page disclaimer.

Warm paper and restrained forest preserve useful continuity with the current app. Originality comes from this coherent product grammar and own mark, not an exotic palette. No stock-finance photography, upward chart decoration, simulated AI typing, decorative stars, giant sidebar or unrelated spending widgets.

## What strong companies teach us — and what to decline

This is a primary-source design review, checked on 15 November 2026. The adaptations and rejections below are design judgments for Headroom, not claims that borrowing a pattern will reproduce another company's business results. Exact font sizes, spacings and motion durations below are our proposed tokens.

| Reference | Useful principle found in the source | Adapt to Headroom | Decline for this product |
|---|---|---|---|
| **Apple** | Purpose and agency, unobtrusive interfaces, alignment, usable targets, intentional motion. | One primary task, readable type, controls beside affected content, reversible previews, short motion. | Liquid Glass over financial content, imitation of native iOS chrome, copied marks, distributed SF font files. |
| **Stripe** | Color roles can be designed around predictable contrast rather than eyeballed swatches. | Measure every text/surface pairing; one semantic role per accent; explicit states. | Stripe gradients or its brand palette; visual spectacle as financial evidence. |
| **Linear** | Its March 2026 refresh deliberately reduces attention taken by navigation, icons and borders. The 2024 work tested density and alignment across actual views. | Quiet top navigation, one consistent action location, rows before cards, restrained metadata. | Developer-tool density, 12px core copy, hidden hover-only controls and a large permanent sidebar. |
| **Mercury** | Its public demo makes a financial product inspectable before commitment. Its Command description separates intent from authorized action. | A synthetic interactive example without signup; preview changes before applying them; truthful save status. | Bank-like balance authority, bank-security claims or payment automation Headroom does not possess. |
| **Notion** | Its March 2026 article treats spacing, paragraph rhythm and consistency across blocks as a system. | Repeatable label/value/source rhythm; compact evidence reading without nested boxes. | An empty document canvas that leaves the user to invent their workflow. |
| **Monzo** | Writing principles place the reader's impact before internal explanation and use normal words for complex financial matters. | “Money received”, “Client agreement needed”, “What changed?”; explain impact before trace. | Jokes around subsidy loss, playful financial scoring, celebratory confetti or unnecessary jargon. |
| **IBM Carbon** | Chart anatomy guidance ties titles, units, direct labels and scale to meaning. | Use direct dollar/date labels and a table alternative; charts only when they reveal a real comparison. | An analytical chart simply to occupy the hero; unlabeled threshold bars; misleading donut totals. |

Primary sources:
- Apple [design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/), [UI design guidance](https://developer.apple.com/design/tips/), [motion](https://developer.apple.com/design/human-interface-guidelines/motion), [accessible color](https://developer.apple.com/design/human-interface-guidelines/color).
- Stripe [Designing accessible color systems](https://stripe.com/blog/accessible-color-systems).
- Linear [2026 calmer interface](https://linear.app/now/behind-the-latest-design-refresh) and [2024 UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui).
- Mercury [Designing in the open](https://mercury.com/blog/designing-in-the-open) and [Mercury Command](https://mercury.com/blog/introducing-mercury-command).
- Notion [Updating the design of Notion pages](https://www.notion.com/blog/updating-the-design-of-notion-pages).
- Monzo [Writing Principles](https://monzo.com/tone-of-voice).
- IBM [Carbon chart anatomy](https://www.carbondesignsystem.com/building-blocks/data-visualization/chart-anatomy).

Wise was considered, but its typography/color pages were JavaScript-only in the available source reader and its motion page could not be retrieved. No unverified Wise measurements are claimed or used.

## Identity — three routes and a selection

**01 Clearance — selected.** A lowercase h with a detached lintel above its shoulder. The gap is an actual piece of headroom, not a stock “growth” arrow. It connects the name to the job and is recognizable as one silhouette. The generated board also demonstrates a one-color small mark and reverse application.

**02 Two paths.** An asymmetric split ribbon expresses choosing between terms. It has graceful movement potential, but is less clearly connected to the name and risks reading as a generic financial growth mark.

**03 Open frame.** Two offset brackets create an open room and imply an H. It is compact and systematic, but reads more like a developer tool or document scanner than household financial help.

Use the selected mark in one color. Do not animate it as a loading indicator. For the web implementation, construct a native SVG with simple filled geometry, then optically inspect 16/20/24/32px versions. The lintel gap must survive the 16px favicon; the minimum separation should be about 2 device-independent pixels at a 24px mark. A small-size optical variant is allowed. Keep clear space of at least half the symbol's stem width around the mark; keep more space around the combined lockup.

The generated transparent lockup is a **raster concept**, not a vector master: slight texture/tonal variation from image generation should not enter the production logo. The SVG should use an exact solid brand color. Set the wordmark independently in a licensed font or create deliberately drawn lettering; do not trace random raster edge noise. No trademark clearance is claimed.

## Typography that feels designed and remains usable

**Inter** is the UI, forms, money, tables, report body and wordmark starting point. It provides tabular numbers and has explicit SIL Open Font License 1.1 licensing in the designer's [official source](https://rsms.me/inter/). **Instrument Serif** is a small dose of personality for large marketing headings; its [official project](https://github.com/Instrument/instrument-serif) describes it as a display face for large sizes and supplies OFL 1.1.

Self-host approved font files, include each OFL and copyright notice, use `font-display: swap`, and provide metric-conscious fallbacks. Do not load an unrelated hosted font on every visitor's first financial session. Preload only the fonts used above the fold; avoid unnecessary weights and italics. Neither font is installed by this proposal.

Apple's [font page and bundled license](https://developer.apple.com/fonts/) do not make downloaded SF files a general cross-platform webfont. Learn from Apple's hierarchy and optical care without redistributing SF. A user's native system font remains a normal fallback choice; this is distinct from serving Apple's font files.

| Role | Desktop | Mobile | Weight / behavior |
|---|---:|---:|---|
| Marketing headline | 64px / 1.02 | 42px / 1.04 | Instrument Serif 400, tracking −0.02em |
| App page title | 36px / 1.15 | 28px / 1.15 | Inter 600 |
| Primary result | 56px / 1.05 | 44px / 1.05 | Inter 600, tabular lining numerals |
| Section title | 24px / 1.25 | 22px / 1.25 | Inter 600 |
| Body and input | 16px / 24px | 16px / 24px | Inter 400; inputs never shrink |
| Secondary / labels | 14px / 20px | 14px / 20px | 400 secondary; 600 labels |
| Metadata | 13px / 18px | 13px / 18px | Never hide a material condition here |
| Button | 15px / 20px | 15px / 20px | Inter 600, ≥44px target |

Use proportional text and tabular numbers: `font-variant-numeric: tabular-nums lining-nums`. Right-align numeric table columns and align currency with the amount. Use a real minus sign and unambiguous dates (“Jan 4, 2027”). Do not abbreviate a decisive dollar amount to “9.7K”. Whole dollars in a summary are acceptable only under the app's documented rounding; evidence/export retains required precision. Avoid old-style serif numerals and all-caps paragraphs. Marketing text measure ≤20 characters for a short headline line where appropriate; prose ≤64ch. The raster font shapes are approximations; real fonts must be checked in the implementation.

## Color, spacing and shape

| Token | Hex | Use |
|---|---|---|
| Canvas | #F6F5F0 | Warm neutral page |
| Surface | #FFFFFF | Input, evidence and primary decision sheet |
| Ink | #202824 | Main text and financial amounts |
| Muted | #5A655F | Secondary explanation |
| Brand | #173F36 | Primary action, links, selected symbol |
| Selected | #E7EEE8 | One selected option |
| Divider | #D7DCD5 | Decorative grouping only |
| Control border | #7A867E | Input/radio boundaries |
| Warning text / fill | #77510C / #FFF0D2 | Uncertainty, conditions and review needed |
| Negative text / fill | #A43235 / #FBEDEE | Actual negative change or validation error |
| Information text / fill | #285E83 / #EDF4F8 | Source and informational state |
| Focus | #2168A1 | Focus ring |

Computed WCAG contrast, using exact proposed sRGB values: ink/canvas **13.84:1**, muted/canvas **5.56:1**, white/brand **11.66:1**, brand/selected **9.88:1**, warning pair **6.29:1**, negative pair **5.98:1**, information pair **6.26:1**, focus/canvas **5.40:1**, control border/white **3.79:1**. Decorative divider/white is **1.39:1** and must never be the only indication of an interactive boundary or meaningful chart series.

These are token checks, **not a claim that the generated PNG or unbuilt app passes accessibility**. Recheck actual CSS, states, antialiasing, adjacent colors and exported PDFs.

Use a 4px base with meaningful steps 8/12/16/24/32/48/64/96. Maximum content width 1200px, desktop side padding 40px, mobile 20px, 24px grid gap. At <760px stack evidence and result layouts. App bar height around 64–72px. Cards only where the content forms a real unit: one decision, one source, one necessary question. Prefer quiet rules for comparable facts and commitments. Controls radius 8px; surfaces 12px; pills only for short real statuses. Shadows only for elevation such as a drawer, not every list row.

Semantic color does not mean “everything green is good”. The selected choice can still require agreement. A larger quoted price does not imply achievable earnings. Green selection always has a radio/label; amber always has words; red must be attached to a real loss or error.

## Three main screens

### 1. Start with the real task

The homepage says what the decision is before asking for a form. The selected concept uses a short offer entry, equal alternatives for documents/manual figures, a live synthetic example, and no account gate. The familiar current-year ACA check remains available as “Check this year's subsidy” rather than requiring a fictitious contract.

The preview uses actual existing synthetic output values, explicitly compared against declining the terms. It is not a customer-savings claim. The website should bind any live preview to the engine fixture; never copy the image's numbers into production as constants.

**Current:** guest app, demo, manual input and CSV/TXT imports.  
**Planned:** unified pasted-offer/documents entry and document-assisted short questioning. Natural-language processing and PDF/image extraction must be capability-gated.

### 2. Confirm the important facts, not an AI performance

The fact-review screen places the relevant document excerpt beside the extracted terms. One material ambiguity (“has this payment arrived?”) gets a visible reason. The user can inspect all proposed facts and confirm a coherent group once. On mobile show the question/facts first, with a source disclosure immediately connected to the affected item.

The source shown in the image is a **new illustrative synthetic offer excerpt**, constructed using the existing example's amounts/dates. It is not a real uploaded document or proof of extraction. The final image leaves every payment-status radio unselected and disables confirmation with an explicit instruction. No fact is selected by default. The browser-save label illustrates saving a draft, not confirming its contents. The superseded v1 image is retained for provenance only and should not be presented as the selected design.

In implementation, replace the mock's empty per-row checkboxes with neutral “Ready to confirm” indicators unless selective application is genuinely needed. Do not force three repetitive checkbox clicks before the bulk confirmation. Conflicting facts cannot join that bulk confirmation. A source-link icon opens the excerpt/drawer; it should not imply an external site if it is local.

**Planned:** unified source review, evidence references, conflict resolution and minimal-question readiness. Reuse the actual import pipeline and shared contracts; do not build a parallel visual-only pipeline.

### 3. Choose terms with the time dimension in view

The desktop comparison places one outcome beside the payment conditions and then presents three aligned alternatives. The mobile layout stacks the same meaning rather than shrinking a table.

The figure **+$9,695** means extra modeled cash after 2026 and 2027 tax settlements compared with declining these terms. Final 2027 settlement is in 2028. It is not Headroom's savings, cash today, a household bank balance, or a guaranteed client payment. Higher price and split dates remain **proposed / client agreement needed**.

The displayed figures come from the provided round-4 screenshot:
- Simplest: $12,000 price, $12,000 on Jan 4, 2027; +$8,268 after both tax years; $33 added retirement.
- More cash overall: $14,000 price, $5,925 on Nov 14, 2026 plus $8,075 on Jan 4, 2027; +$9,695 after both tax years; no added retirement displayed ($0 in the concept).
- More into retirement: $14,000 price, $6,750 on Nov 14, 2026 plus $7,250 on Jan 4, 2027; +$9,284 after both tax years; $500 added retirement.

The current renderer only shows the additional-retirement line when `retirementAddedCents > 0`; the selected screenshot omits it for the middle option. Production must still use the actual engine value, not this inference from a screenshot.

The $33 “Simplest” contribution is a fragile modeled edge case: show the engine's sensitivity/review conditions, never label it “safe” merely because it meets a threshold in this snapshot. “More cash overall” is the illustrated selected state, not a default recommendation justified by the largest total alone. Choose according to the user's date, available cash, negotiation constraints and range checks. Every Nov 14, 2026 date here belongs to a fixed historical synthetic snapshot; never hardcode it or silently treat it as a feasible future receipt date.

**Cash by date is essential.** The mobile concept introduces a horizon selector. Actual implementation must offer the same distinction on desktop. If the user's goal has a date, lead with cash by that date only when the required cash movements and reserves are present. Otherwise show the known project receipts, explain the missing cash context and ask for it. Never turn $5,925 of receipts into $5,925 of spendable household money by changing a label.

If a gain attributed to Headroom is shown, separately compare feasible revised terms with the **original offer**, under identical facts and horizon. Do not substitute the vs-decline total. That extra metric is intentionally absent from the PNG because its verified value was not supplied.

**Current:** goal search, deterministic comparison, draft/PDF/ICS and agreement/payment lifecycle.  
**Planned/changed:** quieter composition, common horizon control, evidence/short explanations, revised historical export flow. A selected option is not a sent draft or client agreement.

## A complete journey beyond the screenshots

| Moment | Visible result and next action | Truth boundary |
|---|---|---|
| First visit | Offer / documents / figures / live example | No signup; scope visible before reliance |
| Import | What can be read, selected file, actual reading state | Specific consent before provider transfer; manual fallback |
| Review | Source, person, period, year, value and conflicts | Unknown does not become zero |
| Missing facts | 1–3 related questions with why and “I don't know” | Current-year task does not demand next year |
| Result | Plain answer, baseline, horizon, separate cash/retirement | No unqualified “best” or invented accuracy |
| Comparison | At most three meaningfully different feasible choices | Constraints and client agreement remain visible |
| Prepare | Client draft + concise PDF + calendar download | Nothing sent automatically |
| Agreement | Record exact terms and date | Chosen/shared/agreed are distinct states |
| Receipt / contribution | Amount + date + project/year before saving | “Mark done” cannot silently create a money fact |
| Return | “What changed?” beside current plan and next action | Preview before applying; one event, one revision |
| Recheck | What changed, what still works, what needs review | Do not silently renegotiate accepted obligations |
| Historical packet | Decision as of revision/date + current assessment separately | Old numbers are not relabeled as current |

The recurring home is a compact current plan: next real action, agreed unpaid commitments, received payments, contribution progress and latest estimate. It does not need charts about daily spending or a game-like health score. Natural-language updates are one convenient input, not the center of the product.

## Motion and tactile quality

Apple's motion guidance favors purposeful, brief, optional feedback. The following timings are **Headroom proposals**, not extracted Apple values. Animation never delays input or communicates a financial fact alone.

| Interaction | Motion | Semantic requirement |
|---|---|---|
| Button hover/press | 120ms color/border; no bounce or scaling of money | Same label, stable target |
| Open evidence | 180ms opacity + ≤8px movement | Focus moves to drawer; Escape closes; return focus |
| Change stage | 220ms opacity/≤8px; immediate interactive state | Preserve context and focus the new heading |
| Compare choice | 120ms selected fill; amount swaps immediately | Keep same baseline/horizon; no counting animation |
| Applied change | 600ms quiet background fade on affected rows | Persistent “Changed” text and before/after remain |
| Save success | Small check and “Saved …” label | Only after actual confirmation from storage |
| Document read | Honest indeterminate progress if genuinely running | No staged fake percentages or pretend OCR |
| Loading result | Retain inputs; set aria-busy; show pending status | Never briefly show a previous result as current |

Suggested easing: enter `cubic-bezier(0.22,1,0.36,1)`; exit `cubic-bezier(0.4,0,1,1)`; micro-feedback `cubic-bezier(0.2,0,0,1)`. Avoid autoplay motion, pulsing balances, parallax, confetti and artificial result-counting.

With `prefers-reduced-motion: reduce`: remove transforms, smooth scrolling and amount interpolation; use instant state changes or ≤80ms opacity and static progress text. Pending state and success remain perceivable without motion. Do not “fix” this only by setting every animation duration to 0.01ms; explicitly design the fallback.

## Accessibility and responsive acceptance

Target WCAG 2.2 AA, with stronger **44×44 CSS px** touch targets as the product choice. WCAG's AA minimum target criterion is 24×24 CSS px with exceptions; do not incorrectly call 44px its AA requirement. Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the web reference.

- Normal text ≥4.5:1; large text ≥3:1; meaningful non-text boundaries and focus ≥3:1. Color never carries a status alone.
- Visible 3px focus ring with 3px offset. Tab order follows reading order. Native buttons/radios where possible, labels visible; errors linked using aria-describedby.
- Menu and evidence dialog support keyboard, Escape, focus containment where appropriate and focus restoration. Sticky CTAs cannot obscure focused content.
- At 360px and at 200% zoom, preserve meaning without horizontal page scrolling. At 400% zoom / 320 CSS px reflow, use a linear reading order; only genuinely two-dimensional data tables may have their own scroll region.
- Radio choice rows use one labeled group; expected-payment timeline dots are small noninteractive timeline symbols, not checkbox-looking targets. Do not copy the PNG's hollow timeline circles literally.
- Before/after updates are text, not red/green-only diffs. Use polite status announcements after applying a change, not on every keystroke.
- Charts, if used later, include units, baseline, date horizon, direct labels and a text/table equivalent. No crucial value lives only in a tooltip.
- Source document images need a selectable-text alternative. Upload works through a file button as well as drag/drop.
- If AI/provider is off, the normal available-format and manual path remains; do not show an enabled PDF promise or fake processing.
- Errors, unsupported situations, local/cloud conflict, stale results and export failures all preserve input and give one usable next action.

## Verification performed and limitations

**Performed:** all six outputs visually inspected in the image tool; exact displayed comparison amounts and payment dates checked against the existing screenshot; file dimensions/modes inspected; selected logo alpha spans 0–255; all files copied to the project artifact folder; proposed contrast pairs calculated from exact sRGB values; font licensing checked against primary font-author sources; output hashes recorded.

**Not performed:** no production UI implementation, live responsive or keyboard audit of this direction, native-font rendering verification, independent tax recalculation, customer usability test, brand trademark search, or vector master production. The image generator's text looks legible and short labels match the requested copy, but the images are not a substitute for actual DOM, contrast, touch-target or export QA. The current public product was not changed.

Before release, open the exact guest URL, source-review route, ordinary-positive and cliff cases, PDF and calendar, mobile viewport and final deck that the jury will use. Use real screenshots of that release for public demonstration. Preserve the user's existing final materials and do not replace them with these concepts.

