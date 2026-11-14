# Headroom — round 5 positioning

Status: **draft for the deck and the homepage, reviewed against `docs/research/round5-business-research.md`, `docs/research/HEADROOM_PAID_VALUE_STRATEGY.md` and `docs/tasks/ROUND5_RESEARCH_ADDENDUM.md` (15 Nov 2026).** No ad was run, no price was tested, no person was contacted. Every product number below was read from the running build on 14 Nov 2026 with the synthetic sample household; dates move some of them (payment windows start "today").

## Who it is for (primary segment)

Independent professionals (designers, developers, consultants, coaches), roughly 30–45, who buy family coverage on the ACA Marketplace with an advance premium tax credit and whose project income arrives unevenly. Secondary: single freelancers in the same position. Scope of this version: TX, FL, TN; single or married filing jointly; one sole-proprietor business; 2026–2027.

The research supports keeping ACA as the reason the decision matters, and selling the **decision about a concrete contract**, not "another ACA calculator". This is a testable bet, not proven product–market fit; the size of the reachable segment has not been computed honestly yet (research §1.6).

## Why they open it today

1. **A client offer is on the table** ("$12,000 for a December project") and they don't know what it leaves the family after taxes and the subsidy, or which price/dates to ask for.
2. **Something changed**: a payment slipped to January, money arrived, a SEP-IRA contribution was made, the income forecast moved.

## What a paid result is (hypothesis)

A finished review of one offer: the facts it relied on, what the offer leaves the family after both tax years, up to three calculated terms that meet the family's own goal (or an honest "no terms in your limits"), and the agreed decision kept as a record with a current calendar. The repeat reason is the next offer or the next change applied to the same plan.

Packaging hypotheses to test side by side (research §1.4): **$29 per decision, $49 per season, $99 per year.** No checkout charges money; demand is not established. The judge demo stays fully open without signup or payment.

## Honest alternatives

Free ACA calculators and cliff estimators; planning software that already models ACA and reconciliation (ProjectionLab); tools with document vaults and AI-confirmed plan changes (Boldin); free tax-lever finders (Bracketsight). Documents, AI updates, a deterministic engine, sources and calendars are **not** unique and must not be claimed as such (addendum §6). The difference to show is one complete scenario: a real offer → missing facts → terms that keep the money the family needs → agreement → a later change applied to the same plan, with the original offer kept as the counterfactual.

## Landing copy

0. *(live)* **Know what a client offer leaves your family — and find terms that work.** / Bring the offer and your figures. Review the facts, compare the terms, and keep the plan up to date as payments arrive. Entry points: Check a client offer · Check my year's income · Try a sample.
1. **Know what your next contract leaves for your household.** / Compare price, payment timing and retirement contributions using your income records, cash limits and Marketplace coverage. *(research headline)*
2. **Before you say yes to the next project, see what it does to your health-insurance subsidy.** / Headroom checks the offer against your family's income and Marketplace plan, then shows prices and payment dates that keep more of it.

Only one homepage is live at a time; switching is a deliberate decision, not a silent experiment.

## Three ad concepts (NOT launched — drafts only)

| # | Pain | Promise | Proof in the product (synthetic sample, read 14 Nov 2026) | CTA |
|---|---|---|---|---|
| A | "A December invoice might cost us our 2026 subsidy." | See what the offer leaves your family after both tax years. | Sample household, $12,000 offer: as offered −$3,166 vs. declining; the smallest change that meets the goal (same price, $400 now + $11,600 on Jan 4, 2027) +$8,300. | Check a client offer |
| B | "The client is flexible on dates — which dates should I ask for?" | Up to three calculated terms that meet your goal, or an honest no. | Three options with cash vs. declining **and** vs. the offer as it stands, "Needs the client's agreement" next to changed terms, "Little room" warnings; "no terms in your limits" card. | Find terms for my goal |
| C | "Every time a payment moves I redo the spreadsheet." | Say what changed; see the effect before anything is saved. | "The bakery final payment moved to January 8, 2027" → preview (2027 credit $16,652 → $0, agreed terms no longer meet the goal) → Apply = one revision; the same sentence again saves nothing. | Continue your plan |

No CTR, CAC, conversion or testimonial numbers exist; none may be shown. The first Business Cup winner reported a competitor ad analysis and a financial model; that does not mean they ran ads or measured CAC (research §2) — our concepts are labelled as unlaunched.

## Deck outline (English, ≤ 10 slides)

Placeholders in [brackets] must be filled with verified evidence or screenshots of the deployed build (`docs/demo/round5-screenshots/` holds this build's).

1. **A client offer can cost a freelance family its health-insurance subsidy.** Problem in one sentence + [sourced IRS/KFF fact from the research memo].
2. **Who this happens to.** Segment above; "not yet interviewed" unless interviews exist.
3. **Start with the offer.** [r5-landing.png, r5-start-paste.png] Upload / paste / enter figures as equal ways in.
4. **Only the questions that matter.** [r5-own-deal-readiness.png] 1–3 questions with a reason and "I don't know yet"; unknown never becomes $0.
5. **Terms that keep the money you need.** [r5-variants.png] One pick first; two labelled comparisons; client agreement shown; approximate search disclosed.
6. **Why this option.** ["Why these options?" panel] Built only from the calculated packet.
7. **Agreement and records.** [r5-records.png, r5-decision-record-pdf-1.png] Historical record kept separately from today's estimate; current calendar.
8. **The plan stays current.** [r5-what-changed-preview.png] Sentence → preview → Apply → one revision.
9. **Business model.** $29 / $49 / $99 packaging hypotheses; unit economics from `docs/research/round5-unit-economics.md` marked as scenarios, not measurements.
10. **Built to be checked.** Scope limits, versions, sources, tests; live URL after verification.
