"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { ChangeCommandSchema, type ChangeCommand } from "@/domain/assistance";
import type { HouseholdWorkspace, Project } from "@/domain/household-workspace";
import type { IntakeRequest, IntakeResult, ProposedOffer } from "@/domain/intake";
import { intakeOffer } from "@/lib/client/api";
import type { ClientResponse } from "@/lib/engine/assist/negotiation";
import { centsToInput, localCalendarDate, moneyExact, parseDollarsToCents, shortDate } from "@/features/format";
import { CommandReview, type LifecycleSaved } from "./CommandReview";

export type CounterofferReader = (request: IntakeRequest) => Promise<IntakeResult>;
type PaymentDraft = { id: string; amount: string; date: string; excerpt?: string; condition?: string | null };
const ResponseDraftSchema = z.object({ response: z.enum(["accepted", "rejected", "countered"]).nullable(), date: z.string(), price: z.string(),
  payments: z.array(z.object({ id: z.string(), amount: z.string(), date: z.string(), excerpt: z.string().optional(), condition: z.string().nullable().optional() })).max(6),
  text: z.string().max(8000), note: z.string().max(300), source: z.string().max(8000).optional(),
  priceFixed: z.boolean().optional(), latest: z.string().optional(), maxPayments: z.string().optional(), sourceIssue: z.string().nullable().optional() });

export function ClientResponsePanel({ ws, project, onSaved, onCancel, readCounteroffer = intakeOffer, initialResponse = null }: {
  ws: HouseholdWorkspace; project: Project; onSaved: LifecycleSaved; onCancel: () => void;
  readCounteroffer?: CounterofferReader; initialResponse?: "accepted" | "rejected" | "countered" | null;
}) {
  const expected = project.receipts.filter(l => !l.actual && !l.cancelledAt && l.expected);
  const received = project.receipts.filter(l => l.actual).reduce((sum, l) => sum + l.actual!.amountCents, 0);
  const [response, setResponse] = useState<"accepted" | "rejected" | "countered" | null>(initialResponse);
  const [date, setDate] = useState(localCalendarDate());
  const [price, setPrice] = useState("");
  const [payments, setPayments] = useState<PaymentDraft[]>(() => expected.map(l => ({ id: l.id, amount: centsToInput(l.expected!.amountCents), date: l.expected!.date })).slice(0, 6));
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceIssue, setSourceIssue] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>();
  const [command, setCommand] = useState<ChangeCommand | null>(null);
  const [note, setNote] = useState("");
  const [priceFixed, setPriceFixed] = useState(false);
  const [latest, setLatest] = useState("");
  const [maxPayments, setMaxPayments] = useState("");
  const [extraCommands, setExtraCommands] = useState<ChangeCommand[]>([]);
  const [responseLimits, setResponseLimits] = useState<ClientResponse["limits"]>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const prefix = `lc-response-${project.id}`;
  const storageKey = `headroom.lifecycle.response.${ws.id}.${project.id}`;
  const hasTerms = !!ws.dealPlanning?.termSpaces.some(space => space.projectId === project.id);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setSourceOpen(!window.matchMedia("(max-width: 800px)").matches); heading.current?.focus(); }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = ResponseDraftSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          const draft = parsed.data; setResponse(draft.response); setDate(draft.date); setPrice(draft.price);
          setPayments(draft.payments); setText(draft.text); setNote(draft.note); setSource(draft.source);
          setPriceFixed(draft.priceFixed ?? false); setLatest(draft.latest ?? ""); setMaxPayments(draft.maxPayments ?? "");
          setSourceIssue(draft.sourceIssue ?? null);
        }
      }
    } catch { setDraftStorageError(true); }
    setDraftLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (!draftLoaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ response, date, price, payments, text, note, source, priceFixed, latest, maxPayments, sourceIssue })); }
    catch { setDraftStorageError(true); }
  }, [storageKey, draftLoaded, response, date, price, payments, text, note, source, priceFixed, latest, maxPayments, sourceIssue]);

  function saved(next: HouseholdWorkspace, summary: string) {
    try { localStorage.removeItem(storageKey); } catch { /* Already saved by the workspace repository. */ }
    onSaved(next, summary);
  }

  function useOffer(offer: ProposedOffer) {
    if (offer.currency === "other") { setSourceIssue("This response is not in US dollars. Headroom cannot calculate these terms."); return; }
    if (offer.payments.length > 6) { setSourceIssue("This response has more than six payments. None were dropped. Enter a supported schedule with at most six remaining payments."); return; }
    if (offer.payments.some(p => p.status === "said_received")) {
      setSourceIssue("The message mentions money already received. Record that receipt first, then enter only the remaining counteroffer payments. No payment has been added."); return;
    }
    setPrice(centsToInput(offer.totalPrice?.amountCents ?? null));
    setPayments(offer.payments.map(p => ({ id: p.id, amount: centsToInput(p.amountCents), date: p.date ?? "", excerpt: p.excerpt, condition: p.condition })).slice(0, 6));
    setSource(text); setError(null); setSourceIssue(null);
  }

  async function read() {
    if (!readCounteroffer || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      const out = await readCounteroffer({ purpose: "counteroffer", text: text.trim(), userDate: localCalendarDate(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago", consentToProvider: consent,
        project: { projectId: project.id, title: project.title, openPayments: expected.map(l => ({ lineId: l.id, amountCents: l.expected!.amountCents, date: l.expected!.date })) } });
      setIntake(out);
      if (out.outcome !== "proposed" || !out.offers.length) setSourceIssue("No complete counteroffer was found. Keep the message and enter the terms below.");
      else if (out.offers.length === 1) useOffer(out.offers[0]);
      else setSourceIssue("Select the offer that belongs to this project before reviewing its terms.");
    } catch (e) { setError(`${e instanceof Error ? e.message : "The message could not be read."} Your text is kept. You can enter the terms below.`); }
    finally { setBusy(false); }
  }

  function review() {
    setError(null);
    if (!response) { setError("Choose what the client said."); return; }
    if (response === "countered" && sourceIssue) { setError(sourceIssue); return; }
    let counter: Extract<ChangeCommand, { type: "record_client_response" }>["counter"] = null;
    if (response === "countered") {
      const total = parseDollarsToCents(price);
      if (total === "invalid") { setError("Enter the total price in dollars, or leave it blank if the client did not state a total."); return; }
      const unpaid: Array<{ amountCents: number; date: string }> = [];
      for (const payment of payments) {
        const cents = parseDollarsToCents(payment.amount);
        if (typeof cents !== "number" || cents <= 0 || !payment.date) { setError("Confirm an amount and full date for every remaining payment. Unknown dates cannot be treated as agreed dates."); return; }
        unpaid.push({ amountCents: cents, date: payment.date });
      }
      if (!unpaid.length) { setError("Add at least one remaining payment in the counteroffer."); return; }
      if (total !== null && total !== received + unpaid.reduce((sum, p) => sum + p.amountCents, 0)) { setError("The total price must equal the remaining payments plus the amount already received. A deposit must not be counted twice."); return; }
      counter = { totalPriceCents: total, unpaid, note: note.trim() || null };
    }
    const parsed = ChangeCommandSchema.safeParse({ type: "record_client_response", projectId: project.id, response, respondedOn: date, packageId: null, counter });
    if (!parsed.success) { setError("Check the dates and amounts. Use full dates between January 1, 2026 and October 16, 2028."); return; }
    const extras: ChangeCommand[] = [];
    let limits: ClientResponse["limits"] = null;
    if (response === "countered" && counter && hasTerms && (priceFixed || latest || maxPayments)) {
      const fixedTotal = counter.totalPriceCents ?? received + counter.unpaid.reduce((sum, p) => sum + p.amountCents, 0);
      const maximum = maxPayments ? Number(maxPayments) : null;
      if (latest && counter.unpaid.some(p => p.date > latest) || maximum !== null && counter.unpaid.length > maximum) { setError("The client’s payment schedule conflicts with these limits. Confirm which dates and number of payments are correct."); return; }
      const change = ChangeCommandSchema.safeParse({ type: "change_terms", projectId: project.id, priceMinCents: priceFixed ? fixedTotal : null,
        priceMaxCents: priceFixed ? fixedTotal : null, latestPaymentDate: latest || null, maxPayments: maximum, newTermsConfirmed: true });
      if (!change.success) { setError("Check the negotiation limits: use a complete date and no more than four payments."); return; }
      extras.push(change.data); limits = { latestPaymentDate: latest || null, priceFixed, maxPayments: maximum };
    }
    setExtraCommands(extras); setResponseLimits(limits);
    setCommand(parsed.data);
  }

  return <section className="lc-panel lc-response" aria-labelledby={`${prefix}-title`} onKeyDown={e => { if (e.key === "Escape" && !busy && !command) { e.preventDefault(); onCancel(); } }}>
    <div className="lc-section-heading"><span className="lc-eyebrow">Keep the decision current</span><h4 id={`${prefix}-title`} tabIndex={-1} ref={heading}>What did the client say?</h4></div>
    <div className="lc-workbench">
      <aside className="lc-source"><details open={sourceOpen} onToggle={e => setSourceOpen(e.currentTarget.open)}><summary>Offer, current terms & history</summary><OfferHistory project={project} ws={ws} />
        {source && <details open><summary>Client reply under review</summary><blockquote className="lc-source-quote">{source}</blockquote></details>}
        {received > 0 && <p className="lc-kept"><strong>{moneyExact(received)} already received</strong><span>Stays recorded in every response.</span></p>}
      </details></aside>
      <div className="lc-main">
        {command ? <CommandReview ws={ws} command={command} additionalCommands={extraCommands} responseLimits={responseLimits} sourceText={source ?? note} onSaved={saved} onBack={() => setCommand(null)} />
          : <form onSubmit={e => { e.preventDefault(); review(); }}>
            <fieldset className="lc-choice"><legend>Record the client’s actual response</legend>
              {([['accepted', 'Accepted the current terms'], ['countered', 'Proposed different terms'], ['rejected', 'Declined the offer']] as const).map(([value, label]) => <label key={value}><input type="radio" name={`${prefix}-kind`} checked={response === value} onChange={() => { setResponse(value); setError(null); }} /><span><strong>{label}</strong></span></label>)}
            </fieldset>
            {response === "accepted" && <p className="lc-context">This records acceptance of the current project payments shown on the left. To accept a saved alternative, use that alternative’s “Client agreed” action instead.</p>}
            {response === "rejected" && <p className="lc-context">The unpaid project payments will be cancelled. The original offer, history and money already received stay. If agreed work creates a refund or cancellation cost, record that separately; it is not assumed to be free.</p>}
            {response === "countered" && <>
              <details className="lc-paste"><summary>Paste the client’s reply</summary>
                <label className="lc-field" htmlFor={`${prefix}-text`}>Client’s words<textarea id={`${prefix}-text`} maxLength={8000} rows={4} value={text} onChange={e => setText(e.target.value)} /></label>
                <label className="lc-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>Allow the AI service to read this reply and this project’s unpaid terms. Household income and other projects are not included.</span></label>
                <button type="button" className="btn secondary" disabled={!text.trim() || busy} onClick={() => void read()}>{busy ? "Reading the reply…" : "Read the terms"}</button>
                {intake && <p className="hint">{intake.providerStatus === "used" ? "AI-proposed terms. Check each amount and date before saving." : `The AI service was not used (${intake.providerStatus.replaceAll("_", " ")}). Review any recognized terms or enter them yourself.`}</p>}
                {intake && intake.offers.length > 1 && <fieldset className="lc-choice"><legend>The text contains more than one offer. Which belongs to this project?</legend>{intake.offers.map((o, i) => <button key={o.id} type="button" className="btn secondary" onClick={() => useOffer(o)}>{o.title ?? `Offer ${i + 1}`} {o.totalPrice?.amountCents !== null && o.totalPrice ? moneyExact(o.totalPrice.amountCents) : ""}</button>)}</fieldset>}
                {intake?.unsupported.map((u, i) => <p className="hint" key={i}>Not applied: “{u.excerpt}” — {u.reason}</p>)}
                {intake?.offers.some(o => o.costsStated) && <p className="hint">Project costs are not changed by recording this response. Update the cost lines separately if the client’s terms also change your costs.</p>}
                {sourceIssue && <div className="notice warn" role="status"><p>{sourceIssue}</p><button type="button" className="btn secondary" onClick={() => { setSourceIssue(null); setSource(undefined); setIntake(null); setPayments([]); setPrice(""); setError(null); }}>Enter US-dollar terms manually</button></div>}
              </details>
              <label className="lc-field" htmlFor={`${prefix}-price`}>Total project price ($) <small>Including money already received; leave blank if not stated.</small><input id={`${prefix}-price`} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
              <div className="lc-payment-heading"><h5>Only the payments still to come</h5><span>{received > 0 ? `${moneyExact(received)} already received is kept separately.` : "These are expected, not received."}</span></div>
              <div className="lc-payment-list">{payments.map((payment, i) => <div className="lc-payment" key={payment.id}>
                <strong className="lc-payment-number">{String(i + 1).padStart(2, "0")}</strong>
                <label htmlFor={`${prefix}-amount-${payment.id}`}>Amount ($)<input id={`${prefix}-amount-${payment.id}`} inputMode="decimal" value={payment.amount} onChange={e => setPayments(rows => rows.map(p => p.id === payment.id ? { ...p, amount: e.target.value } : p))} /></label>
                <label htmlFor={`${prefix}-date-${payment.id}`}>Full payment date<input id={`${prefix}-date-${payment.id}`} type="date" value={payment.date} onChange={e => setPayments(rows => rows.map(p => p.id === payment.id ? { ...p, date: e.target.value } : p))} min={localCalendarDate()} max="2028-10-16" /></label>
                <button type="button" className="btn ghost lc-remove" aria-label={`Remove remaining payment ${i + 1}`} onClick={() => setPayments(rows => rows.filter(p => p.id !== payment.id))}><Trash2 size={18} /></button>
                {payment.excerpt && <p className="lc-excerpt">Source: “{payment.excerpt}”{payment.condition ? ` · ${payment.condition}. Confirm the date above.` : ""}</p>}
              </div>)}</div>
              <button type="button" className="btn ghost" disabled={payments.length >= 6} onClick={() => setPayments(rows => [...rows, { id: crypto.randomUUID(), amount: "", date: "" }])}><Plus size={16} /> Add payment</button>
              <label className="lc-field" htmlFor={`${prefix}-note`}>Client’s conditions or a note <small>Optional. A note records context; it does not change the search limits automatically.</small><textarea id={`${prefix}-note`} rows={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
              {hasTerms && <details className="lc-paste"><summary>Limits for the next negotiation</summary><p className="hint">Only confirm limits the client actually stated. These change which alternatives Headroom may suggest.</p>
                <label className="lc-consent"><input type="checkbox" checked={priceFixed} onChange={e => setPriceFixed(e.target.checked)} /><span>The client’s total price is fixed.</span></label>
                <label className="lc-field" htmlFor={`${prefix}-latest`}>Latest date the client will allow <small>Leave blank to keep your saved limit.</small><input id={`${prefix}-latest`} type="date" value={latest} onChange={e => setLatest(e.target.value)} min={localCalendarDate()} max="2027-12-31" /></label>
                <label className="lc-field" htmlFor={`${prefix}-max`}>Maximum number of remaining payments<select id={`${prefix}-max`} value={maxPayments} onChange={e => setMaxPayments(e.target.value)}><option value="">Keep the saved limit</option>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
              </details>}
            </>}
            <label className="lc-field" htmlFor={`${prefix}-date`}>When did the client respond?<input id={`${prefix}-date`} type="date" value={date} onChange={e => setDate(e.target.value)} min="2026-01-01" max={localCalendarDate()} /></label>
            {error && <p className="notice warn" role="alert">{error}</p>}
            <p className="hint">{draftStorageError ? "This browser could not keep the draft. Keep this page open until you save the response." : "Your reply draft is kept in this browser until you save it. AI consent is requested separately."}</p>
            <div className="lc-actions"><button type="submit" className="btn primary" disabled={busy}>Review the response</button><button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button></div>
          </form>}
      </div>
    </div>
  </section>;
}

export function OfferHistory({ project, ws }: { project: Project; ws?: HouseholdWorkspace }) {
  const original = project.originalOffer;
  return <div className="lc-offer-history">
    <details open><summary>Original client offer</summary>{original ? <><strong className="lc-source-price">{moneyExact(original.priceCents)}</strong><ul>{original.payments.map((p, i) => <li key={i}><span>{moneyExact(p.amountCents)}</span><span>{shortDate(p.date)}</span></li>)}</ul><p className="hint">{original.confirmation === "captured" ? "Captured from the previously saved project." : "Confirmed when first entered."} Kept unchanged.</p></> : <p className="hint">The original offer was not recorded separately for this older project.</p>}</details>
    <div className="lc-current"><h5>{project.status === "agreed" ? "Current agreed payments" : "Current project payments"}</h5><ul>{project.receipts.filter(l => l.actual || !l.cancelledAt && l.expected).map(l => <li key={l.id}><span>{moneyExact(l.actual?.amountCents ?? l.expected?.amountCents)}</span><span>{shortDate(l.actual?.date ?? l.expected?.date)}<small>{l.actual ? "Received" : "Expected"}</small></span></li>)}</ul></div>
    {!!project.offerVersions?.length && <details><summary>Earlier terms · {project.offerVersions.length}</summary><ol className="lc-version-list">{[...project.offerVersions].reverse().map(v => <li key={v.version}><strong>{v.kind.replaceAll("_", " ")} · {v.status}</strong><span>{moneyExact(v.priceCents)} · {shortDate(v.recordedAt)}</span>{v.note && <p>{v.note}</p>}{v.source.sourceId && ws?.evidence.find(e => e.id === v.source.sourceId)?.label && <p className="lc-excerpt">Source: {ws.evidence.find(e => e.id === v.source.sourceId)!.label}</p>}</li>)}</ol></details>}
  </div>;
}
