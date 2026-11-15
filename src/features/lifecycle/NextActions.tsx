"use client";

import { ArrowUpRight, Check } from "lucide-react";
import type { CurrentAction } from "@/domain/actions";
import { shortDate } from "@/features/format";
import "./lifecycle.css";

export function NextActions({ actions, onOpen }: { actions: CurrentAction[]; onOpen: (action: CurrentAction) => void }) {
  const pending = actions.filter(a => a.status === "pending");
  const history = actions.filter(a => a.status !== "pending");
  return <section className="lc-next-actions" aria-labelledby="lc-next-title">
    <div className="lc-section-heading"><span className="lc-eyebrow">Your plan, in motion</span><h2 id="lc-next-title">The next useful move.</h2><p>{pending.length ? `${pending.length} open ${pending.length === 1 ? "action" : "actions"} from the facts in your plan.` : "Nothing is waiting on the facts currently recorded. Return when a payment, income figure or client decision changes."}</p></div>
    <ol className="lc-action-list">{pending.map((a, i) => <li key={a.id}><span className="lc-action-number">{String(i + 1).padStart(2, "0")}</span><div><strong>{a.title}</strong><p>{a.dueDate ? `${a.overdue ? "Past the expected date · " : ""}${shortDate(a.dueDate)}` : "No fixed date"}{a.condition ? ` · ${a.condition}` : ""}</p><small>From {a.source.kind.replaceAll("_", " ")}</small></div><button type="button" className="btn secondary" onClick={() => onOpen(a)} aria-label={`Open: ${a.title}`}>Open <ArrowUpRight size={16} /></button></li>)}</ol>
    {!!history.length && <details className="lc-action-history"><summary>Completed and superseded · {history.length}</summary><ul>{history.map(a => <li key={a.id}>{a.status === "completed" && <Check size={16} aria-hidden="true" />}<div><strong>{a.title}</strong><p>{a.status === "completed" ? `Recorded${a.completedOn ? ` ${shortDate(a.completedOn)}` : ""}` : "Superseded by newer facts"}</p></div></li>)}</ul></details>}
  </section>;
}
