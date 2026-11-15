# Round 5 integration — Codex

November 15, 2026. Branch `codex/round5-integration`; normal merges of Claude 1 `51ba0fa`, Claude 2 `c074b94`, Claude 3 `7667644` onto main `469d147`. Approved design assets preserved.

## Integrated behavior

Selected C interface; readiness/goal search; confirmed text update preview/apply; original offer and decision context; historical decision PDF; current calendar; insurance county lookup; server-recomputed explanations; aggregate analytics.

Codex fixes: engine/deal version bumps; local calendar dates; ambiguous payment target matching; client-paid sentence support; explicit SEP tax year; original manual offer capture; mobile baseline wording; workspace-revision staleness; short-laptop hero proportions; bounded motion/reduced motion; normal-product copy with truthful fixture/payment provenance.

Versions: engine1.3.0, household1.0.1, deal1.1.0, rules `us-federal-aca-2026-2027.r3`.

## AI/services

BasisWeb configured privately in local env and Vercel Production. Text works. Direct PDF attachment returned400; implemented embedded-text extraction with `pdf-parse`, then structured fact proposals verified against actual source excerpts. No OCR/photo claim. No-text PDFs spend no provider call.

Durable global/guest/IP call caps100/10/20. Failed gateway calls stay counted; USD cost remains unknown. Unknown direct-provider usage retains the reservation. No payloads/files in logs or persistent originals. Privacy names gateway/context.

Migration005 applied after001–004; 26 live RLS checks passed. Existing cloud projects preserved. Vercel env saved; integrated main triggers release.

## Verification

- Combined branches passed typecheck,157 tests/29files and build before integration additions.
- Targeted checks cover ambiguity, quota/unknown usage, local dates, original manual offer, no-text PDF and SEP year. Last relevant groups passed; parser production build passed.
- Bounded UI check passed: changed offer changes result; invalid input blocks save; SEP cap; save/reopen/history; missing spouse facts; actual receipt/SEP updates; three goal options; impossible goal; change preview/apply/retry; six360px routes; no page errors.
- Real local provider route correctly proposed fee `$12,000.00`, December20 2026, title and zero costs from a labelled synthetic PDF. A natural sentence moved only the known bakery payment to January8 2027, `providerUsed:true`. These are fixture checks, not customer accuracy/traction.
- Actual UI-created decision PDF downloaded, both pages rendered/inspected: historical context, original offer, comparison, cash/retirement and versions. Current ICS downloaded with six events. Local artifacts under `../artifacts/round5-integration`; public prior examples under `docs/artifacts/round5`.
- Desktop home compared to selected C. Short viewport keeps real input/CTA visible. Reference images unchanged.

Production verification is appended after deployment; local success is not production verification.

### Production: verified November15

Vercel production deployment `5g36Ltg3CdkUpusHJZWvcBAwXgjV` built commit `2dc973b6bbf4a342382d81564e1cc388f7352a7f` and reached Ready. Public alias opens without registration or Vercel authentication. Capabilities: cloud save and all three AI flags true; checkout remains no-charge/demo mode.

Actual production requests passed: text-PDF extraction returned all four expected offer fields and a natural-language payment update returned one correct typed command with `providerUsed:true`. The check used newly created synthetic guest data and removed that test identity. PDF parser/native dependencies therefore work on Vercel, not only locally. The live home was inspected and a local screenshot saved. Optional provider explanation framing was not separately exercised with a real request.

The bounded UI suite also passed against the public production alias: calculation/edit/save/reopen, household receipts and SEP, three goal options, impossible goal, update preview/apply/retry, six 360px routes and no page errors. No repeated paid accuracy sweep was run. Tracked files and built client assets were scanned against the actual private AI/Supabase values: zero matches across 471 checked files.

The user subsequently rejected the lower landing/internal visual quality while retaining the selected C hero/identity. This is a design-completion requirement in Claude1 round6, not a claim that the whole current interface has final approval.

## Known remaining work

Initial pasted offer still uses TXT patterns and substantial manual questions; current-year offer evaluation needs a UI caller. Semantic import/ImportDraft needs actual common first-use/saved-plan wiring, conflict resolution and atomic apply. Saved import targets incomplete. Counteroffer/rejection and partial receipts need explicit lifecycle. No measured paid demand, validated price, customer retention or known gateway dollar COGS. No OCR/photos or live ZIP lookup.

Next: [shared brief](../tasks/ROUND6_SHARED.md) and three individual round6 assignments. Evidence: [product audit](../research/round6-product-gap-audit.md), [paid demand](../research/round6-paid-demand.md), [competition/pitch](../research/round6-competition-pitch.md). Requirements and external evidence are not implemented-feature or customer claims.
