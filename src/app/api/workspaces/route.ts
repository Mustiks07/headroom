import { handle, json, readJsonBody } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/supabase";
import { createWorkspace, CreateWorkspaceBodySchema, listWorkspaces } from "@/lib/server/workspace-store";

export const GET = handle(async (request: Request) => json({ workspaces: await listWorkspaces(await requireOwner(request)) }));

export const POST = handle(async (request: Request) => {
  const owner = await requireOwner(request);
  const body = await readJsonBody(request, CreateWorkspaceBodySchema, 3_000_000);
  return json({ workspace: await createWorkspace(owner, body.workspace, body.legacySnapshot) }, 201);
});
