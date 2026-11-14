import { calculateComparison } from "@/lib/engine";
import { runEngineRoute } from "@/lib/server/engine-route";
import { handle } from "@/lib/server/http";

export const POST = handle((request: Request) => runEngineRoute(request, calculateComparison));
