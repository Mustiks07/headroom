/**
 * Headroom unit economics — reproducible check of docs/research/round5-business-research.md (section 7)
 * and three scenarios for the presentation. Exact rational arithmetic (BigInt fractions), no floats until display.
 *
 * Run: node --experimental-strip-types scripts/business/unit-economics.ts
 *
 * OBSERVED list prices (from the research memo's sources, checked there on 2026-11-15) are inputs; everything
 * else is an ASSUMPTION and printed as such. Nothing here is measured customer behaviour.
 */

// ------------------------------------------------------------------ exact fractions
type F = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const fr = (n: bigint, d = 1n): F => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const q = (s: string | number): F => { const t = String(s); const [i, f = ""] = t.split("."); return fr(BigInt(i + f), 10n ** BigInt(f.length)); };
const add = (...xs: F[]) => xs.reduce((a, b) => fr(a.n * b.d + b.n * a.d, a.d * b.d), fr(0n));
const sub = (a: F, b: F) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (...xs: F[]) => xs.reduce((a, b) => fr(a.n * b.n, a.d * b.d), fr(1n));
const div = (a: F, b: F) => fr(a.n * b.d, a.d * b.n);
const pow = (a: F, k: number) => Array.from({ length: k }, () => a).reduce((x, y) => mul(x, y), fr(1n));
const ge = (a: F, b: F) => a.n * b.d >= b.n * a.d;
const num = (a: F) => Number(a.n) / Number(a.d);
const usd = (a: F, digits = 2) => `${num(a) < 0 ? "-" : ""}$${Math.abs(num(a)).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

// ------------------------------------------------------------------ observed list prices (memo §7.1)
const OBSERVED = {
  cardPct: q("0.029"), cardFixed: q("0.30"),            // Stripe US domestic online card
  billingPct: q("0.007"),                               // Stripe Billing pay-as-you-go, recurring only
  infraPerYear: q(540),                                 // Supabase Pro $25 + Vercel Pro $20 per month
  models: {                                             // Anthropic standard rates, $ per million tokens (input, output)
    "claude-opus-5-5": [q(4), q(20)], "claude-sonnet-5-5": [q(2), q(10)], "claude-haiku-5-5 (prompt <=100k)": [q("0.10"), q("0.50")],
    "gemini-3.5-flash-lite (comparison only)": [q("0.30"), q("2.50")],
  } as Record<string, [F, F]>,
};

// ------------------------------------------------------------------ assumptions (memo base case)
const BASE = {
  refund: q("0.03"), supportPerHour: q(30), retryMultiplier: q(2), billingUnitsPerYear: q(1000),
  docTokens: [q(30000), q(3000)] as [F, F], updateTokens: [q(8000), q(1500)] as [F, F],
};
type Product = { id: string; price: F; recurring: boolean; docs: number; updates: number; supportMin: number; units: F };
const PRODUCTS: Product[] = [
  { id: "decision_29", price: q(29), recurring: false, docs: 2, updates: 4, supportMin: 10, units: q(1000) },
  { id: "season_49", price: q(49), recurring: false, docs: 5, updates: 10, supportMin: 15, units: q(1000) },
  { id: "annual_99", price: q(99), recurring: true, docs: 20, updates: 40, supportMin: 20, units: q(1000) },
  { id: "monthly_15", price: q(15), recurring: true, docs: 2, updates: 4, supportMin: 5, units: q(12000) },
];

const tokenCost = (tokens: [F, F], rates: [F, F]) => div(add(mul(tokens[0], rates[0]), mul(tokens[1], rates[1])), q(1000000));
function unit(p: Product, model: string, o: { refund?: F; supportMin?: number; aiMultiplier?: F; units?: F } = {}) {
  const rates = OBSERVED.models[model];
  const doc = tokenCost(BASE.docTokens, rates), upd = tokenCost(BASE.updateTokens, rates);
  const ai = mul(o.aiMultiplier ?? BASE.retryMultiplier, add(mul(q(p.docs), doc), mul(q(p.updates), upd)));
  const net = mul(p.price, sub(q(1), o.refund ?? BASE.refund));
  const fees = add(mul(p.price, add(OBSERVED.cardPct, p.recurring ? OBSERVED.billingPct : q(0))), OBSERVED.cardFixed);   // charged on the gross even if refunded
  const support = mul(q(o.supportMin ?? p.supportMin), div(BASE.supportPerHour, q(60)));
  const variable = sub(sub(sub(net, fees), support), ai);
  const infra = div(OBSERVED.infraPerYear, o.units ?? p.units);
  return { doc, upd, ai, net, fees, support, variable, infra, contribution: sub(variable, infra) };
}

// ------------------------------------------------------------------ 1. memo arithmetic check
const checks: Array<[string, string, F]> = [];
const opus = "claude-opus-5-5", gem = "gemini-3.5-flash-lite (comparison only)";
const A = (id: string, m: string) => unit(PRODUCTS.find(p => p.id === id)!, m);
checks.push(["Opus annual AI budget", "$12.16", A("annual_99", opus).ai]);
checks.push(["Opus annual contribution before CAC/OPEX", "$69.466", A("annual_99", opus).contribution]);
checks.push(["Opus decision contribution", "$20.233", A("decision_29", opus).contribution]);
checks.push(["Opus season contribution", "$34.729", A("season_49", opus).contribution]);
checks.push(["Opus monthly contribution", "$9.949", A("monthly_15", opus).contribution]);
checks.push(["Opus annual CAC ceiling 3:1, no renewal", "$23.16", div(A("annual_99", opus).contribution, q(3))]);
checks.push(["Opus annual 3-year LTV at 60% renewal (×1.96)", "$136.15", mul(A("annual_99", opus).contribution, q("1.96"))]);
checks.push(["Sonnet annual contribution", "$75.546", A("annual_99", "claude-sonnet-5-5").contribution]);
checks.push(["Haiku annual contribution", "$81.322", A("annual_99", "claude-haiku-5-5 (prompt <=100k)").contribution]);
checks.push(["Gemini annual contribution", "$80.474", A("annual_99", gem).contribution]);
checks.push(["Gemini decision contribution", "$21.3338", A("decision_29", gem).contribution]);
checks.push(["Gemini season contribution", "$37.481", A("season_49", gem).contribution]);
checks.push(["Gemini monthly contribution", "$11.0498", A("monthly_15", gem).contribution]);
const cohort = (cm: F, c: F, n: number) => div(mul(cm, sub(q(1), pow(sub(q(1), c), n))), c);
checks.push(["Opus monthly 12-month LTV at 15% monthly churn", "$56.89", cohort(A("monthly_15", opus).contribution, q("0.15"), 12)]);
checks.push(["Free Opus document run per payer at 5% free→paid", "$7.20", div(mul(q(2), A("annual_99", opus).doc), q("0.05"))]);
checks.push(["Opus media CPC allowance at 5% (ceiling − free intake)", "$0.80", mul(sub(div(A("annual_99", opus).contribution, q(3)), q("7.20")), q("0.05"))]);
checks.push(["SOM A residual (60 payers, $3,000 media)", "$660.36", sub(sub(mul(q(60), A("annual_99", opus).variable), q(540)), q(3000))]);
checks.push(["SOM B residual (250 payers, $5,000 media)", "$11,961.50", sub(sub(mul(q(250), A("annual_99", opus).variable), q(540)), q(5000))]);
checks.push(["SOM C residual (800 payers, $15,000 media)", "$40,464.80", sub(sub(mul(q(800), A("annual_99", opus).variable), q(540)), q(15000))]);
checks.push(["Opus annual with 120 support minutes", "$19.47", unit(PRODUCTS[2], opus, { supportMin: 120 }).contribution]);
checks.push(["Opus annual with 10 customers/year (infra)", "$16.01", unit(PRODUCTS[2], opus, { units: q(10) }).contribution]);
checks.push(["Households for $100M ARR at $99", "1,010,102", fr(BigInt(Math.ceil(100_000_000 / 99)))]);

// ------------------------------------------------------------------ 2. three scenarios (current adapter: Opus)
type Scenario = { id: string; refund: F; supportMin: Record<string, number>; aiMultiplier: F; visitorToQualified: F; qualifiedToPaid: F; cpc: F;
  otherAcquisitionPerPayer: F; freeDocsPerQualified: F; annualRenewal: F; seasonRepeat: F; decisionRepeatPerYear: F };
const SCENARIOS: Scenario[] = [
  { id: "conservative", refund: q("0.05"), supportMin: { decision_29: 20, season_49: 30, annual_99: 60 }, aiMultiplier: q(3), visitorToQualified: q("0.25"), qualifiedToPaid: q("0.02"),
    cpc: q("1.50"), otherAcquisitionPerPayer: q(10), freeDocsPerQualified: q(1), annualRenewal: q("0.30"), seasonRepeat: q("0.20"), decisionRepeatPerYear: q("0.20") },
  { id: "base", refund: q("0.03"), supportMin: { decision_29: 10, season_49: 15, annual_99: 20 }, aiMultiplier: q(2), visitorToQualified: q("0.35"), qualifiedToPaid: q("0.05"),
    cpc: q("1.00"), otherAcquisitionPerPayer: q(5), freeDocsPerQualified: q(1), annualRenewal: q("0.50"), seasonRepeat: q("0.40"), decisionRepeatPerYear: q("0.50") },
  { id: "optimistic", refund: q("0.02"), supportMin: { decision_29: 5, season_49: 10, annual_99: 10 }, aiMultiplier: q("1.5"), visitorToQualified: q("0.50"), qualifiedToPaid: q("0.08"),
    cpc: q("0.75"), otherAcquisitionPerPayer: q(3), freeDocsPerQualified: q(1), annualRenewal: q("0.65"), seasonRepeat: q("0.50"), decisionRepeatPerYear: q("1.00") },
];
/** Finite horizons: annual = 3 billing years (1 + r + r²), season = 2 seasons (1 + repeat), decision = 1 year (1 + repeat decisions). */
function scenarioRow(s: Scenario, p: Product) {
  const u = unit(p, opus, { refund: s.refund, supportMin: s.supportMin[p.id], aiMultiplier: s.aiMultiplier });
  const factor = p.id === "annual_99" ? add(q(1), s.annualRenewal, mul(s.annualRenewal, s.annualRenewal)) : p.id === "season_49" ? add(q(1), s.seasonRepeat) : add(q(1), s.decisionRepeatPerYear);
  const ltv = mul(u.contribution, factor);
  const mediaCac = div(s.cpc, mul(s.visitorToQualified, s.qualifiedToPaid));                // CAC = CPC / (visitor→qualified × qualified→paid)
  const freeIntake = div(mul(s.freeDocsPerQualified, mul(s.aiMultiplier, u.doc)), s.qualifiedToPaid);   // free document runs of qualified non-buyers, per payer
  const cac = add(mediaCac, freeIntake, s.otherAcquisitionPerPayer);
  // Payback in purchases: first n with cumulative expected contribution ≥ CAC (annual: n-th year; others: n-th purchase).
  const per = p.id === "annual_99" ? [q(1), s.annualRenewal, mul(s.annualRenewal, s.annualRenewal)] : p.id === "season_49" ? [q(1), s.seasonRepeat] : [q(1), s.decisionRepeatPerYear];
  let cum = q(0), payback: number | null = null;
  per.forEach((w, i) => { cum = add(cum, mul(u.contribution, w)); if (payback === null && ge(cum, cac)) payback = i + 1; });
  return { u, ltv, mediaCac, freeIntake, cac, ceiling: div(ltv, q(3)), ratio: div(ltv, cac), payback, horizon: per.length };
}

// ------------------------------------------------------------------ output
const lines: string[] = [];
lines.push("## 1. Memo arithmetic, recomputed", "", "| Figure | Memo | Recomputed |", "|---|---:|---:|");
for (const [name, memo, v] of checks) lines.push(`| ${name} | ${memo} | ${name.startsWith("Households") ? num(v).toLocaleString("en-US") : usd(v, name.startsWith("Gemini") && !name.includes("annual") ? 4 : name.includes("contribution") ? 3 : 2)} |`);
lines.push("", "## 2. One billing unit, current adapter (Opus 5.5), memo base assumptions", "", "| | Decision $29 | Season $49 | Annual $99 | Monthly $15 |", "|---|---:|---:|---:|---:|");
const rows = PRODUCTS.map(p => unit(p, opus));
for (const [label, k] of [["Net after refunds", "net"], ["Card + billing fees", "fees"], ["Support", "support"], ["AI (budget, ×2)", "ai"], ["Variable contribution", "variable"], ["Base infra share", "infra"], ["Contribution before CAC/OPEX", "contribution"]] as const)
  lines.push(`| ${label} | ${rows.map(r => usd(r[k], 3)).join(" | ")} |`);
lines.push("", "## 3. Three scenarios (Opus 5.5 adapter)", "", "| Scenario | Product | Contribution / purchase | Horizon LTV | Media CAC | Free intake / payer | Fully loaded CAC | LTV : CAC | Payback (purchase no.) |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
for (const s of SCENARIOS) for (const p of PRODUCTS.slice(0, 3)) {
  const r = scenarioRow(s, p);
  lines.push(`| ${s.id} | ${p.id} | ${usd(r.u.contribution)} | ${usd(r.ltv)} | ${usd(r.mediaCac)} | ${usd(r.freeIntake)} | ${usd(r.cac)} | ${num(r.ratio).toFixed(2)} | ${r.payback ?? `not within ${r.horizon}`} |`);
}
lines.push("", "## 4. Sensitivity (annual $99, base scenario)", "", "| Change | LTV : CAC |", "|---|---:|");
const baseS = SCENARIOS[1];
for (const [label, s] of [["base", baseS], ["qualified→paid 2%", { ...baseS, qualifiedToPaid: q("0.02") }], ["qualified→paid 10%", { ...baseS, qualifiedToPaid: q("0.10") }],
  ["CPC $2.00", { ...baseS, cpc: q(2) }], ["CPC $0.50", { ...baseS, cpc: q("0.50") }], ["no renewal", { ...baseS, annualRenewal: q(0) }], ["renewal 70%", { ...baseS, annualRenewal: q("0.70") }],
  ["support 60 min", { ...baseS, supportMin: { ...baseS.supportMin, annual_99: 60 } }], ["Sonnet-priced AI", baseS]] as Array<[string, Scenario]>) {
  const r = label === "Sonnet-priced AI" ? (() => { const u = unit(PRODUCTS[2], "claude-sonnet-5-5", { refund: s.refund, supportMin: s.supportMin.annual_99, aiMultiplier: s.aiMultiplier });
    const x = scenarioRow(s, PRODUCTS[2]); const ltv = mul(u.contribution, add(q(1), s.annualRenewal, mul(s.annualRenewal, s.annualRenewal)));
    const free = div(mul(s.freeDocsPerQualified, mul(s.aiMultiplier, u.doc)), s.qualifiedToPaid); return div(ltv, add(x.mediaCac, free, s.otherAcquisitionPerPayer)); })() : scenarioRow(s, PRODUCTS[2]).ratio;
  lines.push(`| ${label} | ${num(r).toFixed(2)} |`);
}
console.log(lines.join("\n"));
