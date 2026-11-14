"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardPaste, FileUp, Keyboard } from "lucide-react";

export const PASTED_KEY = "headroom.pasted-text.v1";

/**
 * Three equal ways in: documents, pasted text, or typed figures. Each continues into the same
 * checked household form, so nothing is calculated from guesses.
 */
export function StartChooser({ intent }: { intent: "offer" | "year" }) {
  const router = useRouter();
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const q = intent === "offer" ? "start=project&" : "";
  return <div className="shell page-pad start">
    <p className="eyebrow">{intent === "offer" ? "Check a client offer" : "Check my year's income"}</p>
    <h1 className="page-title">{intent === "offer" ? "Start with the offer" : "Start with this year's income"}</h1>
    <p className="intro">{intent === "offer"
      ? "Headroom sets up the project from the offer, then asks only for the household facts the result needs."
      : "Headroom checks this year's subsidy position from your income forecast and health plan. No project or next-year figures are needed."}</p>
    <div className="entry-grid">
      <Link className="entry" href={`/check?${q}doc=1`}><FileUp size={20} aria-hidden="true" /><strong>Upload documents</strong>
        <span>Profit-and-loss report, pay stub, Marketplace statement{intent === "offer" ? ", the offer" : ""}. You confirm every figure before it&apos;s used.</span></Link>
      <button type="button" className={`entry ${paste ? "on" : ""}`} aria-expanded={paste} onClick={() => setPaste(p => !p)}><ClipboardPaste size={20} aria-hidden="true" /><strong>Paste text</strong>
        <span>{intent === "offer" ? "Paste the client's email or offer." : "Paste lines from a statement or report."}</span></button>
      <Link className="entry" href={`/check?${q}`.replace(/[?&]$/, "")}><Keyboard size={20} aria-hidden="true" /><strong>Enter figures</strong>
        <span>Type the numbers you know. Leave anything unknown blank — it&apos;s never treated as $0.</span></Link>
    </div>
    {paste && <div className="paste-box">
      <label className="field-label" htmlFor="paste-text">Paste the text</label>
      <textarea id="paste-text" rows={8} maxLength={20000} value={text} onChange={e => setText(e.target.value)}
        placeholder={intent === "offer" ? "Project name: Logo refresh\nProject fee: $5,000\nExpected payment: 2026-12-28" : "Net business profit YTD: $41,000\nMonthly premium: $520"} />
      <p className="hint">Headroom reads labeled lines such as “Project fee: $12,000”, “Expected payment: 2026-12-20” or “Payment received: $3,000”. Free-form emails need the document-analysis service, which isn&apos;t switched on in this version — anything not read stays for you to enter. The text is used only for this import.</p>
      <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => {
        try { sessionStorage.setItem(PASTED_KEY, text); } catch { /* storage blocked: continue with manual entry */ }
        router.push(`/check?${q}pasted=1`);
      }}>Read this text</button>
    </div>}
    <p className="muted small">Already have a plan? <Link className="text-link" href="/household">Open My plans</Link>.</p>
  </div>;
}
