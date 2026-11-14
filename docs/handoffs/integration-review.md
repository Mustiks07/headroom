# Integration review — 2026-11-14

Combined Claude 1 UI (`e50783f`), Claude 3 backend/UI integration (`afa0993`) and Claude 2 engine (`f54a0fd`) in `codex/integration-review`, preserving their commit history. This review describes the local integrated app, not a completed contest submission or independently certified tax software.

## Integration corrections

- CSV/TXT extraction: expense payment dates no longer become dollar amounts; multi-value rows and malformed/partial money strings are rejected. Tab-delimited thousands retain their value.
- Rule source IDs resolve to names, primary-source links and source status in the calculation drawer, plan checklist and PDF. Household evidence remains separate from rule metadata.
- Re-read the 2027 single/MFJ brackets and standard deduction in [IRS Rev. Proc. 2026-35](https://www.irs.gov/pub/irs-drop/rp-26-35.pdf), sections 3.01 and 3.15. Values agree with the engine. Section 3.28(2) required updating 2027 QBI minimum deduction/qualifying QBI to $415/$1,030; both calculation and trace now use that year's pack.
- Marketplace actions now say to update when the forecast changes, following [HealthCare.gov](https://www.healthcare.gov/reporting-changes/); removed a manufactured deadline 30 days after receipt.
- Unsupported uncertainty on payroll, existing SEP, non-owner business income, dependent income and insurance amounts is blocked explicitly. The former implementation either ignored ranges or violated assumptions of its monotone search. Allowed profit/interest ranges still move together, not independently. Range UI no longer invites unsupported new ranges.
- Valid amount edits reach the parent draft immediately, so “Recalculate” does not require leaving the input first. Invalid-input propagation remains a specific follow-up in Claude 1's second-round task.
- README and deployment status describe the integrated implementation, not the former unavailable stubs.

Engine `headroom-engine-1.0.1`; rules `us-federal-aca-2026-2027.r2`. Original developer handoffs are historical; corrections here supersede their affected claims.

## Checks performed

- Integrated full typecheck/test/build: passed (43 tests at first merge). Added two focused financial regression cases for the indexed QBI amount and unsupported ranges; affected engine/export checks passed. A version assertion was updated from r1 to r2. Builds were repeated only after code changes found during review.
- Production build on localhost, without AI/Supabase/Stripe credentials: real family comparison, price change $12,000 → $13,000 and SEP maximum $5,500 → $2,000. An over-budget SEP becomes unavailable; split recommendation changes with the input.
- Guest save → refresh/reopen → “Something changed” → income $118,000 → $121,000 → recalculate → save revision 2 with history: passed. No login, email or card requested.
- Ordinary fixture: accepting the $6,000 offer gives approximately +$3,872 after settlements; no artificial special intervention is required.
- Missing-spouse fixture: four unknown wage facts block results; “Add this” opens the relevant household fields; explicit confirmation of no W-2 wages produces a real current-year result. Sources in the calculation drawer resolve to primary links.
- Downloaded the actual PDF and restorable JSON from the browser. The checked SEP report shows +$3,800.45 cash and $5,500 retirement separately, both tax years, rule/engine versions and fingerprint. Rendered all eight report pages to inspect tables, margins and pagination. This is a plan report, **not** the contest slide deck.
- The saved-plan page fits a 360px viewport without whole-page horizontal overflow. No browser JavaScript errors were observed in the checked journeys.

## Not claimed / next work

Public Vercel deployment, live Supabase isolation, real AI-provider extraction, real payments, paid demand validation and the ≤10-slide contest deck have not been completed by this integration review. Keys were not supplied. Browser-local persistence, manual entry and deterministic calculations work without those services.

Important next work: result-first demo and shorter own-data flow; invalid-money edits must block stale calculations; fixed-action evaluation when a saved plan changes; honest independent-range semantics; engine-version upgrade path; resilient cloud failure handling; configured-provider cost controls. Full briefs: [Claude 1](../tasks/CLAUDE1_ROUND2.md), [Claude 2](../tasks/CLAUDE2_ROUND2.md), [Claude 3](../tasks/CLAUDE3_ROUND2.md).
