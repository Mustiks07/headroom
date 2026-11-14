// Aggregate funnel report from the anonymous daily counters (no personal data exists to report).
// Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/analytics-report.mjs [days=30]
// Prints counts per event, split by sample/own data and input path. An empty table stays empty.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server secret; never commit it)."); process.exit(2); }
const days = Number(process.argv[2] ?? 30);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.from("analytics_daily").select("day, event, data_kind, input_path, count").gte("day", since);
if (error) { console.error("Query failed:", error.code ?? error.message); process.exit(1); }
const FUNNEL = ["first_visit", "start", "review_completed", "result_calculated", "plan_saved", "plan_reopened", "proposal_confirmed", "plan_exported", "provider_failure"];
const totals = new Map();
for (const r of data ?? []) {
  const k = `${r.event}|${r.data_kind}`;
  totals.set(k, (totals.get(k) ?? 0) + r.count);
}
console.log(`Headroom anonymous funnel since ${since} (${(data ?? []).length} counter rows)`);
console.log("event".padEnd(22), "own".padStart(8), "sample".padStart(8), "unknown".padStart(8));
for (const e of [...FUNNEL, ...new Set((data ?? []).map(r => r.event).filter(e => !FUNNEL.includes(e)))]) {
  console.log(e.padEnd(22), ...["own", "sample", "unknown"].map(k => String(totals.get(`${e}|${k}`) ?? 0).padStart(8)));
}
const byPath = new Map();
for (const r of data ?? []) if (r.event === "start") byPath.set(r.input_path, (byPath.get(r.input_path) ?? 0) + r.count);
console.log("\nstart by input path:", Object.fromEntries(byPath));
console.log("Sample (demo) counts are synthetic sessions, not customers.");
