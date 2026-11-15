# Headroom — round 6 judge walkthrough

Use the actual app in English, without an account. This is a 2–3 minute product demonstration using a clearly identified synthetic household, not a customer's outcome.

## Preparation

1. Run `node scripts/demo/prepare-round6-plan.cjs` if the input files need refreshing.
2. Open `/household` → **Restore from a file** and choose `docs/artifacts/round6/ui/case-1-importable.json`.
3. Open offer B. The app recalculates the synthetic family's current facts. Do not paste static calculated cards or edit money in developer tools.
4. Keep case 2 and case 3 import files available to show a positive ordinary case or unknown-spouse boundary if asked. Use full dates and local calendar day for actual receipts.

## Live script

**0:00–0: 20 — The decision.**

“A client offers you twelve thousand dollars. For an independent worker buying Marketplace insurance, the price isn't what you keep. Headroom helps you see the result before you say yes, then work out terms you can actually ask for.”

Show the preserved offer and the **as-written** result. “Here the same family ends up with $3,616 less cash after tax settlement than if it declined the unpaid offer. This is a calculated synthetic case; it is not a claimed customer saving.”

**0: 20–1:05 — Workable terms.**

Choose **Find workable terms**. The saved limits already express the family's cash goal, allowed dates and retirement budget. Click **Find terms**.

“We compare only the terms this person is willing to ask for. The smallest change that meets this goal keeps the $12,000 price: $5,400 in December and $6,600 in January. It leaves $8,310 extra cash versus declining, after both tax years settle. That's $11,926 more than accepting the original timing. The client still has to agree, and the January money must genuinely not be available earlier.”

Point to baseline, final settlement horizon and separate retirement amount. Switch **By your date** briefly; name the displayed measure rather than calling it a bank balance.

**1:05–1:35 — Act.**

Choose **Prepare client reply**. Edit a sentence in the message, copy/download it, then save the terms. “Headroom prepares the reply. It doesn't send it or pretend that the client accepted.”

**1:35–2:10 — The client replies.**

In the project, open **Record client response** and enter a different exact unpaid date. Preview it. Show preserved original terms and the changed comparison. Apply only after reviewing the new result. “When the real terms change, the earlier answer becomes history. We calculate again on the same household.”

**2:10–2:40 — Return value.**

Show the next action and receipt controls. If demonstrating a smaller received payment, use today's actual local date and explicitly choose **partial payment**, entering the remaining payment's date. Preview; show the remainder remains in the plan. Don't record a future receipt as actual.

“The plan stays useful when the client replies, the payment arrives or income changes. Current actions come from those facts. The dated decision and current plan can be exported.”

## Network/manual fallback

The deterministic calculation and browser persistence do not require AI. If intake is unavailable, use **Enter the figures**; if PDF generation is unavailable, show the current calculation ledger and download the restorable JSON. Never show a fake success or call an uncreated export downloaded. A new own-data path starts from `/check?start=project`; paste a natural offer, confirm source/dates/costs, then answer the scoped facts. Current-year offers do not demand 2027 income.
