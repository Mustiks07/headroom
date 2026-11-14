import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { familyCase } from "@/fixtures/cases";
import { fakeCalculateComparison } from "../support/fake-engine";

vi.mock("@/lib/engine", () => ({ calculateComparison: fakeCalculateComparison,
  assessCurrentRisk: async () => ({ status: "unavailable", code: "TEST", message: "test", fields: [] }) }));

const exportRoute = await import("@/app/api/export/route");
const capabilitiesRoute = await import("@/app/api/capabilities/route");
const plansRoute = await import("@/app/api/plans/route");
const checkoutRoute = await import("@/app/api/checkout/route");
const analyticsRoute = await import("@/app/api/analytics/route");
const { verifyStripeSignature } = await import("@/lib/server/checkout");
const { createHmac } = await import("node:crypto");

const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Extract drawn text from pdf-lib output: inflate content streams and decode hex string operands. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try { content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { content = m[1]; }
    for (const t of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

afterEach(() => vi.unstubAllEnvs());

describe("PDF export", () => {
  it("renders the fresh calculation: fingerprint, chosen option, both years, separate retirement", async () => {
    const fresh = await fakeCalculateComparison(familyCase);
    if (fresh.status !== "ready") throw new Error("unexpected");
    const response = await exportRoute.POST(post({ input: familyCase, chosenScenarioId: "sep", expectedFingerprint: fresh.calculationFingerprint }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-headroom-fingerprint")).toBe(fresh.calculationFingerprint);
    const text = pdfText(new Uint8Array(await response.arrayBuffer()));
    expect(text).toContain("Headroom plan report");
    expect(text.replace(/\n/g, "")).toContain(fresh.calculationFingerprint);
    expect(text).toContain("Accept and contribute to a SEP-IRA");
    expect(text).toContain("2026");
    expect(text).toContain("2027");
    expect(text).toMatch(/Added to retirement/);
    expect(text).toMatch(/not spendable cash/);
    expect(text).toContain("Make the SEP contribution before filing");
    expect(text).toMatch(/SYNTHETIC example/);
  });

  it("refuses to export old numbers under changed inputs", async () => {
    const fresh = await fakeCalculateComparison(familyCase);
    const edited = structuredClone(familyCase);
    edited.opportunity.grossRevenueCents = 1_500_000;
    const response = await exportRoute.POST(post({ input: edited, chosenScenarioId: "sep",
      expectedFingerprint: fresh.status === "ready" ? fresh.calculationFingerprint : "x" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("STALE_RESULT");
    const infeasible = await exportRoute.POST(post({ input: familyCase, chosenScenarioId: "split" }));
    expect(infeasible.status).toBe(409);
  });
});

describe("service states without keys", () => {
  it("reports truthful capabilities and never exposes values", async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const body = await (await capabilitiesRoute.GET()).json();
    expect(body).toEqual({ cloudSave: false, aiExtraction: false, aiTextProposals: false, aiExplanations: false, checkoutMode: "demo", localTextImport: true });
  });

  it("cloud plan API answers 503 (not a fake save) when Supabase is not configured", async () => {
    const response = await plansRoute.POST(post({ plan: {}, expectedRevision: null }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CLOUD_NOT_CONFIGURED");
  });

  it("demo checkout unlocks without a card and is never a real payment", async () => {
    const result = await (await checkoutRoute.POST(post({}))).json();
    expect(result).toMatchObject({ mode: "demo", unlocked: true, isRealPayment: false, recorded: "browser_only" });
    expect(result.label).toMatch(/No card was collected and no payment was made/);
  });

  it("analytics accepts only whitelisted event names, no amounts", async () => {
    expect((await analyticsRoute.POST(post({ event: "plan_saved" }))).status).toBe(204);
    expect((await analyticsRoute.POST(post({ event: "plan_saved", amountCents: 100 }))).status).toBe(400);
  });

  it("verifies Stripe webhook signatures", () => {
    const payload = "{\"id\":\"evt_test\"}", secret = "whsec_test", t = 1_800_000_000;
    const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec_other", t)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t + 3600)).toBe(false);
  });
});
