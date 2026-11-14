# Headroom design and English copy

Owner: Claude 1. The foundation homepage is a developer starting point, not the final product UI. Replace its development copy when the actual journey exists. Never remove the unavailable state before the real implementation is connected.

## Product story

The first thing a visitor should understand: income changes can affect their health-insurance subsidy, and Headroom helps them plan. Keep ACA/subsidy protection central. Do not lead with a generic finance dashboard, a chat box, a bank-connect wall or an unexplained negative number.

Hero: **Plan your income. Protect your health-insurance subsidy.**

Supporting copy: **See how changing income affects your family's coverage—and compare what you can do next.**

Primary CTA: **Check my subsidy**. Secondary: **Try a sample household**. Contextual action: **Check a new project**.

## Information structure

Use three main work areas: **Your household**, **Compare options**, **Your plan**. Current risk appears after the current-year facts are ready. Next-year questions appear when comparing actions that need them. Document review and evidence are panels within this flow, not six mandatory onboarding pages.

The household summary stays visible while comparing, but details are collapsible. Edit a value in place; do not restart the flow. Show required unknowns before giving a confident recommendation. Current-year assessment works without inventing a project or next-year income.

## Result hierarchy

1. Plain-language finding, with the relevant year and assumptions.
2. Main financial delta with an explicit baseline and settlement horizon.
3. Feasible next action or exact missing information.
4. Separate cash, retirement, tax and subsidy details.
5. Expandable evidence and source trail.

No giant net-worth number formed by adding a pension contribution to available cash. Do not frame every additional dollar as harmful. For an ordinary project: **“This project increases the cash your family keeps.”** If no intervention helps: say that.

Example labels: **“Cash after tax-year settlements”**, **“Compared with not taking this project”**, **“Moved into retirement savings”**, **“Estimated advance credit to repay”**, **“2026 + 2027”**. A concise help panel explains that the final 2027 settlement occurs in 2028.

Risk language: **“Your subsidy may be at risk”**, not **“You will definitely lose $X”** when income/rates are estimates. With unknown spouse income: **“Your spouse's income could change this answer. Add the latest pay stub or enter an estimate.”**

## Comparison interactions

Side-by-side cards on desktop; stacked cards with a sticky summary on mobile. Show accept-as-offered, pension alternatives and split payment when feasible. Infeasible options can explain why, but are never selected as recommended.

Controls: **“Maximum I can put into retirement”**, **“Can the client split the payment?”**, **“Can I negotiate the price?”**, **“What if income changes?”**. Label a scenario buffer by its actual checked range. Avoid probability gauges without a model.

Use a compact waterfall for gross project income → expenses → taxes/subsidy change → extra cash. A two-year breakdown makes payment timing clear. All values come from scenario output. A chart with constant placeholder numbers is not acceptable.

Any input edit invalidates the old recommendation and explanation until recalculation completes. Preserve the previous plan for comparison, visibly dated/versioned, without mixing its numbers with new inputs.

## Trust and execution

Every key figure has **“Show the calculation”**. Evidence drawer shows the field, document excerpt or manual estimate, tax year, source rule and relevant limitation. No unexplained accuracy percentages or government-verification badges.

After **“Use this plan”** show a short checklist with real conditions and dates, PDF/JSON export and **“Something changed”**. A completed action requires user confirmation; a draft letter is not a sent letter. Saving shows either **“Saved in this browser”** or a truthful cloud status.

Pricing: **“$99 / year, per household”**, label the offer as the launch pricing hypothesis in internal materials. Demo access stays fully available without entering card details. Test checkout copy: **“Demo checkout. No payment will be collected.”** Never show invented testimonials or customer counts.

## Visual direction

Calm, editorial financial tool: warm off-white background, dark ink, restrained green for positive/available actions, amber for uncertainty and red only for actual negative change. Generous type hierarchy and clear numerical alignment. The existing CSS tokens are a starting point, not a restriction on improving the layout.

Use purposeful motion for changed amounts and panel transitions, with reduced-motion support. Avoid decorative charts, stock-photo heroes, neon gradients, fake AI typing and dense card grids with no action hierarchy. Provide visible keyboard focus, error associations and readable contrast. Check 360 px and desktop once the actual flow is integrated.

## Required states

Loading, empty profile, input validation, unknown facts, unsupported case, no-risk result, cliff result, no feasible intervention, stale result, AI unavailable/failed, local/cloud save and save conflict, export failure and recovery. Each state includes a next step. Do not discard form values on recoverable errors.
