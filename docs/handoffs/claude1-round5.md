# Claude 1 — round 5 handoff (UI)

Branch `claude1`. Normal merges only (no reset, no force-push); `main` untouched.

## Dependencies merged

| What | SHA |
|---|---|
| `origin/main` (selected design C + current prompts) | `c5f29dd` |
| Claude 3 round 5 contract (`src/domain/assistance.ts`) | `97b608c` |
| Claude 3 round 5 implementation + handoff | `60df7a2` |
| Claude 2 round 5 engine + handoff (incl. `previewChange` apply hook, two baselines) | `32f59d3` |
| Claude 2 follow-up: `clientAgreement` + `moneyByDate` on every option, stored comparisons/robustness | `bc99600` |
| Claude 3 follow-up: original offer kept, decision context in packages/records, server-recomputed explanations, insurance lookups | `00beeaf` (contract `29c6ab4`, `36edf1e`) |
| Claude 3 calendar UID fix (long ids → readable prefix + stable hash) | `7667644` |

**Consumed from the follow-ups (after design C):**
- Options use Claude 2's `clientAgreement` (which of price/dates needs the client's agreement, plus its note) instead of a UI guess.
- **By your date** uses `moneyByDate`: a per-date table (received / available after costs, extra SEP and tax set aside, through both return due dates). The big figure is the goal's date target, or "available by Dec 31, 2026" when no date goal is set.
- "Why …" panels call Claude 3's `explainWorkspace` (server-recomputed for the plan revision), falling back to the same deterministic text built in the browser; the footer says which.
- **Help me find this** on benchmark questions: where the SLCSP is on the notice, `lookupBenchmark` (county candidate from the bundled CMS extract, labelled "not the exact benchmark", used only on an explicit "Use as a county estimate"), and a county picker when the county is unknown (saved to the plan as one revision).
- **County by name or ZIP** (`lookupLocation`) replaces the FIPS field on the household form.
- Checked: TN own household, county "Davidson" found and saved, lookup answered honestly that ages outside 0–14/21/38–40 have no verified county prices. A positive county candidate wasn't reachable with this test household.
- The decision-record PDF now shows the original offer, the baseline and the options compared with the recommendation reason (Claude 3's decision context, from packages saved by the UI).

## Design C (user-selected, `docs/design/c-open/`) — implemented across the working path

- **Foundation:** C tokens in `globals.css` (cobalt #2447F0, chartreuse #DFFF74, ink, canvas, control border, amber/red/success pairs, disabled pair), old names aliased so every existing screen moved to C. **Geist Sans only**, self-hosted variable WOFF2 with its OFL licence (`public/fonts/geist/`), preloaded, `font-display: swap`; serif removed. Tabular lining numerals for money. 3px cobalt focus ring with 3px gap (chartreuse on cobalt). Controls 48px, small buttons and targets ≥44px, radius 12/16/20/24. Real disabled state (#E2E6F0/#687186), not opacity. Reduced motion removes animation; the hero scene enters once (≤450ms).
- **Identity:** native mark from `headroom-mark.svg` inline with `currentColor` (`HeadroomMark`), aria-hidden next to the wordmark; favicon `src/app/icon.svg`.
- **Header:** cobalt on every page, white nav with chartreuse current-page underline; below 800px a menu button (Escape closes, focus returns).
- **Landing `/`:** “Before you say yes.” / “See what a client offer leaves you after tax and health insurance.”, the supplied transparent chrome scene (`public/brand/hero-scene-*.webp`, 640/1024/1536, reserved 3:2 box, empty alt), a live HTML “Client offer $12,000” paper (labelled illustrative below), and the white entry tray overlapping the cobalt/white edge: textarea + **Check my offer** (empty submit shows an associated error; text goes into the same import review), **Add document · Enter figures · Try an example**, “No account needed”. “Your offer → Your facts → Your next move”, continue-plan link and “Check my year's income” below. At ≤800px the tray comes before the scene in DOM and visual order.
- **Review (`/check?start=project&pasted=1|doc=1`):** your text on the left (source card), read figures on the right with source line; **one group confirmation** “Use these N figures” for clear figures; figures needing a choice (year/person/period) stay separate (“Use only this” / Skip). Fixed: an imported offer price showed as unknown because the import didn't mark the project as started — now name, price and date fill and survive reload.
- **Questions, comparison, action, update:** readiness, deal panel, options, package, records and “What changed?” use the C surfaces. The recommended option is a cobalt card with white type and a chartreuse “Our pick”; others white. **Horizon selector “After tax settlements / By your date”** on desktop and mobile (by-date shows the engine's date-target amount and its explanation; without a date goal it says so). “Client agreement needed” tag beside changed terms, “Proposed payments, not money received”. Labels bound to the engine baseline and horizon (“compared with declining this project · 2026–2027 tax years, final settlement in 2028”).
- **Mobile:** 20px gutters, stacked work screens, full-width actions in cards; no horizontal page scroll on `/`, `/start`, `/check`, `/household/[id]` (incl. deal panel and What changed), `/demo` at 360px.

Not done from the C handoff: a dedicated three-step header nav (“Your offer / Your facts / Your terms”) — the existing in-page steps were restyled instead; the mobile comparison is stacked cards, not compact selection rows; 200% zoom and a screen-reader pass were not run.

## What was built

**Entry**
- `/` task-first: *Check a client offer* (primary), *Check my year's income*, *Try a sample*; *Continue your plan* when a saved own household exists.
- `/start?intent=offer|year` — *Upload documents / Paste text / Enter figures* as equal choices. Paste goes into the same import review as files (deterministic labelled-line reader; it says plainly that free-form emails need the AI service, which is off).
- `/check?start=project&doc=1|pasted=1` opens the import first.

**Documents** (plan → *Add documents*)
- Several files at once, each with a status (waiting for consent / reading / review / can't read here / failed / done).
- Fact cards with source line and period. Clear facts can be applied as one group; ambiguous ones ask (which payment, whose SEP, which date/tax year).
- One revision per applied file; a re-import says "already recorded".
- A PDF/photo with AI off shows *Can't read here* — no fake OCR.
- Synthetic files at `/samples/index.html`.

**Short fill-in from `InputReadiness`** (`src/features/assist/Readiness.tsx`, `answers.ts`)
- On the plan overview (`current_year_subsidy`, or `agreed_plan_review` once a project is agreed) and inside *Find terms* (`two_year_terms` for that project).
- 1–3 questions at a time in engine priority order, each with its reason and document hint.
- **Answered inline**: yes/no, choices, monthly/annual amounts, wage/interest groups. The answer is written only at the paths the engine named, in a copy of the workspace, then saved as one revision; the repository validates the shared schema.
- *I don't know yet* keeps the fact unknown (never $0); a confirmed $0 must be typed.
- Forecast amounts open the income editor at the right person/year (2027 included).
- The income editor can now keep a figure while other facts are still missing (before, a fact couldn't be saved until the whole plan was calculable).

**Offer → goal → up to 3 options** (`DealPanel.tsx`)
- The pick is shown first.
- Each option shows cash vs. declining **and**, separately, vs. the offer as it stands (engine `comparisons`), never called savings.
- *Needs the client's agreement* next to changed price/dates; *Little room* when `robustness.holds === false`.
- *Why these options?* uses `buildExplanationPacket('deal_choice', goalId)` → `renderStatements` (deterministic).
- Price bounds remain full price including received money (round 4).

**"What changed?"** (`src/features/assist/WhatChanged.tsx`)
- Flow: sentence → `proposeChange` (deterministic patterns; the consent checkbox appears only if `aiTextProposals`) → `previewChange(ws, proposal, { userDate, apply: applyChangeProposal })`, so the preview is computed on exactly what Apply saves.
- The preview shows the change rows, per-year subsidy, settlement and cash, agreed-terms checks and stale calendar items.
- **Apply / Edit / Cancel.** Apply = `commitProposal` = one revision.
- Repeating the same update shows *This is already in your plan* with Apply disabled.
- Invalid changes (`status !== "ready"`, e.g. money "received" in the future) show *Can't apply* with the engine's reason.
- Missing-data gaps after a valid change are listed, but Apply stays allowed.
- Questions without options (missing date/amount, "couldn't match") are shown as plain notices, not empty radio groups.
- Provider/service failure keeps the typed text.

**After agreement**
- *Decisions and calendar* (`src/features/deal/Records.tsx`):
  - historical decision records (status, time, "figures as of plan revision N … not today's estimate") → server PDF (`/api/export/decision-record`);
  - *Calendar of current actions (.ics)* via `exportCurrentCalendar`, with Claude 3's import note.
- An agreed package explains itself with `agreed_plan` ("How the agreed terms work on today's figures"), not a stale `deal_choice`.

**Attention list**
- Dedupes by id/title.
- No package reminder repeats a payment, a SEP target item or the "send terms" item.

**Funnel events** (`trackEvent`, event + `dataKind` + `inputPath` only; no amounts, text, ids)

| Event | Where |
|---|---|
| `first_visit` | one per browser, via a localStorage flag only |
| `start` | document / paste / manual |
| `review_completed` | import |
| `missing_question_resolved` | inline readiness answer |
| `result_calculated` | check + terms |
| `plan_saved` | |
| `plan_reopened` | |
| `proposal_confirmed` | |
| `plan_exported` | |
| `provider_failure` | |

Sample sessions are sent as `sample`. The contract has no new-vs-returning dimension; `plan_reopened` is the returning signal.

**Docs:** `docs/demo/round5-judge-script.md`, `docs/demo/round5-positioning.md` (updated with the research memo and addendum), `docs/demo/round5-screenshots/` (final build).

## Routes (actual)

`/`, `/start?intent=offer|year`, `/check` (`?start=project`, `&doc=1`, `&pasted=1`), `/demo`, `/household`, `/household/[id]`, `/plan/[id]`, `/plans`, `/samples/index.html`, `/pricing`, `/privacy`, `/terms`.

## How many answers before a result (checked in the browser)

| Path | Answers before a result |
|---|---|
| Sample household | 0 |
| Own figures, "Check my year's income" | **14 answers** before the first subsidy result: household 3 (state, filing, age), income 4 (profit, no wages, no interest, SEP none), coverage 6 (premium, benchmark, advance credit, benchmark source, PTC and self-employed-insurance eligibility), out-of-scope confirmation 1 |
| Then an offer by sentence, up to terms | 1 sentence + **11 inline answers**: 2027 PTC and SEHI eligibility, 2027 profit, 2027 wages (none), "forecast leaves out projects", 2027 benchmark source, 2027 premium, 2027 benchmark, 2027 advance credit, 2027 interest (none), cash method |

After the 11 answers the search returned *Accept as offered* as the pick (+$8,103): the ordinary-positive case. Agreement, then "The December design project payment moved to January 8, 2027", gave one revision; after reload the repeat was a no-op. The record PDF downloaded, plus 1 agreed-plan question afterwards.

## Checked

- `npx tsc --noEmit` clean.
- `npx vitest run`: 29 files / 151 tests pass after merging `main` + `claude2`. Before Claude 2's `32f59d3`, `deal-ui-boundaries` failed; Claude 2 changed that test for the new recommendation policy.
- `npm run build` passes.
- **After merging `7667644` (final):** `tsc` clean, build passes, `npx vitest run` 29 files / 157 tests, `npm run check:ui` passes; own-data journey re-run end to end including the current-actions ICS.
- **After merging `bc99600` + `00beeaf`:** `tsc` clean, build passes, `npx vitest run` 29 files / 155 tests, `npm run check:ui` passes; sample journey with PDF + ICS (6 events) and the own TN journey with the county/benchmark lookup re-run.
- **Final C build (after the redesign):** `tsc` clean; `npm run build` passes; `npx vitest run` 29 files / 151 tests; `npm run check:ui` passes (29 checks). Sample journey re-run on the C build: goal → options → choose → shared → agreed → update → Apply → reload → no-op repeat → decision-record PDF (text read with `pdftotext`, page 1 rendered: `c-pdf-1.png`) + current ICS (6 VEVENTs). Own journey (14 + 11 answers) re-run: agreement, update, reload, PDF. Provider-down / ambiguous / PDF-with-AI-off re-run. Offer-first paste → group confirm → fields filled → reload checked.
- `npm run check:ui` (before the redesign): 29 checks pass. New: update sentence → preview → Apply = one revision; repeat saves nothing; reload keeps the revision; 360 px on six routes.
- Browser journeys (production build, Chromium):
  - **Sample:** goal → 3 options → why → choose → shared → agreed → "The bakery final payment moved to January 8, 2027" → preview (2027 credit $16,652 → $0, agreed terms no longer meet the goal) → Apply → reload → repeat (nothing to save; history has one entry) → decision record PDF + current ICS (6 events).
  - **Own:** paste/enter → result → plan → offer by sentence → inline questions → terms → agreement → update → reload → PDF.
  - **Ambiguous / invalid:** "couldn't match"; future "received" date → *Can't apply* with reason.
  - **Provider unavailable:** simulated 503 on `/api/assist/propose` keeps the text, sends `provider_failure`. PDF upload with AI off → *Can't read here*.
- Real files opened:
  - decision-record PDFs (sample and own) read with `pdftotext`; page 1 rendered to `r5-decision-record-pdf-1.png`;
  - ICS parsed (VCALENDAR, 6 VEVENTs, stable UIDs).
- 360 px: no horizontal page scroll on `/`, `/start`, the plan with *What changed?*, and the deal panel. The examples chip row was fixed to wrap.

**Not checked with a real provider.** `AI_PROVIDER=none` throughout; no key was used or searched for. The consent checkbox and the `explainResult` provider path are wired, but only appear when capabilities report `aiTextProposals` / `aiExplanations`.

## Limits and open items

**Exact contracts still missing (UI is ready to consume them):**
1. (Fixed by Claude 3 `7667644`, merged) calendar UID length. Re-checked on the final build: the own-data journey now downloads the current-actions ICS — 2 events, longest UID line 76 characters, the moved payment on 2027-01-08 and the 2026 tax set-aside on 2027-04-15. No blocking contract remains.
2. (Done) insurance lookups, decision context and original offer, server explanations, `clientAgreement` and `moneyByDate` are consumed above.

- ~~Claude 3 calendar UID bug~~ — fixed in `7667644` and verified (see above).
- **Claude 3 patterns:**
  - "The client paid $2,000" is not recognised ("paid" isn't a receipt word).
  - "The remaining payment moved…" picks one line when several are open, instead of asking. The demo uses project names in the sentence.
- **The pre-plan `/check` form is still the grouped progressive form**, not readiness-driven. The 1–3-question fill-in works once a household plan exists. The offer-first check page shows the full project section (many optional fields).
- *Add documents* uses round 4 `previewDocumentFacts` / `applyDocumentFact` per file, not Claude 3's cross-document import draft. Conflicts between two documents are therefore not surfaced as a pair.
- Inline readiness answers are logged with existing event kinds (`forecast_updated` / `project_updated` / `sep_target_changed`) and an "Answered: …" description; there is no dedicated kind.
- "If the client says no" is answered inside the explanations (`client_refuses`). There is no separate "client declined" package status in the contract (`draft | terms_shared_by_user | client_agreed | superseded`).
- Figures in the judge script depend on the current date.

## Artifacts

- `docs/demo/round5-judge-script.md`
- `docs/demo/round5-positioning.md`
- `docs/demo/round5-screenshots/c-benchmark-help-d.png` — Help me find this (county saved, honest lookup answer).
- `docs/demo/round5-screenshots/` — **final design-C build**: `c-home-d`, `c-home-m-top`, `c-review-d`, `c-review-applied-d`, `c-check-d/-m`, `c-plan-top-d/-m`, `c-goal-d`, `c-variants-d`, `c-variants-bydate-d`, `c-variants-m`, `c-choose-d`, `c-package-d`, `c-whatchanged-d/-m`, `c-records-d`, `c-demo-d`, `c-docs-queue`, `c-provider-down`, `c-pdf-1` (decision record page 1). The earlier green-design captures were removed.
- `tests/ui/smoke.cjs` step 10
