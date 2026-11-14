# Sources and evidence boundaries

Research checked on 14–15 November 2026. Read the actual cited passage before expanding a claim. Official rules and synthetic examples are different kinds of evidence.

## Financial rules

| Source | Use / limitation |
| --- | --- |
| [IRS 2026 applicable percentages](https://www.irs.gov/pub/irs-drop/rp-25-25.pdf) | Revenue Procedure 2025-25 |
| [IRS 2027 applicable percentages](https://www.irs.gov/pub/irs-drop/rp-26-26.pdf) | Revenue Procedure 2026-26, verified primary table |
| [IRS 2026 tax adjustments](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) | Brackets/standard deduction and applicable parameters |
| [IRS 2027 tax adjustments](https://www.irs.gov/pub/irs-drop/rp-26-35.pdf) | Standard deduction and $2,300 CTC maximum verified |
| [IRS 2026 Form 8962 draft instructions](https://www.irs.gov/pub/irs-dft/i8962--dft.pdf) | Worksheet 2 and Table 2; **DRAFT**, retain status |
| [IRS Form 1040 instructions at the draft URL](https://www.irs.gov/pub/irs-dft/i1040gi--dft.pdf) | Downloaded header is **2025**, dated February 25, 2026; verified by header and SHA in source-manifest. Used to check rounding/Tax Table method, not as the published 2026 Tax Table. Live draft URLs may change. |
| [IRS Schedule SE instructions](https://www.irs.gov/instructions/i1040sse) | Per-individual SE income and wage-base rules |
| [IRS Publication 974](https://www.irs.gov/publications/p974) | Available 2025 edition; coupled SEHI/PTC method, not authority for old caps in 2026 |
| [IRS Publication 560](https://www.irs.gov/publications/p560) | SEP eligibility, rate calculation and contribution timing |
| [IRS Notice 2026-66](https://www.irs.gov/pub/irs-drop/n-26-66.pdf) | 2027 defined-contribution cap $75,000 |
| [SSA 2027 fact sheet](https://www.ssa.gov/cola/factsheets/2027.html) | 2027 wage base $192,300; separate tax components |
| [IRS Publication 334](https://www.irs.gov/publications/p334) | Cash accounting and constructive receipt; invoice date alone is insufficient |
| [Marketplace income](https://www.healthcare.gov/income-and-household-information/income/) | Household/MAGI components and updating income |
| [HHS poverty guidelines](https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines) | FPL by year/region; prior-year guideline for coverage-year calculation |
| [IRS premium tax credit Q&A](https://www.irs.gov/affordable-care-act/individuals-and-families/questions-and-answers-on-the-premium-tax-credit) | Current eligibility and reconciliation guidance |

## Insurance inputs

- [CMS 2026 individual medical Landscape](https://data.healthcare.gov/datafile/py2026/individual_market_medical.zip)
- [CMS 2027 individual medical Landscape](https://data.healthcare.gov/datafile/py2027/individual_market_medical.zip)
- [CMS default age curve](https://www.cms.gov/cciio/resources/regulations-and-guidance/downloads/final-guidance-regarding-age-curves-and-state-reporting-12-16-16.pdf)

`data/reference` contains small county extracts and original-source hashes instead of large ZIPs. A county-level second-lowest Silver candidate is not necessarily the user's verified benchmark: exact service area, eligible family, EHB share and coverage conditions matter. The reference example assumes those conditions; never call it a personal insurance quote.

The synthetic family uses adults aged 38/39 across the two years and a child below 15. Child factor 0.765 and adult factors 1.246/1.262 are supported by the CMS curve. The UI fixture uses a five-year-old child; this leaves the same factor/CTC assumption as the reference under-15 child. No real customer data is included.

## Product / competition / contest

See `BUSINESS.md` for direct competitor and market references. [Business Cup](https://businesscup.zimran.io/en) is the contest landing page. The supplied contest/FAQ requirements establish B2C, US ages 25–45, browser-only, English interface/deck, public guest URL, public GitHub and PDF up to 10 slides. User explicitly confirmed no registration/login screens at all.

Primary demand/scale evidence added in round 2 integration: [IRS TY2024 repayment statistics](https://www.irs.gov/pub/irs-soi/25inweek47.xlsx), [CMS 2026 OEP PUF](https://www.cms.gov/files/zip/2026-oep-state-level-public-use-file.zip), [CMS definitions](https://www.cms.gov/files/document/2026-public-use-files-definitions.pdf), and [Marketplace self-employment forecasting/verification](https://www.healthcare.gov/self-employed/income/). Exact cells, units and limitations are recorded in `BUSINESS.md`; do not substitute these broad denominators for paying target households.

No Headroom user interview, paid conversion, retention, independently reviewed tax return, live AI integration or production deployment is asserted by this foundation. Actual checks and service status are recorded in developer handoffs. Synthetic sample values must not be presented as realized customer savings.
