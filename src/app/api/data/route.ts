import { handle, json } from "@/lib/server/http";
import { dbFailure, privilegedClient, requireOwner } from "@/lib/server/supabase";

/**
 * "Clear my data" for the cloud mode. Deletes the caller's plans (events and linked sources
 * cascade) and remaining source metadata through RLS. With a server secret configured it also
 * deletes demo/test entitlements and the anonymous auth user itself.
 */
export const DELETE = handle(async (request: Request) => {
  const owner = await requireOwner(request);
  const plans = await owner.db.from("plans").delete().eq("owner_id", owner.userId);
  if (plans.error) dbFailure(plans.error);
  const sources = await owner.db.from("document_sources").delete().eq("owner_id", owner.userId);
  if (sources.error) dbFailure(sources.error);

  let guestSessionDeleted = false;
  const admin = privilegedClient();
  if (admin) {
    const entitlements = await admin.from("entitlements").delete().eq("owner_id", owner.userId);
    if (entitlements.error) dbFailure(entitlements.error);
    const removed = await admin.auth.admin.deleteUser(owner.userId);
    guestSessionDeleted = !removed.error;
  }
  return json({ deleted: { plans: true, events: true, documentSources: true, guestSession: guestSessionDeleted } });
});
