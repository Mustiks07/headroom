import { describe, expect, it, vi } from "vitest";
import type { ReadyDealSearch } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { fakeSearchDealTerms, fakeState } from "../support/fake-deal-search";
import { pdfPageCount, pdfText } from "../support/pdf-text";

vi.mock("@/lib/engine", async original => {
  const actual = await original<typeof import("@/lib/engine")>();
  return { ...actual, get searchDealTerms() { return fakeState.enabled ? fakeSearchDealTerms : undefined; } };
});

const { createLocalWorkspaceRepository, commitWorkspaceChange, newWorkspaceEvent } = await import("@/lib/client/workspace-repository");
const { buildActionPackage, buildCalendar, buildClientDraft } = await import("@/lib/client/deal-exports");
const { packageCurrency, saveActionPackage, saveDealGoal, setReminderStatus } = await import("@/lib/client/deal-state");
const { analyzeWorkspaceFile, exportWorkspaceJson } = await import("@/lib/client/workspace-migration");
const { previewDocumentFacts, applyDocumentFact } = await import("@/lib/client/workspace-facts");
const { extractFromText } = await import("@/lib/server/extraction/text");
const { POST: exportDecision } = await import("@/app/api/export/decision/route");
const { POST: exportCalendar } = await import("@/app/api/export/calendar/route");

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

async function savedWithPackage() {
  const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
  const ws = await repo.save(structuredClone(dealWorkspaceFixture) as HouseholdWorkspace, null);
  const d = ws.dealPlanning!;
  const result = await fakeSearchDealTerms(ws, d.goals[0], d.termSpaces[0], d.cashContext) as ReadyDealSearch;
  const pkg = buildActionPackage(ws, result, "v-simple", { now: new Date("2026-11-15T12:00:00Z") });
  const event = newWorkspaceEvent("deal_package_saved", "Saved chosen terms.", { projectId: "proj-b" });
  const { saved } = await saveActionPackage(repo, ws, pkg, event);
  return { repo, ws, saved, pkg, event, result };
}
const post = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://localhost/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/** Minimal RFC 5545 structure check (unfolding, line length, BEGIN/END balance, required properties). */
function parseIcs(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  const raw = text.split("\r\n").slice(0, -1);
  for (const l of raw) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  const lines = raw.reduce<string[]>((acc, l) => { if (l.startsWith(" ")) acc[acc.length - 1] += l.slice(1); else acc.push(l); return acc; }, []);
  const stack: string[] = []; const events: Array<Record<string, string>> = []; let cur: Record<string, string> | null = null;
  for (const l of lines) {
    const [nameParams, ...rest] = l.split(":"); const value = rest.join(":"); const name = nameParams.split(";")[0];
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") cur = {}; continue; }
    if (name === "END") { expect(stack.pop()).toBe(value); if (value === "VEVENT") { events.push(cur!); cur = null; } continue; }
    if (cur && stack.at(-1) === "VEVENT") cur[name] = value;
  }
  expect(stack).toEqual([]);
  for (const e of events) for (const k of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "SEQUENCE"]) expect(e[k], k).toBeDefined();
  return events;
}

describe("deal state persistence", () => {
  it("saves goal/terms/package atomically, retries without duplicates, survives reload and JSON restore", async () => {
    const { repo, ws, saved, pkg, event } = await savedWithPackage();
    expect(saved.revision).toBe(ws.revision + 1);
    const retry = await saveActionPackage(repo, ws, pkg, event); // lost acknowledgement → same revision back
    expect(retry.saved.revision).toBe(saved.revision);
    const reloaded = (await repo.get(saved.id))!;
    expect(reloaded.dealPlanning!.packages).toHaveLength(1);
    expect(reloaded.events.filter(e => e.id === event.id)).toHaveLength(1);
    const restored = analyzeWorkspaceFile(await exportWorkspaceJson(reloaded).text());
    expect(restored.status === "workspace" && restored.workspace.dealPlanning).toEqual(reloaded.dealPlanning);
    // A newer choice supersedes the older package of the same project.
    const second = buildActionPackage(reloaded, (await fakeSearchDealTerms(reloaded, reloaded.dealPlanning!.goals[0], reloaded.dealPlanning!.termSpaces[0], null)) as ReadyDealSearch, "v-cash");
    const { saved: s2 } = await saveActionPackage(repo, reloaded, second);
    expect(s2.dealPlanning!.packages.map(p => [p.id === pkg.id, p.status])).toEqual([[true, "superseded"], [false, "draft"]]);
  });

  it("marks packages stale when facts or the goal change", async () => {
    const { repo, saved } = await savedWithPackage();
    expect(await packageCurrency(saved, saved.dealPlanning!.packages[0])).toEqual({ current: true, reason: null });
    const paid = structuredClone(saved);
    paid.projects[0].receipts[1].actual = { amountCents: 300_000, date: "2026-12-16", recordedAt: "2026-12-16T10:00:00Z", sourceId: "doc-offer-a" };
    const { saved: afterPayment } = await commitWorkspaceChange(repo, saved, paid, newWorkspaceEvent("payment_recorded", "Final A payment received."));
    expect((await packageCurrency(afterPayment, afterPayment.dealPlanning!.packages[0])).current).toBe(false);
    expect((await post(exportCalendar, { workspace: afterPayment, packageId: afterPayment.dealPlanning!.packages[0].id })).status).toBe(409);
    const { saved: goalChanged } = await saveDealGoal(repo, saved.revision === afterPayment.revision ? saved : afterPayment,
      { ...afterPayment.dealPlanning!.goals[0], minimumTwoYearCashDeltaCents: 450_000 });
    expect((await post(exportDecision, { workspace: goalChanged, packageId: goalChanged.dealPlanning!.packages[0].id })).status).toBe(409);
  });
});

describe("client draft and calendar", () => {
  it("draft has only price and schedule; no household income, subsidy or tax figures", async () => {
    const { saved, pkg } = await savedWithPackage();
    const body = pkg.clientDraft!.body;
    expect(body).toContain("$12,500.00");
    expect(body).toContain("January 5, 2027");
    for (const forbidden of [/subsidy/i, /premium tax credit/i, /MAGI/i, /income/i, /\$104,000/, /\$11,000/, /SEP/i]) expect(body).not.toMatch(forbidden);
    const withReason = buildClientDraft(saved, pkg.variant, "proj-b", { includeHouseholdDetails: true });
    expect(withReason.body).toMatch(/plan my taxes and health-insurance costs/);
    expect((withReason.body.match(/\$/g) ?? []).length).toBe((body.match(/\$/g) ?? []).length); // no extra amounts
  });

  it("ICS is valid, keeps UIDs stable, bumps SEQUENCE on change and skips done/undated actions", async () => {
    const { repo, saved, pkg } = await savedWithPackage();
    const res = await post(exportCalendar, { workspace: saved, packageId: pkg.id });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    const first = parseIcs(await res.text());
    expect(first.map(e => e.DTSTART)).toEqual(["20261120", "20261201", "20270105"]); // undated Marketplace action not added
    expect(new Set(first.map(e => e.UID)).size).toBe(3);
    const again = parseIcs(buildCalendar(saved, saved.dealPlanning!.packages[0]));
    expect(again.map(e => e.UID)).toEqual(first.map(e => e.UID));
    const { saved: done } = await setReminderStatus(repo, saved, pkg.id, pkg.reminders[0].uid, "done");
    expect(parseIcs(buildCalendar(done, done.dealPlanning!.packages[0])).map(e => e.UID)).not.toContain(pkg.reminders[0].uid);
    // A new package where an action moved: same UID, SEQUENCE + 1, done status kept only if unchanged.
    const moved = await fakeSearchDealTerms(done, done.dealPlanning!.goals[0], done.dealPlanning!.termSpaces[0], null) as ReadyDealSearch;
    moved.variants[0].actions[2] = { ...moved.variants[0].actions[2], dueDate: "2027-01-07" };
    const next = buildActionPackage(done, moved, "v-simple", { id: "pkg-2" });
    const r = next.reminders.find(x => x.actionId === "receive-2")!;
    expect([r.uid, r.sequence]).toEqual([pkg.reminders.find(x => x.actionId === "receive-2")!.uid, 1]);
    expect(next.reminders.find(x => x.actionId === "send-terms")!.status).toBe("done");
    const tricky = parseIcs(buildCalendar(done, { ...next, reminders: [{ ...r, title: "Pay; check, then \\ confirm", sequence: 1 }] }));
    expect(tricky[0].SUMMARY).toBe("Pay\\; check\\, then \\\\ confirm");
  });
});

describe("decision package PDF", () => {
  it("exports a current package with fresh engine figures; refuses tampered or unavailable re-checks", async () => {
    const { saved, pkg } = await savedWithPackage();
    const res = await post(exportDecision, { workspace: saved, packageId: pkg.id });
    expect(res.status).toBe(200);
    const pdf = new Uint8Array(await res.arrayBuffer());
    const text = pdfText(pdf).replace(/\n/g, " ");
    for (const s of ["Decision package", "Your goal", "Your plan without project B", "Total price asked", "$12,500.00", "Money by date",
      "Only this project's money is shown", "not legally computed quarterly", "SEP-IRA contributions", "Draft message to your client (not sent)",
      "has NOT agreed", pkg.searchFingerprint.slice(0, 30)]) expect(text).toContain(s);
    expect(await pdfPageCount(pdf)).toBeLessThanOrEqual(5);
    const tampered = structuredClone(saved); tampered.dealPlanning!.packages[0].variant.twoYearCashDeltaCents += 100_000;
    expect((await post(exportDecision, { workspace: tampered, packageId: pkg.id })).status).toBe(409);
    fakeState.enabled = false;
    try { expect((await post(exportDecision, { workspace: saved, packageId: pkg.id })).status).toBe(503); } finally { fakeState.enabled = true; }
  });
});

describe("document → reviewed fact", () => {
  const doc = "Client payment advice\nPayment received: $3,000.00\nDate received: 2026-12-16\nNet profit YTD: $88,000.00\nProject fee: $12,000.00\n";

  it("offers destinations without guessing, then refuses a second identical import", async () => {
    const ws = structuredClone(dealWorkspaceFixture) as HouseholdWorkspace;
    const extraction = extractFromText(doc, "d".repeat(32), "Uploaded text file");
    const previews = previewDocumentFacts(ws, extraction);
    const received = previews.find(p => p.path === "project.paymentReceived")!;
    expect(received.found).toMatchObject({ amountCents: 300_000, date: "2026-12-16" });
    expect(received.options.length).toBeGreaterThan(1); // the user chooses; equal amounts don't decide
    const ytd = previews.find(p => p.path === "income.scheduleCProfit")!;
    expect(ytd.options[0].needs).toEqual(expect.arrayContaining(["as_of_date"]));
    const target = received.options.find(o => o.id === "proj-a:a-pay-2")!;
    const field = extraction.fields[received.index];
    const applied = applyDocumentFact(ws, field, { ...(target.target as { kind: "payment_received"; projectId: string; lineId: string }), date: received.found.date! });
    if (applied.status !== "applied") throw new Error(applied.status);
    const again = previewDocumentFacts(applied.workspace, extractFromText(doc, "d".repeat(32), "Uploaded text file"));
    expect(again.find(p => p.path === "project.paymentReceived")!.alreadyApplied).toMatch(/Recorded as a payment/);
    expect(applyDocumentFact(applied.workspace, field, { kind: "payment_received", projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16" }).status).toBe("duplicate");
  });

  it("does not treat transfers as income or an unknown period as an annual total", () => {
    const ws = structuredClone(dealWorkspaceFixture) as HouseholdWorkspace;
    const transfer = previewDocumentFacts(ws, extractFromText("Payment received (transfer from savings),\"$5,000.00\"\n", "e".repeat(32), "Note"));
    expect(transfer[0].options).toEqual([]);
    expect(transfer[0].blockers[0]).toMatch(/transfer/);
    const unknown = previewDocumentFacts(ws, extractFromText("Net profit: $50,000.00\n", "f".repeat(32), "Note"));
    expect(unknown[0].options).toEqual([]);
    expect(unknown[0].blockers[0]).toMatch(/never used as an annual total/);
  });
});
