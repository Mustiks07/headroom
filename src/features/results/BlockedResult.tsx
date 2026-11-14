"use client";

import { AlertTriangle, CircleSlash, Download, PlugZap } from "lucide-react";
import type { BlockedComparison } from "@/domain/contracts";
import { describePath, type Draft } from "@/features/household/draft";

/**
 * Renders needs_data / unsupported / unavailable exactly as the engine
 * returned them. Never substitutes a sample result.
 */
export function BlockedResult({ result, draft, onGoTo, onDownloadData, context }: {
  result: BlockedComparison;
  draft: Pick<Draft, "people" | "years">;
  onGoTo?: (path: string) => void;
  onDownloadData?: () => void;
  context: "risk" | "comparison";
}) {
  if (result.status === "needs_data") {
    return <div className="blocked needs" role="status">
      <div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" />
        <div><h3>{context === "risk" ? "A few facts are needed before we can check your subsidy" : "A few facts are needed before we can compare options"}</h3>
          <p>{result.message}</p></div></div>
      {result.fields.length > 0 && <ul className="missing-list">
        {result.fields.map(f => <li key={f.path + f.reason}>
          <div><strong>{describePath(f.path, draft)}</strong><span>{f.reason}</span></div>
          {onGoTo && <button type="button" className="btn small secondary" onClick={() => onGoTo(f.path)}>Add this</button>}
        </li>)}
      </ul>}
    </div>;
  }
  if (result.status === "unsupported") {
    return <div className="blocked unsupported" role="status">
      <div className="blocked-head"><CircleSlash size={20} aria-hidden="true" />
        <div><h3>Headroom can&apos;t give a reliable answer for this situation yet</h3><p>{result.message}</p></div></div>
      {result.fields.length > 0 && <ul className="missing-list">
        {result.fields.map(f => <li key={f.path + f.reason}>
          <div><strong>{describePath(f.path, draft)}</strong><span>{f.reason}</span></div>
          {onGoTo && <button type="button" className="btn small ghost" onClick={() => onGoTo(f.path)}>Review</button>}
        </li>)}
      </ul>}
      <p className="hint">We&apos;d rather say this than show a number that leaves something important out. A tax professional can use the data you entered.</p>
      {onDownloadData && <button type="button" className="btn small secondary" onClick={onDownloadData}><Download size={16} /> Download the data you entered (JSON)</button>}
    </div>;
  }
  return <div className="blocked unavailable" role="status">
    <div className="blocked-head"><PlugZap size={20} aria-hidden="true" />
      <div><h3>The calculation isn&apos;t available right now</h3><p>{result.message}</p>
        <p className="hint">Your entries are kept. Status code: <code>{result.code}</code></p></div></div>
  </div>;
}

export function ProblemsList({ problems, draft, onGoTo, title }: {
  problems: Array<{ path: string; reason: string }>; draft: Pick<Draft, "people" | "years">; onGoTo: (path: string) => void; title: string;
}) {
  return <div className="blocked needs" role="status">
    <div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" /><div><h3>{title}</h3></div></div>
    <ul className="missing-list">{problems.map(p => <li key={p.path + p.reason}>
      <div><strong>{describePath(p.path, draft)}</strong><span>{p.reason}</span></div>
      <button type="button" className="btn small secondary" onClick={() => onGoTo(p.path)}>Add this</button>
    </li>)}</ul>
  </div>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="blocked unavailable" role="alert">
    <div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" />
      <div><h3>Something went wrong while calculating</h3><p>{message}</p><p className="hint">Your entries are kept.</p></div></div>
    {onRetry && <button type="button" className="btn small secondary" onClick={onRetry}>Try again</button>}
  </div>;
}
