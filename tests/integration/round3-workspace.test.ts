import { describe, expect, it } from "vitest";
import type { SavedPlan } from "@/domain/contracts";
import { workspaceFingerprint, workspaceToCaseInput, type HouseholdWorkspace } from "@/domain/household-workspace";
import { familyCase } from "@/fixtures/cases";
import { workspaceFixture } from "@/fixtures/workspace";
import { calculateComparison, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { StorageUnavailableError } from "@/lib/client/errors";
import { CloudSaveFailedError, type StorageModeInfo } from "@/lib/client/repository";
import {
  commitWorkspaceChange, createLocalWorkspaceRepository, createWorkspaceRepository, newWorkspaceEvent, WorkspaceConflictError, type WorkspaceRepository,
} from "@/lib/client/workspace-repository";
import { analyzeWorkspaceFile, confirmV1Migration, exportWorkspaceJson, previewV1Migration } from "@/lib/client/workspace-migration";
import { applyDocumentFact } from "@/lib/client/workspace-facts";
import { extractFromText } from "@/lib/server/extraction/text";
import { POST as exportForecast } from "@/app/api/export/forecast/route";
import { pdfPageCount, pdfText } from "../support/pdf-text";

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }
const ws0 = () => structuredClone(workspaceFixture) as HouseholdWorkspace;

describe("workspace persistence", () => {
  it("keeps two revisions across reloads; a lost acknowledgement is retried without a double write", async () => {
    const store = new MemoryStore();
    const repo = createLocalWorkspaceRepository({ store });
    const r1 = await repo.save(ws0(), null);
    expect(r1.revision).toBe(1);
    const next = structuredClone(r1);
    next.projects[0].receipts[1].actual = { amountCents: 300_000, date: "2026-12-16", recordedAt: "2026-12-16T10:00:00Z", sourceId: "doc-offer-a" };
    const event = newWorkspaceEvent("payment_recorded", "Final payment received.", { projectId: "proj-a", lineId: "a-pay-2" });
    const { saved: r2 } = await commitWorkspaceChange(repo, r1, next, event);
    // The response was "lost": the client retries the same change with the same event id.
    const { saved: retried } = await commitWorkspaceChange(repo, r1, next, event);
    expect(retried.revision).toBe(2);
    const reloaded = createLocalWorkspaceRepository({ store });
    const latest = (await reloaded.get(r1.id))!;
    expect(latest.revision).toBe(2);
    expect(latest.events.filter(e => e.id === event.id)).toHaveLength(1); // revision and event saved together, once
    expect((await reloaded.listRevisions(r1.id)).map(w => w.revision)).toEqual([1]);
    // A different change based on the stale revision is a conflict, not an overwrite.
    const other = structuredClone(r1); other.planning.minimumDesiredCashGainCents = 100;
    await expect(commitWorkspaceChange(reloaded, r1, other, newWorkspaceEvent("forecast_updated", "x"))).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(r2.projects[0].receipts[1].actual?.amountCents).toBe(300_000);
  });

  it("rejects an invalid workspace before writing anything", async () => {
    const store = new MemoryStore();
    const repo = createLocalWorkspaceRepository({ store });
    const bad = ws0(); bad.forecasts.push({ ...bad.forecasts[1] });
    await expect(repo.save(bad, null)).rejects.toMatchObject({ code: "INVALID_WORKSPACE" });
    expect(await repo.list()).toEqual([]);
  });

  it("never reports a cloud save after a cloud failure and offers an explicit local copy", async () => {
    const down = () => { throw new StorageUnavailableError("Cloud save is unavailable right now.", "CLOUD_UNAVAILABLE", 503); };
    const cloud: WorkspaceRepository = { list: async () => down(), get: async () => down(), save: async () => down(), listRevisions: async () => down(),
      getLegacySnapshot: async () => down(), remove: async () => down(), clear: async () => down() };
    const local = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const repo = createWorkspaceRepository({ local, cloud, mode: async (): Promise<StorageModeInfo> => ({ mode: "cloud", label: "", detail: "" }) });
    await expect(repo.save(ws0(), null)).rejects.toBeInstanceOf(CloudSaveFailedError);
    expect(await local.list()).toEqual([]);
    const copy = await repo.saveLocally(ws0());
    expect(repo.locationOf(copy.id)).toBe("local");
    expect((await repo.list()).map(w => w.id)).toEqual([copy.id]);
    expect(repo.cloudProblem()).toMatch(/isn't reachable/);
  });
});

describe("document facts", () => {
  const paystub = "Earnings statement\nPay date: 2026-10-31\nNet profit YTD: $88,000.00\nPayment received: $3,000.00\nDate received: 2026-12-16\nSEP contribution: $1,500.00\n";

  it("re-importing the same document cannot double a payment or a SEP contribution", () => {
    const first = extractFromText(paystub, "a".repeat(32), "Uploaded text file");
    const again = extractFromText(paystub, "a".repeat(32), "Uploaded text file");
    expect(again.fields.map(f => f.evidence.id)).toEqual(first.fields.map(f => f.evidence.id)); // deterministic ids
    const received = first.fields.find(f => f.path === "project.paymentReceived")!;
    const sep = first.fields.find(f => f.path === "income.existingSepContribution")!;
    const ytd = first.fields.find(f => f.path === "income.scheduleCProfit")!;

    const a = applyDocumentFact(ws0(), received, { kind: "payment_received", projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16" });
    if (a.status !== "applied") throw new Error(a.status);
    expect(workspaceToCaseInput(a.workspace).input.years[0].incomes[0].scheduleCProfit.valueCents).toBe(12_500_000); // actual replaced expected
    expect(applyDocumentFact(a.workspace, received, { kind: "payment_received", projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16" }).status).toBe("duplicate");
    const otherDoc = extractFromText(paystub, "b".repeat(32), "Another file").fields.find(f => f.path === "project.paymentReceived")!;
    expect(applyDocumentFact(a.workspace, otherDoc, { kind: "payment_received", projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16" }).status).toBe("needs_resolution");
    const corrected = applyDocumentFact(a.workspace, otherDoc, { kind: "payment_received", projectId: "proj-a", lineId: "a-pay-2", date: "2026-12-16", correctionReason: "Bank statement shows the final amount" });
    expect(corrected.status === "applied" && corrected.workspace.projects[0].receipts[1].corrections).toHaveLength(1);

    const s1 = applyDocumentFact(ws0(), sep, { kind: "sep_contribution", personId: "primary", taxYear: 2026, paidDate: "2026-11-02" });
    if (s1.status !== "applied") throw new Error(s1.status);
    expect(applyDocumentFact(s1.workspace, sep, { kind: "sep_contribution", personId: "primary", taxYear: 2026, paidDate: "2026-11-02" }).status).toBe("duplicate");
    expect(s1.workspace.retirement.contributions.reduce((t, c) => t + c.amountCents, 0)).toBe(350_000);

    // A year-to-date figure cannot silently become a full-year forecast.
    const annualWs = ws0();
    annualWs.forecasts[0] = { method: "annual_total", personId: "primary", year: 2026, excludesManagedProjects: true, annualNetProfit: { valueCents: null, status: "unknown", sourceId: "demo-input" } };
    expect(applyDocumentFact(annualWs, ytd, { kind: "forecast", personId: "primary", year: 2026, field: "annualNetProfit", status: "estimated" }).status).toBe("rejected");
  });

  it("does not classify bank deposits as profit", () => {
    const result = extractFromText("Date,Description,Amount\n2026-03-01,Client ACME,5000.00\n", "c".repeat(32), "Bank CSV");
    expect(result.fields).toEqual([]);
  });
});

async function v1Plan(): Promise<SavedPlan> {
  const input = structuredClone(familyCase);
  input.years[0].incomes[0].existingSepContribution = { valueCents: 150_000, status: "estimated", sourceId: "demo-input" };
  const comparison = await calculateComparison(input);
  if (comparison.status !== "ready") throw new Error(comparison.message);
  const chosen = comparison.scenarios.find(s => s.id === comparison.recommendedScenarioId)!;
  return { id: "11111111-1111-4111-8111-111111111111", revision: 3, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z",
    input, comparison, chosenScenarioId: chosen.id, completedActionIds: chosen.actions.slice(0, 1).map(a => a.id) };
}

describe("v1 → v2 migration and JSON", () => {
  it("previews provenance, asks about SEP, keeps done marks unconfirmed and the original snapshot", async () => {
    const plan = await v1Plan();
    const preview = previewV1Migration(plan, "browser");
    expect(preview.questions.map(q => q.kind).sort()).toEqual(["existing_sep", "project_status"]);
    expect(preview.completedActions).toHaveLength(1);
    expect(() => confirmV1Migration(plan, preview, {})).toThrow(/SEP contribution/);
    const ws = confirmV1Migration(plan, preview, { existingSep: { "primary:2026": { kind: "planned" } } });
    expect(ws.retirement.contributions).toEqual([]); // nothing turned into a payment
    expect(ws.origin.kind === "migrated_v1" && ws.origin.unconfirmed[0]).toMatch(/Old "done" mark/);
    const agreed = ws.projects[0];
    expect(agreed.status).toBe("agreed");
    expect(agreed.receipts.reduce((t, l) => t + (l.expected?.amountCents ?? 0), 0)).toBe(plan.input.opportunity.grossRevenueCents);
    const repo = createLocalWorkspaceRepository({ store: new MemoryStore() });
    const saved = await repo.save(ws, null, { legacySnapshot: plan });
    expect(await repo.getLegacySnapshot(saved.id)).toEqual(plan);
    const paid = confirmV1Migration(plan, preview, { existingSep: { "primary:2026": { kind: "paid", amountCents: 150_000, paidDate: "2026-06-01" } } });
    expect(paid.retirement.contributions.map(c => c.amountCents)).toEqual([150_000]);
  });

  it("restores whole v2 files, refuses newer or damaged ones, and routes v1 files to migration", async () => {
    const text = await exportWorkspaceJson(ws0()).text();
    const ok = analyzeWorkspaceFile(text);
    expect(ok.status === "workspace" && ok.workspace.projects).toHaveLength(2);
    expect(analyzeWorkspaceFile(text.replace(/"workspaceVersion": "2.0"/g, '"workspaceVersion": "3.0"'))).toMatchObject({ status: "invalid", message: expect.stringMatching(/newer version/) });
    const damaged = JSON.parse(text); damaged.workspace.retirement.contributions.push(damaged.workspace.retirement.contributions[0]);
    expect(analyzeWorkspaceFile(JSON.stringify(damaged))).toMatchObject({ status: "invalid", message: expect.stringMatching(/nothing was imported/) });
    const v1 = analyzeWorkspaceFile(JSON.stringify({ kind: "headroom.saved-plan", contractVersion: "1.0", plan: await v1Plan() }));
    expect(v1.status).toBe("v1_plan");
  });
});

describe("Annual income forecast explanation PDF", () => {
  const post = (body: unknown) => exportForecast(new Request("http://localhost/api/export/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  it("explains the forecast from a fresh calculation and refuses stale or invalid requests", async () => {
    const ws = ws0();
    const fingerprint = await workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION);
    const res = await post({ workspace: ws, year: 2026, expectedFingerprint: fingerprint });
    expect(res.status).toBe(200);
    const pdf = new Uint8Array(await res.arrayBuffer());
    const text = pdfText(pdf).replace(/\n/g, " ");
    for (const s of ["Annual income forecast explanation", "not a complete self-employment ledger", "$125,000.00", "range $118,000.00 to $131,000.00",
      "Bakery website redesign", "Offer only (not included)", "Still to pay", "$3,000.00", "Household income for the subsidy", fingerprint.slice(0, 32)]) {
      expect(text).toContain(s);
    }
    expect(await pdfPageCount(pdf)).toBeLessThanOrEqual(5);
    expect((await post({ workspace: ws, year: 2026, expectedFingerprint: "stale" })).status).toBe(409);
    const bad = ws0(); bad.retirement.contributions.push({ ...bad.retirement.contributions[0] });
    expect((await post({ workspace: bad, year: 2026 })).status).toBe(400);
  });
});
