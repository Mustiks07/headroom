import { apiError, handle, HttpError, json, readJsonBody } from "@/lib/server/http";
import { deletePlan, getPlan, updatePlan } from "@/lib/server/plan-store";
import { UpdatePlanBodySchema } from "@/lib/server/schemas";
import { requireOwner } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  return json({ plan: await getPlan(owner, (await params).id) });
});

export const PUT = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  const { id } = await params;
  const body = await readJsonBody(request, UpdatePlanBodySchema);
  try {
    return json({ plan: await updatePlan(owner, id, body.plan, body.expectedRevision) });
  } catch (error) {
    if (error instanceof HttpError && error.code === "PLAN_REVISION_CONFLICT") {
      return apiError(409, error.code, error.message, { current: (error as HttpError & { current?: unknown }).current ?? null });
    }
    throw error;
  }
});

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  await deletePlan(owner, (await params).id);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
