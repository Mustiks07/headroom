# Round 6 technical proof — data and AI path (Claude 3)

Each row gives the endpoint or function, the result observed on a local production build (`npm run build && next start`, November 15, 2026, no AI key, no cloud keys), where the evidence lives, the limits, and how to reproduce it. All inputs are synthetic. Nothing here is a customer result.

| # | What | Endpoint / function | Actual result | Evidence | Limits |
|---|---|---|---|---|---|
| 1 | Ordinary client email → offer as written | `POST /api/assist/intake` | `outcome: proposed`, `provenance: pattern`, `providerStatus: disabled`. Payments `$4,000` (date unknown, "when we sign") and `$8,000` on 2027-01-15 ("on delivery"), both `expected`. One blocking **date** question; costs asked as unknown (not $0) | `tests/integration/round6-intake.test.ts`; corpus `m1` | Provider reading checked only with a mocked SDK in tests; real provider run pending (see 9) |
| 2 | Provider values must be in the text | `checkModelIntake` | Mocked model claims a `$300` cost, "said received" and tax year 2026 that the email doesn't state → all three dropped, note shown; refusal / timeout / quota → `refused` / `timeout` / `quota`, built-in reading still returned; no retry | `round6-intake.test.ts` | Mocked provider (labelled) |
| 3 | Onboarding draft before a household exists | `saveOnboardingDraft` / `answerQuestion` / `onboardingToWorkspace` | Survives reload (localStorage). A typed date answer updates the bound payment. Conversion creates the project via `add_offered_project`; original offer $12,000 `user_confirmed`. Two adults → `needs_answers` (person) | `round6-intake.test.ts` | UI adoption is Claude 1's |
| 4 | One import path, whole group or nothing | `applyImportGroup` / `commitImportGroup` | Two unnamed W-2s → two people, not a conflict. The same person twice → refused. Taxable vs tax-exempt interest kept apart. Benchmark fills only months 1–3. A 2025 W-2 in a 2026 group rejects the whole group. Retry → `nothing_new`. Plan changed elsewhere → `stale`. A corrected W-2 needs an explicit replace; earlier evidence kept | `tests/integration/round6-import.test.ts` | Uses Claude 2's current `checkImportedFacts`; interest type is enforced by Claude 3's target rules |
| 5 | Text PDF without AI; scan refused | `POST /api/documents/extract` | W-2 text PDF → Box 1 $42,000, SS $44,000, Medicare $44,000, "Read on Headroom's server without AI". Scan PDF with consent → `unavailable`, "no readable text layer", no provider call | corpus `d2`, `d7`; `documents.test.ts` | No OCR, no photos |
| 6 | Negotiation and partial payment | `record_client_response`, `record_partial_receipt`, `settle_lower_total` via `commitCommands` | Counteroffer: original offer unchanged, versions `original → client_counteroffer (open)`, unpaid terms replaced, history kept. Accept → `accepted_terms`. Decline keeps $4,000 received. Partial $1,200 of $3,000 + remainder $1,800 on 2027-01-10; totals unchanged. Retry → already applied | `tests/integration/round6-lifecycle.test.ts` | Financial effect of counteroffers is the engine's (Claude 2) |
| 7 | Save re-runs the business checks | `applyChangeProposal` → `validateAndApply` | A fresh, schema-valid receipt dated after today → `BLOCKED`, nothing saved. A YTD forecast update without an as-of date was refused during the export run below | `round6-lifecycle.test.ts` | New command types are checked by Claude 3's rules until Claude 2's validator covers them |
| 8 | Exports after changes (real engine) | `POST /api/export/decision-record`, `/api/export/calendar`, `/api/export/decision`, `/api/assist/explain` | After agreement → partial receipt → income change → counteroffer on the other project: historical PDF `200 verified`, 2 pages, "Received $200.00 of the expected $400.00", "The rest … $200.00 … 2027-01-20"; current calendar `5 current, 2 cancelled` ("Done:" for the received payment, "Cancelled:" for the countered one); current package export `409`; explanation `server_recomputed` at revision 7 | `docs/artifacts/round6/exports/` (PDF rendered and read; ICS parsed with Python `icalendar`) | Synthetic household |
| 9 | Extraction accuracy and time | `scripts/ai-eval.mjs` over HTTP | Built-in: dev set 57/67 → 67/67 after general fixes (optimistic); **untuned hold-out 24/28 (85.7%)**, median 5–8 ms | [`ai-evaluation.md`](../artifacts/round6/ai-evaluation.md) | Provider not measured in this branch |
| 10 | Quotas and operations | `reserveAiCall` + `headroom_count_ai_call`; `scripts/ops-report.mjs` | Every outcome counted (including `quota_reached`) with latency/tokens; BasisWeb cost reported as unknown | `round2-ai-guard.test.ts` | Needs migration 006 |
| 11 | Funnel without personal data | `/api/analytics`, `scripts/analytics-report.mjs` | Round 6 funnel; own/sample/developer separated; date range, denominators, zero state; return buckets (same day / ≥1 day / ≥7 days) | script output | Counts events, not people; no payments |

## Reproduce

```bash
npm ci && npm run build
```

```bash
npx next start -p 3917
```

```bash
npx vitest run tests/integration/round6-*.test.ts tests/integration/round5-assist.test.ts
```

```bash
BASE_URL=http://localhost:3917 node scripts/ai-eval.mjs --label=built-in
```

```bash
BASE_URL=http://localhost:3917 node scripts/ai-eval.mjs --corpus=corpus-holdout.json --label=built-in-holdout
```

Provider run (Codex, private key, synthetic inputs only): see `docs/AI_DEPLOYMENT.md`, "Bounded provider evaluation".
