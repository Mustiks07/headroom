"use client";

import { useEffect, useRef, useState } from "react";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { buildExplanationPacket, renderStatements, type EngineExplanationPacket } from "@/lib/engine";
import { explainWorkspace } from "@/lib/client/api";
import { humanizeDates } from "@/features/format";

const Q = { why_worse: "Why not the offer as it stands?", why_january: "Why these dates?", client_refuses: "What if the client says no?", what_changes: "What would change this answer?" } as const;

/**
 * "Why this option?" — an explanation built only from the engine's verified packet. The AI wording
 * (if switched on and consented) is published only when every figure matches the packet; otherwise
 * Headroom shows its own deterministic text.
 */
export function Explain({ ws, subject, refId, label = "Why this option?" }: { ws: HouseholdWorkspace; subject: "current_year" | "deal_choice" | "agreed_plan"; refId?: string; label?: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "ready"; text: string; packet: EngineExplanationPacket; ai: boolean; server: boolean } | { kind: "error"; message: string }>({ kind: "idle" });
  const generation = useRef(0);
  useEffect(() => { generation.current++; setState({ kind: "idle" }); }, [ws.id, ws.revision, subject, refId]);
  async function load() {
    const request = ++generation.current;
    setState({ kind: "loading" });
    try {
      const packet = await buildExplanationPacket(ws, subject, refId);
      if (!("statements" in packet)) { if (request === generation.current) setState({ kind: "error", message: packet.message }); return; }
      let text = renderStatements(packet, packet.statements);
      let ai = false, server = false;
      // Claude 3: the server rebuilds the packet from this plan revision; fall back to the same text built here.
      try {
        const r = await explainWorkspace(ws, subject, refId, { consentToProvider: false });
        if (r.verification?.origin === "server_recomputed") { text = r.explanation.text; ai = r.explanation.source === "ai_model"; server = true; }
      } catch { /* keep the deterministic text built in the browser */ }
      if (request === generation.current) setState({ kind: "ready", text, packet, ai, server });
    } catch (e) { if (request === generation.current) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }
  return <details className="explain why" onToggle={e => { if ((e.target as HTMLDetailsElement).open && state.kind === "idle") void load(); }}>
    <summary>{label}</summary>
    {state.kind === "idle" && <button className="btn secondary small" type="button" onClick={() => void load()}>Explain the current figures</button>}
    {state.kind === "loading" && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Checking…</p>}
    {state.kind === "error" && <p className="small">{state.message}</p>}
    {state.kind === "ready" && <div className="stack-sm">
      <p className="small">{humanizeDates(state.text)}</p>
      {state.packet.answers.filter(a => a.status === "answered").map(a => <div key={a.question}><p className="small"><strong>{Q[a.question]}</strong></p>
        <p className="small">{humanizeDates(renderStatements(state.packet, a.statements))}</p></div>)}
      {state.packet.answers.filter(a => a.status === "unresolved" && a.missing).map(a => <p key={a.question} className="hint">{Q[a.question]} Not answered yet: {humanizeDates(a.missing!)}</p>)}
      {state.packet.nextAction && <p className="small"><strong>Next:</strong> {humanizeDates(state.packet.nextAction)}</p>}
      {state.packet.limitations.length > 0 && <ul className="bullets small muted">{state.packet.limitations.map(l => <li key={l}>{humanizeDates(l)}</li>)}</ul>}
      <p className="hint">{state.ai ? "Framing by the AI service; the figures come from Headroom's calculation." : "Every figure comes from Headroom's calculation"}{state.server ? ` — recomputed on Headroom's server for plan revision ${ws.revision}.` : " in this browser."}</p>
    </div>}
  </details>;
}
