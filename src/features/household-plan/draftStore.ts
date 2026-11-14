"use client";

import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";

/**
 * Browser draft of a household plan (revision 0 = unsaved draft, per the shared contract).
 * This is the same kind of UI draft as the /check form draft: it keeps work across a browser
 * restart. It is NOT the versioned plan repository (Claude 3 owns that); the UI labels it as a
 * draft kept in this browser and never claims a cloud save.
 */
const PREFIX = "headroom.household-draft.v2:";

export interface DraftSummary { id: string; title: string; updatedAt: string; isSynthetic: boolean; projects: number }

export function listDrafts(): DraftSummary[] {
  const out: DraftSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const ws = readDraft(key.slice(PREFIX.length));
      if (ws) out.push({ id: ws.id, title: ws.household.title, updatedAt: ws.updatedAt, isSynthetic: ws.household.isSynthetic, projects: ws.projects.length });
    }
  } catch { /* storage blocked */ }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Returns null for missing, unreadable or schema-invalid drafts (never a half-parsed document). */
export function readDraft(id: string): HouseholdWorkspace | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const parsed = HouseholdWorkspaceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Throws when the browser refuses to store it, so the UI can say the change was not kept. */
export function writeDraft(ws: HouseholdWorkspace): void {
  const checked = HouseholdWorkspaceSchema.parse(ws);
  localStorage.setItem(PREFIX + checked.id, JSON.stringify(checked));
}

export function removeDraft(id: string) {
  try { localStorage.removeItem(PREFIX + id); } catch { /* ignore */ }
}

export function clearDrafts() {
  try { for (const d of listDrafts()) localStorage.removeItem(PREFIX + d.id); } catch { /* ignore */ }
}
