import type { HouseholdWorkspace, WorkspaceEvent } from "@/domain/household-workspace";
import { newWorkspaceEvent } from "@/lib/client/api";

/**
 * Writes a readiness answer into a COPY of the workspace at the exact paths Claude 2's
 * assessInputReadiness named. No value is invented: "I don't know yet" never comes here, an
 * amount is only written when typed, and a path that doesn't resolve fails the whole answer.
 * The repository validates the result against the shared schema before anything is saved.
 */
export type ReadinessAnswer =
  | { kind: "boolean"; value: boolean }
  | { kind: "choice"; value: string }
  | { kind: "money"; cents: number }
  | { kind: "money_fields"; values: Record<string, number> };

type Token = { key: string; index: number | "*" | null };

function tokens(path: string): Token[] | null {
  const out: Token[] = [];
  for (const part of path.split(".")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+|\*)\])?$/.exec(part);
    if (!m) return null;
    out.push({ key: m[1], index: m[2] === undefined ? null : m[2] === "*" ? "*" : Number(m[2]) });
  }
  return out;
}

/** Every concrete parent object + leaf key the path names (expanding `[*]`). */
function targets(root: unknown, path: string): Array<{ parent: Record<string, unknown>; key: string }> | null {
  const t = tokens(path);
  if (!t || !t.length) return null;
  let nodes: unknown[] = [root];
  for (let i = 0; i < t.length; i++) {
    const { key, index } = t[i];
    const last = i === t.length - 1;
    if (last && index === null) {
      const out = nodes.filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && key in (n as object)).map(parent => ({ parent, key }));
      return out.length === nodes.length && out.length ? out : null;
    }
    const next: unknown[] = [];
    for (const n of nodes) {
      const v = n && typeof n === "object" ? (n as Record<string, unknown>)[key] : undefined;
      if (index === null) { if (v === undefined) return null; next.push(v); continue; }
      if (!Array.isArray(v)) return null;
      if (index === "*") next.push(...v);
      else if (v[index] !== undefined) next.push(v[index]); else return null;
    }
    if (!next.length) return null;
    nodes = next;
  }
  return null; // the path ended on an array element, which is never a fact
}

function setMoney(parent: Record<string, unknown>, key: string, cents: number, estimated: boolean) {
  const cur = parent[key];
  if (cur && typeof cur === "object" && "valueCents" in (cur as object)) parent[key] = { ...(cur as object), valueCents: cents, status: estimated ? "estimated" : "confirmed", sourceId: "manual-entry" };
  else if (cur === null || typeof cur === "number") parent[key] = cents;
  else throw new Error(`“${key}” isn't an amount.`);
}

export function answerPaths(ws: HouseholdWorkspace, paths: string[], answer: ReadinessAnswer, year: number | null, label: string): HouseholdWorkspace {
  const next = structuredClone(ws);
  if (!next.evidence.some(e => e.id === "manual-entry")) next.evidence.push({ id: "manual-entry", kind: "manual", label: "Entered by you in Headroom" });
  const estimated = year === 2027 || paths.some(p => /years\[1\]/.test(p));
  const write = (path: string, fn: (parent: Record<string, unknown>, key: string) => void) => {
    const found = targets(next, path);
    if (!found) throw new Error("This question can't be answered here. Use the matching section of the plan.");
    for (const { parent, key } of found) fn(parent, key);
  };
  if (answer.kind === "money_fields") {
    const entries = Object.entries(answer.values);
    if (!entries.length) throw new Error("Enter at least one amount.");
    for (const [path, cents] of entries) write(path, (p, k) => setMoney(p, k, cents, estimated));
  } else {
    for (const path of paths) write(path, (p, k) => {
      if (answer.kind === "boolean") p[k] = answer.value;
      else if (answer.kind === "choice") p[k] = answer.value;
      else setMoney(p, k, answer.cents, estimated);
    });
  }
  const top = paths[0] ?? "";
  const kind: WorkspaceEvent["kind"] = top.startsWith("projects") ? "project_updated" : top.startsWith("retirement") ? "sep_target_changed" : "forecast_updated";
  next.events = [...next.events, newWorkspaceEvent(kind, `Answered: ${label}`.slice(0, 300))];
  return next;
}

/**
 * Paths that need their own editor rather than an inline answer: a forecast that doesn't exist yet
 * (`forecasts[primary:2027]`) or a forecast amount (method, year-to-date and ranges live in the
 * income editor), document drafts, and choosing a project. Yes/no facts on an existing forecast
 * (e.g. "leaves out the managed projects") are answered inline.
 */
export const needsEditor = (paths: string[], kind: string) => paths.some(p => p.startsWith("draft.") || p === "projects" || p.startsWith("(root)")
  || /\[[^\]\d*][^\]]*\]/.test(p) && !/\[\*\]/.test(p)
  || (p.startsWith("forecasts") && (kind === "money" || kind === "money_fields" || kind === "range")));
