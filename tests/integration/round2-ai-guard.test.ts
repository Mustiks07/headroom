import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Session + durable quota store are mocked here; their SQL is verified only with a live project.
const rpc = vi.fn();
const requireOwner = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  requireOwner: (...a: unknown[]) => requireOwner(...a),
  optionalOwner: async () => null,
  privilegedClient: () => ({ rpc }),
  dbFailure: () => { throw new Error("db"); },
}));
const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse }; } }));
// Round 5: the durable budget replaced the call-count quota. `budget` is the reserve outcome; settle calls are recorded.
const reserve = (outcome: string) => ({ data: [{ reservation_id: outcome === "ok" ? "res-1" : null, outcome }], error: null });
const usage = { input_tokens: 2_500, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

const { POST } = await import("@/app/api/documents/extract/route");
const { GET: capabilities } = await import("@/app/api/capabilities/route");

async function pdfUpload(headers: Record<string, string> = {}, consent = true, withText = true) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  if (withText) page.drawText("SYNTHETIC CHECK: Project fee: $12,000");
  const form = new FormData();
  form.set("file", new File([new Uint8Array(await pdf.save()) as BlobPart], "notice.pdf", { type: "application/pdf" }));
  if (consent) form.set("consent", "provider");
  return POST(new Request("http://localhost/api/documents/extract", { method: "POST", body: form, headers: { authorization: "Bearer guest.jwt.token", ...headers } }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testvalue");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_testvalue");
  vi.stubEnv("AI_PROVIDER", "anthropic");
  vi.stubEnv("AI_API_KEY", "sk-ant-test-not-real");
  requireOwner.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", db: {} });
  rpc.mockImplementation(async (name: string) => name === "headroom_settle_ai_spend" ? { data: null, error: null } : reserve("ok"));
  parse.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("paid document-analysis endpoint", () => {
  it("uses BasisWeb's durable call quota without assigning invented USD prices", async () => {
    vi.stubEnv("AI_PROVIDER", "basisweb");
    vi.stubEnv("AI_API_KEY", "sk-pl-synthetic-test-key");
    vi.stubEnv("AI_MODEL", "claude-opus-5.5");
    rpc.mockClear();
    rpc.mockImplementation(async (name: string) => {
      if (name !== "headroom_consume_ai_quota") throw new Error("Unexpected USD budget call for gateway");
      return { data: "ok", error: null };
    });
    expect((await (await capabilities()).json()).aiExtraction).toBe(true);
    parse.mockResolvedValueOnce({ stop_reason: "end_turn", usage, parsed_output: {
      documentKind: "other", printedTaxYear: 2026, fields: [], notes: [],
    } });
    expect((await pdfUpload()).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toMatchObject(["headroom_consume_ai_quota", { p_global_limit: 100, p_user_limit: 10, p_ip_limit: 20 }]);
    rpc.mockResolvedValueOnce({ data: "global_limit", error: null });
    expect((await pdfUpload()).status).toBe(429);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("does not spend a gateway call on a PDF without an embedded text layer", async () => {
    vi.stubEnv("AI_PROVIDER", "basisweb");
    vi.stubEnv("AI_API_KEY", "sk-pl-synthetic-test-key");
    vi.stubEnv("AI_MODEL", "claude-opus-5.5");
    rpc.mockClear();
    const result = await (await pdfUpload({}, true, false)).json();
    expect(result).toMatchObject({ status: "unavailable", fields: [] });
    expect(result.warnings[0]).toMatch(/no readable text layer/);
    expect(rpc).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("is offered only with a provider AND the durable quota store", async () => {
    expect((await (await capabilities()).json()).aiExtraction).toBe(true);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect((await (await capabilities()).json()).aiExtraction).toBe(false);
    const res = await pdfUpload();
    expect(await res.json()).toMatchObject({ status: "unavailable", warnings: ["Document analysis is unavailable. Enter the figures manually."] });
    expect(parse).not.toHaveBeenCalled();
  });

  it("requires consent, a guest session and quota before any provider call", async () => {
    expect((await pdfUpload({}, false)).status).toBe(400);
    requireOwner.mockRejectedValueOnce(new Error("no session"));
    expect((await pdfUpload()).status).toBe(401);
    rpc.mockResolvedValueOnce(reserve("guest_budget"));
    const limited = await pdfUpload();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.message).toMatch(/today's limit/);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } }); // quota store broken → fail closed
    expect((await pdfUpload()).status).toBe(503);
    expect((await pdfUpload({ origin: "https://evil.example" })).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    const call = rpc.mock.calls.at(-1)![1];
    expect(call.p_ip).toMatch(/^[0-9a-f]{32}$/); // hashed, never the raw IP
  });

  it("recovers honestly from provider failure and refusal", async () => {
    parse.mockRejectedValueOnce(new Error("timeout"));
    const failed = await pdfUpload();
    expect(failed.status).toBe(503);
    expect((await failed.json()).warnings[0]).toMatch(/enter the figures manually/i);
    parse.mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null, usage });
    expect(await (await pdfUpload()).json()).toMatchObject({ status: "unavailable" });
    parse.mockResolvedValueOnce({ stop_reason: "end_turn", usage, parsed_output: { documentKind: "marketplace_notice", printedTaxYear: 2026, notes: [],
      fields: [{ field: "coverage.enrollmentPremium", valueAsPrinted: "$1,917.75", period: "monthly", page: 1, excerpt: "Monthly premium $1,917.75" },
        { field: "coverage.advancePtc", valueAsPrinted: "$900.00", period: "monthly", page: 1, excerpt: "Your tax credit: $1,117.75" }] } });
    const ok = await (await pdfUpload()).json();
    expect(ok.status).toBe("review_required");
    expect(ok.fields).toHaveLength(1); // the value not found in its own quoted line is dropped
    expect(ok.fields[0].proposedValue).toEqual({ kind: "money", amountCents: 191_775, period: "monthly", asPrinted: "$1,917.75" });
    expect(ok.warnings.join(" ")).toMatch(/AI model/);
    expect(ok.document.kind).toBe("marketplace_statement");
    expect(ok.facts[0]).toMatchObject({ provenance: "ai_model", personCandidate: null, review: "extracted", field: "coverage.enrollmentPremium" });
    // Only known usage is settled; a timeout keeps its reservation because billing is unknown.
    const settles = rpc.mock.calls.filter(c => c[0] === "headroom_settle_ai_spend").map(c => c[1]);
    expect(settles.at(-1)).toMatchObject({ p_input: 2_500, p_output: 400, p_outcome: "end_turn" });
    expect(settles.find(s => s.p_outcome === "Error")).toBeUndefined();
  });
});
