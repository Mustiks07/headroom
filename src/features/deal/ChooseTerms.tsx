"use client";

import { useEffect, useMemo, useState } from "react";
import { Explain } from "@/features/assist/Explain";
import { CalendarDays, Check, Copy, Download, FileText } from "lucide-react";
import type { ActionPackage, DealVariant, ReadyDealSearch } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import {
  buildActionPackage, clientDraftFile, clientDraftNotes, currentSearchFingerprint, exportCalendarIcs, exportDecisionPdf, packageCurrency,
} from "@/lib/client/api";
import { humanizeDates, money, shortDate, signedMoney } from "@/features/format";
import { downloadBlob, fileStamp } from "@/features/plan/storage";

/**
 * Chosen terms → action package (Claude 3's builder and exports). Choosing here is not the client's
 * agreement; nothing is sent. The package is saved only with a fresh calculation.
 */
export function ChooseTerms({ ws, variant, result, onSave, onCancel }: {
  ws: HouseholdWorkspace; variant: DealVariant; result: ReadyDealSearch;
  onSave: (pkg: ActionPackage) => Promise<boolean>; onCancel: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const project = ws.projects.find(p => p.id === result.projectId);
  const preview = useMemo(() => { try { return { ok: true as const, pkg: buildActionPackage(ws, result, variant.id, { includeHouseholdDetails: details }) }; }
    catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; } }, [ws, result, variant.id, details]);
  useEffect(() => { let live = true; void currentSearchFingerprint(ws, result.goalId).then(fp => { if (live) setFresh(fp === result.searchFingerprint); }); return () => { live = false; }; }, [ws, result]);

  return <section id="choose-terms" className="plan-section changed" aria-labelledby="choose-title">
    <h2 id="choose-title" className="section-title small">Chosen terms for “{project?.title}”</h2>
    <p className="small"><strong>{humanizeDates(variant.label)}</strong> — ask {money(variant.terms.priceCents)} in total; {variant.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join(", ") || "no further payments"}.
      {" "}{signedMoney(variant.twoYearCashDeltaCents)} cash after both tax years {result.baseline.kind === "accept_as_offered" ? "vs. accepting as offered" : "vs. declining these terms"}.</p>
    {fresh === false && <p className="stale-banner" role="status">Your plan changed since these terms were calculated. Search again before saving them.</p>}
    {!preview.ok ? <p className="notice warn">{preview.error}</p> : <>
      <ClientDraftView draft={preview.pkg.clientDraft} notes={clientDraftNotes(variant)} details={details} onDetails={setDetails} />
      <RemindersView pkg={preview.pkg} />
    </>}
    {error && <p className="notice warn" role="alert">{error}</p>}
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={!preview.ok || fresh !== true || busy} onClick={async () => {
        if (!preview.ok) return; setBusy(true); setError(null);
        const ok = await onSave(preview.pkg); if (!ok) setError("The terms weren't saved. Your choice is kept here — try again."); setBusy(false);
      }}>{busy ? "Saving…" : "Save these terms to my plan"}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Back to the options</button>
    </div>
    <p className="hint">Saving keeps the message, reminders and the calculation with your plan. Nothing is sent to your client, and it doesn&apos;t count as the client agreeing.</p>
  </section>;
}

function ClientDraftView({ draft, notes, details, onDetails }: { draft: ActionPackage["clientDraft"]; notes: string[]; details?: boolean; onDetails?: (v: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  if (!draft) return null;
  const text = `Subject: ${draft.subject}\n\n${draft.body}`;
  return <div className="client-draft">
    <h3 className="small-head">Message to your client (draft)</h3>
    <textarea readOnly value={text} rows={Math.min(14, text.split("\n").length + 1)} aria-label="Draft message to your client" />
    <div className="row gap wrap">
      <button type="button" className="btn small ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}><Copy size={14} /> {copied ? "Copied" : "Copy"}</button>
      <button type="button" className="btn small ghost" onClick={() => downloadBlob(clientDraftFile(draft), `message-to-client-${fileStamp()}.txt`)}><Download size={14} /> Download .txt</button>
      {onDetails && <label className="check small"><input type="checkbox" checked={!!details} onChange={e => onDetails(e.target.checked)} />Add a general reason (no amounts about our household)</label>}
    </div>
    <ul className="bullets small muted">{notes.map(n => <li key={n}>{n}</li>)}</ul>
  </div>;
}

function RemindersView({ pkg, onToggle }: { pkg: ActionPackage; onToggle?: (uid: string, done: boolean) => void }) {
  if (!pkg.reminders.length) return null;
  return <div><h3 className="small-head">Your next actions</h3>
    <ul className="checklist">{pkg.reminders.map(r => <li key={r.uid} className={r.status === "done" ? "done" : ""}>
      <div className="check-body"><p className="check-title">{humanizeDates(r.title)}</p>
        <p className="muted small">{r.date ? `By ${shortDate(r.date)}` : humanizeDates(r.condition ?? "No fixed date")}{r.status === "cancelled" ? " · cancelled" : ""}</p>
        {onToggle && r.status !== "cancelled" && <button type="button" className="link-btn" onClick={() => onToggle(r.uid, r.status !== "done")}>{r.status === "done" ? "Mark as not done" : "Mark as done"}</button>}</div>
    </li>)}</ul></div>;
}

const STATUS_TEXT: Record<ActionPackage["status"], string> = {
  draft: "Chosen in Headroom — not shared yet", terms_shared_by_user: "You shared these terms with the client", client_agreed: "You recorded the client's agreement", superseded: "Replaced by a newer choice",
};

/** A saved package: status steps, exports, reminders. Stays visible after reload. */
export function PackageCard({ ws, pkg, onShared, onAgreed, onReminder, onNotice }: {
  ws: HouseholdWorkspace; pkg: ActionPackage;
  onShared: () => void; onAgreed: () => void; onReminder: (uid: string, done: boolean) => void; onNotice: (tone: "ok" | "warn", text: string) => void;
}) {
  const [currency, setCurrency] = useState<{ current: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const project = ws.projects.find(p => p.id === pkg.projectId);
  useEffect(() => { let live = true; void packageCurrency(ws, pkg).then(c => { if (live) setCurrency(c); }); return () => { live = false; }; }, [ws, pkg]);
  const v = pkg.variant;
  async function exp(kind: "pdf" | "ics") {
    setBusy(kind);
    try {
      const blob = kind === "pdf" ? await exportDecisionPdf(ws, pkg.id) : await exportCalendarIcs(ws, pkg.id);
      downloadBlob(blob, kind === "pdf" ? `headroom-decision-${fileStamp()}.pdf` : `headroom-actions-${fileStamp()}.ics`);
      onNotice("ok", kind === "pdf" ? "Decision summary downloaded." : "Calendar file downloaded. Importing it again updates the same events.");
    } catch (e) { onNotice("warn", `The ${kind === "pdf" ? "PDF" : "calendar file"} couldn't be created: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  }
  const usable = currency?.current === true;
  return <article className={`package status-${pkg.status}`} aria-labelledby={`pkg-${pkg.id}`}>
    <header className="project-head"><div>
      <h3 id={`pkg-${pkg.id}`}>{project?.title}: {humanizeDates(v.label)}</h3>
      <p className="muted small">Ask {money(v.terms.priceCents)} · {v.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join(", ") || "no further payments"} · {signedMoney(v.twoYearCashDeltaCents)} after both tax years{v.retirementAddedCents ? ` · +${money(v.retirementAddedCents)} retirement` : ""}</p>
    </div><span className={`pill ${pkg.status === "client_agreed" ? "good" : "neutral"}`}>{STATUS_TEXT[pkg.status]}</span></header>
    {currency && !currency.current && pkg.status !== "client_agreed" && <p className="notice warn small">{currency.reason}</p>}
    {currency && !currency.current && pkg.status === "client_agreed" && <p className="hint">These were the terms as calculated when agreed. Your plan has changed since — see “Your plan as agreed” for how they work on today&apos;s figures.</p>}
    <ol className="steps-line" aria-label="Progress">
      <li className="on"><Check size={13} aria-hidden="true" /> Chosen</li>
      <li className={pkg.status !== "draft" ? "on" : ""}>{pkg.status !== "draft" ? <Check size={13} aria-hidden="true" /> : null} Shared with the client</li>
      <li className={pkg.status === "client_agreed" ? "on" : ""}>{pkg.status === "client_agreed" ? <Check size={13} aria-hidden="true" /> : null} Client agreed</li>
    </ol>
    <div className="row gap wrap">
      {pkg.status === "draft" && <button type="button" className="btn small secondary" onClick={onShared}>I sent these terms to the client</button>}
      {(pkg.status === "draft" || pkg.status === "terms_shared_by_user") && <button type="button" className="btn small primary" disabled={!usable} onClick={() => {
        if (window.confirm(`Record that the client agreed to these terms? Your plan will use them: ${v.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join(", ")}.`)) onAgreed(); }}>The client agreed</button>}
      <button type="button" className="btn small ghost" disabled={!usable || busy === "pdf"} onClick={() => void exp("pdf")}><FileText size={14} /> {busy === "pdf" ? "Preparing…" : "Decision summary (PDF)"}</button>
      <button type="button" className="btn small ghost" disabled={!usable || busy === "ics"} onClick={() => void exp("ics")}><CalendarDays size={14} /> Calendar (.ics)</button>
    </div>
    {pkg.status === "client_agreed" && !usable && <p className="hint">The dated decision record and the calendar of current actions are under “Decisions and calendar” below.</p>}
    {!usable && currency && pkg.status !== "client_agreed" && <p className="hint">Exports and agreement need a current calculation. Open “Find terms for my goal” and search again.</p>}
    <details className="explain"><summary>Message to your client and next actions</summary>
      <ClientDraftView draft={pkg.clientDraft} notes={clientDraftNotes(v)} />
      <RemindersView pkg={pkg} onToggle={onReminder} />
    </details>
    {pkg.status === "client_agreed"
      ? <Explain ws={ws} subject="agreed_plan" refId={pkg.projectId} label="How the agreed terms work on today's figures" />
      : <Explain ws={ws} subject="deal_choice" refId={pkg.id} label="Why this option?" />}
  </article>;
}
