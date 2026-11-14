import { apiError, handle, HttpError, json, readJsonBody } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/supabase";
import { deleteWorkspace, getWorkspace, updateWorkspace, UpdateWorkspaceBodySchema } from "@/lib/server/workspace-store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) =>
  json({ workspace: await getWorkspace(await requireOwner(request), (await params).id) }));

/** Atomic: the workspace document (with its new history event inside) replaces revision N with N+1. */
export const PUT = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  const body = await readJsonBody(request, UpdateWorkspaceBodySchema, 2_000_000);
  try {
    return json({ workspace: await updateWorkspace(owner, (await params).id, body.workspace, body.expectedRevision) });
  } catch (error) {
    if (error instanceof HttpError && error.code === "WORKSPACE_REVISION_CONFLICT") {
      return apiError(409, error.code, error.message, { current: (error as HttpError & { current?: unknown }).current ?? null });
    }
    throw error;
  }
});

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  await deleteWorkspace(await requireOwner(request), (await params).id);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
