# Headroom round 6 business model (hypotheses)

Owner: Claude 2. Script: `scripts/business/round6-economics.ts` (`node --experimental-strip-types scripts/business/round6-economics.ts`). Inputs: [round6-paid-demand.md](round6-paid-demand.md) §5–6, [round6-economics/](round6-economics/) (researcher model), [round6-competition-pitch.md](round6-competition-pitch.md), [round6-monetization-review.md](round6-monetization-review.md).

**Everything here is modelled.** There are no Headroom customers, payments, measured conversion, CAC, refunds, support time or retention. The only observed inputs are list prices: Stripe US card 2.9% + $0.30 per charge; Stripe Billing 0.7% on recurring charges; Supabase Pro $25 + Vercel Pro $20 a month ($540/year fixed hosting, deducted once at business level). The deployed AI runs through the **BasisWeb gateway, whose dollar cost is not known**: it reports tokens and enforces call caps. AI cost is therefore a variable **A** (full AI cost of one paid period, failed attempts included) shown at several values. The earlier direct-Opus budget ($12.16/year for the annual workload) is a reference point only, and it is not used as COGS. This model is separate from the customer tax engine.

## Formulas

```text
Contribution(period) = Price × (1 − RefundRate)
                     − [Price × (2.9% + 0.7% if recurring) + $0.30]      fees stay on refunded sales
                     − SupportMinutes / 60 × $30                         software support, not tax review
                     − VariableInfra − A
CAC   = CPC / (VisitorToQualified × QualifiedToActivated × ActivatedToPaid)
      + FreeAIPerActivatedNonBuyer × (1 − ActivatedToPaid) / ActivatedToPaid
      + OtherAcquisitionPerPayer                                         CAC is not CPC
LTV36 = Contribution × (1 + r + r²)          annual, r = annual renewal (assumed)
      = Contribution × (1 + repeat)           case / season, one assumed further purchase
      = Contribution × (1 − (1 − c)^36) / c   monthly alternative, c = monthly churn (assumed)
Break-even ActivatedToPaid for LTV36 ÷ CAC = k:
      p* = (CPC / (q × a) + F) / (LTV36 / k − Other + F)
Households for $100M ARR = $100M / annual price;  new per year (steady state) = households × (1 − r)
```

A payer's own AI use is inside A, and an activated non-buyer's free AI is inside CAC, so neither is counted twice. If AI also runs for visitors who are out of scope, add that cost to CAC as well; the first scope check should run before any paid extraction.

## 1. Research arithmetic re-checked

| Figure | Recomputed | Matches |
|---|---:|---|
| Contribution before AI, $29 case (memo: $21.159) | 21.159 | yes |
| Contribution before AI, $49 season (memo: $36.729) | 36.729 | yes |
| Contribution before AI, $99 annual (memo: $78.686) | 78.686 | yes |
| Contribution before AI, $149 annual (memo: $124.386) | 124.386 | yes |
| Illustrative CAC q=35%, c=5%, CPC $1, F=$0.20, other $5 (memo: $65.94) | 65.943 | yes |
| Annual99 LTV36 at A=$10, r=50% (memo: $120.20) | 120.200 | yes |
| round6-economics model: annual99 contribution with Opus A=$12.16 ($66.53) | 66.526 | yes |
| round6-economics model: qualified-first CAC ($31.81) | 31.807 | yes |
| round6-economics model: annual99 LTV36 at 25% renewal ($87.32) | 87.315 | yes |
| Active households for $100M ARR at $99 (1,010,102) | 1,010,102 | yes |
| Active households for $100M ARR at $149 (671,141) | 671,141 | yes |

## 2. Contribution per paid period vs unknown AI cost A (before CAC and fixed hosting; refunds 5%)

| Product | Before AI | A = $1 | A = $5 | A = $10 | A = $30 | Break-even A |
|---|---:|---:|---:|---:|---:|---:|
| case29 (one decision, 30 days) | $21.159 | $20.16 | $16.16 | $11.16 | −$8.84 | $21.16 |
| season49 (90 days, no auto-renew) | $36.729 | $35.73 | $31.73 | $26.73 | $6.73 | $36.73 |
| annual99 | $78.686 | $77.69 | $73.69 | $68.69 | $48.69 | $78.69 |
| annual149 (price test) | $124.386 | $123.39 | $119.39 | $114.39 | $94.39 | $124.39 |
| monthly15 (alternative) | $11.810 | $10.81 | $6.81 | $1.81 | −$18.19 | $11.81 |

## 3. Conservative / base / upside (all inputs hypothetical)

| Input | Conservative | Base | Upside |
|---|---:|---:|---:|
| CPC | $1.50 | $1.00 | $0.60 |
| Visitor → qualified (in scope) | 25.0% | 35.0% | 50.0% |
| Qualified → activated (own result reached) | 40.0% | 60.0% | 70.0% |
| Activated → paid | 5.0% | 12.0% | 20.0% |
| = Visitor → paid | 0.5% | 2.5% | 7.0% |
| Free AI per activated non-buyer | $1.00 | $0.50 | $0.20 |
| Other acquisition per payer (creative, labour) | $10.00 | $5.00 | $3.00 |
| AI cost A per period: case / season / annual / monthly | $5 / $10 / $30 / $5 | $2 / $4 / $10 / $2 | $1 / $2 / $5 / $1 |
| Refunds; support time × base | 10.0%; ×3 | 5.0%; ×1 | 3.0%; ×0.5 |
| Annual renewal; repeat purchase; monthly churn | 25.0%; 25.0%; 30.0% | 50.0%; 50.0%; 20.0% | 70.0%; 75.0%; 10.0% |

| Scenario | Product | Contribution / period | CAC | First period ÷ CAC | LTV36 | LTV36 ÷ CAC | Break-even activated→paid (1×, 3×) |
|---|---|---:|---:|---:|---:|---:|---:|
| conservative | case29 (one decision, 30 days) | $4.71 | $329.00 | 0.01× | $5.89 | 0.02× | not reachable, not reachable |
| conservative | season49 (90 days, no auto-renew) | $9.28 | $329.00 | 0.03× | $11.60 | 0.04× | >100% (not reachable), not reachable |
| conservative | annual99 | $23.74 | $329.00 | 0.07× | $31.15 | 0.09× | 72.2%, >100% (not reachable) |
| conservative | annual149 (price test) | $66.94 | $329.00 | 0.20× | $87.85 | 0.27× | 20.3%, 78.9% |
| conservative | monthly15 (alternative) | $3.06 | $329.00 | 0.01× | $10.20 | 0.03× | >100% (not reachable), not reachable |
| base | case29 (one decision, 30 days) | $19.16 | $48.35 | 0.40× | $28.74 | 0.59× | 21.7%, >100% (not reachable) |
| base | season49 (90 days, no auto-renew) | $32.73 | $48.35 | 0.68× | $49.09 | 1.02× | 11.8%, 44.3% |
| base | annual99 | $68.69 | $48.35 | 1.42× | $120.20 | 2.49× | 4.5%, 14.8% |
| base | annual149 (price test) | $114.39 | $48.35 | 2.37× | $200.18 | 4.14× | 2.7%, 8.5% |
| base | monthly15 (alternative) | $9.81 | $48.35 | 0.20× | $49.03 | 1.01× | 11.8%, 44.4% |
| upside | case29 (one decision, 30 days) | $23.24 | $12.37 | 1.88× | $40.67 | 3.29× | 5.1%, 17.8% |
| upside | season49 (90 days, no auto-renew) | $39.46 | $12.37 | 3.19× | $69.05 | 5.58× | 2.9%, 9.5% |
| upside | annual99 | $80.67 | $12.37 | 6.52× | $176.66 | 14.28× | 1.1%, 3.4% |
| upside | annual149 (price test) | $127.37 | $12.37 | 10.30× | $278.93 | 22.55× | 0.7%, 2.1% |
| upside | monthly15 (alternative) | $11.86 | $12.37 | 0.96× | $115.93 | 9.37× | 1.7%, 5.3% |

## 4. Sensitivity: annual $99, base scenario (LTV36 ÷ CAC)

| Change | LTV36 ÷ CAC |
|---|---:|
| base | 2.49× |
| activated→paid 6% | 1.30× |
| activated→paid 20% | 3.90× |
| CPC $2 | 1.37× |
| CPC $0.50 | 4.22× |
| no renewal | 1.42× |
| renewal 70% | 3.11× |
| A = $30 | 1.76× |
| A = $1 | 2.81× |
| support 3× | 1.76× |
| refunds 15% | 2.13× |

## 5. $100M ARR — requirements, not a forecast

| Annual price | Active paying households | New per year at 50% renewal (steady state) | Acquisition spend per year at base CAC |
|---:|---:|---:|---:|
| $99 | 1,010,102 | 505,051 | $24,418,815 |
| $149 | 671,141 | 335,571 | $16,224,592 |


## What the model says

1. **The researchers' arithmetic is right**: all 11 re-checked figures match (section 1). The contribution table needs no correction. Their AI line used direct-Opus prices, which section 2 replaces with the unknown-A view.
2. **AI cost is not the deciding variable for annual plans.** Annual $99 stays positive up to A = $78.69 per year. For $29 cases, A above about $21 per decision makes the sale a loss, so measure real gateway cost per case before any paid launch.
3. **Acquisition decides.** In the base case (2.5% visitor→paid, $1 CPC) the fully loaded CAC is $48.35. Annual $99 returns 1.42× in the first period and 2.49× over 36 months *if* half renew. A single $29 decision returns 0.40× and cannot carry paid search at these inputs; its break-even needs 21.7% activated→paid. Conservative inputs fail for every package. The upside clears 3× for every package except monthly.
4. **Sensitivity (annual, base).** Paid conversion (6% → 1.30×, 20% → 3.90×), CPC ($2 → 1.37×, $0.50 → 4.22×) and renewal (none → 1.42×, 70% → 3.11×) move the result most. A ($1 → 2.81×, $30 → 1.76×) and support time (3× → 1.76×) matter, but less.
5. **$100M ARR.** At $99, $100M ARR needs 1,010,102 active paying households, and about 505,000 new ones a year at 50% renewal. At the base CAC that is about $24.4M of acquisition a year. The current scope (three states, one Schedule C owner, Marketplace coverage, 2026–2027) does not establish such a market. Reaching it requires, in order and each with evidence:
   - the same decision for more supported households and states, after rule verification;
   - several contracts per year per household;
   - income and coverage changes between employment and self-employment;
   - only then adjacent independent-work decisions.
   It stays B2C (the household pays). A target is not a forecast.

## Recommendation (to test, not to set)

Follow the research sequence. First, **one offer of $29 per decision with 30 days of updates**, in low-CPC or partner channels (communities, accountants as referrers; the household pays). Measure:
- qualified share, activation (own result reached), purchase and refunds;
- support minutes and real gateway cost per case.

Offer **$49 for 90 days** to people with a second real event. Test **annual $99 / $149** only after repeat use is observed. Monthly $15 is not recommended now: the job is event-driven, and the model gives it the weakest first-period ratio. Do not scale paid search before activated→paid is measured above the break-even rows in section 3.

## Market layers (do not multiply)

| Layer | Figure | What it is not |
|---|---:|---|
| Marketplace plan selections, 2026 OEP (CMS) | 23,130,860 people | Not households, not paid coverage, not buyers |
| Self-employed / small-business owners with Marketplace coverage, 2022, ages 21–64 (Treasury) | 3,285,550 people | Not current, not 25–45, not households |
| Same, TX + FL + TN | 1,108,650 people | Not the supported household scope |
| TX/FL/TN people at >300–500% FPL, 2026 OEP (CMS) | 455,449 people | All ages and job types; not near-cliff households |
| Supported, reachable paying households | **unknown** | Measure with qualification in the first tests |

## For the deck (English, compact)

| | Decision $29 | Season $49 | Annual $99 |
|---|---:|---:|---:|
| Contribution before AI and CAC (modelled) | $21.16 | $36.73 | $78.69 |
| AI cost per period at break-even | $21.16 | $36.73 | $78.69 |
| Base-case CAC (modelled: $1 CPC, 2.5% visitor→paid) | $48.35 | $48.35 | $48.35 |
| 36-month contribution ÷ CAC (base, modelled) | 0.59× | 1.02× | 2.49× |
| Paid conversion needed for 3× (of activated users) | not reachable | 44.3% | 14.8% |

Caption: *"Modelled from list prices and stated assumptions; no customer data yet. Gateway AI cost is a variable until measured."* For $100M ARR: *"About 1.01M paying households at $99/year — a requirement, not a forecast."*

## Limits

- No sales tax, chargebacks, FX, legal or security review, engineering or founder time. Contribution is not profit.
- Renewal, repeat purchase, churn, funnel rates, refunds, support and A are assumptions, and different packages assume different usage.
- Stripe merchant eligibility for Headroom is not verified, and MoR alternatives are not modelled here (see the researcher model).
- The CMS and Treasury figures are dated, people-level and overlapping, and are listed only to show what is not yet known.
