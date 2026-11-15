# Research and decision evidence

## Current round 6 evidence and implementation plan

- [Paid demand and pricing validation](round6-paid-demand.md): paid-category evidence, strongest objections, acquisition assumptions and experiments. Current BasisWeb dollar COGS is unknown; older fixed AI cost assumptions are not actual deployment costs.
- [Competition and ten-slide pitch architecture](round6-competition-pitch.md): current alternative/participant evidence and precise artifacts needed for the defense.
- [Code-backed gap audit](round6-product-gap-audit.md): actual missing integration and decision-lifecycle behavior, not a list of speculative features.
- [Complete next implementation round](../tasks/ROUND6_SHARED.md): ownership, contracts, all three assignments and finite acceptance criteria.

Research is not customer traction. Developer/fixture events cannot establish paid conversion or retention. No outreach or paid advertising was performed by these researchers.

## Newly found: the first winner's primary materials

[Preggo winner data review](PREGGO_WINNER_DATA.md) identifies the public app/landing repositories and the team's ten-page **Business Cup Stage 2** economics PDF, inspected in full. This corrects the earlier search's missing-repository/document finding. [Reproduced arithmetic](preggo-reference-arithmetic.json) separates the team's assumptions from Codex stress cases. The review maps their evidence categories to what Headroom already has and still needs; the PDF is not verified as the final pitch deck or as measured campaign results.

## Latest: subscription and repeat-value review, November 15

[Round 6 monetization review](round6-monetization-review.md) rechecks paid alternatives, proposes the next event-driven product improvements, defines case/season/year experiments and separates first-period contribution from modeled renewal LTV. This is research for the next iteration, not a live pricing change or a replacement for the current Claude assignments.

[Editable assumptions](round6-economics/inputs.json), [reproducible model](round6-economics/model.py), [calculated results](round6-economics/results.json) and [readable tables](round6-economics/summary.md) include refunds, support, nonpayer AI, acquisition labor and heavy-use sensitivity. The revised annual99 base contribution is $66.53 under its explicitly different assumptions; the older model below remains a historical scenario. No real customer cohort or campaign is claimed.

## Earlier evidence

The [round 5 research memo](round5-business-research.md) covers customer pain, alternatives, first-Business-Cup evidence, pricing hypotheses, acquisition, unit economics and the evidence needed for a ten-slide pitch. It distinguishes observed source material from modeled assumptions and unperformed experiments. It is an internal research artifact, not a customer testimonial or final deck.

- [Source register](ROUND5_EVIDENCE.csv): 62 records, with interpretation and limitations.
- [Economic calculation](ROUND5_ECONOMICS_CHECK.py): standard-library Python, no network calls; run `python docs/research/ROUND5_ECONOMICS_CHECK.py` from the repository root.
- [Calculated output](ROUND5_ECONOMICS_CHECK.json): the existing adapter is modeled under `anthropic_profiles` and identified by `reference_profile_for_current_adapter`. Top-level `products`, `annual` and `monthly` are explicitly the alternative Gemini architecture. `som_scenarios` uses Opus. Do not mix their margins.

Public list prices do not establish access to a provider account, extraction quality, customer usage or support costs. Production AI is currently disabled. $29/decision, $49/season and $99/year remain price hypotheses; no measured Headroom CAC, paying customer count or retention is claimed.

Acquisition accounting refinement: the first memo's $7.20 free-intake allocation at 5% conversion assumes that intake has not already been included in paid usage. The paid-value follow-up includes a paying customer's first document in paid COGS, so only nonpayers add acquisition compute: $0.36 × 95 / 5 = $6.84 per payer. Apply one convention consistently; never add both costs for the same request.

Additional reviews:

- [Participant repositories](COMPETITOR_REPOS_ROUND5.md) and [97-candidate register](COMPETITOR_REPOS_ROUND5.csv): 56 self-attributed current entries, 29 likely, one duplicate and 11 excluded. This is not an official complete submission roster. Idea strength and development state are assessed separately.
- [Paid-value strategy](HEADROOM_PAID_VALUE_STRATEGY.md) and [decision matrix](HEADROOM_PAID_VALUE_DECISION_MATRIX.csv): the original model plus six alternatives, purchase triggers, default recommendation, attribution and tests that could justify changing direction.
- [Additional economics checks](HEADROOM_PAID_VALUE_ECONOMICS_CHECK.py) with [calculated output](HEADROOM_PAID_VALUE_ECONOMICS_CHECK.json): the strategy's cohort/acquisition sensitivity.
- [Selected C direction](../design/c-open/README.md): user-selected cobalt/chrome/chartreuse system, desktop/mobile references and implementation handoff. This is not a claim of deployment.
- [Archived visual direction](../design/round5/design-direction.md): rejected by the user on November 15. Retained as research history; its palette, fonts, logo and screen compositions are not approved for implementation.
- [Development addendum](../tasks/ROUND5_RESEARCH_ADDENDUM.md): selected implications assigned to the three existing developer roles.

These reports do not silently expand the supported financial scope or replace user-provided final materials. Design screenshots are concepts, and economic scenarios are modeled rather than measured customer results.
