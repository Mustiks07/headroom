import { z } from "zod";
import { createStripeTestCheckout, demoCheckout, verifyStripeTestSession } from "@/lib/server/checkout";
import { capabilities } from "@/lib/server/env";
import { handle, json, readJsonBody } from "@/lib/server/http";
import { optionalOwner } from "@/lib/server/supabase";

const BodySchema = z.object({ mode: z.enum(["demo", "stripe_test"]).optional() });

/** Start checkout. Demo is always available and collects no card; Stripe TEST only when configured. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, BodySchema, 2_000);
  const owner = await optionalOwner(request);
  const mode = body.mode ?? capabilities().checkoutMode;
  if (mode === "stripe_test" && capabilities().checkoutMode === "stripe_test") {
    return json(await createStripeTestCheckout(owner?.userId ?? null, new URL(request.url).origin));
  }
  return json(await demoCheckout(owner?.userId ?? null));
});

/** Verify a returned Stripe TEST session server-side: GET /api/checkout?session_id=cs_test_... */
export const GET = handle(async (request: Request) => {
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  const owner = await optionalOwner(request);
  return json(await verifyStripeTestSession(sessionId, owner?.userId ?? null));
});
