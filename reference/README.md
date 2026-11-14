# Reference material, not production code

`legacy/engine.py` is the user-supplied CliffGuard v2 prototype. It is retained so Claude 2 can inspect the reasoning, reproduce issues and port correct logic into Headroom. It is **not** imported by the web app and contains known defects described in `docs/ENGINE_SPEC.md`.

The prototype's seven passing tests did not prove full tax correctness. Known issues include spouse wage-cap attribution, the 175% applicable-figure rounding, outdated 2027 caps and limited independence of its checker. Its support claims are broader than its implemented tax rules.

`scripts/reference/audit_reference.py` is a portable limited independent comparison of the specific high-band MFJ family scenario. It uses no production engine functions for its independent arithmetic but checks only the stated narrow case, not a complete return/eligibility. It also reports the known prototype defects; these are expected audit findings, not production tests.

The `data/reference/audit-results.json` file is historical evidence, with source assumptions and synthetic status preserved. It must never be used to populate successful production result cards. Formal rounding/source corrections may legitimately change reference amounts if documented.
