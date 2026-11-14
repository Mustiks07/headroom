"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { workspaceRepo } from "@/features/household-plan/store";
import { dateTime } from "@/features/format";

/** Returning visitors go straight back to their saved household plan (no re-entry of confirmed facts). */
export function ContinuePlan() {
  const [latest, setLatest] = useState<HouseholdWorkspace | null>(null);
  useEffect(() => { let live = true; workspaceRepo().list().then(ws => { if (live) setLatest(ws.find(w => !w.household.isSynthetic) ?? null); }, () => {}); return () => { live = false; }; }, []);
  if (!latest) return null;
  return <Link className="continue-plan" href={`/household/${encodeURIComponent(latest.id)}`}>
    <span><strong>Continue your plan</strong> — {latest.household.title}</span>
    <span className="muted small">Updated {dateTime(latest.updatedAt)} · {latest.projects.length} project{latest.projects.length === 1 ? "" : "s"}</span>
    <ArrowRight size={16} aria-hidden="true" />
  </Link>;
}
