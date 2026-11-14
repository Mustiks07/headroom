import registry from "../../data/rules/sources.json";
import type { CaseInput } from "./contracts";

export type DisplaySource = {
  id: string; label: string; kind: string; url?: string; excerpt?: string;
  taxYear?: number; page?: number;
};

/** Official rule IDs resolve separately from household evidence; neither changes the input fingerprint. */
export function resolveSource(input: CaseInput, id: string): DisplaySource | undefined {
  const rule = registry.sources.find(source => source.id === id);
  if (rule) return { id, label: rule.title, kind: "rule", url: rule.url, excerpt: rule.status };
  return input.evidence.find(source => source.id === id);
}
