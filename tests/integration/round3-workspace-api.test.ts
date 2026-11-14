import { describe, expect, it, vi } from "vitest";
import { workspaceFixture } from "@/fixtures/workspace";

// Cloud session mocked: these checks cover boundary validation only, not live RLS (needs a real project).
const dbUsed = vi.fn();
const requireOwner = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  requireOwner: (...a: unknown[]) => requireOwner(...a),
  dbFailure: () => { throw new Error("db"); },
  privilegedClient: () => null,
}));
const { POST } = await import("@/app/api/workspaces/route");
const { PUT } = await import("@/app/api/workspaces/[id]/route");

const req = (body: unknown) => new Request("http://localhost/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json", authorization: "Bearer a.b.c" }, body: JSON.stringify(body) });

describe("workspace API boundary", () => {
  it("refuses with 503 when cloud save is not configured", async () => {
    const { HttpError } = await import("@/lib/server/http");
    requireOwner.mockRejectedValueOnce(new HttpError(503, "CLOUD_NOT_CONFIGURED", "Cloud save is not configured."));
    const res = await POST(req({ workspace: workspaceFixture, expectedRevision: null }));
    expect(res.status).toBe(503);
  });

  it("rejects an inconsistent workspace before touching the database", async () => {
    requireOwner.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", db: new Proxy({}, { get: () => { dbUsed(); throw new Error("db used"); } }) });
    const bad = structuredClone(workspaceFixture) as Record<string, any>;
    bad.retirement.contributions.push({ ...bad.retirement.contributions[0] });
    const created = await POST(req({ workspace: bad, expectedRevision: null }));
    expect(created.status).toBe(400);
    expect((await created.json()).error.code).toBe("INVALID_WORKSPACE");
    const updated = await PUT(new Request("http://localhost/api/workspaces/x", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: bad, expectedRevision: 1 }) }), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(updated.status).toBe(400);
    expect(dbUsed).not.toHaveBeenCalled();
  });
});
