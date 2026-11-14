# Competitor workflow comparison (round 3)

Checked by Claude 2 in the session of 2026-11-14 (UTC dates of the hackathon commits run into 2026-11-15). Free public pages only: no signup, no payment, no installation or execution of other teams' code. "Ran" means we entered the inputs below into the live public tool in a headless Chromium and read the result; "states" means it is written on the vendor's page and was not exercised. Screens and raw outputs were kept in the session scratchpad, not in Git.

## Reproducible scenario

Synthetic household (same as the Headroom demos): Tennessee, married filing jointly, two adults (38) and one child, Marketplace coverage all year, 2026 benchmark = enrolled premium = $23,013/year, advance credit $1,117.75/month; 2027 premium $28,122.84, benchmark $27,789.36. One sole proprietor, no wages.

1. Base forecast: Schedule C profit $118,000 in 2026 and 2027, **excluding** managed projects.
2. Project **A** "Website A" already agreed: $6,000 expected 2026-11-20.
3. New offer **B** "Branding B": $6,000 on 2026-12-20; client can split into January (latest 2027-01-31); price not negotiable.
4. Money set aside for SEP-IRA contributions: $4,000.
5. Household accepts B with the minimum SEP as its 2026 goal; A's payment arrives ($6,000 on 2026-11-21); $1,000 of SEP is paid on 2026-12-15.
6. The base 2026 forecast is corrected to $121,000.

The questions: what is B worth **on top of A**; which actions are feasible within the $4,000; after step 5, what remains to pay; after step 6, does the agreed plan still protect the credit, and what is the new best option?

### Headroom result (engine `headroom-engine-1.1.1`, household layer `headroom-household-1.0.0`, rules r3)

Reproduced by `tests/engine/workflow-scenario.test.ts`.

| Step | Output |
| --- | --- |
| B over A (baseline "Your plan without Branding B") | Accept as offered **−$7,597** over two years (2026 credit lost); SEP $3,598 → **+$1,201** cash, $3,598 retirement; SEP $4,000 (set-aside maximum) → +$871; split $1,997 now / $4,003 on 2027-01-04 → **+$4,155** (recommended for spendable cash) |
| After B agreed with SEP goal $3,598, A paid, $1,000 SEP paid | Plan feasible; SEP goal $3,598, paid $1,000, **still to pay $2,598**; legal limit on the combined profit $24,163; **$1,402** of the set-aside left for new contributions; 2026 credit $12,396 |
| Base corrected to $121,000 | The agreed plan, evaluated as agreed, **loses the 2026 credit** (`creditLostYears: [2026]`); paid $1,000 stays paid. New options for B: an *additional* SEP $2,789 would be needed but is marked infeasible (only $1,402 available); a new split $2,959 / $3,041 keeps the credit (+$4,155) |

No other tool below models steps 2, 5 and 6 (an agreed project, recorded actual payments/contributions, and re-evaluating fixed agreements after a correction). This is a workflow difference, not a claim that their arithmetic is wrong.

## Product competitors

| | MyTaxQuarter | ACAIndex | Bracketsight | ProjectionLab |
| --- | --- | --- | --- | --- |
| Access | Free, no signup ([estimator](https://mytaxquarter.com/aca-subsidy)) | Free, no signup ([calculator](https://acacreditindex.com/)) | Free, no signup ([tool](https://www.bracketsight.com/aca)) | ACA Subsidies, Tax Estimation, What-If Scenarios and Downloadable Reports in **Premium $129/year** ([pricing](https://projectionlab.com/pricing)); not run (paid) |
| Input it needs for the subsidy | Household **MAGI** (user computes it) | Household **MAGI**, benchmark and plan premiums | AGI entered separately; Schedule C profit, W-2, age, retirement contributions so far unlock levers | Plan model (not checked) |
| Ran: MAGI $99,730 (Headroom's 2026 decline result) | With SLCSP $1,918/mo: **$13,670/yr**, "applicable percentage 9.4%", "$6,870 away from the cliff". Default national-average SLCSP gave **$0**. | **$13,080/yr**, contribution $9,933, credit at 400% $12,396 — identical to Headroom | Benchmark from six sample counties ("sample data pending the CMS county file"); Tennessee not available | — |
| Ran: over the line | MAGI $106,601 → not eligible ✔ | $106,601 → $0, "Credit lost above cliff $12,396" ✔ | AGI $109,663 → "411.5% … $3,063 past the edge", full repayment of $13,413 advance ✔ | — |
| SEP / SEHI | States SEP/Solo 401(k)/HSA reduce MAGI; links a SEP calculator; [blog](https://mytaxquarter.com/blog/aca-subsidy-2026-freelancers-guide) walks through a SEP decision | Guides; no self-employment input in the calculator | Ran: SEP room **$21,932** for $118,000 profit (same as Headroom), SE health "recovers $8,501", ranked levers; its FAQ calls the SE health-insurance deduction "circular" with the credit (text cut off in our capture) | Docs state advance credit and reconciliation are modeled ([help](https://projectionlab.com/help/aca-subsidy-reconciliation)) |
| Income timing / two tax years | Discusses December payments in text | No | States "CliffCheck never auto-advises income timing" | States two-pass estimate→reconcile per simulated year; settlement in the next year's cash flow (not checked) |
| Several agreed projects, actual vs expected, saved plan | No (single estimate) | No ("inputs stay in this browser") | No ("nothing stored") | Long-horizon saved plans (paid; project/payment ledger not checked) |

Observations to verify again before quoting in a pitch:

- **MyTaxQuarter** displayed a 9.4% applicable percentage at 374% FPL. Rev. Proc. 2025-25 (and its own blog's stated basis) gives 9.96% for 300–400%; with the same benchmark the credit is $13,080, not $13,670. In our automated run, typing `1917.75` into its SLCSP field produced a $191,775 monthly premium; integers worked. Treat both as observations from one run, not a published audit.
- **ACAIndex** matched Headroom to the dollar when given Headroom's MAGI. Its strength is the cited threshold registry; it leaves MAGI (and so the SEHI/PTC coupling) to the user.
- **Bracketsight** is the closest free product: self-employment levers, SEP room, SE-health deduction, CSR bands, "no AI arithmetic", rule citations. Its AGI field did not change when we changed Schedule C profit, and its premiums are sample data. Its methodology on the SEHI/PTC iteration was **not** audited here.
- **ProjectionLab** is a broad paid planner with ACA reconciliation in its documentation. We did not sign up; we cannot say what it does with a self-employment project ledger.

## Contest projects

The Business Cup 2.0 site ([businesscup.zimran.io](https://businesscup.zimran.io/en)) describes a 24-hour hackathon (November 14–15, Top-10 finals) and says "Detailed judging criteria will be shared with participants before the hackathon"; it publishes no participant list. We therefore only cover public repositories found by GitHub search for "zimran" / "business cup" on 2026-11-14. Read: README and file list only.

| Repository | Claimed product (README) | Track / status | Observed |
| --- | --- | --- | --- |
| [ZuKuFLu/HESTi](https://github.com/ZuKuFLu/HESTi) | Compares a contractor's change order with the quote: one AI extraction call + rule engine for math/duplicates; browser-local running total of approved change orders | Money (same track) | Next.js + tests; live URL listed (not opened). Clear "recorded sample" disclosure |
| [SungatSerikov/hackathon-zimran](https://github.com/SungatSerikov/hackathon-zimran) "Case Desk" | Detective game on everyday paperwork/fraud; "202 automated tests" | Entertainment | README lists the five weighted criteria (below) |
| [ops-develop-2026/zimran-cashout](https://github.com/ops-develop-2026/zimran-cashout) "CASHOUT" | Resale listings backend + eBay adapter; browser app "developed separately and not included" | Not stated | Says live publishing unverified |
| [procrastipredator/claro_zimran_business_cup](https://github.com/procrastipredator/claro_zimran_business_cup) "Claro" | Task-avoidance coaching PWA ("Stage 3 judging", April 2026) | Earlier stage, not this hackathon's build | README is a template |
| MAKLUBE/Zimran_Business_Cup | — | — | Empty repository |

Relevant Devpost projects (claims from their pages, not run): [CliffCheck](https://devpost.com/software/cliffcheck) — benefit cliffs for wage raises across 16 states, browser-only, WebMCP tools (WebMCP Challenge); [UniVital](https://devpost.com/software/univital) — plan risk and "distance to subsidy cliff" for students (Hacklytics 2026); [SetAside](https://devpost.com/software/setaside) — tax set-aside from PayPal activity for side earners, integer-cent money maths (PayPal AI Hackathon). None claims self-employed SEHI/PTC coupling, agreed-project tracking or SEP target/paid accounting.

## Assessment against the five contest criteria

Weights from the supplied contest materials (`docs/BUSINESS.md`); the same five weighted criteria appear in the public Case Desk README. Scores are not given: these are observable differences, not a ranking.

| Criterion | Product competitors | Contest projects | Headroom evidence today | Gap to close |
| --- | --- | --- | --- | --- |
| Product 40% | Free tools give an instant one-year answer; Bracketsight and ACAIndex are polished and cited | HESTi and Case Desk claim live apps and many tests | Real editable two-year calculation, fixed agreements, A+B without double counting, SEP target/paid/budget, regression and oracle tests | Household screens are Claude 1's round 3; public deployment not yet verified |
| Value / retention 20% | Recompute from scratch each time; ProjectionLab keeps plans (paid) | HESTi keeps a running total of approved change orders | Same plan updated by events: actual payments, paid SEP, corrected income → consequence for the agreed plan, then new options | Needs the saved workspace journey end-to-end in the UI |
| Problem / user 15% | Generic ACA estimate for anyone | Different problems (contractors, fraud game, resale) | A self-employed family deciding on a specific offer near the cliff | No user interviews yet |
| Business 15% | Free tools; ProjectionLab $129/year shows paid demand for planning | Subscription claims in READMEs | $99/year hypothesis, assumptions stated in BUSINESS.md | No measured conversion |
| Originality 10% | A cliff gauge alone is common (all four have one) | — | Decision on a concrete offer with cash limits, received vs expected money and retirement shown separately | Must show it in the deployed demo, not only in tests |

## Limits of this comparison

- One synthetic household and one run per tool; no accuracy claims beyond the outputs listed.
- ProjectionLab paid features, HESTi's live URL and all contest demos were not executed.
- Only repositories found by public search on 2026-11-14 are covered; private or unnamed contest entries are unknown.
- Competitor pages change; re-run the scenario before using any number in the deck.
