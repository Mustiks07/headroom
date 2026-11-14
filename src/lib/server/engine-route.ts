import "server-only";
import { CaseInputSchema, type CaseInput } from "@/domain/contracts";
import { json, readJsonBody } from "./http";

/** Shared handling for /api/assess and /api/calculate: same engine as the browser. */
export async function runEngineRoute<R extends { status: string }>(request: Request,
  run: (input: CaseInput) => Promise<R>): Promise<Response> {
  const input = await readJsonBody(request, CaseInputSchema);
  const result = await run(input);
  // ready / needs_data / unsupported are valid financial-domain answers (200).
  // "unavailable" means the calculator itself cannot answer: never a fabricated success.
  return json(result, result.status === "unavailable" ? 503 : 200);
}

