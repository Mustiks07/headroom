import { capabilities } from "@/lib/server/env";
import { json } from "@/lib/server/http";

/** Booleans/mode only. Never returns keys, provider payloads or configuration values. */
export async function GET(): Promise<Response> {
  return json(capabilities());
}
