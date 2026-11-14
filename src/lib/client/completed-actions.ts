import type { ScenarioResult } from "@/domain/contracts";

/** An action id names a step, not its amount or deadline. Retain only unchanged steps. */
export function retainedCompletedActions(completed: string[], previous: ScenarioResult | undefined,
  next: ScenarioResult | undefined): string[] {
  if (!previous || !next || previous.kind !== next.kind || !Array.isArray(previous.actions)) return [];
  const old = new Map(previous.actions.filter(a => a && typeof a.id === "string").map(a => [a.id, a]));
  return completed.filter(id => {
    const before = old.get(id), after = next.actions.find(a => a.id === id);
    return !!before && !!after && typeof before.title === "string"
      && before.title === after.title && before.dueDate === after.dueDate;
  });
}
