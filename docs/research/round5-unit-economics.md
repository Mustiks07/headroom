# Headroom unit economics — reproducible check (round 5)

Owner: Claude 2. Script: `scripts/business/unit-economics.ts` (exact fractions, no floating point until display):

```
node --experimental-strip-types scripts/business/unit-economics.ts
```

Inputs come from `docs/research/round5-business-research.md` §7 and `HEADROOM_PAID_VALUE_STRATEGY.md`: **observed list prices** (Stripe 2.9% + $0.30 per card charge, Stripe Billing 0.7% on recurring charges, Supabase Pro + Vercel Pro = $540/year, Anthropic Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million input/output tokens; Gemini Flash-Lite only as the memo's comparison) and **assumptions** (everything else). Nothing below is measured customer behaviour, a price test, or revenue. The current adapter is Anthropic with the Opus 5.5 default, and AI is off in production. The Opus rows are the reference.

## Formulas (for the deck)

```text
NetRevenue      = Price × (1 − RefundRate)
PaymentFees     = Price × (2.9% + 0.7% if recurring) + $0.30          (charged on the gross even when refunded)
Support         = SupportMinutes / 60 × $30
AI              = RetryMultiplier × (Documents × DocCost + Updates × UpdateCost)
DocCost         = (30,000 × InputRate + 3,000 × OutputRate) / 1,000,000       UpdateCost: 8,000 / 1,500 tokens
Contribution    = NetRevenue − PaymentFees − Support − AI − $540 / BillingUnitsPerYear
MediaCAC        = CPC / (VisitorToQualified × QualifiedToPaid)
FreeIntake/payer= FreeDocsPerQualifiedVisitor × RetryMultiplier × DocCost × (1 − QualifiedToPaid) / QualifiedToPaid   (non-buyers only)
FullyLoadedCAC  = MediaCAC + FreeIntake/payer + OtherAcquisition (creative, labour, referral) per payer
HorizonLTV      = Contribution × (1 + r + r²) annual over 3 years · × (1 + repeat) season / decision
Payback         = first purchase n whose cumulative expected contribution ≥ FullyLoadedCAC
```

Annual LTV uses an assumed **annual renewal rate**, never one derived from an invented monthly churn. The memo's monthly $15 cohort formula is kept only for its own figure.

## 1. Memo arithmetic, recomputed

| Figure | Memo | Recomputed |
|---|---:|---:|
| Opus annual AI budget | $12.16 | $12.16 |
| Opus annual contribution before CAC/OPEX | $69.466 | $69.466 |
| Opus decision contribution | $20.233 | $20.233 |
| Opus season contribution | $34.729 | $34.729 |
| Opus monthly contribution | $9.949 | $9.949 |
| Opus annual CAC ceiling 3:1, no renewal | $23.16 | $23.16 |
| Opus annual 3-year LTV at 60% renewal (×1.96) | $136.15 | $136.15 |
| Sonnet annual contribution | $75.546 | $75.546 |
| Haiku annual contribution | $81.322 | $81.322 |
| Gemini annual contribution | $80.474 | $80.474 |
| Gemini decision contribution | $21.3338 | $21.3338 |
| Gemini season contribution | $37.481 | $37.4810 |
| Gemini monthly contribution | $11.0498 | $11.0498 |
| Opus monthly 12-month LTV at 15% monthly churn | $56.89 | $56.89 |
| Free Opus document run per payer at 5% free→paid | $7.20 | $7.20 |
| Opus media CPC allowance at 5% (ceiling − free intake) | $0.80 | $0.80 |
| SOM A residual (60 payers, $3,000 media) | $660.36 | $660.36 |
| SOM B residual (250 payers, $5,000 media) | $11,961.50 | $11,961.50 |
| SOM C residual (800 payers, $15,000 media) | $40,464.80 | $40,464.80 |
| Opus annual with 120 support minutes | $19.47 | $19.47 |
| Opus annual with 10 customers/year (infra) | $16.01 | $16.01 |
| Households for $100M ARR at $99 | 1,010,102 | 1,010,102 |

## 1b. Paid-value strategy figures, recomputed (HEADROOM_PAID_VALUE_STRATEGY.md)

| Figure | Strategy | Recomputed |
|---|---:|---:|
| Annual contribution, 60 support minutes | $49.47 | $49.47 |
| Funnel 30% × 60% × 20% → visitor→paid | 3.6% | 3.6% |
|   media CAC at $1 CPC | $27.78 | $27.78 |
| CAC before labour at 5% visitor→paid, $1 CPC (media $20 + non-payer AI) | $26.84 | $26.84 |
| Minimum visitor→paid for 3:1 at $1 CPC, decision_29 | 19.14% | 19.14% |
| Minimum visitor→paid for 3:1 at $1 CPC, season_49 | 11.39% | 11.39% |
| Minimum visitor→paid for 3:1 at $1 CPC, annual_99 | 5.78% | 5.78% |
| Decision, one extra purchase by 40% of buyers | $28.33 | $28.33 |
| Season, one extra purchase by 40% of buyers | $48.62 | $48.62 |
| $100M revenue at $29 / $49 (purchases per year) | 3.45M / 2.04M | 3.45M / 2.04M |
| Zero sales in 30 comparable trials: one-sided 95% upper bound | 9.5% | 9.50% |
| Zero sales in 60 comparable trials: one-sided 95% upper bound | 4.87% | 4.87% |
| Zero sales in 100 comparable trials: one-sided 95% upper bound | 2.95% | 2.95% |

## 2. One billing unit, current adapter (Opus 5.5), memo base assumptions

| | Decision $29 | Season $49 | Annual $99 | Monthly $15 |
|---|---:|---:|---:|---:|
| Net after refunds | $28.130 | $47.530 | $96.030 | $14.550 |
| Card + billing fees | $1.141 | $1.721 | $3.864 | $0.840 |
| Support | $5.000 | $7.500 | $10.000 | $2.500 |
| AI (budget, ×2) | $1.216 | $3.040 | $12.160 | $1.216 |
| Variable contribution | $20.773 | $35.269 | $70.006 | $9.994 |
| Base infra share | $0.540 | $0.540 | $0.540 | $0.045 |
| Contribution before CAC/OPEX | $20.233 | $34.729 | $69.466 | $9.949 |

## 3. Three scenarios (Opus 5.5 adapter)

Assumptions (all hypothetical):

| Input | Conservative | Base | Optimistic |
|---|---:|---:|---:|
| Refund rate | 5% | 3% | 2% |
| Support minutes (decision / season / annual) | 20 / 30 / 60 | 10 / 15 / 20 | 5 / 10 / 10 |
| AI retry/reserve multiplier | 3× | 2× | 1.5× |
| Visitor → qualified | 25% | 35% | 50% |
| Qualified → paid | 2% | 5% | 8% |
| CPC | $1.50 | $1.00 | $0.75 |
| Other acquisition per payer (creative, labour) | $10 | $5 | $3 |
| Free document runs per qualified visitor | 1 | 1 | 1 |
| Annual renewal | 30% | 50% | 65% |
| Season repurchase / extra decisions per year | 20% / 20% | 40% / 50% | 50% / 100% |

| Scenario | Product | Contribution / purchase | Horizon LTV | Media CAC | Free intake / payer | Fully loaded CAC | LTV : CAC | Payback (purchase no.) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| conservative | decision_29 | $14.05 | $16.85 | $300.00 | $26.46 | $336.46 | 0.05 | not within 2 |
| conservative | season_49 | $24.73 | $29.67 | $300.00 | $26.46 | $336.46 | 0.09 | not within 2 |
| conservative | annual_99 | $41.41 | $57.55 | $300.00 | $26.46 | $336.46 | 0.17 | not within 3 |
| base | decision_29 | $20.23 | $30.35 | $57.14 | $6.84 | $68.98 | 0.44 | not within 2 |
| base | season_49 | $34.73 | $48.62 | $57.14 | $6.84 | $68.98 | 0.70 | not within 2 |
| base | annual_99 | $69.47 | $121.57 | $57.14 | $6.84 | $68.98 | 1.76 | 1 |
| optimistic | decision_29 | $23.33 | $46.65 | $18.75 | $3.11 | $24.86 | 1.88 | 2 |
| optimistic | season_49 | $38.48 | $57.72 | $18.75 | $3.11 | $24.86 | 2.32 | 1 |
| optimistic | annual_99 | $78.50 | $162.68 | $18.75 | $3.11 | $24.86 | 6.55 | 1 |

## 4. Sensitivity (annual $99, base scenario)

| Change | LTV : CAC |
|---|---:|
| base | 1.76 |
| qualified→paid 2% | 0.73 |
| qualified→paid 10% | 3.30 |
| CPC $2.00 | 0.96 |
| CPC $0.50 | 3.01 |
| no renewal | 1.01 |
| renewal 70% | 2.21 |
| support 60 min | 1.25 |
| Sonnet-priced AI | 2.02 |

## What the check shows

1. **The memo's and the paid-value strategy's arithmetic is correct.** All 22 memo figures and 13 strategy figures recompute exactly: Opus annual contribution $69.466, CAC ceiling $23.16, the free-intake cost of $7.20 per payer, the CPC allowance of about $0.80 at 5%, and the three SOM residuals. No correction to its numbers is needed.
2. **Watch the conversion definition.** The memo's “click→paid 5%” means 5% of *all* clicks buy. The two-stage formula required here gives 1.75% of clicks in the base case (35% qualified × 5% of qualified buy), which costs $57.14 of media per payer at a $1 CPC. With a fully loaded CAC of $68.98 (free intake counted for non-buyers only, as in the strategy script), base annual LTV:CAC is **1.76**, below the memo's chosen 3:1 bar. Annual $99 pays back on the first purchase only by $0.49. Decision and season do not pay back within their horizons at these assumptions. These are assumptions, not findings about the market.
3. **What moves the result most:** the share of qualified visitors who buy (2% → 0.73, 10% → 3.30), CPC ($2 → 0.96, $0.50 → 3.01) and renewal (none → 1.01, 70% → 2.21). Support time and the model choice matter less (60 min → 1.25; Sonnet pricing → 2.02, quality not tested).
4. **Implication for the pitch** (a planning statement, not a forecast): paid search at about $1 CPC works only if qualified visitors convert at 5% or more and renew. The first acquisition tests should be low-CPC or partner channels, with real conversion measured before any paid scale-up, which is also the memo's conclusion. A per-decision price ($29) cannot carry paid acquisition under any of the three scenarios.

## Labels for the deck

Every figure here is **modelled from assumptions**: price, conversion, renewal, support time and AI usage are hypotheses, not sales. Write "modelled" next to them on slides; never "customers", "revenue" or "CAC achieved". The only observed inputs are list prices.

## Limits

- Prices of Stripe, Supabase, Vercel and Anthropic are list prices from the memo's sources (checked there on 2026-11-15); they were not re-fetched here, and a specific account may pay different rates.
- Token budgets per document/update are budgets, not measured usage; the 2–3× multiplier is a reserve, not an error statistic.
- No sales tax, chargebacks, professional review, engineering/OPEX or founder time; contribution is not profit.
- Renewal, repeat and every funnel rate are assumptions; demo sessions and synthetic data are not customers.
