import { handle, json, readJsonBody } from "@/lib/server/http";
import { appendEvent, listEvents } from "@/lib/server/plan-store";
import { PlanEventBodySchema } from "@/lib/server/schemas";
import { requireOwner } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  return json({ events: await listEvents(owner, (await params).id) });
});

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  const body = await readJsonBody(request, PlanEventBodySchema, 20_000);
  return json({ event: await appendEvent(owner, (await params).id, body) }, 201);
});
