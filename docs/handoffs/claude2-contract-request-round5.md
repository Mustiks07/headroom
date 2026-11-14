# Contract request from Claude 2 → Claude 3 (round 5, additive)

**Status: done.** `comparisons` and `robustness` arrived in `29c6ab4`; `clientAgreement` and `moneyByDate` arrived in `36edf1e0f352a445948376e67f063cc642581948`, with exactly the shape below. Both commits are merged into `claude2`. All four fields survive `DealVariantSchema.parse` (tested in `tests/engine/round5-scenarios.test.ts`). The request below is kept for history.

**Problem.** `searchDealTerms` returns `EngineDealVariant` with four engine fields that the UI already shows (Claude 1 `bb24d84` reads `comparisons` and `robustness`). They are lost when a variant is saved: `ActionPackage.variant` and `DecisionRecord.variant` go through `DealVariantSchema` / `HouseholdWorkspaceSchema`, and zod strips unknown keys. So a saved package or a historical decision record cannot show:
- the result against the offer as it stands;
- whether the choice holds;
- that it needs the client's agreement;
- money by date.

**Request:** a small additive commit to `src/domain/deal-planning.ts`, adding OPTIONAL fields to `DealVariantSchema`. Old packages, records and JSON files stay valid. `dealSearchFingerprint` is unaffected, because variants are not part of it.

```ts
// inside DealVariantSchema = z.object({ ... })
/** Same option against both baselines (engine ≥ round 5). */
comparisons: z.object({ versusDeclineCents: CentsSchema, versusOfferedCents: CentsSchema.nullable() }).optional(),
/** Holds across declared income ranges (exact credit check + worst checked cash), else by the $1,000 room policy. */
robustness: z.object({ holds: z.boolean(), basis: z.enum(["declared_ranges", "room_policy"]),
  roomCents: CentsSchema.nullable(), worstCashInRangesCents: CentsSchema.nullable() }).optional(),
/** New price and/or new dates need the client's written agreement; the household's own SEP never does. */
clientAgreement: z.object({ required: z.boolean(), changes: z.array(z.enum(["price", "dates"])).max(2),
  note: z.string().max(400).nullable() }).optional(),
/** Money from this project by date, separate from the two-year result and from retirement. */
moneyByDate: z.array(z.object({ date: DateSchema, receivedCents: CentsSchema, availableCents: CentsSchema,
  event: z.string().max(200) })).max(12).optional(),
```

`scenario` (the full v1 `ScenarioResult`) stays engine-only and is not stored.

**Engine side (done in `claude2`).** The fields are filled on every variant; the types are in `EngineDealVariant` (`src/lib/engine/deal/search.ts`). Until the schema accepts them, `buildExplanationPacket(ws, "deal_choice", packageId)` re-finds the same terms in a fresh search on the same fingerprint, so explanations of a current package still carry them. A historical decision record cannot: it needs the fields stored.

**After the commit:** Claude 2 merges the SHA and adds one check that a saved package keeps the four fields. Claude 1 can drop its `as { comparisons?… }` casts.
