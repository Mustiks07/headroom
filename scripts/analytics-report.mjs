// Aggregate funnel report from the anonymous daily counters (no personal data exists to report).
// Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/analytics-report.mjs [days=30] [--json]
// Counts per event split by own / sample (fixture) / developer / unknown, with the date range, the
// denominator of each own-data step and an explicit zero state. Counters are events, not people:
// a conversion rate here is events/events, not users, and no event proves a payment or a customer.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server secret; never commit it)."); process.exit(2); }
const days = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 30);
const asJson = process.argv.includes("--json");
const until = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.from("analytics_daily").select("day, event, data_kind, input_path, count").gte("day", since);
if (error) { console.error("Query failed:", error.code ?? error.message); process.exit(1); }
const rows = data ?? [];
const KINDS = ["own", "sample", "developer", "unknown"];
// Round 6 funnel, own-data path: entry → source review → first useful result → terms → client response → repeat change → export.
const FUNNEL = ["intake_submitted", "source_review_opened", "facts_confirmed", "first_useful_result", "terms_chosen", "client_message_prepared",
  "client_response_recorded", "partial_receipt_recorded", "repeat_change_applied", "decision_exported"];
const RETURNS = ["plan_reopened_same_day", "plan_reopened_after_1_day", "plan_reopened_after_7_days"];
const count = (event, kind) => rows.filter(r => r.event === event && r.data_kind === kind).reduce((s, r) => s + r.count, 0);
const report = {
  range: { since, until, days }, counterRows: rows.length,
  funnel: FUNNEL.map((event, i) => {
    const own = count(event, "own"), prev = i === 0 ? null : count(FUNNEL[i - 1], "own");
    return { event, ...Object.fromEntries(KINDS.map(k => [k, count(event, k)])), ownStepRate: prev ? Math.round((own / prev) * 1000) / 10 : null, ownDenominator: prev };
  }),
  returns: RETURNS.map(event => ({ event, ...Object.fromEntries(KINDS.map(k => [k, count(event, k)])) })),
  providerFailures: Object.fromEntries(KINDS.map(k => [k, count("provider_failure", k) + count("intake_failed", k)])),
  inputPaths: Object.fromEntries(["document", "paste", "manual", "provider", "none"].map(p => [p, rows.filter(r => r.event === "intake_submitted" && r.data_kind === "own" && r.input_path === p).reduce((s, r) => s + r.count, 0)])),
  otherEvents: [...new Set(rows.map(r => r.event))].filter(e => !FUNNEL.includes(e) && !RETURNS.includes(e)).sort(),
};
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log(`Headroom anonymous funnel ${since} … ${until} (${rows.length} counter rows)`);
if (!rows.length) { console.log("No events recorded in this range. Zero observations: nothing can be said about usage, conversion or retention."); process.exit(0); }
console.log("event".padEnd(28), ...KINDS.map(k => k.padStart(10)), "own step rate".padStart(16));
for (const f of report.funnel) console.log(f.event.padEnd(28), ...KINDS.map(k => String(f[k]).padStart(10)), (f.ownStepRate === null ? "-" : `${f.ownStepRate}% of ${f.ownDenominator}`).padStart(16));
console.log("\nReturns (separate sessions, bucketed by time since the plan was last saved)");
for (const r of report.returns) console.log(r.event.padEnd(28), ...KINDS.map(k => String(r[k]).padStart(10)));
console.log("\nown intake by input path:", report.inputPaths, "\nprovider/intake failures:", report.providerFailures);
console.log("\nCounts are events, not people. Sample = fixture/demo sessions; developer = localhost, previews and opted-in testers. Neither is a customer, and no event here is a payment.");
