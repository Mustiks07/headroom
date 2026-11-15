// Runs the fixed round 6 corpus against a RUNNING Headroom (real HTTP, no mocks) and scores the answers.
//
//   node scripts/ai-eval.mjs                                   # built-in reading (no consent → no provider call)
//   EVAL_CONSENT=1 NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… \
//     BASE_URL=https://<deployment> node scripts/ai-eval.mjs --label=provider --only=m   # provider, messages
//   … --only=d
//   … --corpus=corpus-holdout.json --label=built-in-holdout       # hold-out set (run once, no tuning)                                                  # provider, documents (split: guest cap is 10 calls/day)
//
// With EVAL_CONSENT=1 the script signs in ONE anonymous guest (public Supabase values only) and sends the
// synthetic inputs with provider consent. Each case's mode is read from the RESPONSE (provenance /
// providerStatus), not assumed. Results: docs/artifacts/round6/eval/results/<label>.json + a table on stdout.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const consent = process.env.EVAL_CONSENT === "1";
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
const label = arg("label") ?? (consent ? "provider" : "built-in");
const only = arg("only");
const dir = "docs/artifacts/round6/eval";
const corpusFile = arg("corpus") ?? "corpus.json";
const corpus = JSON.parse(readFileSync(`${dir}/${corpusFile}`, "utf8"));

let token = null;
if (consent) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) { console.error("EVAL_CONSENT=1 needs the PUBLIC Supabase URL and publishable key for an anonymous guest session."); process.exit(2); }
  const { data, error } = await createClient(url, key, { auth: { persistSession: false } }).auth.signInAnonymously();
  if (error || !data.session) { console.error("Anonymous sign-in failed:", error?.code ?? error?.message); process.exit(1); }
  token = data.session.access_token;
}
const headers = { Origin: BASE, ...(token ? { Authorization: `Bearer ${token}` } : {}) };

async function run(c) {
  const t0 = performance.now();
  let res;
  if (c.type === "message") {
    res = await fetch(`${BASE}/api/assist/intake`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({
      purpose: c.purpose, text: readFileSync(`${dir}/${c.file}`, "utf8"), userDate: corpus.userDate, timeZone: corpus.timeZone, consentToProvider: consent, project: null }) });
  } else {
    const form = new FormData();
    const mime = c.file.endsWith(".pdf") ? "application/pdf" : "text/plain";
    form.set("file", new File([readFileSync(`${dir}/${c.file}`)], c.file.split("/").pop(), { type: mime }));
    if (consent) form.set("consent", "provider");
    res = await fetch(`${BASE}/api/documents/extract`, { method: "POST", headers, body: form });
  }
  const ms = Math.round(performance.now() - t0);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ms, body };
}

const score = { correct: 0, incorrect: 0, missing: 0, extra: 0 };
const tally = (k, n = 1) => { score[k] += n; };
function cmp(expected, actual, what, rows) {
  if (actual === undefined || actual === null) { if (expected === null) { tally("correct"); return; } tally("missing"); rows.push(`missing ${what}`); return; }
  if (expected === null) { tally("incorrect"); rows.push(`${what}: expected none, got ${actual}`); return; }
  if (actual === expected) tally("correct"); else { tally("incorrect"); rows.push(`${what}: expected ${expected}, got ${actual}`); }
}

const results = [];
let firstDocId = null;
for (const c of corpus.cases.filter(x => !only || x.id.startsWith(only))) {
  const r = await run(c);
  const notes = [];
  const before = { ...score };
  let mode = "built-in";
  if (c.type === "message") {
    const b = r.body;
    mode = b.provenance === "ai_model" ? "provider" : "built-in";
    cmp(c.expected.outcome, b.outcome, "outcome", notes);
    (c.expected.offers ?? []).forEach((eo, i) => {
      const o = b.offers?.[i];
      if (!o) { tally("missing", 1 + eo.payments.length * 3); notes.push(`missing offer ${i + 1}`); return; }
      cmp(eo.totalCents, o.totalPrice?.amountCents ?? null, `offer ${i + 1} total`, notes);
      cmp(eo.costsStated, o.costsStated, `offer ${i + 1} costsStated`, notes);
      cmp(eo.taxYearStated, o.taxYearStated, `offer ${i + 1} tax year`, notes);
      eo.payments.forEach((ep, k) => {
        const p = o.payments?.[k];
        if (!p) { tally("missing", 3); notes.push(`missing payment ${k + 1}`); return; }
        cmp(ep.amountCents, p.amountCents, `payment ${k + 1} amount`, notes);
        cmp(ep.date, p.date, `payment ${k + 1} date`, notes);
        cmp(ep.status, p.status, `payment ${k + 1} status`, notes);
      });
      const extra = (o.payments?.length ?? 0) - eo.payments.length;
      if (extra > 0) { tally("extra", extra); notes.push(`${extra} extra payment(s)`); }
    });
    const extraOffers = (b.offers?.length ?? 0) - (c.expected.offers?.length ?? 0);
    if (extraOffers > 0) { tally("extra", extraOffers); notes.push(`${extraOffers} extra offer(s)`); }
    if (c.expected.unsupported) cmp(true, (b.unsupported?.length ?? 0) > 0, "unsupported part reported", notes);
    results.push({ id: c.id, type: c.type, httpStatus: r.status, ms: r.ms, mode, providerStatus: b.providerStatus ?? null, notes });
  } else {
    const b = r.body;
    mode = b.facts?.some(f => f.provenance === "ai_model") ? "provider" : "built-in";
    if (c.expected.status) cmp(c.expected.status, b.status, "status", notes);
    for (const ef of c.expected.fields) {
      const f = b.fields?.find(x => x.path === ef.path);
      if (!f) { tally("missing"); notes.push(`missing ${ef.path}`); continue; }
      if (ef.amountCents !== undefined) cmp(ef.amountCents, f.proposedValue?.amountCents ?? null, ef.path, notes);
      if (ef.date !== undefined) cmp(ef.date, f.proposedValue?.date ?? null, ef.path, notes);
      if (ef.period) cmp(ef.period, f.proposedValue?.period ?? null, `${ef.path} period`, notes);
      if (ef.asOfDate) cmp(ef.asOfDate, b.facts?.find(x => x.field === ef.path)?.asOfDate ?? null, `${ef.path} as-of`, notes);
    }
    const extra = (b.fields?.length ?? 0) - c.expected.fields.length;
    if (extra > 0) { tally("extra", extra); notes.push(`${extra} extra field(s): ${b.fields.filter(x => !c.expected.fields.some(e => e.path === x.path)).map(x => x.path).join(", ")}`); }
    if (c.repeat) {
      const again = await run(c);
      cmp(b.document?.documentId, again.body.document?.documentId, "same document recognized on re-upload", notes);
      firstDocId = b.document?.documentId ?? null;
    }
    if (c.conflictsWith) cmp(true, !!b.document?.documentId && b.document.documentId !== firstDocId, "revised document has its own id (conflict, not duplicate)", notes);
    results.push({ id: c.id, type: c.type, format: c.format ?? "text", httpStatus: r.status, ms: r.ms, mode, status: b.status ?? null, notes });
  }
  const d = Object.fromEntries(Object.keys(score).map(k => [k, score[k] - before[k]]));
  Object.assign(results.at(-1), { score: d });
  console.log(`${c.id.padEnd(26)} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)} ms  ${mode.padEnd(9)} ok ${d.correct}  wrong ${d.incorrect}  missing ${d.missing}  extra ${d.extra}${notes.length ? `  — ${notes.join("; ")}` : ""}`);
}
const lat = results.map(r => r.ms).sort((a, b) => a - b);
const expectedTotal = score.correct + score.incorrect + score.missing;
const summary = { label, base: BASE.replace(/\/\/[^/]+/, "//<host>"), corpusVersion: corpus.corpusVersion, ranAt: new Date().toISOString(), consent,
  modes: [...new Set(results.map(r => r.mode))], cases: results.length, ...score, expectedChecks: expectedTotal,
  accuracy: expectedTotal ? Math.round(score.correct / expectedTotal * 1000) / 10 : null,
  latencyMs: { median: lat[Math.floor(lat.length / 2)] ?? null, max: lat.at(-1) ?? null } };
mkdirSync(`${dir}/results`, { recursive: true });
writeFileSync(`${dir}/results/${label}.json`, JSON.stringify({ summary, results }, null, 2) + "\n");
console.log(`\n${label}: ${score.correct}/${expectedTotal} expected checks correct (${summary.accuracy}%), ${score.incorrect} wrong, ${score.missing} missing, ${score.extra} extra; latency median ${summary.latencyMs.median} ms, max ${summary.latencyMs.max} ms`);
