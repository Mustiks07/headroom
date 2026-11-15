# AI deployment — integrated round 5

Current adapter: **BasisWeb**, using the official Anthropic SDK at a fixed third-party gateway URL. Model ID `claude-opus-5.5` is the provider's identifier, not independent verification of the underlying model. Keys and the private cabinet URL must never enter Git or logs.

Real checks on November 15, 2026: structured text, text-PDF through Headroom's extraction route, and a sentence changing a known payment date. See [integration handoff](handoffs/integration-round5.md) for release evidence.

## Features and actual limits

| AI_FEATURES item | Endpoint | Behavior |
|---|---|---|
| extraction | POST /api/documents/extract | Embedded PDF text read on our server, then sent with permission for fact proposals. CSV/TXT parsed deterministically. |
| proposal | POST /api/assist/propose | Consented text becomes commands/questions; supported patterns work without AI. |
| explanation | POST /api/assist/explain | Server recomputes financial packet. Optional model framing does not replace numerical explanation. |

BasisWeb rejected direct PDF attachments (HTTP400). `pdf-parse` reads embedded text without OCR. Photos or PDFs without a text layer return a paste/manual alternative before spending a gateway call. Do not advertise scans/photos as working. The optional direct Anthropic adapter accepts attachments but is not the verified production provider.

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
