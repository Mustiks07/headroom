import { handle, json, readJsonBody } from "@/lib/server/http";
import { createPlan, listPlans } from "@/lib/server/plan-store";
import { CreatePlanBodySchema } from "@/lib/server/schemas";
import { requireOwner } from "@/lib/server/supabase";

export const GET = handle(async (request: Request) => {
  const owner = await requireOwner(request);
  return json({ plans: await listPlans(owner) });
});

export const POST = handle(async (request: Request) => {
  const owner = await requireOwner(request);
  const body = await readJsonBody(request, CreatePlanBodySchema);
  return json({ plan: await createPlan(owner, body.plan) }, 201);
});
