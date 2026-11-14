// One-time two-guest isolation check against a configured Supabase project.
// Usage: NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... node scripts/verify-rls.mjs
// Creates two anonymous users, writes a plan/event/source as A, and checks B cannot read, update or delete them.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."); process.exit(2); }

const guest = async () => {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
  return { c, id: data.user.id };
};
const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const a = await guest(), b = await guest();
const planId = crypto.randomUUID();
const ins = await a.c.from("plans").insert({ id: planId, owner_id: a.id, payload: { rlsCheck: true } }).select("id").single();
check("A can create own plan", !ins.error);
check("A cannot create plan owned by B", !!(await a.c.from("plans").insert({ owner_id: b.id, payload: {} })).error);
const ev = await a.c.from("plan_events").insert({ plan_id: planId, owner_id: a.id, kind: "income_changed", payload: {} });
check("A can add event to own plan", !ev.error);
const src = await a.c.from("document_sources").insert({ owner_id: a.id, plan_id: planId, source_kind: "manual", label: "rls check" });
check("A can add source metadata", !src.error);

check("B cannot read A's plan by id", ((await b.c.from("plans").select("id").eq("id", planId)).data ?? []).length === 0);
check("B cannot list A's events", ((await b.c.from("plan_events").select("id").eq("plan_id", planId)).data ?? []).length === 0);
check("B cannot list A's sources", ((await b.c.from("document_sources").select("id").eq("plan_id", planId)).data ?? []).length === 0);
check("B cannot update A's plan", ((await b.c.from("plans").update({ payload: { hacked: true } }).eq("id", planId).select("id")).data ?? []).length === 0);
check("B cannot delete A's plan", ((await b.c.from("plans").delete().eq("id", planId).select("id")).data ?? []).length === 0);
check("B cannot attach event to A's plan", !!(await b.c.from("plan_events").insert({ plan_id: planId, owner_id: b.id, kind: "income_changed", payload: {} })).error);
const rev = await a.c.from("plan_revisions").insert({ plan_id: planId, owner_id: a.id, revision: 1, payload: {} });
check("A can archive own revision", !rev.error);
check("B cannot read A's revisions", ((await b.c.from("plan_revisions").select("id").eq("plan_id", planId)).data ?? []).length === 0);
check("B cannot read the AI quota table", ((await b.c.from("ai_usage").select("day")).data ?? []).length === 0);
check("Guests cannot call the AI quota function", !!(await b.c.rpc("headroom_consume_ai_quota", { p_user: b.id, p_ip: "x", p_user_limit: 1, p_ip_limit: 1, p_global_limit: 1 })).error);
const wsId = crypto.randomUUID();
check("A can create own workspace", !(await a.c.from("workspaces").insert({ id: wsId, owner_id: a.id, revision: 1, payload: { rlsCheck: true } })).error);
check("B cannot read A's workspace", ((await b.c.from("workspaces").select("id").eq("id", wsId)).data ?? []).length === 0);
check("B cannot update A's workspace", ((await b.c.from("workspaces").update({ payload: { hacked: true } }).eq("id", wsId).select("id")).data ?? []).length === 0);
check("B cannot attach a snapshot to A's workspace", !!(await b.c.from("workspace_snapshots").insert({ workspace_id: wsId, owner_id: b.id, kind: "legacy_v1", revision: 0, payload: {} })).error);
check("A can store own legacy snapshot", !(await a.c.from("workspace_snapshots").insert({ workspace_id: wsId, owner_id: a.id, kind: "legacy_v1", revision: 0, payload: {} })).error);
await a.c.from("workspaces").delete().eq("id", wsId);
// Round 5 (migration 005): AI spend and analytics counters are server-only.
check("Guests cannot read AI spend", ((await b.c.from("ai_spend").select("day")).data ?? []).length === 0);
check("Guests cannot read AI reservations", ((await b.c.from("ai_reservations").select("id")).data ?? []).length === 0);
check("Guests cannot read analytics counters", ((await b.c.from("analytics_daily").select("day")).data ?? []).length === 0);
check("Guests cannot reserve AI spend", !!(await b.c.rpc("headroom_reserve_ai_spend", { p_guest: "x", p_ip: "x", p_feature: "proposal", p_model: "m", p_reserve: 1, p_global_limit: 9, p_guest_limit: 9, p_ip_limit: 9 })).error);
check("Guests cannot write analytics counters", !!(await b.c.rpc("headroom_count_event", { p_event: "start", p_data_kind: "own", p_input_path: "manual" })).error);
check("B cannot write entitlements", !!(await b.c.from("entitlements").insert({ owner_id: b.id, mode: "live", expires_at: new Date().toISOString() })).error);
check("A still sees own plan", ((await a.c.from("plans").select("id").eq("id", planId)).data ?? []).length === 1);
await a.c.from("plans").delete().eq("id", planId);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `${failed} check(s) failed` : "All isolation checks passed");
process.exit(failed ? 1 : 0);
