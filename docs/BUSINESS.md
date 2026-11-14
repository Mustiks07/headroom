# Product value and contest evidence

Headroom's core is ACA subsidy protection for self-employed US households with changing income. It is not a generic gig-rate calculator. The complete experience goes from current risk to a feasible decision and later plan updates.

**Current research, November 15:** the [round 5 research memo](research/round5-business-research.md), [evidence register](research/ROUND5_EVIDENCE.csv) and [reproducible arithmetic](research/ROUND5_ECONOMICS_CHECK.py) update the assumptions below. The main paid-job hypothesis is an actionable decision about an open client contract, with household taxes, insurance and cash constraints accounted for. Neither willingness to pay nor repeat purchases have been established. A separate review of participant repositories, alternative business models and visual design is in progress; those proposals are not current product claims.

## Payment hypothesis

The current demo shows **$99 per year per household**. Compare this hypothesis with **$29 per decision** and **$49 per season**, stating exactly what each purchase includes. These are proposed price tests, not observed willingness to pay or a live billing change. The recurring value is maintaining a current household plan when work, pay, family income or insurance changes. A one-time cliff warning is not enough to justify an annual purchase.

Initial payment: a material personal decision and the ability to keep that decision current. Reuse: new work, canceled payment, spouse bonus, corrected forecast, open enrollment. Renewal: next year's income and insurance differ. If users only have a seasonal one-off need and do not renew, test a per-season/decision purchase rather than disguising low use as monthly retention.

Free insight should be useful and honest. Do not hide the fact that no special intervention is needed. In the contest all capabilities are accessible without login or actual payment, with a clearly marked demo/test commercial flow.

## Competition

- [MyTaxQuarter](https://mytaxquarter.com/aca-subsidy) provides a free ACA estimate and a [SEP/income-change discussion](https://mytaxquarter.com/blog/aca-subsidy-2026-freelancers-guide). Do not say it lacks ACA or SEP knowledge.
- [ACAIndex](https://acacreditindex.com/) provides a free cliff calculator and source registry. A gauge and official citations are not enough differentiation.
- [Bracketsight](https://www.bracketsight.com/aca) is free without signup and offers cliff distance, retirement levers and source explanations. Its published methodology also discusses SEHI/PTC iteration; that claim has not been independently audited here. Its page labels benchmark premiums as sample data. Do not claim a sourced deterministic cliff calculator is unique to Headroom.
- [ProjectionLab](https://projectionlab.com/pricing) has a $129/year plan, ACA calculations, scenarios and reports. Its [reconciliation documentation](https://projectionlab.com/help/aca-subsidy-reconciliation) explicitly handles advance credits. Do not claim it cannot model these outcomes.

Our concrete comparison task: current documents, a $12,000 opportunity, limited retirement cash, optional split payment and uncertain next-year income. Measure time to a correct and understandable feasible answer and time to update it after another fact changes. Document-first intake and ongoing plan revision are the proposed advantage; superiority over every feature of competitors has not been established.

[ProjectionLab's founder reported $1M ARR in June 2025](https://projectionlab.com/blog/we-reached-1m-arr-with-zero-funding). This supports paid demand in the broader planning category, not proven willingness to buy Headroom. There are no claimed Headroom payments or user interviews in this foundation.

## Evidence added on 15 November 2026

| Finding | Primary source and interpretation |
| --- | --- |
| 6,391,741 returns reported excess advance premium tax credit repayment, totaling $8,812,506,000 | [IRS filing-season workbook](https://www.irs.gov/pub/irs-soi/25inweek47.xlsx), `Filing Season` B83/B84; monetary figures are in thousands. Tax year 2024 returns processed through November 20, 2025. This is actual reconciliation at national scale, not all avoidable loss or Headroom's addressable market. |
| 23,130,860 people selected or automatically renewed a 2026 Marketplace plan | [CMS OEP state-level PUF](https://www.cms.gov/files/zip/2026-oep-state-level-public-use-file.zip), national Total/All row. People, not households or verified full-year paid coverage. Ages 26–44 sum to 8,173,935; this is not exactly the contest's 25–45 audience. |
| 455,449 people in TX/FL/TN fall in the broad >300%–500% FPL bands | Sum of the two relevant income bands for these states in the same CMS file. Includes all ages and employment types. It is not SAM; the required joint age/employment/household/eligibility/ability-to-pay breakdown is unavailable. |
| Self-employed applicants must estimate the coverage year's net income and update changed forecasts | [HealthCare.gov's self-employment guidance](https://www.healthcare.gov/self-employed/income/). It also describes detailed income/expense records when verification is requested. This supports an ongoing forecast-and-update job, not measured monthly use or willingness to pay. |

The national enrollment figure declined from the preceding open-enrollment period; do not describe the market as automatically growing. A large reconciliation total does not prove software can prevent that total.

## What to build and validate next

Round 3's product hypothesis is **one household forecast with several commitments, actual-versus-expected payments and a usable explanation of the forecast**. A new project is an entry point; another receipt, a corrected income estimate or renewal creates the next task. This targets a concrete limitation of disconnected calculations. It remains a proposed advantage until a like-for-like workflow comparison and user behavior support it.

Proposed validation with 6–8 recruited target households: ask about the last real forecast/update decision and current paid/free help; have the person use their own supported situation; observe whether they can confirm the assumptions, choose an action, explain its cash cost, and return after an actual change. Offer a clearly priced real purchase only when the payment/product setup is ready. Track completion, consequential mistakes, repeat use and actual purchase separately. A checkout click, compliment or synthetic demo is not a sale. Recruitment/outreach has not been performed by this repository work.

Prioritize an independent professional review of the decisive example and a small set of counterexamples. More unit tests do not replace that review or demand evidence. Free Marketplace assistance, brokers and existing accountants are alternatives to compare and possible acquisition partners, while the household remains the payer.

## Market and economics

[Treasury's 2022 analysis](https://home.treasury.gov/system/files/131/ACA-Mkt-Coverage-Self-Employed-Small-Business-Owners-09232024.pdf) identifies 3.3M self-employed/small-business owners aged 21–64 with Marketplace coverage at some point that year, with overlapping groups. It is not a current count of target households aged 25–45, people near a cliff, or paid prospects. Do not relabel it SAM.

At $99/year, $100M ARR requires roughly 1.01M paying households. The initial niche does not establish that scale. Expansion can follow the same job—decisions about household income, contracts and changes between employment and self-employment—but each expansion needs evidence. A change in subsidy law may also change willingness to pay, even if the engine is technically adaptable.

Modeled economics, not measured business results: with the existing Anthropic default, 20 documents plus 40 updates/year and a 2× token reserve, estimated annual AI cost is $12.16. At $99/year, assumed refunds, payment/billing fees, 20 support minutes and $540 fixed hosting allocated across 1,000 annual purchases yield $69.47 contribution before acquisition and other operating costs. A chosen 3:1 first-year contribution/CAC target permits $23.16 acquisition cost without assuming renewal. One free document with the reserve costs $0.36; at an assumed 5% free-to-paid conversion this alone adds $7.20 per payer. Current production AI is off. Rates, usage assumptions, model alternatives and support/scale sensitivities are documented in [section 7](research/round5-business-research.md#7-unit-economics-четыре-модели-с-явными-допущениями); do not present a cheaper alternative model's economics as the current stack.

## Contest criteria

| Weight | What judges should be able to observe |
| --- | --- |
| Product 40% | Real editable calculation, feasible actions, save/reopen/update/export; readable repo and bounded regression proof |
| Value/retention 20% | An actual decision and an updated saved plan after a new income event |
| Problem/user 15% | A specific household problem, source-backed stakes and honest user evidence when collected |
| Business 15% | Clear personal payer/price, honest assumptions, measurable acquisition/renewal and credible expansion questions |
| Originality 10% | A complete household decision with cash constraints and inspectable evidence, beyond a generic cliff gauge |

## English deck outline, maximum 10 slides

1. **More income. An unexpected health-insurance bill.** One specific problem and target household.
2. **Who this happens to.** User situation and sourced evidence, with honest market boundaries.
3. **Meet Headroom.** Current risk → feasible action → updated plan.
4. **See the decision change.** Actual working demo from the deployed build.
5. **Cash you can use. Retirement shown separately.** Verified model comparison, assumptions visible.
6. **Why another calculator is not enough.** Concrete workflow comparison without false competitor claims.
7. **A plan that stays current.** A real second event and changed result.
8. **A household pays for a decision.** Price hypothesis, acquisition test and renewal mechanism.
9. **Built to be checked.** Rule versions, traces, meaningful regressions, supported boundaries.
10. **From a focused problem to a larger business.** Measurable next steps and honest scaling assumptions.

Claude 1 supplies the real UI captures/visual assets; Claude 2 validates all numbers/claims; Claude 3 assembles the final artifact links and verifies they match the deployed release. Final deck preparation/review is coordinated with the owner/Codex after the actual integrated app exists. Do not replace any user-provided final deck with a weaker generated version.
