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
check("B cannot write entitlements", !!(await b.c.from("entitlements").insert({ owner_id: b.id, mode: "live", expires_at: new Date().toISOString() })).error);
check("A still sees own plan", ((await a.c.from("plans").select("id").eq("id", planId)).data ?? []).length === 1);
await a.c.from("plans").delete().eq("id", planId);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `${failed} check(s) failed` : "All isolation checks passed");
process.exit(failed ? 1 : 0);
