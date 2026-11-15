import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntakeRequest, IntakeResult } from "@/domain/intake";
import { familyCase, ordinaryCase } from "@/fixtures/cases";
import { sampleOfferEmail } from "@/fixtures/round6";

// The provider, guest session and quota store are mocked ONLY to check validation and failure handling. No real provider call is claimed.
const rpc = vi.fn(); const requireOwner = vi.fn(); const parse = vi.fn();
vi.mock("@/lib/server/supabase", () => ({ requireOwner: (...a: unknown[]) => requireOwner(...a), optionalOwner: async () => null,
  privilegedClient: () => ({ rpc }), dbFailure: () => { throw new Error("db"); } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse }; } }));

const { parseOfferText, draftFromIntake, answerQuestion, openQuestions, onboardingToWorkspace, loadOnboardingDraft, saveOnboardingDraft, counterofferCommand } = await import("@/lib/client/offer-intake");
const { workspaceFromCase } = await import("@/features/household-plan/ops");
const { POST: intake } = await import("@/app/api/assist/intake/route");

class MemoryStore { data = new Map<string, string>(); get length() { return this.data.size; } key() { return null; } clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }
const req = (text: string, consentToProvider = false): IntakeRequest => ({ purpose: "first_offer", text, userDate: "2026-11-15", timeZone: "America/Chicago", consentToProvider, project: null });
const post = async (body: IntakeRequest): Promise<IntakeResult> => (await intake(new Request("http://localhost/api/assist/intake", { method: "POST",
  headers: { "Content-Type": "application/json", authorization: "Bearer a.b.c" }, body: JSON.stringify(body) }))).json();
const provider = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testvalue");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_testvalue"); vi.stubEnv("AI_PROVIDER", "basisweb"); vi.stubEnv("AI_API_KEY", "sk-pl-synthetic-test-key");
  vi.stubEnv("AI_MODEL", "claude-opus-5.5"); vi.stubEnv("AI_FEATURES", "proposal");
  requireOwner.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", db: {} });
  rpc.mockResolvedValue({ data: "ok", error: null });
};
afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); parse.mockReset(); requireOwner.mockReset(); });

describe("built-in reading of an ordinary offer email", () => {
  it("keeps amounts as written, asks for the missing date, treats costs as unknown", () => {
    const r = parseOfferText(sampleOfferEmail, "2026-11-15", "d1");
    expect(r.outcome).toBe("proposed");
    const o = r.offers[0];
    expect(o.totalPrice?.amountCents).toBe(1_200_000);
    expect(o.payments.map(p => [p.amountCents, p.date, p.condition, p.status])).toEqual([[400_000, null, "when we sign", "expected"], [800_000, "2027-01-15", "on delivery", "expected"]]);
    expect(o.costsStated).toBe(false);
    expect(o.taxYearStated).toBeNull();
    expect(r.questions.map(q => [q.id, q.kind, q.blocking])).toEqual([["q-offer-1-p1-date", "date", true], ["q-offer-1-costs", "amount", false]]);
  });

  it("a payment the client says was sent needs confirmation; rates and other currencies are unsupported; projects stay separate", () => {
    const sent = parseOfferText("We already sent the $1,000 deposit last Tuesday. The final $4,000 will be paid on December 18.", "2026-11-15", "d");
    expect(sent.offers[0].payments.map(p => p.status)).toEqual(["said_received", "expected"]);
    expect(sent.questions.some(q => q.id === "q-offer-1-p1-received" && q.blocking)).toBe(true);
    const invoice = parseOfferText("Invoice #42: $2,500 due December 30.", "2026-11-15", "d");
    expect(invoice.offers[0].payments[0].status).toBe("expected"); // a quoted invoice is not paid
    expect(parseOfferText("Our rate is €80 per hour.", "2026-11-15", "d").outcome).toBe("unsupported_input");
    const rate = parseOfferText("We pay $95 per hour, about 40 hours.", "2026-11-15", "d");
    expect(rate.outcome).toBe("nothing_found");
    expect(rate.unsupported[0].reason).toMatch(/rate/);
    const two = parseOfferText("Two things: the website rebuild for $9,000 due January 20.\n\nSeparately, the brochure design for $1,500 due December 10.", "2026-11-15", "d");
    expect(two.offers.map(o => [o.title, o.payments[0].amountCents, o.payments[0].date])).toEqual([["Website rebuild", 900_000, "2027-01-20"], ["Brochure design", 150_000, "2026-12-10"]]);
    const pct = parseOfferText("Quote: logo refresh $2k flat. 50% upfront, 50% on approval.", "2026-11-15", "d");
    expect(pct.offers[0].payments.map(p => p.amountCents)).toEqual([100_000, 100_000]);
  });
});

describe("POST /api/assist/intake", () => {
  it("without consent or with AI off returns the built-in reading and says why", async () => {
    expect((await post(req(sampleOfferEmail))).providerStatus).toBe("not_consented");
    const off = await post(req(sampleOfferEmail, true));
    expect(off).toMatchObject({ providerStatus: "disabled", provenance: "pattern", outcome: "proposed" });
  });

  it("checks the provider's values against the text; drops an invented quote; reports refusal, timeout and quota", async () => {
    provider();
    parse.mockResolvedValueOnce({ stop_reason: "end_turn", usage: { input_tokens: 700, output_tokens: 200 }, parsed_output: {
      offers: [{ title: "Booking site redesign", currencyWritten: "USD", total: { amountAsWritten: "$12,000", quote: "Budget is $12,000 for the whole project" },
        payments: [{ amountAsWritten: "$4,000", dateAsWritten: null, condition: "when we sign", status: "expected", quote: "$4,000 when we sign" },
          { amountAsWritten: "$8,000", dateAsWritten: "January 15", condition: "on delivery", status: "said_received", quote: "the remaining $8,000 on delivery, which we expect around January 15" }],
        costs: [{ amountAsWritten: "$300", dateAsWritten: null, quote: "hosting costs $300" }], taxYearAsWritten: "2026", priceNegotiable: null, scheduleNegotiable: null }],
      unsupported: [] } });
    const r = await post(req(sampleOfferEmail, true));
    expect(r).toMatchObject({ providerStatus: "used", provenance: "ai_model" });
    expect(r.offers[0].payments.map(p => [p.amountCents, p.date, p.status])).toEqual([[400_000, null, "expected"], [800_000, "2027-01-15", "expected"]]); // "said_received" not backed by the quote
    expect(r.offers[0].costs).toEqual([]); // "$300" is not in the message
    expect(r.offers[0].taxYearStated).toBeNull(); // the message names no tax year
    expect(r.notes[0]).toMatch(/could not be found in your message/);
    parse.mockResolvedValueOnce({ stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 1 }, parsed_output: null });
    expect((await post(req(sampleOfferEmail, true))).providerStatus).toBe("refused");
    parse.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" }));
    const t = await post(req(sampleOfferEmail, true));
    expect(t).toMatchObject({ providerStatus: "timeout", provenance: "pattern", outcome: "proposed" }); // manual path still usable
    rpc.mockResolvedValueOnce({ data: "global_limit", error: null });
    expect((await post(req(sampleOfferEmail, true))).providerStatus).toBe("quota");
    expect(parse).toHaveBeenCalledTimes(3); // no call after the quota refusal, no retries
  });
});

describe("onboarding draft before a workspace exists", () => {
  it("survives reload, takes typed answers, converts through the shared command with the original offer", async () => {
    const storage = new MemoryStore();
    const r = parseOfferText(sampleOfferEmail, "2026-11-15", "draft-1");
    let draft = draftFromIntake(r, sampleOfferEmail);
    expect(saveOnboardingDraft(draft, storage)).toBe(true);
    draft = loadOnboardingDraft(storage)!;
    expect(draft.offers[0].payments[1].date).toBe("2027-01-15");
    expect(() => answerQuestion(draft, { kind: "amount", fieldId: "q-offer-1-p1-date", amountCents: 1 })).toThrow(/needs a date/);
    const single = () => workspaceFromCase({ ...ordinaryCase, opportunity: { ...ordinaryCase.opportunity, grossRevenueCents: 0 } }, [], false);
    const blocked = await onboardingToWorkspace(draft, single, { userDate: "2026-11-15" });
    expect(blocked.conversion).toMatchObject({ status: "needs_answers", questions: [{ id: "q-offer-1-p1-date" }] });
    draft = answerQuestion(draft, { kind: "date", fieldId: "q-offer-1-p1-date", date: "2026-12-01" });
    draft = answerQuestion(draft, { kind: "amount", fieldId: "q-offer-1-costs", amountCents: 0 });
    expect(openQuestions(draft)).toEqual([]);
    saveOnboardingDraft(draft, storage);
    draft = loadOnboardingDraft(storage)!;
    const done = await onboardingToWorkspace(draft, single, { userDate: "2026-11-15" });
    expect(done.conversion.status).toBe("converted");
    const p = done.workspace!.projects.at(-1)!;
    expect(p.receipts.map(l => [l.expected!.amountCents, l.expected!.date])).toEqual([[400_000, "2026-12-01"], [800_000, "2027-01-15"]]);
    expect(p.originalOffer).toMatchObject({ priceCents: 1_200_000, confirmation: "user_confirmed", source: { kind: "user_entered" } });
    expect(p.expenses).toEqual([]); // the user said 0 costs
    // Two adults: whose business must be answered, never assumed.
    const two = await onboardingToWorkspace(draft, () => workspaceFromCase({ ...familyCase, opportunity: { ...familyCase.opportunity, grossRevenueCents: 0 } }, [], false), { userDate: "2026-11-15" });
    if (familyCase.people.filter(x => x.role !== "dependent").length > 1) expect(two.conversion).toMatchObject({ status: "needs_answers", questions: [{ kind: "person" }] });
  });

  it("a counteroffer becomes one record_client_response command", () => {
    const r = parseOfferText("We can do $13,000: $5,000 on December 15 and $8,000 on January 6.", "2026-11-15", "c");
    expect(counterofferCommand(r.offers[0], "proj-b", "2026-11-15", 0)).toEqual({ type: "record_client_response", projectId: "proj-b", response: "countered", respondedOn: "2026-11-15",
      packageId: null, counter: { totalPriceCents: 1_300_000, unpaid: [{ amountCents: 500_000, date: "2026-12-15" }, { amountCents: 800_000, date: "2027-01-06" }], note: null } });
  });
});
