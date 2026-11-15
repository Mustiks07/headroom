# Extraction and intake evaluation — round 6 (Claude 3)

**What was measured:** Headroom's **built-in reading** (no AI provider) on a fixed, versioned, synthetic corpus, through the real HTTP routes of a local production build (`next start`), November 15, 2026. **Not measured yet:** the configured provider (BasisWeb). This branch has no provider key; the exact bounded steps for Codex are in [`docs/AI_DEPLOYMENT.md`](../../AI_DEPLOYMENT.md#bounded-provider-evaluation-codex-with-the-private-key-synthetic-inputs-only). No mocks were used for these numbers. Mocks are used only in unit tests for provider failure handling and are not counted here.

## Corpus

- Development set `eval/corpus.json` (`round6-1.0`): 13 cases. Messages: ordinary offer email, client counteroffer, invoice (money due, not received), "half and half" with no dates, a client saying a deposit was already sent, an hourly rate (unsupported). Documents: payment confirmation (native text PDF), W-2 (text PDF; Box 1 vs Social Security/Medicare wages), Marketplace notice (text PDF; premium / benchmark / advance credit), year-to-date P&L (text; uploaded twice for duplicate detection), revised P&L with a different profit (conflict), SEP confirmation (text PDF), and a PDF with no text layer (scan stand-in).
- Hold-out set `eval/corpus-holdout.json` (`round6-holdout-1.0`): 5 cases written **after** the reader fixes below and run **once**. The reader was not changed after seeing them.
- Inputs: `eval/inputs/*` (all synthetic). Expected values sit in the corpus files next to each case. PDFs are regenerated with `node scripts/eval-make-pdfs.mjs`.
- Scoring (`scripts/ai-eval.mjs`): each expected value is checked as **correct**, **incorrect** or **missing**. Values covered: amount, date, status (expected vs said-received), total, costs stated, tax year stated, period, as-of date, outcome, and duplicate/conflict recognition. Extra values are counted separately as **extra**. The mode of each case is read from the response (`provenance` / `providerStatus`), not assumed.

## Results (built-in reading, no provider)

| Run | Checks correct | Wrong | Missing | Extra | Latency median / max |
|---|---:|---:|---:|---:|---:|
| Development set, before fixes | 57 / 67 (85.1%) | 3 | 7 | 0 | 7 ms / 202 ms |
| Development set, after fixes | 67 / 67 (100%) — **optimistic: fixes were made against this set** | 0 | 0 | 0 | 8 ms / 174 ms |
| **Hold-out set (untuned)** | **24 / 28 (85.7%)** | 2 | 2 | 2 | 5 ms / 54 ms |

Latency is server time on a local machine; the first request of each type includes a warm-up. Results: `eval/results/built-in-before-fixes.json`, `built-in.json`, `built-in-holdout.json`.

### Fixes made after the first development run (general rules, not string matches)

1. "$6,000 — half when we start and half when it's done": shares written as words now count as shares of the stated total. The two dates stay unknown, and Headroom asks for them.
2. A P&L whose range starts on January 1 and ends before December 31 is now year-to-date, with its as-of date. Through December 31 it is annual. Any other range, such as one quarter, stays unknown and is never treated as a full year.
3. In a SEP contribution confirmation, a generic "Contribution amount" label is now read as the SEP contribution.

### Hold-out failures (left as they are and reported)

- **h3** "Revised offer: $9,000 instead of $10,000, paid in one go on January 12": the old $10,000 was read as a second payment, and the date went to it. The questions step shows both amounts for the user to correct. The provider path is expected to handle "instead of", but this has not been measured.
- **h4** pay stub: "Gross pay this period" and "YTD gross pay" both map to gross wages. The per-period value came first, and the YTD period was not kept on it. The engine's semantic check still refuses a non-annual wage figure (`NOT_ANNUAL_WAGES`), so it cannot enter the plan as annual pay. It is a reading error, not a calculation error.
- **h5** 1099-INT: "Box 1 Interest income" was read as W-2 Box 1 because the W-2 label rule matches first. Taxable interest was therefore missing; tax-exempt interest was correct. In the import, the user's target must also match the field (`TARGET_MISMATCH`), so the wrong field cannot be applied as interest.

## What this shows and what it does not

- The built-in path is fast and conservative. It does not invent costs, tax years or receipts. It treats an invoice as money due, and it asks before treating a deposit as received. It reports rates and other currencies as unsupported.
- On text it was not tuned for, about 1 in 7 checks failed. Users must review every proposed figure; group confirmation exists for exactly this.
- No accuracy claim is made for arbitrary documents, real customer documents, scans or photos. OCR is not implemented: a PDF without a text layer returns "no readable text layer" and spends no provider call.
- **Provider accuracy, latency and token use are unknown until the bounded run above.** The integration handoff records earlier real BasisWeb checks: one text PDF and one update sentence, both correct. Those are fixture checks, not a benchmark.
