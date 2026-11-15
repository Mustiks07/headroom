# Headroom — Business Cup presentation

[Open the app](https://headroom-amber.vercel.app) · [Download the 10-slide PDF](https://raw.githubusercontent.com/Mustiks07/headroom/main/docs/presentation/headroom-business-cup.pdf) · [Run the live demonstration](../demo/round6-judge-script.md)

English, 16:9, ten slides. Each finished slide was generated separately with its text, following Headroom's selected cobalt/chrome/chartreuse identity. Figures were checked against the combined round 6 build. Speaker notes and full sources are below; the PDF links to this evidence page without adding an eleventh slide.

## Five-minute delivery

| Slide | Time | Say and show |
|---|---:|---|
| 1. Before you say yes. | 15s | A client offer has a household price. Headroom helps independent professionals with Marketplace insurance see what remains after taxes and insurance, before agreeing. Our initial consumer is a US adult aged 25-45. |
| 2. The problem | 25s | A $12,000 project is not automatically $12,000 of progress. In this illustrative Tennessee family, the original terms leave $3,616 less household cash than declining. Crossing the subsidy limit can change the whole decision. |
| 3. Same fee, better terms | 30s | Keep the fee. Change the permitted payment schedule: $5,400 on December 15 and $6,600 on January 4. The calculated result is $8,310 extra cash versus declining, an $11,926 improvement over the original terms. The client must agree and the payment timing must be genuine. |
| 4. Bring the offer | 40s | Switch to the live app. Show an offer and its confirmed facts, then the saved household. The app asks for what the calculation needs. AI reads; code calculates. Click Find workable terms on the prepared case. |
| 5. Keep the decision current | 40s | Prepare and edit the client reply, save the terms, then preview a client response or partial payment. Original terms remain in history; expected payments remain distinct from received money. Show the PDF action once, then return to the deck. |
| 6. Difference | 25s | ACA calculators and financial planners already exist. Our product is built around this specific job: take a real offer, respect the household's cash and timing constraints, prepare a reply, and update the decision when the deal changes. |
| 7. Purchase and repeat | 30s | Launch with one usable decision for $29, including thirty days of revisions. Repeat project work supports an annual $99 plan. We will validate repeat use before treating annual retention as established. The household pays; the contest app is free. |
| 8. Market | 25s | CMS reports 3.34 million plan selections in the published 26-44 age bands across our three starting states, and 8.17 million nationally. That establishes category reach. We begin with independent professionals facing a material client decision, then expand supported coverage. |
| 9. Distribution and economics | 45s | In those states, 83.8% of selections were broker-assisted, including assisted renewals. This points to broker referrals and worker communities as the first channel tests. Our annual scenario produces $120 contribution LTV over 36 months against modeled CAC of $48.35. Its conversion, renewal and cost assumptions are explicit and reproducible. |
| 10. Close | 25s | Start with one costly decision. Expand supported states, household types and repeat independent-work decisions. $100 million ARR at $99 needs roughly 1.01 million paying households. The product, public code and calculation evidence are available now, with no account required. |

Total: 300 seconds. Keep the separate two-to-three-minute walkthrough for questions or a longer demonstration. Do not attempt to fill an entire household from scratch during this five-minute slot.

## Claim-to-evidence index

| Slides | Claim | Evidence |
|---|---|---|
| 2-3 | Case amounts and same-price payment split | [Inputs, cases and results](../artifacts/round6/scenarios/decision-cases.md), [actual UI exports](../artifacts/round6/ui/), [independent calculation oracle](../../tests/engine/oracle.ts) |
| 2-3 | Premium tax credit and genuine receipt timing | [IRS PTC questions and answers](https://www.irs.gov/affordable-care-act/individuals-and-families/questions-and-answers-on-the-premium-tax-credit), [IRS Publication 538](https://www.irs.gov/publications/p538), [versioned source registry](../SOURCES.md) |
| 4-5 | Working browser flow, intake, updates, PDF, calendar | [Combined release verification](../handoffs/integration-round6.md), [Claude 1 handoff](../handoffs/claude1-round6.md), [technical proof](../demo/round6-technical-proof.md) |
| 6 | Existing competitors and specific workflow focus | [MyTaxQuarter ACA](https://mytaxquarter.com/aca-subsidy), [Bracketsight methodology](https://www.bracketsight.com/aca/methodology), [ProjectionLab ACA reconciliation](https://projectionlab.com/help/aca-subsidy-reconciliation), [comparison research](../research/round6-competition-pitch.md) |
| 7 | Proposed packaging and repeat-use model | [Launch decisions](../research/round6-launch-decisions.md), [pricing research](../research/round6-monetization-review.md) |
| 8-9 | 3.34M, 8.17M, 83.8% | [CMS 2026 OEP public-use files](https://www.cms.gov/data-research/statistics-trends-reports/marketplace-products/2026-marketplace-open-enrollment-period-public-use-files), [reproducible analysis](../research/cms2026-market/profile.py), [results](../research/cms2026-market/results.json) |
| 9-10 | Contribution LTV, CAC, scale arithmetic | [Business model, formulas and sensitivities](../research/round6-economics.md), [executable model](../../scripts/business/round6-economics.ts) |

The CMS figures are people selecting plans during open enrollment, not households, November active enrollment or qualified customers. Published 26-34 and 35-44 bands are combined; they are not an exact 25-45 count. The three-state broker share is 7,780,292 / 9,280,315 = 83.8365%. The selection statistic describes an existing channel; Headroom has not established broker partnerships.

The annual financial scenario assumes $99 price, 5% refunds, $10 AI usage per annual payer, 20 support minutes at $30/hour, $1.50 variable infrastructure and card/billing fees. Contribution is $68.686/year. At 50% annual renewal, 36-month contribution LTV is $68.686 × (1 + 0.5 + 0.25) = $120.2005. Modeled CAC includes $1 CPC, a 35% qualified share, 60% activation, 12% paid conversion among activated users, $0.50 free-AI usage per activated non-buyer, and $5 other acquisition cost: $48.35. These are planning inputs, not measured Headroom cohorts. Actual gateway dollar cost has not been established. Fixed hosting is excluded from contribution LTV and deducted once at business level.

## Answers to likely questions

**Why pay when ACA calculators are free?** The paid job is finding permitted terms for a specific deal and its real revisions, using the household's existing agreements, cash needs, dates and retirement limits. Free estimates remain a valid alternative for someone who already knows the inputs and does not need the workflow.

**Why return?** A client counters, a deposit is smaller than agreed, an expected payment moves, or a new project arrives. These change the decision. Revisions to the same purchased case are included; new demand is not inferred from correcting product mistakes.

**How does this scale?** Broaden verified state and household coverage, then support repeated independent-work decisions. At $99/year, $100M ARR requires 1,010,102 annual paying households. The category counts are not proof that this many households will buy.

**What is actually validated?** A working public product, reproducible financial cases, real exports, guest persistence and isolation, targeted live-provider requests, primary-source market analysis and an executable business model. The current release has not generated measured paid demand or retention.

**Can the AI invent tax numbers?** The language model proposes extracted facts and explanations. Users confirm data; money is calculated by the deterministic versioned engine. Missing or unsupported facts block the relevant result.

## Submission package

- Product: https://headroom-amber.vercel.app
- Public source: https://github.com/Mustiks07/headroom
- Deck: `docs/presentation/headroom-business-cup.pdf` (10 pages)
- Short description: **Headroom turns a client offer into a household decision: understand what remains after taxes and health insurance, choose workable terms, and keep the plan current when the deal changes.**
- Track: Money. B2C. Browser only. English UI and deck. No registration or payment gate.

The artifacts are prepared for submission. Uploading to an organizer's portal is a separate action; this file is not a submission receipt.
