# Round 4 export samples (synthetic)

- `decision-package-LAYOUT-test-double.pdf` — layout/content check of the decision package. **The money figures are placeholders from the test double in `tests/support/fake-deal-search.ts`, not engine results.** Claude 2's `searchDealTerms` is not on `main` yet; the production route answers 503 until it is.
- `actions-synthetic.ics` — calendar from the production route (`POST /api/export/calendar`), synthetic household; dates/titles come from the same test-double variant.
- `client-terms-draft-synthetic.txt` — the deterministic client draft for that variant (price and schedule only).

Regenerate after integration with the real engine before using any of these in a presentation.
