# Product analytics — funnel specification (round 5)

Anonymous, aggregate, allowlisted. Implemented in `src/lib/client/analytics-events.ts` (names), `POST /api/analytics` (strict schema) and migration `202611170005` (`analytics_daily` + `headroom_count_event`, server-only). Report: `node scripts/analytics-report.mjs [days]` with the Supabase URL and server secret in the environment (never committed).

## What is recorded

One row per `(UTC day, event, data_kind, input_path)` with a counter. Nothing else: no ids, guest/session ids, IPs, text, documents, amounts, incomes, household profile, fingerprints or URLs. `data_kind`: `sample` (synthetic demo), `own`, `unknown`. `input_path`: `document`, `paste`, `manual`, `provider`, `none`.

## Funnel events (UI calls `trackEvent(event, { dataKind, inputPath })`)

| Step | Event | When |
| --- | --- | --- |
| 1 | `first_visit` | first page view in a browser session |
| 2 | `start` | the user chooses a start mode (sample / upload / paste / manual) |
| 3 | `review_completed` | a group of extracted facts was confirmed |
| – | `missing_question_resolved` | a readiness question was answered (including "I don't know yet") |
| 4 | `result_calculated` | a ready engine result was shown |
| 5 | `plan_saved` | a plan/workspace revision was saved |
| 6 | `plan_reopened` | a saved plan was opened again later |
| 6 | `proposal_confirmed` | a typed change from text was confirmed and saved |
| 6 | `plan_exported` | a PDF / JSON / calendar file was downloaded |
| – | `provider_failure` | an AI call failed/was limited and the user continued manually |

Earlier events (`calculation_started`, `scenario_chosen`, `pricing_viewed`, `checkout_demo`, …) remain allowed.

## Rules for reading the numbers

- `sample` rows are demo sessions with synthetic data: never customers, never traction.
- An empty table is reported as empty; nothing is seeded.
- Counters can't be joined to people or to each other; conversion between steps is an aggregate ratio per day, not a per-user path.
- AI provider cost is measured separately (`ai_reservations`, actual token usage) and must not be mixed with modelled unit economics.
