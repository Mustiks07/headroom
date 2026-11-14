# Claude 1 — round 5 handoff (UI)

Branch `claude1`. Normal merges only (no reset, no force-push); `main` untouched.

## Dependencies merged

| What | SHA |
|---|---|
| `origin/main` (integration round 4 + research + addendum, visual direction withdrawn) | `58a6959` |
| Claude 3 round 5 contract (`src/domain/assistance.ts`) | `97b608c` |
| Claude 3 round 5 implementation + handoff | `60df7a2` |
| Claude 2 round 5 engine + handoff (incl. `previewChange` apply hook, two baselines) | `32f59d3` |

The visual direction in `docs/design/round5/` was withdrawn by the user (addendum, 15 Nov); none of its logo, palette or fonts was used.

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
- `npm run check:ui`: 29 checks pass. New: update sentence → preview → Apply = one revision; repeat saves nothing; reload keeps the revision; 360 px on six routes.
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

- **Claude 3 bug (blocks the current calendar for own data):** `buildCurrentCalendar` (`src/lib/client/deal-exports.ts`) builds UIDs longer than the 200-character schema limit when the project was added by sentence (`proj-prop-<uuid>`, lines `line-proj-prop-<uuid>-0-u1-pkg-…`). Saving `dealPlanning.calendar.issued` then fails: *"This household plan has invalid or inconsistent data."* Sample projects (`proj-b`) work. Suggested fix: hash or shorten the UID parts. Not changed here (Claude 3's file).
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
- `docs/demo/round5-screenshots/` — landing (desktop/360), start-paste, own result, own deal readiness, variants, deal 360, what-changed preview/360, ambiguous, provider down, documents AI-off and queue, records, full plan desktop/360, decision-record PDF page 1
- `tests/ui/smoke.cjs` step 10
