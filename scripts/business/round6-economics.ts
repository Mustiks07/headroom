/**
 * Headroom round 6 business model: HYPOTHESES, not measured customers, prices or costs.
 * Run: node --experimental-strip-types scripts/business/round6-economics.ts > /tmp/out.md
 *
 * Observed inputs (list prices, research memos dated 2026-11-15): Stripe US card 2.9% + $0.30, Stripe Billing 0.7% on recurring
 * charges, fixed hosting $540/year (Supabase Pro $25 + Vercel Pro $20 per month). Everything else is an assumption.
 * AI: the deployment uses the BasisWeb gateway, whose USD cost per call is NOT known (it reports tokens/call caps only).
 * AI cost is therefore a variable A = full AI cost of one paid period, shown at several values; the earlier direct-Opus
 * budget ($12.16/year for the annual workload) is a reference point only, not the deployment's cost.
 */

type Product = { id: string; price: number; recurring: boolean; supportMin: number; infra: number; months: number };
const PRODUCTS: Product[] = [
  { id: "case29 (one decision, 30 days)", price: 29, recurring: false, supportMin: 10, infra: 0.25, months: 1 },
  { id: "season49 (90 days, no auto-renew)", price: 49, recurring: false, supportMin: 15, infra: 0.60, months: 3 },
  { id: "annual99", price: 99, recurring: true, supportMin: 20, infra: 1.50, months: 12 },
  { id: "annual149 (price test)", price: 149, recurring: true, supportMin: 20, infra: 1.50, months: 12 },
  { id: "monthly15 (alternative)", price: 15, recurring: true, supportMin: 3, infra: 0.10, months: 1 },
];
const OBS = { card: 0.029, fixed: 0.30, billing: 0.007, hostingYear: 540, supportHour: 30 };

/** Contribution of one paid period before CAC and fixed hosting. Fees stay charged on refunded sales (conservative). */
const contributionBeforeAI = (p: Product, refund: number, supportMin = p.supportMin) =>
  p.price * (1 - refund) - (p.price * (OBS.card + (p.recurring ? OBS.billing : 0)) + OBS.fixed) - supportMin / 60 * OBS.supportHour - p.infra;

type Scenario = { id: string; refund: number; supportMult: number; A: Record<string, number>; cpc: number; qualified: number; activated: number; paid: number;
  freeAIPerActivatedNonBuyer: number; otherAcqPerPayer: number; renewal: number; repeat: number; monthlyChurn: number };
const SCEN: Scenario[] = [
  { id: "conservative", refund: 0.10, supportMult: 3, A: { case: 5, season: 10, annual: 30, monthly: 5 }, cpc: 1.5, qualified: 0.25, activated: 0.40, paid: 0.05,
    freeAIPerActivatedNonBuyer: 1.0, otherAcqPerPayer: 10, renewal: 0.25, repeat: 0.25, monthlyChurn: 0.30 },
  { id: "base", refund: 0.05, supportMult: 1, A: { case: 2, season: 4, annual: 10, monthly: 2 }, cpc: 1.0, qualified: 0.35, activated: 0.60, paid: 0.12,
    freeAIPerActivatedNonBuyer: 0.5, otherAcqPerPayer: 5, renewal: 0.50, repeat: 0.50, monthlyChurn: 0.20 },
  { id: "upside", refund: 0.03, supportMult: 0.5, A: { case: 1, season: 2, annual: 5, monthly: 1 }, cpc: 0.6, qualified: 0.50, activated: 0.70, paid: 0.20,
    freeAIPerActivatedNonBuyer: 0.2, otherAcqPerPayer: 3, renewal: 0.70, repeat: 0.75, monthlyChurn: 0.10 },
];
const kindOf = (p: Product) => (p.id.startsWith("case") ? "case" : p.id.startsWith("season") ? "season" : p.id.startsWith("monthly") ? "monthly" : "annual");

/** CAC = CPC / (qualified × activated × paid) + free AI of activated non-buyers per payer + other acquisition per payer. */
const cac = (s: Scenario, paid = s.paid) => s.cpc / (s.qualified * s.activated * paid) + s.freeAIPerActivatedNonBuyer * (1 - paid) / paid + s.otherAcqPerPayer;
/** 36-month contribution: annual 1 + r + r²; season 1 + repurchase; case 1 + repeat decisions within 12 months; monthly Σ(1−c)^k, k < 36. */
const ltv36 = (p: Product, s: Scenario, c: number) => {
  const k = kindOf(p);
  if (k === "annual") return c * (1 + s.renewal + s.renewal ** 2);
  if (k === "season" || k === "case") return c * (1 + s.repeat);
  return c * (1 - (1 - s.monthlyChurn) ** 36) / s.monthlyChurn;
};
/** Paid conversion (of activated) at which LTV36/CAC = target, holding the other inputs. */
const breakEvenPaid = (s: Scenario, ltv: number, target: number) => {
  // ltv/target = cpc/(q·a·p) + F(1−p)/p + O  →  ltv/target − O + F = (cpc/(q·a) + F)/p
  const rhs = ltv / target - s.otherAcqPerPayer + s.freeAIPerActivatedNonBuyer;
  return rhs <= 0 ? null : (s.cpc / (s.qualified * s.activated) + s.freeAIPerActivatedNonBuyer) / rhs;
};
const usd = (x: number, d = 2) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (x: number | null) => (x === null ? "not reachable" : x > 1 ? ">100% (not reachable)" : `${(x * 100).toFixed(1)}%`);
const out: string[] = [];

// 1. Re-check the researchers' published arithmetic.
const memo = [
  ["Contribution before AI, $29 case (memo: $21.159)", contributionBeforeAI(PRODUCTS[0], 0.05), 21.159],
  ["Contribution before AI, $49 season (memo: $36.729)", contributionBeforeAI(PRODUCTS[1], 0.05), 36.729],
  ["Contribution before AI, $99 annual (memo: $78.686)", contributionBeforeAI(PRODUCTS[2], 0.05), 78.686],
  ["Contribution before AI, $149 annual (memo: $124.386)", contributionBeforeAI(PRODUCTS[3], 0.05), 124.386],
  ["Illustrative CAC q=35%, c=5%, CPC $1, F=$0.20, other $5 (memo: $65.94)", 1 / (0.35 * 0.05) + 0.20 * 0.95 / 0.05 + 5, 65.942857],
  ["Annual99 LTV36 at A=$10, r=50% (memo: $120.20)", (contributionBeforeAI(PRODUCTS[2], 0.05) - 10) * 1.75, 120.2005],
  ["round6-economics model: annual99 contribution with Opus A=$12.16 ($66.53)", contributionBeforeAI(PRODUCTS[2], 0.05) - 12.16, 66.526],
  ["round6-economics model: qualified-first CAC ($31.81)", 10000 / 360 + 500 / 360 + (3000 - 360) * 0.36 / 360, 31.81],
  ["round6-economics model: annual99 LTV36 at 25% renewal ($87.32)", (contributionBeforeAI(PRODUCTS[2], 0.05) - 12.16) * (1 + 0.25 + 0.0625), 87.32],
  ["Active households for $100M ARR at $99 (1,010,102)", Math.ceil(1e8 / 99), 1010102],
  ["Active households for $100M ARR at $149 (671,141)", Math.ceil(1e8 / 149), 671141],
] as const;
out.push("## 1. Research arithmetic re-checked", "", "| Figure | Recomputed | Matches |", "|---|---:|---|");
for (const [name, v, ref] of memo) out.push(`| ${name} | ${v > 10000 ? v.toLocaleString("en-US") : v.toFixed(3)} | ${Math.abs(v - ref) < 0.006 ? "yes" : `NO (${ref})`} |`);

// 2. Contribution per paid period as a function of the unknown AI cost A.
out.push("", "## 2. Contribution per paid period vs unknown AI cost A (before CAC and fixed hosting; refunds 5%)", "",
  "| Product | Before AI | A = $1 | A = $5 | A = $10 | A = $30 | Break-even A |", "|---|---:|---:|---:|---:|---:|---:|");
for (const p of PRODUCTS) { const c = contributionBeforeAI(p, 0.05); out.push(`| ${p.id} | ${usd(c, 3)} | ${[1, 5, 10, 30].map(a => usd(c - a)).join(" | ")} | ${usd(c)} |`); }

// 3. Scenarios.
out.push("", "## 3. Conservative / base / upside (all inputs hypothetical)", "",
  "| Input | Conservative | Base | Upside |", "|---|---:|---:|---:|",
  `| CPC | ${SCEN.map(s => usd(s.cpc)).join(" | ")} |`,
  `| Visitor → qualified (in scope) | ${SCEN.map(s => pct(s.qualified)).join(" | ")} |`,
  `| Qualified → activated (own result reached) | ${SCEN.map(s => pct(s.activated)).join(" | ")} |`,
  `| Activated → paid | ${SCEN.map(s => pct(s.paid)).join(" | ")} |`,
  `| = Visitor → paid | ${SCEN.map(s => pct(s.qualified * s.activated * s.paid)).join(" | ")} |`,
  `| Free AI per activated non-buyer | ${SCEN.map(s => usd(s.freeAIPerActivatedNonBuyer)).join(" | ")} |`,
  `| Other acquisition per payer (creative, labour) | ${SCEN.map(s => usd(s.otherAcqPerPayer)).join(" | ")} |`,
  `| AI cost A per period: case / season / annual / monthly | ${SCEN.map(s => `${usd(s.A.case, 0)} / ${usd(s.A.season, 0)} / ${usd(s.A.annual, 0)} / ${usd(s.A.monthly, 0)}`).join(" | ")} |`,
  `| Refunds; support time × base | ${SCEN.map(s => `${pct(s.refund)}; ×${s.supportMult}`).join(" | ")} |`,
  `| Annual renewal; repeat purchase; monthly churn | ${SCEN.map(s => `${pct(s.renewal)}; ${pct(s.repeat)}; ${pct(s.monthlyChurn)}`).join(" | ")} |`,
  "", "| Scenario | Product | Contribution / period | CAC | First period ÷ CAC | LTV36 | LTV36 ÷ CAC | Break-even activated→paid (1×, 3×) |", "|---|---|---:|---:|---:|---:|---:|---:|");
for (const s of SCEN) for (const p of PRODUCTS) {
  const c = contributionBeforeAI(p, s.refund, p.supportMin * s.supportMult) - s.A[kindOf(p)];
  const C = cac(s), L = ltv36(p, s, c);
  out.push(`| ${s.id} | ${p.id} | ${usd(c)} | ${usd(C)} | ${(c / C).toFixed(2)}× | ${usd(L)} | ${(L / C).toFixed(2)}× | ${pct(breakEvenPaid(s, L, 1))}, ${pct(breakEvenPaid(s, L, 3))} |`);
}

// 4. Sensitivity of the base annual case.
const base = SCEN[1], annual = PRODUCTS[2];
const ratio = (s: Scenario, p = annual, sm = 1) => { const c = contributionBeforeAI(p, s.refund, p.supportMin * s.supportMult * sm) - s.A[kindOf(p)]; return ltv36(p, s, c) / cac(s); };
out.push("", "## 4. Sensitivity: annual $99, base scenario (LTV36 ÷ CAC)", "", "| Change | LTV36 ÷ CAC |", "|---|---:|");
for (const [label, s, sm] of [["base", base, 1], ["activated→paid 6%", { ...base, paid: 0.06 }, 1], ["activated→paid 20%", { ...base, paid: 0.20 }, 1], ["CPC $2", { ...base, cpc: 2 }, 1],
  ["CPC $0.50", { ...base, cpc: 0.5 }, 1], ["no renewal", { ...base, renewal: 0 }, 1], ["renewal 70%", { ...base, renewal: 0.7 }, 1], ["A = $30", { ...base, A: { ...base.A, annual: 30 } }, 1],
  ["A = $1", { ...base, A: { ...base.A, annual: 1 } }, 1], ["support 3×", base, 3], ["refunds 15%", { ...base, refund: 0.15 }, 1]] as Array<[string, Scenario, number]>)
  out.push(`| ${label} | ${ratio(s, annual, sm).toFixed(2)}× |`);

// 5. $100M ARR: what must be true.
out.push("", "## 5. $100M ARR — requirements, not a forecast", "", "| Annual price | Active paying households | New per year at 50% renewal (steady state) | Acquisition spend per year at base CAC |", "|---:|---:|---:|---:|");
for (const price of [99, 149]) { const n = Math.ceil(1e8 / price), neu = Math.ceil(n * (1 - base.renewal)); out.push(`| ${usd(price, 0)} | ${n.toLocaleString("en-US")} | ${neu.toLocaleString("en-US")} | ${usd(neu * cac(base), 0)} |`); }
console.log(out.join("\n"));

export {};
