# AI deployment — integrated round 5

Current adapter: **BasisWeb**, using the official Anthropic SDK at a fixed third-party gateway URL. Model ID `claude-opus-5.5` is the provider's identifier, not independent verification of the underlying model. Keys and the private cabinet URL must never enter Git or logs.

Real checks on November 15, 2026: structured text, text-PDF through Headroom's extraction route, and a sentence changing a known payment date. See [integration handoff](handoffs/integration-round5.md) for release evidence.

## Features and actual limits

| AI_FEATURES item | Endpoint | Behavior |
|---|---|---|
| extraction | POST /api/documents/extract | Embedded PDF text read on our server, then sent with permission for fact proposals. CSV/TXT parsed deterministically. |
| proposal | POST /api/assist/propose | Consented text becomes commands/questions; supported patterns work without AI. |
| proposal (same feature and call quota) | POST /api/assist/intake | Round 6: an ordinary client email or counteroffer → offers as written + typed questions. Every provider value must be quoted from the text; otherwise it is dropped and asked. Without consent/AI: built-in reading. `providerStatus` says `used`, `not_consented`, `disabled`, `quota`, `timeout`, `refused`, `invalid_output` or `unavailable`. |
| explanation | POST /api/assist/explain | Server recomputes financial packet. Optional model framing does not replace numerical explanation. |

Round 6: without consent, or with AI off, a PDF's embedded text is read on Headroom's server with the same deterministic reader as TXT (nothing is sent). BasisWeb rejected direct PDF attachments (HTTP400). `pdf-parse` reads embedded text without OCR. Photos or PDFs without a text layer return a paste/manual alternative before spending a gateway call. Do not advertise scans/photos as working. The optional direct Anthropic adapter accepts attachments but is not the verified production provider.

Extraction limits: 3 MB, 5 pages, 50,000 extracted characters, 4,000 output tokens, 40-second provider timeout. Proposals: 4,000 input characters, 2,000 output tokens, 20 seconds. Explanation: 1,200 output tokens, 15 seconds. No automatic retry/model switch.

## Private environment

| Variable | Non-secret configuration |
|---|---|
| AI_PROVIDER | basisweb |
| AI_MODEL | claude-opus-5.5 |
| AI_API_KEY | private server-only gateway key |
| AI_FEATURES | extraction,proposal,explanation |
| AI_DAILY_CALL_LIMIT | 100 global |
| AI_GUEST_DAILY_CALL_LIMIT | 10 |
| AI_IP_DAILY_CALL_LIMIT | 20 |
| SUPABASE_SECRET_KEY | private server-only credential |

Public Supabase configuration provides the invisible guest session. `AI_PROVIDER=none` disables external AI; manual calculation remains available. Production env is in the existing Vercel project; changes require redeployment. Allowed destination/models are fixed in `src/lib/server/ai-client.ts`; other gateway models have not been evaluated.

## Quotas and accounting

BasisWeb uses atomic `headroom_consume_ai_quota` from migration 003. Every attempted request counts, including failure/unknown usage. Guest/IP identifiers are HMAC-hashed. Recreated guests cannot bypass the global limit. Existing burst limits are only per-instance protection.

Gateway USD cost is **unknown**. Logs report token counts, outcome and `costUsd: null`. Call caps and size/output limits constrain use but are not a verified dollar ceiling. Unit economics must model the unknown instead of copying direct Anthropic prices.

The optional direct Anthropic adapter uses migration005 spend-reservation RPCs. Its inherited price table must be checked against current official prices before enabling it. Unknown usage keeps the reservation; it is not refunded as a free call. Migration005 also enables server-only aggregate analytics. Migrations001–005 are already applied.

## Consent and validation

- Permission precedes external processing. Text-PDF contents and relevant minimal project/payment context can leave Headroom; privacy copy identifies BasisWeb.
- Originals are not retained. Confirmed facts/short redacted excerpts may be stored in a plan. No documents, amounts, full payloads or secrets in logs/analytics.
- Model values are copied as written and parsed into cents/dates by code. Text-PDF excerpts must occur in the actual source and contain the printed value. User approval precedes application.
- Person, contribution year, income period and ambiguous payment target require explicit resolution. JSON schema compliance is not accuracy evidence.
- Financial explanations are server-recomputed templates. Model framing with digits is rejected. Legacy client packets are explicitly unverified.
- Quota failure blocks paid calls; manual input/calculation remains available.

## Bounded production smoke

1. Capabilities shows intended AI/cloud flags without credentials.
2. Labelled synthetic text PDF: compare fee/date/cost proposals with exact source, inspect review UI.
3. Known synthetic project plus date-change sentence: one correct command, unchanged amount, `providerUsed` true.
4. Targeted no-text PDF/quota/failure tests; do not repeat paid calls after a green result without a reason.
5. Confirm logs and deployed client contain no secrets/content. Inspect the actual Vercel route, not only local build.

The parser is externalized with `pdf-parse` and `@napi-rs/canvas`. [Maintainer deployment guidance](https://github.com/mehmet-kozan/pdf-parse/blob/main/docs/troubleshooting.md).

## Insurance lookup

Benchmark/county-name lookup uses bundled CMS year/county data. County candidates are not confirmed eligibility results. ZIP lookup requires a separate `MARKETPLACE_API_KEY`; it is not configured or live-tested. Never substitute state averages or a different year's data. Manual notice entry remains available.

## Round 6 additions (Claude 3)

- Migration `202611180006_round6_ops.sql` (not yet applied): `developer` analytics data kind; `ai_calls_daily` + `headroom_count_ai_call` (feature, provider, outcome, latency, token totals; no content). Reserve/settle count every outcome, including `quota_reached`.
- Reports (server secret from a private shell, never committed): `node scripts/analytics-report.mjs 30` (round 6 funnel with date range, own-data denominators, zero state; sample/developer separated) and `node scripts/ops-report.mjs 7` (provider availability, outcome classes, quota refusals, mean/max latency, tokens; BasisWeb cost stays "unknown").
- No new environment variables. `AI_FEATURES=extraction,proposal,explanation` already covers intake (it uses `proposal`).

### Bounded provider evaluation (Codex, with the private key; synthetic inputs only)

1. Deploy the merged build with the existing BasisWeb env; apply migration 006.
2. Messages (6 provider calls): `EVAL_CONSENT=1 NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… BASE_URL=https://<deployment> node scripts/ai-eval.mjs --label=provider-messages --only=m`
3. Documents (5 provider calls; the scan spends none): same with `--label=provider-documents --only=d`. The per-guest cap is 10 calls/day, so run step 3 the next day or with a second anonymous guest (the script signs in a new one each run).
4. Hold-out (3 messages + 2 docs): `--corpus=corpus-holdout.json --label=provider-holdout`.
5. Commit the three `docs/artifacts/round6/eval/results/provider-*.json` files and update `docs/artifacts/round6/ai-evaluation.md`. Check `node scripts/ops-report.mjs 1` shows the calls with latency and no unknown-usage surprises. Do not repeat after a clean run.

