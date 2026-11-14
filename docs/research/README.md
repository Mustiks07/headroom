# Research and decision evidence

The [round 5 research memo](round5-business-research.md) covers customer pain, alternatives, first-Business-Cup evidence, pricing hypotheses, acquisition, unit economics and the evidence needed for a ten-slide pitch. It distinguishes observed source material from modeled assumptions and unperformed experiments. It is an internal research artifact, not a customer testimonial or final deck.

- [Source register](ROUND5_EVIDENCE.csv): 62 records, with interpretation and limitations.
- [Economic calculation](ROUND5_ECONOMICS_CHECK.py): standard-library Python, no network calls; run `python docs/research/ROUND5_ECONOMICS_CHECK.py` from the repository root.
- [Calculated output](ROUND5_ECONOMICS_CHECK.json): the existing adapter is modeled under `anthropic_profiles` and identified by `reference_profile_for_current_adapter`. Top-level `products`, `annual` and `monthly` are explicitly the alternative Gemini architecture. `som_scenarios` uses Opus. Do not mix their margins.

Public list prices do not establish access to a provider account, extraction quality, customer usage or support costs. Production AI is currently disabled. $29/decision, $49/season and $99/year remain price hypotheses; no measured Headroom CAC, paying customer count or retention is claimed.

Additional participant-repository, paid-value and visual-direction reviews are underway. They may suggest changes, but do not silently change the supported financial scope or replace user-provided final materials.
