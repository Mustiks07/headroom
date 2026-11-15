// Operational AI report from anonymous counters (migration 006): availability, outcome classes,
// quota refusals, latency and token totals per feature/provider. No content, keys or identifiers.
// Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/ops-report.mjs [days=7] [--json]
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server secret; never commit it)."); process.exit(2); }
const days = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 7);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.from("ai_calls_daily").select("*").gte("day", since);
if (error) { console.error(error.code === "42P01" ? "ai_calls_daily is missing: apply migration 202611180006_round6_ops.sql." : `Query failed: ${error.code ?? error.message}`); process.exit(1); }
const rows = data ?? [];
const groups = new Map();
for (const r of rows) {
  const k = `${r.feature}|${r.provider}`;
  const g = groups.get(k) ?? { feature: r.feature, provider: r.provider, calls: 0, ok: 0, outcomes: {}, latencySum: 0, latencyMax: 0, input: 0, output: 0, usageUnknown: 0 };
  g.calls += r.calls; g.outcomes[r.outcome] = (g.outcomes[r.outcome] ?? 0) + r.calls;
  if (r.outcome === "end_turn") g.ok += r.calls;
  g.latencySum += Number(r.latency_ms_sum); g.latencyMax = Math.max(g.latencyMax, r.latency_ms_max);
  g.input += Number(r.input_tokens); g.output += Number(r.output_tokens); g.usageUnknown += r.usage_unknown;
  groups.set(k, g);
}
const report = { since, days, groups: [...groups.values()].map(g => {
  const attempted = g.calls - (g.outcomes.quota_reached ?? 0) - (g.outcomes.quota_check_failed ?? 0);
  return { ...g, attempted, successRate: attempted ? Math.round(g.ok / attempted * 1000) / 10 : null, meanLatencyMs: attempted ? Math.round(g.latencySum / attempted) : null, costUsd: g.provider === "basisweb" ? "unknown (gateway billing not independently known)" : "see ai_spend" };
}) };
if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log(`Headroom AI calls since ${since}`);
if (!rows.length) { console.log("No AI calls recorded (AI off, migration 006 not applied, or no use)."); process.exit(0); }
for (const g of report.groups) console.log(`${g.feature}/${g.provider}: ${g.attempted} provider calls, ${g.successRate ?? "-"}% end_turn, mean ${g.meanLatencyMs ?? "-"} ms, max ${g.latencyMax} ms, tokens in/out ${g.input}/${g.output}, usage unknown ${g.usageUnknown}; outcomes ${JSON.stringify(g.outcomes)}; cost ${g.costUsd}`);
