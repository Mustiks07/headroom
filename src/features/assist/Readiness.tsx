"use client";

import { useMemo, useState } from "react";
import type { ReadinessIntent } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { assessInputReadiness } from "@/lib/engine";
import { humanizeDates } from "@/features/format";

const TASK: Record<ReadinessIntent, string> = {
  current_year_subsidy: "this year's subsidy check", new_offer: "checking this offer", two_year_terms: "finding terms across 2026 and 2027", agreed_plan_review: "checking your agreed plan",
};

/**
 * Only the questions this task needs (Claude 2's assessInputReadiness), 1–3 at a time, each with
 * its reason. "I don't know yet" keeps the fact unknown — it is never filled with $0.
 */
export function Readiness({ ws, intent, projectId, onAnswer }: {
  ws: HouseholdWorkspace; intent: ReadinessIntent; projectId?: string; onAnswer: (path: string) => void;
}) {
  const r = useMemo(() => assessInputReadiness(ws, intent, null, projectId ? { projectId } : {}), [ws, intent, projectId]);
  const [later, setLater] = useState<string[]>([]);
  if (r.status === "ready") return r.precision === "range_changes_answer" || r.precision === "range_not_yet_checked"
    ? <p className="hint">{humanizeDates(r.precisionNote)}</p> : null;
  if (r.status === "unsupported") return <div className="notice warn small" role="status"><strong>Headroom can&apos;t calculate {TASK[intent]} for this situation.</strong>
    <ul className="bullets small">{r.unsupported.map(u => <li key={u.code + u.path}>{humanizeDates(u.reason)}</li>)}</ul>
    <p>Your facts stay saved and can be exported for a tax professional.</p></div>;
  const open = [...r.questions].sort((a, b) => a.priority - b.priority).filter(q => !later.includes(q.id));
  const shown = open.slice(0, 3);
  return <div className="readiness" role="status">
    <p className="small"><strong>{r.questions.length} thing{r.questions.length === 1 ? "" : "s"} to confirm for {TASK[intent]}</strong>
      {r.notNeeded.length > 0 && <span className="muted"> · not needed now: {r.notNeeded.map(humanizeDates).join("; ")}</span>}</p>
    <ul className="question-list">{shown.map(q => <li key={q.id}>
      <p className="check-title">{humanizeDates(q.question)}</p>
      <p className="muted small">{humanizeDates(q.reason)}{q.documentHint ? ` Where to find it: ${humanizeDates(q.documentHint)}.` : ""}</p>
      <div className="row gap"><button type="button" className="btn small secondary" onClick={() => onAnswer(q.path)}>Answer</button>
        {q.allowUnknown && <button type="button" className="link-btn" onClick={() => setLater([...later, q.id])}>I don&apos;t know yet</button>}</div>
    </li>)}</ul>
    {open.length === 0 && later.length > 0 && <p className="hint">You&apos;ve left {later.length} question{later.length > 1 ? "s" : ""} for later. The result waits for them — nothing unknown is treated as $0.</p>}
  </div>;
}
