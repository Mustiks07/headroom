import { handle, json } from "@/lib/server/http";
import { listRevisions } from "@/lib/server/plan-store";
import { requireOwner } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

/** Earlier revisions of one of the caller's plans (newest first). */
export const GET = handle(async (request: Request, { params }: Ctx) => {
  const owner = await requireOwner(request);
  return json({ revisions: await listRevisions(owner, (await params).id) });
});
