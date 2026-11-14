import { handle, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/supabase";
import { listWorkspaceSnapshots } from "@/lib/server/workspace-store";

type Ctx = { params: Promise<{ id: string }> };

/** Earlier revisions (newest first), or with ?legacy=1 the original v1 snapshot it was migrated from. */
export const GET = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  const { id } = await params;
  if (new URL(request.url).searchParams.get("legacy") === "1") {
    const [legacySnapshot = null] = await listWorkspaceSnapshots(owner, id, "legacy_v1");
    return json({ legacySnapshot });
  }
  return json({ revisions: await listWorkspaceSnapshots(owner, id, "revision") });
});
