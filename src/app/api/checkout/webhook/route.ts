import { handleStripeWebhook } from "@/lib/server/checkout";
import { handle, json } from "@/lib/server/http";

export const POST = handle(async (request: Request) => {
  const payload = await request.text();
  await handleStripeWebhook(payload, request.headers.get("stripe-signature"));
  return json({ received: true });
});
