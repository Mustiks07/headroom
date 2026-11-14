# Headroom development rules

Headroom helps US self-employed people protect their ACA health-insurance subsidy as income changes. A new client project is one important entry point. Do not turn this into a general budgeting app or remove health-insurance protection from the main story.

## Read first

1. `docs/TZ.md` — authoritative product and implementation specification.
2. `docs/ARCHITECTURE.md` — modules, shared interfaces, API and persistence.
3. `docs/ENGINE_SPEC.md` — financial rules, supported cases and audit findings.
4. Your assignment in `docs/tasks/CLAUDE1.md`, `CLAUDE2.md` or `CLAUDE3.md`.
5. `docs/ACCEPTANCE.md` — a bounded verification plan and release definition.

The user wants a strong, complete, checked result. Public app, README, deck and demo must match the current build. Preserve user-provided final materials; do not replace them with weaker generated versions without agreement. Inspect the actual artifacts judges will open before final publication.

## Shared decisions

- Product name: **Headroom**. All app UI, validation, generated reports and presentation content are **English**. Internal specifications may be Russian.
- Next.js App Router + TypeScript. One Vercel deployment. Supabase for optional cloud persistence. Deterministic TypeScript financial engine, no LLM arithmetic.
- Money crossing module/API boundaries is **integer USD cents**. Use Decimal for intermediate financial arithmetic and documented IRS rounding. Do not mix dollars and cents.
- `null`/unknown is not zero. Distinguish confirmed values, estimates and missing data. Do not silently infer spouse income, eligibility or the correct benchmark.
- Read `src/domain/contracts.ts` before building your component. It is the shared contract, not a suggestion.
- The foundation contains explicit unavailable stubs. Replace them with real behavior; never disguise an unimplemented calculation, upload, payment or save as success.
- No login, signup, password, email gate or account screen anywhere in the contest app. The full journey works immediately. Supabase anonymous sessions are invisible technical plumbing, not an onboarding step. Manual input and financial calculation work without AI keys. Guest save/reopen works without Supabase keys. No real-payment gate for judges.
- User documents, credentials and provider payloads do not belong in Git, logs or analytics. `.env.example` contains names only.

## Parallel ownership

| Branch | Owner | Own paths |
| --- | --- | --- |
| `claude1` | UI and user journey | `src/app/**` except `src/app/api/**`; `src/components/**`; `src/features/**`; `public/**`; UI smoke flows |
| `claude2` | Financial engine | `src/lib/engine/**`; `data/rules/**`; `data/reference/**`; `reference/**`; `scripts/reference/**`; `tests/engine/**` |
| `claude3` | Backend and integration | `src/app/api/**`; `src/lib/client/**`; `src/lib/server/**`; `supabase/**`; `tests/integration/**`; package/config/CI files |

Shared contracts and fixtures are frozen initially. Claude 3 is their integration owner; coordinate additive changes through the handoff files/PR description before dependent edits. Do not independently rename fields, change return statuses or install a second UI/build stack. Claude 1 may add UI-only helpers without changing the contract. Claude 2 may add internal engine types.

Each Claude works in a **separate clone or worktree** on its assigned branch. Never switch another developer's shared working directory. No force pushes or rewriting another branch. Do not delete/recreate other work. Commit coherent increments and include the changed contract, required env/migration and verification in `docs/handoffs/claudeN.md`.

Claude 3 integrates engine and UI branches into `claude3` after their handoffs, resolves integration issues, then prepares the combined result for `main`. Only the integrated, checked version goes to the shared release branch. Foundation commit is the common starting point; do not recreate the repo.

## Verification without an endless test loop

Run the checks affected by your change. At handoff: typecheck, the relevant small test group, and one build. After integration: the finite checks in `docs/ACCEPTANCE.md`, including the deployed core journey. Repeat only after relevant code changes or a failure. No arbitrary coverage target, speculative test expansion, cosmetic unit tests or repeated identical green runs. Financial boundary errors and cross-user data access deserve targeted checks.

Never claim guaranteed savings, independent professional review, customer payments or a finished integration without evidence. Synthetic examples must be labeled. Retirement principal is not spendable cash. Do not count repayment twice. Every number displayed by the product must originate from the actual calculation result.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
