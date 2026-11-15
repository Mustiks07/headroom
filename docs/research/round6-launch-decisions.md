# Headroom launch decisions from the remaining research questions

Updated November 15, 2026. This is an internal product and business decision record. It does not replace the final presentation. The pitch should lead with the customer result, the working product, a concrete advantage and a credible growth plan. **Do not add an “our weaknesses” slide or self-congratulatory statements about honesty.** Keep detailed validation notes for preparation and Q&A. Numbers retain their actual units and sources.

## 1. First customer and purchase

Start with an independent professional aged 30–45 who has Marketplace coverage, a material upcoming client offer, and at least one condition they can change: price, a genuinely negotiable payment arrangement, or an affordable eligible retirement contribution. A spouse's earnings and the family's coverage make this a household decision. This is the chosen initial segment, not a measured customer population.

The purchased outcome is a **decision on this offer**, with a reply to the client and subsequent revisions. It is not an alert that income has crossed a line. A person without an offer can still check their annual income; that entry remains useful but should not be forced into the same purchase promise.

The official CMS training material itself describes a self-employed website designer with regular clients and irregular freelance work. It also explains why changing income requires updated Marketplace estimates. This supports the problem and return triggers, not a willingness-to-pay figure. [CMS unpredictable-income training](https://www.cms.gov/marketplace/technical-assistance-resources/unpredictable-income)

**Product decision:** ask whether the price or terms can be discussed before presenting them as options. Keep the ordinary positive-offer result: sometimes the useful answer is simply to accept. Do not create a loss to manufacture a reason to pay.

## 2. Where the initial market actually is

Downloaded the official CMS 2026 state and county PUF ZIPs. The source counts **people with medical plan selections during open enrollment**, including automatic re-enrollment, regardless of whether the premium was paid. These are not households, active policies in November, self-employed people, or prospective Headroom purchasers. [CMS source page and files](https://www.cms.gov/data-research/statistics-trends-reports/marketplace-products/2026-marketplace-open-enrollment-period-public-use-files)

| Geography | All plan selectors | Published age bands 26–44 | Published income band >300%–400% FPL, all ages | Broker-assisted share of all selectors |
| --- | ---: | ---: | ---: | ---: |
| Texas | 4,172,233 | 1,490,336 | 171,791 | 82.9% |
| Florida | 4,538,772 | 1,639,463 | 187,383 | 86.3% |
| Tennessee | 569,310 | 211,740 | 35,017 | 71.5% |
| Three states | **9,280,315** | **3,341,539** | **394,191** | **83.8%** |
| US, 50 states and DC | 23,130,860 | 8,173,935 | 1,907,986 | Not reported nationally |

The income band is household income relative to FPL, not business revenue or profit. It is broad and does not establish that someone is about to cross a cliff. The published age bins do not give an exact current-age 25–45 count. The definitions PDF even specifies a January 1, 2025 age reference for HealthCare.gov; preserve the “published age bands” label rather than silently correcting that source definition. [CMS definitions, pages 2–4, 7–8 and 12–13](https://www.cms.gov/files/document/2026-public-use-files-definitions.pdf)

The data do not cross-tabulate age × self-employment × income × tax household × control over client terms. Do not multiply marginal percentages and call the result SAM. The analysis reconciles all 51 state/DC records to the national control, and county enrollment to state totals. Suppressed income cells remain unknown: 12 Texas cells and 2 Tennessee cells account for differences of 56 and 26 people from known-county sums.

Reproducible calculation and source archive hashes: [script](cms2026-market/profile.py), [results](cms2026-market/results.json). The local raw archives are a download cache, not required application assets. No spreadsheet source was edited.

**Business decision:** use the three states as a credible launch geography, with targeted recruitment inside them. The national number is category context. A pitch can say: **“We start where the problem is concentrated: independent professionals buying their own health insurance.”** If adding a chart, label it `2026 Marketplace plan selectors` and show the initial states highlighted, not a made-up paid TAM.

## 3. Distribution should follow existing help

Across the three states, 7,780,292 of 9,280,315 selectors were assisted by an agent or broker. That includes previous broker assistance carried into automatic re-enrollment; it does not mean each person had a fresh consultation. The ratio is 83.84% from the matched CMS fields.

HealthCare.gov already offers free application and enrollment assistance. Therefore “help understanding subsidies” alone is a weak paid acquisition message. [HealthCare.gov assistance](https://www.healthcare.gov/apply-and-enroll/get-help-applying/)

**Business decision:** test distribution alongside independent ACA brokers and communities of independent professionals. The consumer still buys Headroom; the partner is a route to the consumer, not counted B2B revenue. Provide a user-controlled calculation record that complements the broker's enrollment task. Do not promise the broker will recommend it, imply an existing partnership, or assume referral work is free.

First test order: broker/community-assisted discovery, then tightly scoped search intent around an actual offer or changing annual income. Measure qualified own-data completion and purchase by source. Broad paid acquisition should wait until those economics support it. No outreach or paid campaign was performed in this research.

## 4. A real payment change, not an invoice-date trick

For cash-method taxpayers, income can count when received or made available without restriction. Waiting to deposit a check does not automatically move the income to another tax year. [IRS Publication 538, Cash Method and Constructive receipt](https://www.irs.gov/publications/p538)

**Product decision:** separate these states: proposed terms, accepted terms, expected payments and actual receipts. A cross-year option requires the relevant accounting and availability conditions, plus the client's agreement. It never re-dates money already received. If the client rejects the proposal, the original offer and received deposits remain and the answer is recalculated. This is a substantive difference to demonstrate, not merely another calculator field.

Updating the Marketplace estimate is a separate action from changing a client contract. CMS recommends prompt reporting of income changes and describes choosing a smaller advance credit; that changes the timing of assistance and repayment exposure, not automatically the family's final entitlement. Do not count reduced advance payments as extra savings. [CMS income guidance](https://www.cms.gov/marketplace/technical-assistance-resources/unpredictable-income)

## 5. Price and acquisition economics

Use **$29 for one offer and 30 days of revisions** as the first real willingness-to-pay experiment. A subsequent $49 / 90-day period is a repeat-use test. Current annual pricing in the contest app remains a proposed package; all contest functionality stays accessible without an account or payment. Do not publish three competing pricing stories simultaneously.

The newly integrated [Claude 2 economics model](round6-economics.md) accounts for the BasisWeb AI price as an unknown variable. Its base case gives $19.16 contribution on a $29 decision and $48.35 acquisition cost. Thus the inexpensive first purchase alone cannot fund that modeled paid channel. The annual $99 base case gives $68.69 contribution and 2.49× 36-month contribution LTV/CAC under the specified conversion and renewal assumptions. These are calculated scenarios, not observed sales or costs.

**Business decision:** do not solve this by asserting a high lifetime value. Keep the paid pilot low-touch, measure support and provider spend, and test a channel that can earn back acquisition on the first purchase. Use renewal only after users encounter and complete a second meaningful event. The deck should present the chosen package and the conditions for attractive economics, supported by this model.

## 6. Repeat use and expansion

Return triggers are a new client offer, a counteroffer, a partial receipt, changed spouse income, or a changed coverage fact. A calendar notification is a delivery mechanism, not proof of retention. Track both the opportunity for a new decision and whether the person completes it. Compare event-driven use with seasonal use before choosing automatic renewal.

**Expansion decision:** keep ACA as the initial costly problem and grow the same offer-decision workflow through more supported household situations and states. Only then evaluate broader independent-worker take-home decisions. This is a roadmap, not a claim of current coverage. Payment scheduling should remain useful even when a case has a gradual subsidy change rather than a cliff.

At $99 annually, $100 million ARR requires 1,010,102 active annual subscribers. A national total of 1,907,986 *people of all ages* in the published 300–400% income band cannot by itself substantiate that household subscription ambition. The growth story therefore needs repeat decisions and broader supported situations, not just a warning near one threshold. One-time decision revenue is not ARR.

## 7. Evidence to capture from the final working release

One finite demonstration should establish the advantage: paste the offer, confirm missing facts, see the offer as written, choose feasible terms, apply a client response or partial payment, and reopen the updated plan. Capture elapsed time, manual corrections, the resulting financial trace, and one export from the same final commit. This is a technical product benchmark. Customer behavior and purchases require real participants and cannot be produced by another code agent.

Pitch emphasis: **“Headroom turns a client offer into a plan for the money your household keeps—and keeps that plan useful when the deal changes.”** Follow it with the working result, the first buyer, the distribution choice and the expansion path. Detailed research qualifications belong next to the relevant quantitative claim or in preparation notes, not on a slide devoted to weaknesses.
