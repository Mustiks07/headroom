# Architecture and shared interface agreement

## Runtime

One Next.js App Router application on Vercel, TypeScript throughout. The deterministic engine is a browser-compatible module. It is also called by the server before exporting/saving authoritative calculated snapshots. No Python runtime or separate backend deployment is required.

Supabase provides PostgreSQL, optional anonymous auth and private source metadata. AI is behind one server adapter selected by environment configuration. Manual input, calculation and local persistence do not depend on external keys. The foundation intentionally exposes unavailable stubs until their assigned owner implements them.

```text
UI and editable facts (Claude 1)
    ├── shared CaseInput → calculateComparison (Claude 2)
    │                         └── versioned rules + numeric trace
    └── client API / PlanRepository (Claude 3)
           ├── local browser repository, when cloud is unavailable
           └── Next.js API → Supabase / document provider / PDF
```

## Directories and ownership

`src/domain/contracts.ts` is the shared v1 contract. `src/fixtures/cases.ts` contains **inputs**, not fabricated output cards. Do not implement a separate financial formula in React, an API handler or an LLM prompt.

| Path | Owner | Purpose |
| --- | --- | --- |
| `src/app`, excluding `api` | Claude 1 | Routes, layouts, global visual style |
| `src/components`, `src/features` | Claude 1 | Forms, comparison, evidence, saved-plan UI |
| `src/lib/engine` | Claude 2 | Eligibility guards, taxes, PTC, SEHI, search, trace |
| `data/rules`, `data/reference` | Claude 2 | Versioned parameters and independent examples |
| `src/lib/client/api.ts` | Claude 3 | Stable adapter used by UI |
| `src/lib/server` | Claude 3 | Providers, ownership, persistence, PDF, env validation |
| `src/app/api`, `supabase` | Claude 3 | HTTP and database |
| package/config/lockfile | Claude 3 after foundation | Shared dependency integration |

UI-only types can live in the UI tree. Engine internals can live in the engine tree. Changes to shared contracts/fixtures must be coordinated by Claude 3, documented in the handoff and adopted by both consumers. Prefer additive changes; no unannounced field renaming.

## Shared entry points

```ts
assessCurrentRisk(input: CaseInput): Promise<RiskAssessment>
calculateComparison(input: CaseInput): Promise<ComparisonResult>
getDemoCase(id: string): CaseInput | undefined
createPlanRepository(): PlanRepository
extractDocument(file: File): Promise<ExtractionResult>
exportPlanPdf(plan: SavedPlan): Promise<Blob>
```

The async engine entry allows browser-compatible SHA-256 fingerprints and moving expensive work into a Worker. Its calculations remain deterministic and network-free. The result must not depend on the wall clock, AI or locale. Use explicit tax year and rule version.

`ComparisonResult.status` is `ready`, `needs_data`, `unsupported` or `unavailable`. The UI handles every state. Only `ready` contains scenario outputs. Missing fields identify contract paths and human-readable reasons. Never replace a blocked result with a successful demo result.

`assessCurrentRisk` evaluates the current year independently of an opportunity and unknown next-year facts. Use it for the original subsidy-protection entry. `calculateComparison` requires any next-year facts needed for its two-year results; ask for those only when moving into that comparison. Do not silently copy this year's income into next year. `scopeConfirmed: null` requires clarification, not a default assumption.

Money is integer cents at every boundary; Decimal intermediates and source-specific rounding stay inside the engine. `FactSchema` rejects unknown zeroes. `range` is an explicitly declared uncertainty interval, not a statistical confidence estimate. Array positions are not person identities; use `personId`.

The engine validates required adult incomes, ownership, covered people, evidence references, tax family consistency, scope and eligibility in addition to structural Zod parsing. A valid JSON shape does not imply tax eligibility. New UI profiles start with unknowns. The synthetic fixtures explicitly assert their assumptions.

Fingerprint: SHA-256 of canonical key-sorted input + engine version + rule version. Saved scenarios and AI explanations carry that fingerprint. Editing any relevant fact invalidates old results; old and new snapshots must never be combined in one comparison.

## Routes and API

UI routes owned by Claude 1: `/`, `/check`, `/demo`, `/plan/[id]`, `/pricing`, plus simple privacy/terms pages. The route names may be extended without changing the module contract. A `case` query selects the seed; the URL does not contain private financial inputs.

| Method and route | Input | Result |
| --- | --- | --- |
| `POST /api/assess` | `CaseInput` | `RiskAssessment`; only current-year facts required |
| `POST /api/calculate` | `CaseInput` | `ComparisonResult`; same engine as browser |
| `POST /api/documents/extract` | multipart `file` | `ExtractionResult`; proposed fields and evidence, no automatic apply |
| `GET /api/plans` | authenticated anonymous/session owner | owner's plan summaries |
| `POST /api/plans` | `{plan, expectedRevision: null}` | validated saved plan at revision 1 |
| `GET /api/plans/[id]` | owner session | saved plan or 404 |
| `PUT /api/plans/[id]` | `{plan, expectedRevision}` | next revision, or 409 conflict |
| `DELETE /api/plans/[id]` | owner session | 204; associated records removed |
| `GET/POST /api/plans/[id]/events` | `PlanEvent` on POST | history / saved event |
| `DELETE /api/data` | owner session | delete that user's app data |
| `POST /api/export` | `{input, chosenScenarioId}` | PDF generated from a fresh engine result |
| `POST /api/checkout` | explicit demo/test mode | clearly identified demo action or Stripe test URL |
| `GET /api/capabilities` | none | `{cloudSave, aiExtraction, checkoutMode}`; booleans/mode only |

HTTP 400: malformed input. 200: a valid financial-domain result, including needs_data/unsupported. 401: missing/invalid cloud session. 404: inaccessible/missing resource, without disclosing another owner. 409: revision conflict. 413: file too large. 415: unsupported file. 429: rate limit. 503: configured service unavailable. No fabricated 200 success when an integration is absent.

Claude 3 implements API payload schemas at the boundary. Server derives `owner_id` from verified auth, never from the body. When saving a financial result, recompute from the submitted input, validate the chosen scenario, and reject stale/mismatched fingerprints. Stored client-calculated numbers are not trusted as proof.

Local PlanRepository matches the same semantics in IndexedDB or versioned local storage: per-browser persistence, optimistic revision, events and clear. It is not an in-memory Map masquerading as persistent storage. Cloud failure must preserve local draft; show a truthful mode label. Do not silently duplicate or overwrite a newer cloud revision.

## Database

`supabase/migrations/202611140001_foundation.sql` provides the initial schema for review/implementation by Claude 3. It is not claimed to have been applied to a live project.

- `plans`: owner, revision, complete versioned plan payload.
- `plan_events`: owner, plan, event payload; composite FK keeps event ownership aligned with plan ownership.
- `document_sources`: minimal source metadata for confirmed facts; no raw file blob/SSN.
- `entitlements`: read-only to its owner; only trusted server/payment path writes it. Test/demo rows are distinguishable from live purchases.

RLS applies to the `authenticated` role, which includes Supabase anonymous sign-ins. The public publishable key is not an ownership mechanism. Do not use an unrestricted service-key client for normal user reads/writes. Use server secret credentials only for strictly scoped privileged operations.

Anonymous auth is a no-form guest mechanism, not a promise of cross-device recovery. Judge mode stays functional when Supabase is unconfigured or anonymous sign-in cannot proceed; explain local storage accurately. Production anti-abuse/rate controls must not unexpectedly lock judges out of the deterministic demo.

## Documents and providers

Limit the first extraction request to 3 MB and a documented small page count; validate MIME and actual parseability. CSV/TXT can use deterministic extraction with user review. PDF/image extraction requires a configured supported provider or a real local parser. Unsupported/scanned documents get a clear fallback, not guessed values.

`AI_PROVIDER=none` is the default. Claude 3 should implement one actual provider adapter once credentials/provider are known; adding adapters must not change the UI or engine. No placeholder API key is treated as working configuration. `AI_API_KEY` and `AI_MODEL` are server-only. Never expose a secret through NEXT_PUBLIC variables.

Treat document text as untrusted data. Model output is schema-validated and restricted to proposed fields/evidence. No model tools for payments, deleting data or changing accounts. Numerical explanations use the calculated scenario and trace; if output changes a number, fall back to deterministic explanation.

Do not retain original documents by default. Tell users before a provider receives the document. Keep source excerpts minimal and do not send document bodies to analytics. Deterministic manual mode must remain usable after extraction timeout.

## Integration sequence

1. All three start at the common foundation commit on their assigned branch.
2. Claude 2 replaces the engine entry point. Claude 1 builds against the stable ready/blocked union and genuine demo inputs. Claude 3 replaces persistence/extraction/export stubs.
3. Each leaves `docs/handoffs/claudeN.md` with exact completed behavior, necessary env, known gap, changed contract and checks run.
4. Claude 3 fetches both branches, merges their implementation commits into `claude3`, resolves ownership/interface issues and runs the bounded acceptance suite.
5. Integrate to `main` only when the actual core path works. Do not repeatedly rerun all checks while code is unchanged. Deploy the integrated branch on Vercel; verify the deployed link and release artifacts.

When an implementation is missing, surface the blocker and continue independent assigned work. Do not wait for AI keys to build the engine or for Supabase to build the UI.
