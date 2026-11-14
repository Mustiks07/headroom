# Headroom — round 5 positioning (draft for review)

Status: **draft**. No ad was run, no price was tested, no user was interviewed for this document. Market figures below are only those already sourced in `docs/BUSINESS.md`. `docs/research/round5-business-research.md` did not exist when this was written; replace or confirm the assumptions here when it lands.

## Who it is for (primary segment)

Independent professionals (designers, developers, consultants, coaches) aged roughly 30–45 who:
- buy family health insurance on the ACA Marketplace with an advance premium tax credit, and
- have project income that arrives in uneven amounts at uneven times.

Secondary: single freelancers in the same situation. Scope today: TX, FL and TN; single or married filing jointly; one sole-proprietor business (see the app's "What this version covers").

## Why they open it today

A concrete client offer is on the table ("$12,000 for a December project") and they don't know what it does to the family's subsidy and taxes, or whether a different price or payment date would be better. The second trigger is a change: a payment slipped to January, a deposit arrived, a SEP-IRA contribution was made.

## What they could pay for (completed result)

A decision they can act on and keep current, not a one-time number:
- what the offer leaves the family after both tax years, with the subsidy effect;
- up to three calculated terms that meet their own goal (cash kept, money by a date, retirement cap), or an honest "no terms in your limits" with the smallest change that would work;
- a message draft for the client, a calendar file and a decision summary for their accountant;
- updates when payments and contributions actually happen.

Price hypothesis stays **$99 / year per household** (`docs/BUSINESS.md`). Not validated.

## Why they come back

A second offer, a moved or partial payment, a SEP contribution, a corrected income forecast, open enrollment for next year. Each one changes the same household plan instead of starting over. (Retention is a hypothesis; there is no usage data yet.)

## Honest alternatives

Free ACA calculators and cliff estimators (e.g. MyTaxQuarter, ACAIndex) and planning software with ACA modelling (ProjectionLab, paid). Headroom's claimed difference is the **workflow around a specific offer** — terms search against the family's own goal, fixed received money, SEP cash, and updating the plan after events — not superior tax knowledge. See `docs/research/competitor-workflow.md` for what was actually observed; do not claim a competitor lacks a feature that wasn't checked.

## Two landing-copy alternatives (not live; current homepage is variant 0)

0. *(current)* **Know what a client offer leaves your family — and find terms that work.** / Bring the offer and your figures. Review the facts, compare the terms, and keep the plan up to date as payments arrive.
1. **Before you say yes to the next project, see what it does to your health-insurance subsidy.** / Headroom checks the offer against your family's income and Marketplace plan, then shows prices and payment dates that keep more of it.
2. **One plan for your freelance year: offers, payments and your Marketplace subsidy.** / Add an offer or a payment, see what changed for your family, and know the next step.

Only one homepage is live at a time; switching is a deliberate decision, not an experiment run silently.

## Three ad concepts (NOT launched — drafts only)

| # | Pain | Promise | Proof in the product | CTA |
|---|---|---|---|---|
| A | "A December invoice might cost us our 2026 subsidy." | See what the offer leaves your family after both tax years. | Sample household: accepting $12,000 as offered shows −$3,436; splitting the payment shows +$8,315 (synthetic, live engine). | Check a client offer |
| B | "The client is flexible on dates — which dates should I ask for?" | Up to three calculated terms that meet your goal, or an honest no. | Goal search with price range, payment windows and SEP cap; "no terms in your limits" card with the smallest change that would work. | Find terms for my goal |
| C | "Every time a payment moves I redo the spreadsheet." | Tell Headroom what changed; it updates the plan and shows the next step. | Documents/receipts recorded as facts, attention list, plan revisions and history; repeated import adds nothing twice. | Continue your plan |

No CTR, CAC, conversion or testimonial numbers exist; none may be shown.

## Deck outline (English, ≤ 10 slides)

Placeholders in [brackets] must be filled with verified evidence or real screenshots from the deployed build. This outline does not replace a user-provided final deck.

1. **A client offer can cost a freelance family its health-insurance subsidy.** One sentence of the problem + [sourced fact on Marketplace self-employed enrollment from `docs/BUSINESS.md`].
2. **Who this happens to.** The segment above; [interview/research evidence if collected — otherwise say "not yet interviewed"].
3. **Meet Headroom.** Offer → facts → terms → action → update. [Screenshot: homepage three entries].
4. **See the decision.** [Screenshot: sample household verdict + three tiles]. Numbers labelled synthetic.
5. **Terms that meet the family's goal.** [Screenshot: up to three options; no-terms card]. Approximate search disclosed.
6. **From choice to action.** [Screenshots: client draft, calendar, decision PDF page]. Nothing is sent automatically.
7. **The plan stays current.** [Screenshot: document import → payment recorded → attention list; revision history].
8. **Why not a free calculator?** Workflow comparison from `competitor-workflow.md` [observed facts only].
9. **Business model.** $99/year per household hypothesis; what would have to be true (renewal, CAC) — [research memo figures if available, marked as assumptions].
10. **Built to be checked.** Versions, sources, tests, scope limits; live URL [https://headroom-amber.vercel.app after verification].
