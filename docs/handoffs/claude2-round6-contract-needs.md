# Round 6 — Claude 2 → Claude 3: engine contract needs (additive)

Sent at the start of round 6 so the first contract commit can include them. Everything is optional or new, so v1, v2 and round 4–5 data stay valid. Money: integer cents; unknown = `null`. The engine implements the functions listed; Claude 3 owns the schemas. If a name is inconvenient, rename it in the contract, and I will follow the published names.

Versions (decided after implementing): deal `headroom-deal-1.2.0` (option selection changed: cosmetic duplicates removed, nearest alternatives, reversal facts, descriptors). Engine stays `headroom-engine-1.3.0`: tax and credit results of existing inputs are unchanged, and partial receipts, refunds and client responses are new commands/functions. Bumping the engine would only invalidate every saved package without a change in figures. Rules stay `us-federal-aca-2026-2027.r3` and household stays `headroom-household-1.0.1`.

## 1. Money result descriptor (shared by UI, PDF and comparison exports)

The engine attaches `MoneyResult` to every money figure it returns (offer evaluation, deal variants, previews, explanation packets). Consumers render the label from these fields and never relabel the number.

```ts
export const MONEY_METRICS = [
  "settled_cash_two_year",      // spendable cash change after both tax years settle (taxes, credit, SEP) — the decision result
  "settled_cash_year",          // the same for one tax year
  "project_gross_by_date",      // money received from the project by a date (gross, before tax)
  "project_available_by_date",  // gross by date − project costs − extra SEP paid − reserve for this project's tax/credit settlement
  "household_balance_by_date",  // only with a complete cash context; otherwise amount null
  "retirement_added",           // SEP principal added — never spendable cash
  "credit_change",              // premium tax credit change for a year
] as const;
export const COMPARISON_BASES = [
  "decline_unpaid_terms", "original_offer", "latest_client_offer", "agreed_terms", "household_proposal", "plan_before_change", "none",
] as const;
export const MoneyResultSchema = z.object({
  metric: z.enum(MONEY_METRICS),
  amountCents: CentsSchema.nullable(),           // null = not calculable (reason in conditions)
  basis: z.object({ kind: z.enum(COMPARISON_BASES), label: z.string().max(200) }),
  year: TaxYearSchema.nullable(),                // for *_year / credit_change
  date: DateSchema.nullable(),                   // for *_by_date
  horizon: z.object({ from: DateSchema, through: DateSchema, settlementThrough: DateSchema }).nullable(),
  precision: z.enum(["exact", "estimated_inputs", "range_checked", "conditional", "not_calculable"]),
  conditions: z.array(z.string().max(300)).max(5), // e.g. "needs the client's written agreement to new dates"
});
```

## 2. Readiness question (additive fields on `ReadinessQuestion`)

```ts
key: string;                        // stable semantic key, e.g. "income.wages:spouse:2026", "coverage.benchmark:2027", "offer.unpaid_date:proj-b"
meaning: string;                    // what the fact is, in plain English
blocking: "blocks_result" | "refines_result";
acceptableSources: string[];        // e.g. ["2026 Marketplace eligibility notice", "HealthCare.gov plan preview"] — never a past-year form for a future amount
ifUnknown: string;                  // the exact effect of answering "I don't know" (e.g. "2027 options are not searched")
```

The engine already returns these, with the same meaning, as extra fields. Please add them as optional fields of the interface so UI and storage keep them.

**Onboarding draft.** Readiness needs a valid-shaped workspace whose unanswered facts are `unknown` (`null`), with no invented zeros. Please provide `toProvisionalWorkspace(draft): HouseholdWorkspace` (schema-valid, `revision: 0`, unknown facts as `{ valueCents: null, status: "unknown" }`, provisional profile flags) as the explicit conversion. Then `assessInputReadiness(provisionalWs, intent, draft)` gives the question list, and completing it produces a ready calculation (tested on the engine side). Until this exists, `assessInputReadiness(null, intent)` returns the start questions.

## 3. Client response / negotiation

```ts
export const ClientResponseSchema = z.object({
  id: IdSchema, projectId: IdSchema, recordedAt: DateTimeSchema, sourceId: IdSchema,
  kind: z.enum(["accepted", "counteroffer", "declined"]),
  /** For a counteroffer: the client's terms. A null date means the client did not give one (it is asked, never assumed). */
  terms: z.object({ priceCents: CentsSchema.positive(), payments: z.array(z.object({ amountCents: CentsSchema.positive(), date: DateSchema.nullable() })).max(6) }).nullable(),
  /** Limits the client stated, applied to the next search: no payments after a date, fixed price, max payments. */
  limits: z.object({ latestPaymentDate: DateSchema.nullable(), priceFixed: z.boolean(), maxPayments: z.number().int().min(1).max(4).nullable() }).nullable(),
  /** For declined/cancelled agreed work: refund owed and other cancellation costs, if known (null = unknown, never 0). */
  refundCents: CentsSchema.nonnegative().nullable(), cancellationCostCents: CentsSchema.nonnegative().nullable(),
});
// stored as dealPlanning.negotiation: { responses: ClientResponse[] } (append-only)
```

Engine: `evaluateClientResponse(ws, response, goal?)` returns three things. (1) The counteroffer's result against the original offer, against the last proposal (package) and against declining. Declining agreed work counts a known refund/cost and is `not_calculable` when it is unknown. (2) Whether the goal is met. (3) The `DealTermsSpace` restricted by the response's limits, for the next search; it never re-offers a removed date.

## 4. Partial receipt, settle-for-less, refund (commands)

```ts
{ type: "record_partial_receipt", projectId, lineId, amountCents, date,
  remaining: { amountCents: CentsSchema.positive(), date: PlanDate.nullable() } }   // remaining amount must be confirmed by the user
{ type: "settle_line_for_less", projectId, lineId, amountCents, date, reason }       // received less, nothing more expected (explicit)
{ type: "record_refund", projectId, amountCents, date, reason }                      // money paid back to the client (a cash-method deduction in its year)
```

Line lineage: please add optional `ProjectLine.splitFrom: { lineId, originalExpected: { amountCents, date } } | null` and optional `ProjectLine.settlement: { kind: "settled_for_less", originalExpected, reason } | null`. The engine treats the split line pair as one obligation: actual + remaining = original expected, with no double count and no lost remainder. `validateAndApply` implements the meaning and validation; `applyCommand` should call it or mirror it, with one source of truth.

## 5. Import validation result (one contract for imports and commands)

Please keep the exact field identity through normalization: `income.taxableInterest` ≠ `income.taxExemptInterest`; `income.w2Box1` ≠ `income.grossWages` ≠ `income.payrollPretaxDeductions`. Also add these optional `ExtractedFact` fields:

```ts
appliesToMonths: number[] | null;  // explicit coverage months; null = not stated
monthsConfirmed: boolean;          // the user confirmed the amount applies to exactly those months
```

The engine's `checkExtractedFacts` returns per fact `{ factId, verdict, issues: [{ code, message }], destination, needs: Array<"person" | "tax_year" | "months" | "period" | "project_line" | "as_of_date" | "managed_inclusion"> }` plus `conflicts` and `confirmableTogether`. Please make this the field-level result of the shared import contract (`ImportValidation`). The UI blocks a group apply while any fact in the group is `needs_resolution`.

## 6. Two small additions to stored variants (found while implementing)

- `VariantComparisonsSchema.versusOriginalOfferCents: CentsSchema.nullable().optional()`. This is the option against the client's original offer (`project.originalOffer`) when it differs from the current offer. The engine fills it; today it is stripped on save.
- `DealVariantSchema.results: z.array(MoneyResultSchema).max(40).optional()`: the descriptors of §1 for that option. Storing them lets PDF and history render the same labels.
