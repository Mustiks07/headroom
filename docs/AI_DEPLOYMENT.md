# AI deployment (round 5)

Status: **no real provider request has been made by Claude 3** — no key was available. Production runs with `AI_PROVIDER=none`; manual entry, CSV/TXT/pasted-text import, deterministic change proposals and deterministic explanations work without any provider. Codex enables the provider after a real synthetic test.

## What the provider is used for (three separate switches)

| Feature (`AI_FEATURES` item) | Endpoint | Without it |
| --- | --- | --- |
| `extraction` | `POST /api/documents/extract` (PDF / PNG / JPEG / WebP) | CSV/TXT/pasted text are read deterministically; PDF/images say "Document analysis is unavailable. Enter the figures manually." |
| `proposal` | `POST /api/assist/propose` | Built-in patterns: moved payment, received payment, SEP contribution, simple new offer; anything else asks for the form |
| `explanation` | `POST /api/assist/explain` | Deterministic explanation from the engine's verified packet |

Each feature is ON only when **all** hold: `AI_PROVIDER=anthropic`, a real `AI_API_KEY`, Supabase public values + `SUPABASE_SECRET_KEY`, migration `202611170005_ai_budget_analytics.sql` applied, `AI_MODEL` listed in the dated price table (`src/lib/server/ai-budget.ts`), and the feature listed in `AI_FEATURES`. If `AI_FEATURES` is unset, only `extraction` is enabled (round 2 behaviour). Each call also needs this browser's anonymous guest session and the user's explicit per-request consent.

## Environment (server-only; set in Vercel → Settings → Environment Variables)

| Name | Safe default / example | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `none` | `anthropic` to enable |
| `AI_API_KEY` | – | Anthropic API key. Never in `NEXT_PUBLIC_*`, Git, logs or chat |
| `AI_MODEL` | `claude-opus-5-5` (code default) | Must be one of `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (priced). Choose after the comparison below; no automatic fallback to another model |
| `AI_FEATURES` | `extraction` | e.g. `extraction,proposal,explanation` |
| `AI_DAILY_BUDGET_USD` | `5` | **Global** daily ceiling — the real spend limit (anonymous guests can be re-created) |
| `AI_GUEST_DAILY_BUDGET_USD` | `0.50` | Per guest session per day (soft) |
| `AI_IP_DAILY_BUDGET_USD` | `1` | Per HMAC-hashed IP per day |
| `MARKETPLACE_API_KEY` | – | Optional, not AI: official Marketplace API key for ZIP → county candidates. Server-only; never `NEXT_PUBLIC_*` |
| `AI_DAILY_LIMIT`, `AI_GUEST_DAILY_LIMIT`, `AI_IP_DAILY_LIMIT` | – | Round 2 call counters; no longer used (replaced by the spend budget for all features) |

Also set a monthly spend limit in the Anthropic console; Headroom's budget is an additional guard, not a replacement.

## Per-request limits and cost control

- Prices used for budgeting (USD per million tokens, Anthropic models overview, checked 2026-11-16): Opus 5.5 $4 in / $20 out; Sonnet 5.5 $2 / $10; Haiku 5.5 $0.10 / $0.50. Update `MODEL_PRICES_PER_MTOK` and `PRICES_CHECKED_ON` when prices change.
- Before each call the **worst case** is reserved atomically in Postgres (`headroom_reserve_ai_spend`): estimated input (2,000 + text/3 + 3,000 per PDF page + 1,800 per image) plus the feature's max output tokens. After the call it is settled with the provider's actual `usage` (`headroom_settle_ai_spend`). A crash keeps the reservation (fail-safe). If the budget store is unreachable, the AI feature fails closed; the manual path continues.
- Limits: extraction ≤ 3 MB, ≤ 5 PDF pages, 4,000 output tokens, 40 s; proposals 2,000 output tokens, 20 s, text ≤ 4,000 chars; explanations 1,200 output tokens, 15 s. `maxRetries: 0`, no server-side fallback, `effort: "low"`.
- Worst-case reservation per call with the defaults: Opus 5.5 extraction of a 5-page PDF ≈ (17,000 × $4 + 4,000 × $20) / 1e6 ≈ **$0.15**; Haiku 5.5 ≈ $0.004. Proposal with Opus ≈ $0.05. Actual cost is usually lower and is what is recorded.
- Logs: one line per call with feature, model, outcome, token counts and cost — never text, documents, amounts or provider payloads.

## Structured output and validation

Official SDK `@anthropic-ai/sdk` 1.8.0, `client.messages.parse` with `output_config.format` from `zodOutputFormat` (GA JSON schema output; no beta header). Schemas avoid unsupported keywords (no min/max/length constraints). Refusal or `max_tokens` → treated as unavailable. Structured JSON is not proof of correctness, so:

- extraction: the model copies values **as printed**; Headroom parses cents/dates itself and drops any value not found in the model's own quoted line; the person is never inferred; every figure needs user confirmation (group confirm only for non-conflicting facts);
- proposals: the model may reference only context ids; amounts/dates are parsed from its "as written" text against the user's date/time zone; unknown ids → a question; only whitelisted commands;
- explanations: the client sends `{workspace, subject, refId?}` and the **server rebuilds the packet** with the engine's `buildExplanationPacket` from that exact revision (`verification.origin: "server_recomputed"`, with workspace id, revision, fingerprint, engine/rules versions). A browser-built `{packet}` is still accepted but labelled `client_packet_unverified` ("not recalculated by the server"). Every financial sentence is an engine template with references; the provider may only add a short **number-free** framing in front of it (any digit → rejected, deterministic text shown). Matching figures alone is not treated as proof of meaning.

## Insurance data lookups (no LLM involved)

- `POST /api/insurance/benchmark {workspace, year}` — no external call. Claude 2's `resolveBenchmark` over the CMS plan-year county extracts in `data/reference` (Davidson County, TN, PY2026/PY2027; sha256 and retrieval date 2026-11-14 in `source-manifest.json`). Returns `confirmed` (the user's notice), `county_candidate` (never shown as the confirmed benchmark) or `not_available` with what to enter. No averages, no other year's figure.
- `GET /api/insurance/location?state=TN&q=davidson` — counties with plan data in this build.
- `GET /api/insurance/location?zip=37203` — only when `MARKETPLACE_API_KEY` (server env) is set: one fixed official endpoint, `marketplace.api.healthcare.gov/api/v1/counties/by/zip/{zip}`, 5 s timeout, ZIP only (no income, names or family data), 24 h in-memory cache, 30 lookups/min per IP; a ZIP crossing county lines returns `ambiguous` with every county. The key is requested from the CMS developer portal; its rate limits were **not verified** here (cms.gov/healthcare.gov were unreachable from the build session) and **no real request was made** — the response shape is validated and anything unexpected returns `not_available`. Without the key, ZIP lookup says it isn't set up.

## Provider smoke (Codex, after setting the key)

1. Deploy with `AI_PROVIDER=anthropic`, `AI_FEATURES=extraction,proposal,explanation`, the chosen `AI_MODEL`, small budgets (e.g. `AI_DAILY_BUDGET_USD=1`).
2. `GET /api/capabilities` → the three AI booleans true (in a browser with a guest session).
3. Upload the synthetic PDFs made from `docs/artifacts/round5/sample-documents/*.txt` (print to PDF); compare the proposed facts with `expected-facts.json`; record model, latency, input/output tokens and cost from the function log line.
4. Propose "The remaining payment moved to January 8, 2027" with consent; confirm the preview shows exactly one changed line.
5. Explain one result with consent; the text must contain only figures from the packet.
6. Query `ai_reservations` for the day: every row settled, spend within budget.
7. Optional comparison: repeat step 3 with `claude-haiku-5-5` and `claude-sonnet-5-5` on the same three documents; choose the cheapest model whose proposed facts match `expected-facts.json` exactly.
