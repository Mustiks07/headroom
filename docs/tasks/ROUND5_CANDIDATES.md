# Next round candidates — reduce manual work

Historical planning note. The active assignments are now [ROUND5_SHARED.md](ROUND5_SHARED.md) and `CLAUDE<N>_ROUND5.md`, issued after the combined round 4 review. The public release uses Vercel and real Supabase guest sessions; preserve its no-registration path and environment configuration.

## First priority: documents → confirmed facts → useful answer

The user identified excessive manual entry as a product weakness. AI should reduce that work before adding a general chat assistant. Existing text import, optional document extraction, fact review and round 4 document previews are the starting point; extend them instead of building another extraction stack.

Proposed ownership after round 4:

- **Claude 1:** make document-assisted entry a primary alternative to manual entry. Show only unresolved questions, a compact proposed-changes review, where each figure came from, and an obvious correction path. Keep annual profit, year-to-date profit and gross bank deposits distinct. Preserve typed figures when an import is cancelled or fails.
- **Claude 2:** define which facts are needed for the current-year answer versus a two-year deal, and validate imported year/person/period semantics. A prior-year return is evidence about that year, not a confirmed current forecast. Do not infer spouse income, current eligibility, future benchmark premiums or future profit from an unrelated document. Reuse existing deterministic calculations.
- **Claude 3:** finish the existing extraction → typed proposal → explicit confirmation → workspace revision route. Source references must identify document, page/section and period when available. Validate model output before proposing mutations. Preserve duplicate detection, idempotent confirmation, consent, durable quotas and truthful provider-unavailable behavior. Provider secrets stay server-side.

Accept one real, bounded synthetic-document journey: upload a readable document → review extracted amounts with their source → answer only the facts still missing → get a real calculation → save/reload. Include one contradictory period and one illegible/missing value. Never turn an uncertain extraction into a confirmed zero. A bank statement alone cannot establish the household's complete ACA/tax facts.

## Second priority: update the existing plan in ordinary language

Example: “The client moved the remaining $4,000 to January 8.” Resolve the project and payment; ask if ambiguous; show a before/after proposal; apply only after confirmation. Received money stays fixed. Recalculate agreed conditions and refresh the action package after the revision. A request is not proof that the client agreed or that a payment was received.

Reuse typed workspace commands and event history. The language model proposes supported commands; it does not calculate tax, execute arbitrary actions, submit Marketplace changes or send client messages.

## Before claiming this in the pitch

Connect a provider using a user-supplied server key, choose a verified available model, set an explicit spending cap, and run the exact deployed journey with synthetic documents. Record what was extracted correctly, what required correction, and time/steps to the first useful answer. Until then, describe AI PDF/image reading as unavailable, not demonstrated.

The final release still needs the reviewed English deck (at most 10 slides) and a coherent public demonstration. Improve the first useful answer and return visit before expanding to all states, bank sync or a generic chatbot. No paid-customer or retention claims without evidence.
