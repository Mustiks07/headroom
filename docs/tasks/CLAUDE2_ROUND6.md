# Claude 2 — decisions users can trust and act on

You own `src/lib/engine/**`, financial rules/reference data and engine verification. Also own scenario/business calculation artifacts under `scripts/business/**`, `docs/research/round6-economics.md` and `docs/artifacts/round6/scenarios/`. Read shared brief, engine spec, round5 handoffs, new research and audit. Continue `claude2`, merge latest main. Send contract needs to Claude 3 first; do not independently fork shared schemas.

## 1. Connect the shortest valid calculation path

- Stabilize and expose `evaluateOfferAsOffered` plus decision-scoped readiness so Claude 1 can use them. Current-year acceptance should use only the facts needed for that calculation; next-year unknowns must not block it unless the decision actually depends on them.
- Every required question has a stable key, meaning, reason, acceptable source and effect if unknown. Distinguish blocking from useful-to-refine. Do not treat a global “all data complete” score as financial confidence.
- Support both new-offer and annual-income-without-offer paths. Explain no-intervention cases just as well as cliff cases. Preserve the current supported federal/ACA scope and fail explicitly outside it.
- Readiness and calculations must agree: completing the displayed questions should not lead to an unexplained second list or an invented zero.

## 2. Finish semantic document validation

- Put `checkExtractedFacts` into the real shared import flow with Claude 3; currently it is not called by product code. Review the normalization before reusing it.
- Fix taxable interest versus tax-exempt interest: they currently collapse into one `interest` destination. Preserve each source type and correct financial effect.
- Preserve annual/monthly/YTD/one-time period; never force coverage to monthly. Require actual covered months, relevant tax year and person. Monthly values may fill selected months only under an explicit confirmation that they apply to those months.
- YTD profit plus future expected income must not include managed projects twice. Gross deposits/transfers are not Schedule C profit. W-2 Box 1/gross wages/pretax withholding must not be interchanged. Prior-year figures are not current confirmed facts.
- Return actionable field-level conflicts/unsupported/needs-clarification results to one import contract. Different people/years/months must not be conflated; equal-looking values from different sources retain provenance.
- Confirmed group calculations should have the same result as the equivalent correct manual inputs. A partial apply must not yield a deceptively valid financial result.

## 3. Negotiation and actual payment semantics

- Evaluate counteroffers under explicit allowable price, timing, number of payments and retirement constraints. Preserve received amounts and fixed commitments. Do not recommend asking for an already-received payment in another year.
- Maintain original-offer and current-offer comparisons separately. Describe which baseline is used in every money result. Never count the user's retirement principal as product-created savings.
- Support partial receipt correctly: received portion + outstanding remainder, with no doubled revenue or lost remainder. Full settlement for less is a different explicit event. Handle cancellations/rejections with existing receipts and any explicitly entered refund/cost facts; don't assume them away.
- Proposed/agreed/received status changes must affect the right scenario. Client agreement is not proof of constructive-receipt legality. Timing arrangements remain constrained by recorded facts and documented rules.
- Publish common presentation metadata for settled cash, project gross by date, project available cash and household balance. UI, PDF and comparison exports must consume this rather than relabel the same number.

## 4. Robustness that changes the recommendation

- Keep mathematical minimum, feasible choice and safer plan separate. Use declared income ranges or explicitly described stress cases; don't manufacture a universal “$2,000 buffer” confidence guarantee.
- Show when a recommendation reverses across credible inputs and the fact needed to settle it. Use ranges with proven bounds only where the engine can justify them. Finite tested points are finite checks, not a global proof.
- When no option meets the goal, identify the binding constraint and return only valid nearest alternatives with their shortfall. A suggested negotiation threshold must be calculated within supported space.
- Avoid duplicate cards and cosmetically different options. Ensure the recommended option, alternatives and unchanged offer are compared over the same horizon with taxes/credits settled consistently.
- Keep cancellation of old action recommendations, stale fingerprint invalidation, old version handling and historical record replay consistent. Publish the version bump with a migration/review explanation when semantics change.

## 5. Bounded independent verification and readable evidence

- Extend the existing consequential scenario matrix, not an arbitrary test count. Include near-cliff family, ordinary profitable offer, unknown spouse income, two independent income ranges, original vs counteroffer, partial receipt across years, SEP tax-year ambiguity, zero/negative feasible improvement and impossible deadline goal.
- Independently check selected decisive outputs against primary IRS/HHS/CMS materials or a separately implemented reference. Reusing the same tables/functions is not full independence. Verify current published tax-year data rather than trusting dated comments or prior summaries.
- Produce `docs/artifacts/round6/scenarios/decision-cases.md` with exact inputs, sources, engine/rules versions, options, both baselines, cash/retirement, assumptions and independent-check scope. Include at least one case where Headroom says “accept as offered” and one where it refuses an unsupported recommendation.
- If showing competitor calculations, use the same inputs and scope. Distinguish “feature not found” from proven absence, and old competitor information from current observed behavior. Do not claim savings relative to an intentionally bad baseline as if achieved for customers.

## 6. Business model calculations for the later presentation

- Consume current researcher findings; do not invent a market by multiplying all Marketplace enrollees by price. Separate covered people, eligible adult households, independent workers, supported geography, reachable near-term buyers and broader expansion.
- Model event/season pass, annual plan and monthly alternatives as hypotheses with explicit retention behavior. Do not set product pricing silently; provide a recommendation and sensitivity table.
- Calculate contribution margin after payment fees, AI, storage, support and refunds with documented assumptions. BasisWeb currently reports gateway tokens/call caps, not independently known USD cost; include a cost variable/sensitivity instead of applying direct Anthropic prices.
- CAC is not CPC. Show CPC→qualified visitor→activation→paid conversion; CAC from actual spend only when observed. LTV is contribution margin with retention uncertainty, not revenue divided by a guessed churn presented as measured.
- Give conservative/base/upside scenarios and break-even paid conversion/CAC. Explain what must be true to reach $100M ARR, customers needed and expansion assumptions. A target is not a forecast.
- Output formulas/scripts and a compact English table for the deck. Keep these assumptions separate from customer tax calculations.

## Delivery

Typecheck, targeted engine regressions, one build and a real app/export scenario using the published API contracts. Commit/push `claude2`, handoff with scenario evidence, contract commits and unsupported cases. Do not broaden scope to all taxes/states or attempt a huge new suite. A correct clear boundary is better than a false recommendation.
