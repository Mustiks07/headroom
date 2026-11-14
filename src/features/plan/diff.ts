import type { CaseInput } from "@/domain/contracts";
import { describePath, isMoneyFact } from "@/features/household/draft";
import { money, shortDate } from "@/features/format";

export interface InputChange { path: string; label: string; before: string; after: string }

const STATUS = { confirmed: "confirmed", estimated: "estimate", unknown: "unknown" } as const;

function show(value: unknown, path: string): string {
  if (isMoneyFact(value)) return value.valueCents === null ? "Unknown" : `${money(value.valueCents)} (${STATUS[value.status]})`;
  if (value === null || value === undefined) return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return /Cents$/.test(path) ? money(value) : String(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return shortDate(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value);
}

/** Lists what the person changed, grouping identical monthly edits. */
export function diffInputs(before: CaseInput, after: CaseInput): InputChange[] {
  const raw: Array<{ path: string; before: unknown; after: unknown }> = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (isMoneyFact(a) || isMoneyFact(b) || Array.isArray(a) && path.endsWith("Ids") || typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
      const same = isMoneyFact(a) && isMoneyFact(b) ? a.valueCents === b.valueCents && a.status === b.status : JSON.stringify(a) === JSON.stringify(b);
      if (!same) raw.push({ path, before: a, after: b });
      return;
    }
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      if (path === "" && ["evidence", "id", "title", "contractVersion", "isSynthetic"].includes(k)) continue;
      walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  };
  walk(before, after, "");

  const out: InputChange[] = [];
  const grouped = new Map<string, Array<{ path: string; before: unknown; after: unknown }>>();
  for (const change of raw) {
    const m = /^(years\.\d+\.coverage)\.\d+\.(.+)$/.exec(change.path);
    if (m) { const key = `${m[1]}.*.${m[2]}`; grouped.set(key, [...(grouped.get(key) ?? []), change]); }
    else out.push({ path: change.path, label: describePath(change.path, after), before: show(change.before, change.path), after: show(change.after, change.path) });
  }
  for (const [key, changes] of grouped) {
    const first = changes[0];
    const allSame = changes.every(c => show(c.after, c.path) === show(first.after, first.path) && show(c.before, c.path) === show(first.before, first.path));
    const label = describePath(first.path.replace(/coverage\.\d+/, "coverage"), after);
    out.push({ path: key, label: `${label}${changes.length === 12 ? " (every month)" : ` (${changes.length} month${changes.length > 1 ? "s" : ""})`}`,
      before: allSame ? show(first.before, first.path) : "Varies", after: allSame ? show(first.after, first.path) : "Varies" });
  }
  return out;
}
