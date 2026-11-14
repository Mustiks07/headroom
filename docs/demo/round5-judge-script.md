# Round 5 judge script (90–120 seconds)

Build checked: branch `claude1` on 14 Nov 2026, production build (`npm run build && next start`), `AI_PROVIDER=none`. Everything below works with the AI provider off; nothing needs signup, email or payment. All households are synthetic. Figures depend on today's date (payment windows start today) — read them from the screen, don't recite them.

## Main route — sample household, offer → decision → update

| Time | Do | Say (one line) |
|---|---|---|
| 0:00 | Open `/`. | "Headroom answers one question: what does this client offer leave my family — and which terms work?" Point at **Check a client offer / Check my year's income / Try a sample**. |
| 0:10 | **My plans** → **Open the sample household plan**. | Overview: 2026 subsidy, expected profit, *What needs attention next*. Open **Why is my subsidy where it is?** — the explanation is built only from the calculated packet. |
| 0:25 | On **December design project** → **Find terms for my goal**. Keep at least `4000`, SEP up to `1000`; **I need money by a certain date** `2027-01-10`, `3000`; **Price and payment limits**: `12000`–`14000`, latest `2027-01-31`, 2 payments, client open to new terms **Yes** → **Find terms**. | "The family says what it needs; the engine searches prices and dates." |
| 0:50 | Three options, the pick first. | Read the pick: cash after both tax years vs. declining (e.g. **+$8,300**) and, separately, vs. the offer as it stands (e.g. **+$11,466**); "Needs the client's agreement"; a "Little room" warning on the riskier options. Open **Why these options?** (as offered it would be about **−$3,166**). |
| 1:05 | **Choose these terms** → **Save these terms to my plan** → **I sent these terms to the client** → **The client agreed** (confirm). | "Headroom never sends anything; only you record what the client said." |
| 1:20 | **What changed?** → type `The bakery final payment moved to January 8, 2027` → **Show the change**. | Preview before saving: the payment row, per-year subsidy and cash (2027 credit **$16,652 → $0**), and "the terms you agreed no longer meet your goal". **Apply** → one new revision. |
| 1:35 | Reload the page; type the same sentence again → **Show the change**. | Same revision after reload; "This is already in your plan — there is nothing to save" (button disabled). **Cancel**. |
| 1:45 | **Decisions and calendar** → **Decision record (PDF)** and **Calendar of current actions (.ics)**. | The record is the decision as made then ("figures as of plan revision N, not today's estimate"); the calendar is the current plan. |
| ~1:55 | End. | |

## Provider-off alternative (always available)

The AI provider is off in this build, so the route above *is* the provider-off route. To show honest behaviour:
- **Add documents** on the plan → choose `payment-confirmation.txt` and `sep-contribution.txt` from **Synthetic sample files**: each file gets a status, clear facts can be applied as a group, ambiguous ones ask (which payment? whose SEP? which date?). A PDF shows **Can't read here** — no fake OCR.
- **What changed?** says the AI service for other wording isn't on; unknown sentences get "I couldn't match this…" with examples, never a guess.
- A failing assistance service keeps the typed text and says so (checked by simulating a 503).

## Backup route — own figures, no sample

1. `/start?intent=year` → **Enter figures** → household (state, filing, age), 2026 profit, no wages / no interest / no SEP yet, coverage (premium, benchmark, advance credit, benchmark source, two eligibility answers), **None of these apply** → **Check my subsidy** (14 answers) → **Make this my household plan**.
2. **What changed?** → `The client offered $12,000 for December design project paid on December 20, 2026` → preview lists the facts still needed → **Apply**.
3. **Find terms** → up to 3 questions at a time with reasons (2027 eligibility yes/no, 2027 profit, 2027 wages, premiums, cash method…) answered inline; 11 answers in the checked run → search → **Accept as offered** is the pick (+$8,103 in the checked run) — an ordinary positive offer needs no change.

## Do not claim

AI document reading, launched ads, measured conversion/CAC, real users, or that documents/AI/calendars are unique to Headroom.
