# Round 6 developer observations

These are internal developer walkthroughs, not user research, traction, willingness-to-pay or usability-study results. No stopwatch measurement was taken during concurrent implementation, so no time-to-value number is inferred.

| Path | Observation | Questions / correction | Status |
| --- | --- | --- | --- |
| Manual own offer | $12,000, explicit 0 costs; TX, single, age 34, explicit 0 SEP; saved as a real proposed project with original offer preserved | Exact 2026 receipt date required; 2027 facts not requested | Observed by root in actual browser |
| Date question | Automation filled native date value without updating React state; native keyboard change submitted correctly | Added native FormData read and onInput handling; no claim of a confirmed end-user failure | Correction implemented |
| First incomplete result | Initial integration exposed three long questions plus the full dashboard | Changed to one focused question/count, expandable remaining list, adjacent document entry and collapsed plan details | Implemented after observed review |
| Financial cases 1–3 | Case 1 −$3,616 /+$8,310; case 2 profitable without next year; unknown spouse yields no result | Existing deterministic regressions re-run on integrated engine | 3 selected tests passed |
| Documents | Cross-source person/period conflicts, monthly/annual distinction, partial receipt, prior-year reference and atomic replacement | 14 targeted checks | Passed; real no-AI PDF reading and reviewed P&L save passed in production browser |
| Lifecycle | Canonical response/partial/final commands now share semantic preview and commit | Published contract mismatch corrected; smaller generic receipt blocked | Targeted tests passed |
| 360px / final exports | Must be checked on the final composed build, with real downloads and input-driven output | Screenshot filenames and observed outcomes should be appended by release reviewer | Completed locally: result, focused question and partial-payment views at 360px; 4-page current PDF + 2-page historical PDF rendered and inspected; ICS/JSON content matched |

For a later small usability session, observe a new person entering their own offer without coaching. Record: entry method, number of unanswered facts, corrections, time to first supported answer, time to reviewed terms, and any failure/recovery. Separate unsupported profiles from abandoned onboarding. Ask what decision they would otherwise make and whether they would pay for that result; do not count developer runs as demand validation.

## Final production artifacts (synthetic only)

- `case1-as-written-desktop.png`, `case1-terms-desktop.png`, `case1-mobile-360.png`: actual input-driven result. The split is $5,400 Dec 15, 2026 / $6,600 Jan 4, 2027. The saved-window roundtrip defect found during the walkthrough was fixed before these final captures.
- `counteroffer-preview.png`, `partial-mobile-360.png`, `after-counteroffer-partial-ui.json`: $12,500 counteroffer then $1,000 actual and $11,500 remaining; original $12,000 offer retained.
- `document-review-desktop.png`, `focused-question-mobile-360.png`: reviewed $117,000 estimated annual profit and the one missing spouse-wages question.
- `reviewed-client-message.txt`, `case1-decision-ui.pdf`, `case1-actions-ui.ics`: actual downloads after editing the message and saving the selected terms.
- `historical-decision-after-receipt-ui.pdf`, `current-actions-after-receipt-ui.ics`: separate run accepting the selected split and receiving $1,000 of the first $5,400 payment. Historical record retains the original calculation and lists the $4,400 remainder; current ICS uses the remaining payments and Apr 18, 2028 settlement date.

The PDF pages were rendered with Poppler and visually inspected. No clipped text, overlap or missing displayed glyphs was observed. The package is a detailed 4-page report, not the contest pitch deck. Browser runs used localhost production, no login and no live provider; deployment and live provider checks remain the release owner's responsibility.
