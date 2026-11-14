"use client";

import { useState } from "react";
import { CalendarDays, FileText } from "lucide-react";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { CALENDAR_IMPORT_NOTE, exportCurrentCalendar, trackEvent } from "@/lib/client/api";
import { dateTime, humanizeDates } from "@/features/format";
import { downloadBlob, fileStamp } from "@/features/plan/storage";
import { workspaceRepo } from "@/features/household-plan/store";

/**
 * After the client agrees: the historical decision record (figures as of that revision, never
 * relabelled as current) and a calendar of the CURRENT plan's open actions (updates/cancellations).
 */
export function Records({ ws, onSaved, onNotice, dataKind }: {
  ws: HouseholdWorkspace; onSaved: (saved: HouseholdWorkspace) => void; onNotice: (tone: "ok" | "warn", text: string) => void; dataKind: "sample" | "own";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const records = ws.dealPlanning?.decisionRecords ?? [];
  const hasAgreed = ws.projects.some(p => p.status === "agreed") || (ws.retirement.targets.length > 0);

  async function recordPdf(recordId: string) {
    setBusy(recordId);
    try {
      const res = await fetch("/api/export/decision-record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: ws, recordId }) });
      if (!res.ok) { const j = await res.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(j?.error?.message ?? `The record couldn't be created (${res.status}).`); }
      downloadBlob(await res.blob(), `headroom-decision-record-${fileStamp()}.pdf`);
      void trackEvent("plan_exported", { dataKind, inputPath: "none" });
      onNotice("ok", res.headers.get("X-Headroom-Record") === "verified" ? "Decision record downloaded (re-checked against its own figures)." : "Decision record downloaded as an archived record.");
    } catch (e) { onNotice("warn", e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  async function calendar() {
    setBusy("ics");
    try {
      const out = await exportCurrentCalendar(workspaceRepo(), ws);
      downloadBlob(out.blob, `headroom-current-actions-${fileStamp()}.ics`);
      onSaved(out.saved);
      void trackEvent("plan_exported", { dataKind, inputPath: "none" });
      onNotice("ok", `Calendar downloaded: ${out.active} current event${out.active === 1 ? "" : "s"}${out.cancelled ? `, ${out.cancelled} cancelled` : ""}.`);
    } catch (e) { onNotice("warn", `The calendar couldn't be created: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  }

  if (!records.length && !hasAgreed) return null;
  return <section className="plan-section" id="records" aria-labelledby="records-title">
    <h2 id="records-title" className="section-title small">Decisions and calendar</h2>
    {records.length > 0 && <ul className="plan-list">{[...records].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(r => {
      const project = ws.projects.find(p => p.id === r.projectId);
      const label = typeof r.variant.label === "string" ? r.variant.label : "";
      return <li key={r.id}><div className="plan-link">
        <span className="plan-title">{project?.title ?? "Project"}: {humanizeDates(label)}</span>
        <span className="muted small">{r.status === "client_agreed" ? "Client agreed" : "Terms shared"} — recorded {dateTime(r.recordedAt)}; figures as of plan revision {r.workspaceRevision}. A historical record, not today&apos;s estimate.</span>
        <span><button type="button" className="btn small ghost" disabled={busy === r.id} onClick={() => void recordPdf(r.id)}><FileText size={14} /> {busy === r.id ? "Preparing…" : "Decision record (PDF)"}</button></span>
      </div></li>;
    })}</ul>}
    <div className="row gap wrap"><button type="button" className="btn small secondary" disabled={busy === "ics"} onClick={() => void calendar()}><CalendarDays size={14} /> {busy === "ics" ? "Preparing…" : "Calendar of current actions (.ics)"}</button></div>
    <p className="hint">{CALENDAR_IMPORT_NOTE}</p>
  </section>;
}
