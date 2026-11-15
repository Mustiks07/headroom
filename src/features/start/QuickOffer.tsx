"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OnboardingDraft, ProposedOffer, TypedAnswer, UnresolvedField } from "@/domain/intake";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { answerQuestion, draftFromIntake, intakeOffer, loadOnboardingDraft, onboardingToWorkspace, openQuestions, questionsForOffers, saveOnboardingDraft, trackEvent } from "@/lib/client/api";
import { blankDraft, buildCaseInput, personName, restoreDraft, type Draft } from "@/features/household/draft";
import { HouseholdBasics, type Update } from "@/features/household/editors";
import { InvalidInputsProvider } from "@/features/household/invalidInputs";
import { newId, workspaceFromCase } from "@/features/household-plan/ops";
import { workspaceRepo } from "@/features/household-plan/store";
import { parseAmount } from "@/features/household-plan/parts";
import { localCalendarDate, money, shortDate } from "@/features/format";
import { PASTED_KEY } from "./StartChooser";
import { MoneyField } from "@/components/MoneyField";

function emptyOnboarding(): OnboardingDraft {
  const at = new Date().toISOString();
  return { draftVersion: "1.0", id: newId("intake"), createdAt: at, updatedAt: at, text: null, intake: null, offers: [], selectedOfferId: null,
    facts: [], questions: [], answers: [], profileDraft: null, status: "collecting", convertedWorkspaceId: null };
}
function manualOffer(): ProposedOffer {
  return { id: newId("offer"), title: null, currency: "USD", totalPrice: null, payments: [], costs: [], costsStated: false,
    taxYearStated: null, negotiable: { price: null, schedule: null } };
}
const PROVIDER_NOTE: Record<string, string> = {
  used: "AI read the text you approved. Review each proposed fact below.",
  not_consented: "Read with built-in rules. Your offer was not sent to an AI provider.",
  disabled: "AI reading is unavailable. Built-in reading was used; check the extracted terms.",
  quota: "AI reading reached its usage limit. Built-in reading was used; your text is kept.",
  timeout: "AI reading timed out. Built-in reading was used; your text is kept.",
  refused: "AI could not read this message. Review the built-in reading or enter the terms.",
  invalid_output: "AI did not return usable terms. Review the built-in reading or enter the terms.",
  unavailable: "AI reading could not be reached. Built-in reading was used; your text is kept.",
};

/** An incomplete, reloadable intake. Only household identity is needed before a plan can ask scoped questions. */
export function QuickOffer({ importMode, intent = "offer", initialHouseholdId }: { importMode?: "doc" | "pasted"; intent?: "offer" | "income"; initialHouseholdId?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(emptyOnboarding);
  const [profile, setProfile] = useState<Draft>(blankDraft);
  const [text, setText] = useState("");
  const profileOnly = importMode === "doc" || intent === "income";
  const [step, setStep] = useState<"source" | "review" | "household">(profileOnly ? "household" : "source");
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [existing, setExisting] = useState<HouseholdWorkspace[]>([]);
  const [existingId, setExistingId] = useState(initialHouseholdId ?? "");
  const [owner, setOwner] = useState("primary");
  const [problems, setProblems] = useState<Array<{ path: string; reason: string }>>([]);
  const [keepText, setKeepText] = useState(true);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    const old = loadOnboardingDraft();
    let pasted: string | null = null;
    try { if (importMode === "pasted") pasted = sessionStorage.getItem(PASTED_KEY); } catch { /* storage unavailable */ }
    if (old?.status === "collecting") {
      setDraft(old); const p = restoreDraft(old.profileDraft); if (p) setProfile(p);
      setText(pasted ?? old.text ?? ""); setStep(profileOnly ? "household" : pasted ? "source" : old.offers.length ? "review" : "source");
      setNotice("Your unfinished offer and answers were restored in this browser.");
    } else setText(pasted ?? "");
    setLoaded(true);
    void workspaceRepo().list().then(list => setExisting(list.filter(w => !w.household.isSynthetic)), () => {});
  }, [importMode, profileOnly]);
  useEffect(() => {
    if (!loaded) return;
    // Never truncate a pasted offer silently: keep over-limit text on screen, do not persist an invalid draft.
    if (text.length > 8000) { setStorageOk(false); return; }
    setStorageOk(saveOnboardingDraft({ ...draft, profileDraft: profile, text: keepText ? text : null }));
  }, [draft, profile, text, loaded, keepText]);
  const offer = draft.offers.find(o => o.id === draft.selectedOfferId) ?? draft.offers[0];
  const chosenHousehold = existing.find(w => w.id === existingId);
  const people = chosenHousehold?.household.people ?? profile.people;
  const sepYears = profileOnly ? [2026] : [...new Set([...(offer?.payments.map(p => Number(p.date?.slice(0, 4))) ?? []), ...(offer?.costs.map(c => Number(c.date?.slice(0, 4))) ?? [])].filter(y => y === 2026 || y === 2027))];
  const update: Update = fn => setProfile(old => { const next = structuredClone(old); fn(next); return next; });
  const questions = openQuestions(draft).filter(q => !offer || q.subject.ref === offer.id || offer.payments.some(p => p.id === q.subject.ref) || offer.costs.some(c => c.id === q.subject.ref));
  const unresolved = questions.filter(q => q.blocking || q.subject.field === "costs");
  const totalMatches = !offer?.totalPrice?.amountCents || offer.payments.reduce((sum, p) => sum + (p.amountCents ?? 0), 0) === offer.totalPrice.amountCents;
  const readyOffer = !!offer && offer.currency === "USD" && offer.costsStated && !!offer.payments.length && !unresolved.length && totalMatches && offer.payments.every(p => p.amountCents && p.date);

  function updateOffer(fn: (o: ProposedOffer) => void) {
    setDraft(old => { const next = structuredClone(old); const o = next.offers.find(o => o.id === next.selectedOfferId) ?? next.offers[0]; if (o) fn(o);
      next.questions = questionsForOffers(next.offers, next.id);
      // Editing a previously answered date/amount reopens that exact question instead of hiding it behind an old answer.
      next.answers = next.answers.filter(a => !next.questions.some(q => q.id === a.fieldId && q.kind !== "choice")); return next; });
  }
  function beginManual() {
    const o = manualOffer(); setDraft(old => ({ ...old, offers: [o], selectedOfferId: o.id, intake: { provenance: "manual", providerStatus: "not_consented" },
      questions: questionsForOffers([o], old.id), answers: [] })); setStep("review"); setError(null);
  }
  async function read() {
    if (!text.trim() || text.length > 8000) { setError(text.length > 8000 ? "This reader accepts up to 8,000 characters. Shorten the message; your full text is kept here." : "Paste the offer first, or enter the figures below."); return; }
    setBusy(true); setError(null);
    try {
      const result = await intakeOffer({ purpose: "first_offer", text, userDate: localCalendarDate(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago", consentToProvider: consent, project: null });
      setDraft(draftFromIntake(result, keepText ? text : null, draft)); setNotes([...result.notes, ...result.unsupported.map(u => `${u.excerpt}: ${u.reason}`)]);
      if (result.outcome === "proposed") { setStep("review"); try { sessionStorage.removeItem(PASTED_KEY); } catch { /* no storage */ } }
      else setError(result.outcome === "unsupported_input" ? "This message includes terms Headroom cannot calculate. Review the notes or enter a supported USD offer." : "No clear offer terms were found. Your text is kept; enter the figures below.");
    } catch (e) { setError(`${e instanceof Error ? e.message : String(e)} Your text is kept.`); }
    setBusy(false);
  }
  async function create() {
    setError(null);
    if (!profileOnly && !readyOffer) { setStep("review"); setError("Confirm the open offer questions, including its costs, before continuing."); return; }
    const built = buildCaseInput(profile, "risk");
    if (!chosenHousehold && !built.ok) { setProblems(built.problems); return; }
    if (!chosenHousehold && profile.years.some(y => sepYears.includes(y.year) && y.incomes.some(i => i.existingSepContribution.valueCents === null))) {
      setError("Confirm the SEP-IRA amount for each person below. Enter 0 only if none is already contributed or planned; the draft stays here if you don't know yet."); return;
    }
    const selectedOwner = people.some(p => p.id === owner && p.role !== "dependent") ? owner : people.find(p => p.role !== "dependent")!.id;
    setBusy(true);
    try {
      const onboarding = profileOnly ? { ...draft, offers: [], selectedOfferId: null } : draft;
      const out = await onboardingToWorkspace(onboarding,
        () => chosenHousehold ? structuredClone(chosenHousehold) : workspaceFromCase(built.ok ? built.input : (() => { throw new Error("Household details are incomplete."); })(), profile.ui.forecasts ?? [], false),
        { userDate: localCalendarDate(), ownerPersonId: selectedOwner });
      if (out.conversion.status !== "converted" || !out.workspace) {
        if (out.conversion.status === "needs_answers") { const needed = out.conversion.questions; setDraft(d => ({ ...d, questions: [...d.questions.filter(q => !needed.some(x => x.id === q.id)), ...needed] })); setStep("review"); }
        else if (out.conversion.status === "invalid") setError(`${out.conversion.message} ${out.conversion.fields.map(f => f.reason).join(" ")}`);
        setBusy(false); return;
      }
      const saved = await workspaceRepo().save(out.workspace, chosenHousehold?.revision ?? null);
      saveOnboardingDraft({ ...draft, status: "converted", convertedWorkspaceId: saved.id, text: null, profileDraft: profile });
      void trackEvent("plan_saved", { dataKind: "own", inputPath: draft.intake?.provenance === "manual" ? "manual" : "paste" });
      router.push(`/household/${encodeURIComponent(saved.id)}?saved=1${out.conversion.projectId ? `&offer=${encodeURIComponent(out.conversion.projectId)}` : ""}${importMode === "doc" ? "#document-facts" : intent === "income" ? "" : "#offer-answer"}`);
    } catch (e) { setError(`The plan couldn't be saved: ${e instanceof Error ? e.message : String(e)} Your draft and answers are kept.`); }
    setBusy(false);
  }
  if (!loaded) return <div className="offer-entry"><p className="loading-line" role="status">Opening your offer…</p></div>;
  return <div className="offer-entry">
    <p className="flow-step"><strong>{step === "source" ? "1 · Your offer" : step === "review" ? "2 · Confirm the terms" : profileOnly ? "Your household" : "3 · Your household"}</strong> → A useful answer → Your next move</p>
    <div className="work-heading"><h1>{step === "source" ? "Start with the offer." : step === "review" ? "Let’s get the facts right." : "A little context. Then your answer."}</h1>
      <p>{step === "source" ? "Paste the client's words or enter the terms yourself." : step === "review" ? "Check what was written. Resolve only what's missing." : importMode === "doc" ? "Choose the household for your documents. You'll review every proposed fact before applying it." : intent === "income" ? "Check this year's subsidy using your income forecast. You don't need a client offer or next year's figures." : "Your household determines the tax and insurance effect. Remaining money facts can stay unknown for now."}</p></div>
    {notice && <p className="notice ok" role="status">{notice} <button className="link-btn" type="button" onClick={() => setNotice(null)}>Dismiss</button></p>}
    {!storageOk && <p className="notice warn" role="status">This draft could not be saved in the browser. Keep this page open while you finish.{text.length > 8000 ? " Shorten the text to enable saving." : ""}</p>}
    {error && <p className="notice warn" role="alert">{error}</p>}
    {step === "source" && <div className="offer-entry-grid"><aside className="offer-source"><h2>Your words become reviewable facts.</h2><p>Price, dates and costs stay separate. Headroom never sends a reply to the client.</p><Link href="/check">Just check my year&apos;s income</Link></aside>
      <div className="offer-review"><label htmlFor="intake-text">Client offer or project description</label><textarea id="intake-text" rows={8} value={text} onChange={e => setText(e.target.value)} aria-describedby="intake-limit" placeholder="Paste the email, including the price and payment terms…" />
        <p className="field-help" id="intake-limit">{text.length.toLocaleString()} / 8,000 characters. Remove account numbers and other private details.</p>
        <label className="check small"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Allow the AI service to read this message to identify the offer terms.</label>
        <label className="check small"><input type="checkbox" checked={keepText} onChange={e => setKeepText(e.target.checked)} />Keep the original text in this browser while I finish.</label>
        <div className="flow-actions"><button className="btn primary" type="button" disabled={busy || !text.trim()} onClick={() => void read()}>{busy ? "Reading your offer…" : "Read my offer"}</button><button className="btn secondary" type="button" onClick={beginManual}>Enter the figures</button></div>
        {!!notes.length && <ul className="bullets small">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div></div>}
    {step === "review" && offer && <div className="offer-entry-grid"><aside className="offer-source"><h2>Source</h2>
      {draft.intake?.provenance !== "manual" && <p className="small">{PROVIDER_NOTE[draft.intake?.providerStatus ?? "not_consented"]}</p>}
      {text ? <details open><summary>View original offer</summary><blockquote>{text}</blockquote></details> : <p>Terms entered by you. No AI reading was used.</p>}
      <button className="btn ghost" type="button" onClick={() => setStep("source")}>Edit source text</button>
      {!!notes.length && <details><summary>What was read or left out</summary><ul className="bullets small">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
      <p className="hint">Nothing becomes a saved project until you confirm the household and continue.</p></aside>
      <div className="offer-review">
        {draft.offers.length > 1 && <div className="field"><label htmlFor="selected-offer">Which offer first?</label><select id="selected-offer" value={offer.id} onChange={e => setDraft(d => ({ ...d, selectedOfferId: e.target.value }))}>{draft.offers.map(o => <option key={o.id} value={o.id}>{o.title ?? "Untitled offer"}</option>)}</select></div>}
        <div className="field"><label htmlFor="offer-name">Project name</label><input id="offer-name" value={offer.title ?? ""} maxLength={200} onChange={e => updateOffer(o => { o.title = e.target.value || null; })} placeholder="Name this project" /></div>
        {offer.currency !== "USD" && <p className="notice warn">Only USD offers are supported. The source currency cannot be assumed.</p>}
        {offer.totalPrice && <p>Total as written: <strong>{money(offer.totalPrice.amountCents)}</strong> <span className="muted small">{offer.totalPrice.asWritten}</span></p>}
        {offer.payments.map(p => <div className="payment-edit" key={p.id}><div><strong>{money(p.amountCents)}</strong><p className="field-help">{p.status === "said_received" ? "Said to be received — confirm below" : "Expected payment"}</p></div><div>{p.date ? shortDate(p.date) : "Date not specified"}<p className="field-help">{p.condition}</p></div><button type="button" className="btn ghost" onClick={() => updateOffer(o => { const line = o.payments.find(x => x.id === p.id)!; line.amountCents = null; line.date = null; })}>Edit</button>{p.excerpt && <p className="field-help">Source: “{p.excerpt}”</p>}</div>)}
        {offer.payments.length > 0 && offer.payments.length < 6 && <button className="btn ghost" type="button" onClick={() => updateOffer(o => { o.payments.push({ id: newId("payment"), amountCents: null, amountAsWritten: null, date: null, dateAsWritten: null, condition: null, status: "expected", excerpt: "" }); })}>Add another payment</button>}
        {!totalMatches && <p className="notice warn">The payments do not match the total as written. Correct a payment, or confirm in the question below that the payment amounts are right.</p>}
        {!!offer.costs.length && <p>Extra project costs: {offer.costs.map(c => `${money(c.amountCents)}${c.date ? ` on ${shortDate(c.date)}` : ", date needed"}`).join("; ")}</p>}
        {offer.costsStated && !offer.costs.length && <p>Extra project costs: <strong>$0 — confirmed by you</strong></p>}
        {unresolved.length > 0 && <><p className="field-help">{unresolved.length} open question{unresolved.length === 1 ? "" : "s"}. Answers are saved with this offer.</p>{unresolved.slice(0, 3).map(q => <TypedQuestion key={q.id} question={q} onAnswer={a => { try { setDraft(d => answerQuestion(d, a)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} />)}</>}
        <div className="flow-actions"><button type="button" className="btn secondary" onClick={() => setStep("source")}>Back</button><button type="button" className="btn primary" disabled={!readyOffer} onClick={() => { setStep("household"); setError(null); }}>Continue to household →</button></div>
        {!readyOffer && <p className="hint">Confirm the missing amounts, dates and project costs to continue. Unknown amounts are never treated as $0.</p>}
      </div></div>}
    {step === "household" && <div className="offer-review">
      {!!existing.length && <div className="field"><label htmlFor="use-household">Use your saved household facts</label><select id="use-household" value={existingId} onChange={e => setExistingId(e.target.value)}><option value="">Create a new household</option>{existing.map(w => <option key={w.id} value={w.id}>{w.household.title} · {w.household.state} · revision {w.revision}</option>)}</select></div>}
      {!chosenHousehold && <InvalidInputsProvider draft={profile} update={update}><HouseholdBasics draft={profile} update={update} problemAt={path => problems.find(p => p.path === path)?.reason} />
        <div className="focused-question"><h2 className="section-title small">Retirement already in your plan</h2><p className="field-help">This sets the starting point before the new offer. It is a yearly amount, not a claim that money has already left your account.</p>
          {profile.years.filter(y => sepYears.includes(y.year)).flatMap(y => y.incomes.map(row => <MoneyField key={`${y.year}-${row.personId}`} plain path={`sep-onboarding.${row.personId}.${y.year}`} label={`${personName(profile, row.personId)} · ${y.year} SEP-IRA already contributed or planned`} fact={row.existingSepContribution} evidence={profile.evidence} noneLabel="None contributed or planned" hint="Include existing commitments only. You'll record actual transfers with dates inside your plan." onChange={fact => update(d => { d.years.find(x => x.year === y.year)!.incomes.find(x => x.personId === row.personId)!.existingSepContribution = fact; })} />))}
        </div>
      </InvalidInputsProvider>}
      {people.filter(p => p.role !== "dependent").length > 1 && !profileOnly && <div className="field"><label htmlFor="offer-owner">Whose business takes this offer?</label><select id="offer-owner" value={owner} onChange={e => setOwner(e.target.value)}>{people.filter(p => p.role !== "dependent").map(p => <option key={p.id} value={p.id}>{personName({ people }, p.id)}</option>)}</select></div>}
      {!!problems.length && <ul className="notice warn" role="alert">{problems.map(p => <li key={p.path}>{p.reason}</li>)}</ul>}
      <p className="field-help">No account needed. Your saved plan asks only for the financial facts this decision needs. A current-year offer does not require next year&apos;s income.</p>
      <div className="flow-actions">{!profileOnly && <button className="btn secondary" type="button" onClick={() => setStep("review")}>Back to offer</button>}<button className="btn primary" type="button" disabled={busy} onClick={() => void create()}>{busy ? "Saving your plan…" : importMode === "doc" ? "Continue to document review →" : intent === "income" ? "Continue to my subsidy check →" : "Save offer & check my facts →"}</button></div>
    </div>}
  </div>;
}

function TypedQuestion({ question: q, onAnswer }: { question: UnresolvedField; onAnswer: (answer: TypedAnswer) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  function submit(entered: string) {
    setError(null);
    if (q.kind === "amount") { const parsed = parseAmount(entered, q.subject.field === "costs"); if (parsed.cents === null || parsed.error) { setError(parsed.error ?? "Enter an amount."); return; } onAnswer({ kind: "amount", fieldId: q.id, amountCents: parsed.cents }); }
    else if (q.kind === "date") { if (!/^202[67]-\d{2}-\d{2}$/.test(entered)) { setError("Enter a full date in 2026 or 2027."); return; } onAnswer({ kind: "date", fieldId: q.id, date: entered }); }
  }
  return <div className="focused-question"><label htmlFor={`answer-${q.id}`}>{q.question}</label><p className="field-help">{q.reason}</p>
    {q.source.excerpt && <p className="field-help">From: “{q.source.excerpt}”</p>}
    {q.kind === "choice" || q.kind === "person" ? <div className="row gap wrap">{q.options.map(o => <button className="btn secondary" key={o.value} type="button" onClick={() => onAnswer(q.kind === "person" ? { kind: "person", fieldId: q.id, personId: o.value } : { kind: "choice", fieldId: q.id, value: o.value })}>{o.label}</button>)}</div>
      : <form className="row gap wrap" onSubmit={e => { e.preventDefault(); submit(String(new FormData(e.currentTarget).get("answer") ?? value)); }}><input id={`answer-${q.id}`} name="answer" type={q.kind === "date" ? "date" : "text"} inputMode={q.kind === "amount" ? "decimal" : undefined} min={q.kind === "date" ? "2026-01-01" : undefined} max={q.kind === "date" ? "2027-12-31" : undefined} value={value} onInput={e => setValue(e.currentTarget.value)} onChange={e => setValue(e.target.value)} /><button className="btn secondary" type="submit">Use this answer</button></form>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
