# Round 6 developer observations

These are internal developer walkthroughs, not user research, traction, willingness-to-pay or usability-study results. No stopwatch measurement was taken during concurrent implementation, so no time-to-value number is inferred.

| Path | Observation | Questions / correction | Status |
| --- | --- | --- | --- |
| Manual own offer | $12,000, explicit 0 costs; TX, single, age 34, explicit 0 SEP; saved as a real proposed project with original offer preserved | Exact 2026 receipt date required; 2027 facts not requested | Observed by root in actual browser |
| Date question | Automation filled native date value without updating React state; native keyboard change submitted correctly | Added native FormData read and onInput handling; no claim of a confirmed end-user failure | Correction implemented |
| First incomplete result | Initial integration exposed three long questions plus the full dashboard | Changed to one focused question/count, expandable remaining list, adjacent document entry and collapsed plan details | Implemented after observed review |
| Financial cases 1–3 | Case 1 −$3,616 /+$8,310; case 2 profitable without next year; unknown spouse yields no result | Existing deterministic regressions re-run on integrated engine | 3 selected tests passed |
| Documents | Cross-source person/period conflicts, monthly/annual distinction, partial receipt, prior-year reference and atomic replacement | 14 targeted checks | Passed; browser walk remains root's release check |
| Lifecycle | Canonical response/partial/final commands now share semantic preview and commit | Published contract mismatch corrected; smaller generic receipt blocked | Targeted tests passed |
| 360px / final exports | Must be checked on the final composed build, with real downloads and input-driven output | Screenshot filenames and observed outcomes should be appended by release reviewer | Pending root walkthrough |

For a later small usability session, observe a new person entering their own offer without coaching. Record: entry method, number of unanswered facts, corrections, time to first supported answer, time to reviewed terms, and any failure/recovery. Separate unsupported profiles from abandoned onboarding. Ask what decision they would otherwise make and whether they would pay for that result; do not count developer runs as demand validation.
