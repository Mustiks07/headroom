"use client";

import { useState } from "react";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { buildExplanationPacket, renderStatements, type EngineExplanationPacket } from "@/lib/engine";
import { explainResult, getCapabilities } from "@/lib/client/api";
import { humanizeDates } from "@/features/format";

const Q = { why_worse: "Why not the offer as it stands?", why_january: "Why these dates?", client_refuses: "What if the client says no?", what_changes: "What would change this answer?" } as const;

/**
 * "Why this option?" — an explanation built only from the engine's verified packet. The AI wording
 * (if switched on and consented) is published only when every figure matches the packet; otherwise
 * Headroom shows its own deterministic text.
 */
export function Explain({ ws, subject, refId, label = "Why this option?" }: { ws: HouseholdWorkspace; subject: "current_year" | "deal_choice" | "agreed_plan"; refId?: string; label?: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "ready"; text: string; packet: EngineExplanationPacket; ai: boolean } | { kind: "error"; message: string }>({ kind: "idle" });
  async function load() {
    setState({ kind: "loading" });
    try {
      const packet = await buildExplanationPacket(ws, subject, refId);
      if (!("statements" in packet)) { setState({ kind: "error", message: packet.message }); return; }
      const caps = await getCapabilities();
      let text = renderStatements(packet, packet.statements);
      let ai = false;
      if ((caps as { aiExplanations?: boolean }).aiExplanations) {
        try { const r = await explainResult(packet, { consentToProvider: false }); text = r.explanation.text; ai = r.explanation.source === "ai_model"; } catch { /* keep deterministic text */ }
      }
      setState({ kind: "ready", text, packet, ai });
    } catch (e) { setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }
  return <details className="explain why" onToggle={e => { if ((e.target as HTMLDetailsElement).open && state.kind === "idle") void load(); }}>
    <summary>{label}</summary>
    {state.kind === "loading" && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Checking…</p>}
    {state.kind === "error" && <p className="small">{state.message}</p>}
    {state.kind === "ready" && <div className="stack-sm">
      <p className="small">{humanizeDates(state.text)}</p>
      {state.packet.answers.filter(a => a.status === "answered").map(a => <div key={a.question}><p className="small"><strong>{Q[a.question]}</strong></p>
        <p className="small">{humanizeDates(renderStatements(state.packet, a.statements))}</p></div>)}
      {state.packet.answers.filter(a => a.status === "unresolved" && a.missing).map(a => <p key={a.question} className="hint">{Q[a.question]} Not answered yet: {humanizeDates(a.missing!)}</p>)}
      {state.packet.nextAction && <p className="small"><strong>Next:</strong> {humanizeDates(state.packet.nextAction)}</p>}
      {state.packet.limitations.length > 0 && <ul className="bullets small muted">{state.packet.limitations.map(l => <li key={l}>{humanizeDates(l)}</li>)}</ul>}
      <p className="hint">{state.ai ? "Wording by the AI service; every figure was checked against Headroom's calculation." : "Every figure comes from Headroom's calculation."}</p>
    </div>}
  </details>;
}
