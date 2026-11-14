# Monetization model — calculated scenarios

**Hypotheses, not measured customers.** USD; checked 2026-11-15. Change `inputs.json`, run `python docs/research/round6-economics/model.py`. One product period; contribution excludes CAC and fixed costs.

| Product | Price | Net after assumed refunds | Payment fees | AI | Support | Variable infra | Contribution |
|---|---:|---:|---:|---:|---:|---:|---:|
| case29 | 29.00 | 27.55 | 1.14 | 1.22 | 5.00 | 0.25 | 19.94 |
| season49 | 49.00 | 46.55 | 1.72 | 3.04 | 7.50 | 0.60 | 33.69 |
| annual99 | 99.00 | 94.05 | 3.86 | 12.16 | 10.00 | 1.50 | 66.53 |
| annual149_test | 149.00 | 141.55 | 5.66 | 12.16 | 10.00 | 1.50 | 112.23 |
| monthly15_test | 15.00 | 14.25 | 0.84 | 1.22 | 1.50 | 0.10 | 10.59 |

Qualified-first acquisition scenario: 3.60% visitor-to-paid; fully stated CAC $31.81; annual99 first-period contribution/CAC 2.09×.
For the chosen first-period 3× target, visitor-to-paid must reach 5.14% at the same assumed CPC, qualification and labor costs. This is a required threshold, not a predicted conversion.

| Annual renewal assumption | 36-month contribution LTV | Ratio to modeled CAC |
|---|---:|---:|
| 25% | $87.32 | 2.75× |
| 50% | $116.42 | 3.66× |
| 70% | $145.69 | 4.58× |

| Monthly churn assumption | 12-month contribution LTV | 36-month contribution LTV | Payback billing period |
|---|---:|---:|---:|
| 10% | $71.02 | $98.55 | 5 |
| 20% | $44.33 | $47.95 | 6 |
| 30% | $29.82 | $30.31 | not reached within 36 |

| Annual99 sensitivity | Contribution before CAC/fixed |
|---|---:|
| base | $66.53 |
| refund_10pct | $61.58 |
| support_60min | $46.53 |
| ai3x_support60 | $22.21 |
| ai5x_support120 | $-32.11 |
| mor_fee_comparison | $64.94 |

Limitations:

- Stripe rates are an eligible US merchant / domestic card comparison, not proof that Headroom can onboard or charge live.
- MoR rates are an alternative comparison, not added to Stripe. Provider/product/country approval and refund terms are not verified.
- No caching or model routing discount; reserve is a workload assumption, not observed retries. OCR, long documents and image tokens can exceed it.
- Support is a blended software-support scenario; professional tax review is excluded and is not promised in any plan.
- Refunded purchases retain full modeled delivery costs and original payment fees. Recurring Billing fee is conservatively charged on gross collections.
- Variable infra is a separate estimated usage allowance; fixed hosting is excluded from unit contribution and deducted once at business level.
- No sales tax included in price, corporate tax, disputes, FX, legal review, security audit, engineering or acquisition creative costs beyond stated labor.
- Cohort LTV is finite, undiscounted contribution before CAC and fixed costs; renewal/churn are hypotheses, not RevenueCat benchmarks.
- Monthly model has additional one-off onboarding; annual/case/season support already includes onboarding in their period.
- Different product periods have different assumed usage. Only annual149 versus annual99 holds delivery assumptions constant; this model is not an observed price A/B experiment.
