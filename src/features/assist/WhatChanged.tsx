"use client";

import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { AssistanceRequest, ChangeCommand, ChangeProposal } from "@/domain/assistance";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { engineWorkspaceFingerprint, previewChange, type EngineChangePreview } from "@/lib/engine";
import {
  CommandError, answerAmbiguity, buildAssistanceContext, commitProposal, getCapabilities, proposeChange, trackEvent,
} from "@/lib/client/api";
import { humanizeDates, money, shortDate, signedMoney } from "@/features/format";
import { workspaceRepo } from "@/features/household-plan/store";

const EXAMPLES = [
  "The final payment will arrive on January 8, 2027",
  "I received $3,200 today for the bakery project",
  "I contributed $1,500 to my 2026 SEP",
];

type State =
  | { kind: "idle" }
  | { kind: "proposing" }
  | { kind: "proposal"; request: AssistanceRequest; proposal: ChangeProposal; providerUsed: boolean; notes: string[]; preview: EngineChangePreview | { status: "blocked"; message: string } | null }
  | { kind: "error"; message: string };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * "What changed?" — the user's words become a typed proposal (Claude 3: patterns or, with consent,
 * the provider); Claude 2's engine previews it on a copy; nothing is saved until Apply, which
 * commits ONE revision. Retrying the same proposal adds nothing.
 */
export function WhatChanged({ ws, onSaved, onNotice, dataKind }: {
  ws: HouseholdWorkspace; onSaved: (saved: HouseholdWorkspace, summary: string) => void; onNotice: (tone: "ok" | "warn", text: string) => void; dataKind: "sample" | "own";
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [aiText, setAiText] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getCapabilities().then(c => setAiText(!!(c as { aiTextProposals?: boolean }).aiTextProposals)); }, []);

  async function preview(proposal: ChangeProposal) {
    if (proposal.ambiguities.length || !proposal.commands.length) return null;
    const p = await previewChange(ws, proposal, { userDate: today() });
    return "proposalId" in p ? p : { status: "blocked" as const, message: p.message };
  }

  async function propose() {
    if (!text.trim()) return;
    setState({ kind: "proposing" }); setAnswers({});
    const request: AssistanceRequest = { intent: "update", text: text.trim().slice(0, 4000), userDate: today(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
      base: { workspaceId: ws.id, revision: ws.revision, fingerprint: await engineWorkspaceFingerprint(ws) }, context: buildAssistanceContext(ws) };
    try {
      const r = await proposeChange(request, { consentToProvider: aiText && consent });
      setState({ kind: "proposal", request, proposal: r.proposal, providerUsed: r.providerUsed, notes: r.notes, preview: await preview(r.proposal) });
    } catch (e) {
      void trackEvent("provider_failure", { dataKind, inputPath: consent ? "provider" : "paste" });
      setState({ kind: "error", message: `${e instanceof Error ? e.message : String(e)} Your text is kept — try again or change the figures directly below.` });
    }
  }

  async function resolve() {
    if (state.kind !== "proposal") return;
    const next = answerAmbiguity(state.request, state.proposal, answers);
    setState({ ...state, proposal: next, preview: await preview(next) });
  }

  async function apply() {
    if (state.kind !== "proposal") return;
    setBusy(true);
    try {
      const out = await commitProposal(workspaceRepo(), ws, state.proposal);
      const saved = out.saved;
      void trackEvent("proposal_confirmed", { dataKind, inputPath: state.providerUsed ? "provider" : "paste" });
      if (saved) onSaved(saved, out.alreadyApplied ? "This change was already saved — nothing was added twice." : "Change saved as a new revision. Figures below are recalculated.");
      setState({ kind: "idle" }); setText("");
    } catch (e) {
      const code = e instanceof CommandError ? e.code : null;
      onNotice("warn", code === "PROPOSAL_STALE" ? "Your plan changed since this proposal was made. Check it again before applying." : `The change wasn't saved: ${e instanceof Error ? e.message : String(e)}`);
      if (code === "PROPOSAL_STALE") setState({ kind: "idle" });
    }
    setBusy(false);
  }

  const p = state.kind === "proposal" ? state : null;
  const pv = p?.preview && "proposalId" in p.preview ? p.preview : null;
  return <section className="plan-section what-changed" id="what-changed" aria-labelledby="wc-title">
    <h2 id="wc-title" className="section-title small"><MessageSquareText size={18} aria-hidden="true" /> What changed?</h2>
    <p className="muted small">Say it in a sentence. Headroom shows exactly what it would change and what that does to your plan — nothing is saved until you apply it.</p>
    <div className="examples">{EXAMPLES.map(x => <button key={x} type="button" className="chip-btn" onClick={() => setText(x)}>{x}</button>)}</div>
    <label className="visually-hidden" htmlFor="wc-text">What changed</label>
    <textarea id="wc-text" rows={2} maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. The client moved the last payment to January 8, 2027" />
    {aiText && <label className="check small"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Let the AI service read this sentence (only the sentence and project names are sent).</label>}
    {!aiText && <p className="hint">Headroom understands common updates (a moved payment, a payment received, a SEP-IRA contribution, a new offer). The AI service for other wording isn&apos;t switched on in this version.</p>}
    <div className="row gap"><button type="button" className="btn primary small" disabled={!text.trim() || state.kind === "proposing"} onClick={() => void propose()}>{state.kind === "proposing" ? "Reading…" : "Show the change"}</button></div>
    {state.kind === "error" && <p className="notice warn" role="alert">{state.message}</p>}

    {p && <div className="proposal" aria-live="polite">
      {p.proposal.commands.length === 0 && !p.proposal.ambiguities.length && <p className="notice warn">Headroom couldn&apos;t turn this into a change it can make. Try one of the examples, or change the figures directly below.{p.notes.length ? ` ${p.notes.join(" ")}` : ""}</p>}
      {p.proposal.commands.length > 0 && <><h3 className="small-head">Headroom would</h3>
        <ul className="bullets small">{p.proposal.commands.map((c, i) => <li key={i}>{describe(c, ws)}</li>)}</ul></>}
      {p.proposal.resolvedDates.length > 0 && <p className="hint">Dates read as: {p.proposal.resolvedDates.map(d => `“${d.phrase}” = ${shortDate(d.date)}`).join("; ")}.</p>}
      {p.proposal.ambiguities.length > 0 && <div className="ambiguities">
        {p.proposal.ambiguities.map(a => <fieldset key={a.id} className="tri"><legend className="field-label">{humanizeDates(a.question)}</legend>
          <div className="seg small">{a.options.map(o => <label key={o.id} className={answers[a.id] === o.id ? "on" : ""}>
            <input type="radio" name={`amb-${a.id}`} checked={answers[a.id] === o.id} onChange={() => setAnswers({ ...answers, [a.id]: o.id })} />{humanizeDates(o.label)}</label>)}</div></fieldset>)}
        <button type="button" className="btn small secondary" disabled={p.proposal.ambiguities.some(a => !answers[a.id])} onClick={() => void resolve()}>Use these answers</button>
      </div>}
      {p.preview && "status" in p.preview && p.preview.status === "blocked" && <p className="notice warn">{p.preview.message}</p>}
      {pv && <PreviewView pv={pv} />}
      <div className="row gap wrap">
        <button type="button" className="btn primary" disabled={busy || !pv || pv.status !== "ready" || p.proposal.ambiguities.length > 0} onClick={() => void apply()}>{busy ? "Saving…" : "Apply"}</button>
        <button type="button" className="btn ghost" onClick={() => setState({ kind: "idle" })}>Edit</button>
        <button type="button" className="btn ghost" onClick={() => { setState({ kind: "idle" }); setText(""); }}>Cancel</button>
      </div>
    </div>}
  </section>;
}

function PreviewView({ pv }: { pv: EngineChangePreview }) {
  return <div className="preview">
    {pv.changes.length > 0 && <div className="table-wrap"><table className="years-table compact"><caption>What changes</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
      <tbody>{pv.changes.map((c, i) => <tr key={i}><th scope="row">{humanizeDates(c.label)}</th><td>{c.before ? humanizeDates(c.before) : "—"}</td><td><strong>{humanizeDates(c.after)}</strong></td></tr>)}</tbody></table></div>}
    {pv.years.some(y => y.before || y.after) && <div className="table-wrap"><table className="years-table compact"><caption>What it does to your plan</caption>
      <thead><tr><th scope="col">Year</th><th scope="col">Subsidy now → after</th><th scope="col">Settled when you file</th><th scope="col">Cash after settlement</th></tr></thead>
      <tbody>{pv.years.map(y => <tr key={y.year}><th scope="row">{y.year}</th>
        <td className="num">{y.before ? money(y.before.subsidyCents) : "—"} → <strong>{y.after ? money(y.after.subsidyCents) : "—"}</strong></td>
        <td className="num">{y.before ? settle(y.before.settlementCents) : "—"} → {y.after ? settle(y.after.settlementCents) : "—"}</td>
        <td className="num">{y.before && y.after ? signedMoney(y.after.spendableCents - y.before.spendableCents) : "—"}</td></tr>)}</tbody></table></div>}
    {pv.agreedChecks.filter(a => a.after && !a.after.met).map(a => <p key={a.projectId} className="notice warn small">After this change, the terms you agreed for this project no longer meet your goal.</p>)}
    {pv.staleDependencies.length > 0 && <ul className="bullets small">{pv.staleDependencies.map(d => <li key={d.kind + d.id}>{humanizeDates(d.reason)}</li>)}</ul>}
    {pv.noOps.length > 0 && <p className="hint">Already in your plan — nothing is added twice.</p>}
    {pv.blockers.length > 0 && <ul className="bullets small warn-text">{pv.blockers.map(b => <li key={b.path}>{humanizeDates(b.reason)}</li>)}</ul>}
    {pv.notes.length > 0 && <ul className="bullets small muted">{pv.notes.map(n => <li key={n}>{humanizeDates(n)}</li>)}</ul>}
  </div>;
}

const settle = (c: number) => (c === 0 ? "none" : c > 0 ? `repay ${money(c)}` : `extra ${money(-c)}`);

function describe(c: ChangeCommand, ws: HouseholdWorkspace): string {
  const proj = (id: string) => ws.projects.find(p => p.id === id);
  const line = (pid: string, lid: string) => proj(pid)?.receipts.find(l => l.id === lid) ?? proj(pid)?.expenses.find(l => l.id === lid);
  const who = (id: string | null) => !id ? "someone (to choose)" : ws.household.people.find(p => p.id === id)?.role === "spouse" ? "your spouse" : "you";
  switch (c.type) {
    case "update_expected_payment": { const l = line(c.projectId, c.lineId);
      return `Change the expected ${l?.label ?? "payment"} of “${proj(c.projectId)?.title}”${l?.expected ? ` (${money(l.expected.amountCents)} on ${shortDate(l.expected.date)})` : ""} to ${[c.newAmountCents !== null ? money(c.newAmountCents) : null, c.newDate ? shortDate(c.newDate) : null].filter(Boolean).join(" on ")}`; }
    case "record_receipt": return `Record ${money(c.amountCents)} received on ${shortDate(c.date)} for “${proj(c.projectId)?.title}” (it replaces the expected amount)`;
    case "record_sep_contribution": return `Record a ${c.taxYear} SEP-IRA contribution of ${money(c.amountCents)} paid on ${shortDate(c.paidDate)} by ${who(c.personId)}`;
    case "add_offered_project": return `Add the offer “${c.title}”${c.totalPriceCents ? ` for ${money(c.totalPriceCents)} in total` : ""}${c.unpaid.length ? `, payments ${c.unpaid.map(u => `${money(u.amountCents)} on ${shortDate(u.date)}`).join(", ")}` : ""}`;
    case "correct_fact": return `Correct a recorded figure to ${money(c.amountCents)}${c.date ? ` on ${shortDate(c.date)}` : ""} (${c.reason})`;
    case "update_forecast": return `Update ${who(c.personId)}'s ${c.year} profit figure to ${money(c.amountCents)} (${c.status === "confirmed" ? "final" : "estimate"})`;
    case "change_goal": return `Change the goal for “${proj(c.projectId)?.title}”`;
    case "change_terms": return `Change the allowed terms for “${proj(c.projectId)?.title}”`;
  }
}
