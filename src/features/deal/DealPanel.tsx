"use client";

import { useEffect, useMemo, useState } from "react";
import { Readiness } from "@/features/assist/Readiness";
import { Explain } from "@/features/assist/Explain";
import { trackEvent } from "@/lib/client/api";
import { AlertTriangle, CheckCircle2, CircleSlash, Star, XCircle } from "lucide-react";
import type { DealSearchResult, DealVariant, DecisionSensitivityResult, NoFeasibleTerms, ReadyDealSearch } from "@/domain/deal-planning";
import { effectiveLine, type HouseholdWorkspace, type Project } from "@/domain/household-workspace";
import { centsToInput, humanizeDates, money, shortDate, signClass, signedMoney } from "@/features/format";
import { personName } from "@/features/household/draft";
import { GoalForm, defaultGoal, goalProblems, type GoalDraft } from "./GoalForm";
import { buildGoal, draftFromSaved } from "./model";
import { searchTerms, sensitivity } from "./engine";

const PURPOSE: Record<DealVariant["purpose"], string> = {
  simplest: "Simplest", most_cash: "More cash overall", earliest_money: "More money by your date",
  most_retirement: "More into retirement", lowest_risk: "More room if income rises", as_offered: "As offered",
};

type SearchState = { key: string; revision: number; pending: boolean; result?: DealSearchResult; error?: string };

/**
 * Goal-first deal planning for one project: the household says what it needs; Claude 2's engine
 * searches allowed terms; this panel only displays the result and lets the person choose.
 */
export function DealPanel({ ws, project, onSaveGoal, onChoose, onGoToForecast, onClose, onSubmitAnswer, onGoToPath }: {
  ws: HouseholdWorkspace; project: Project;
  /** Saves goal + allowed terms (+ cash context) as a plan revision; returns the saved workspace or null on failure. */
  onSaveGoal: (built: Extract<ReturnType<typeof buildGoal>, { ok: true }>) => Promise<HouseholdWorkspace | null>;
  onChoose: (variant: DealVariant, result: ReadyDealSearch) => void;
  onGoToForecast: () => void;
  onClose: () => void;
  onSubmitAnswer: (next: HouseholdWorkspace, summary: string) => Promise<boolean>;
  /** Opens the plan editor that holds a fact the search still needs. */
  onGoToPath: (path: string) => void;
}) {
  const savedGoal = ws.dealPlanning?.goals.find(g => g.projectId === project.id);
  const savedSpace = ws.dealPlanning?.termSpaces.find(t => t.projectId === project.id);
  const [draft, setDraft] = useState<GoalDraft>(() => draftFromSaved(defaultGoal(project), savedGoal, savedSpace, ws.dealPlanning?.cashContext ?? null));
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [busy, setBusy] = useState(false);
  const draftKey = JSON.stringify(draft);
  const problems = useMemo(() => goalProblems(draft), [draft]);
  const fixed = project.receipts.filter(l => l.actual).map(l => ({ amountCents: l.actual!.amountCents, date: l.actual!.date }));
  const unpaid = project.receipts.map(effectiveLine).filter(e => e.basis === "expected");

  async function find() {
    setTouched(true); setMessage(null);
    const built = buildGoal(ws, project, draft, savedGoal?.id ?? null);
    if (!built.ok) { setMessage(built.message); return; }
    setBusy(true);
    const saved = await onSaveGoal(built);
    if (!saved) { setBusy(false); setMessage("Your goal wasn't saved, so nothing was searched. Your entries are kept — see the message at the top of the page and try again."); return; }
    setSearch({ key: draftKey, revision: saved.revision, pending: true });
    try {
      const goal = saved.dealPlanning!.goals.find(g => g.id === built.goal.id)!;
      const space = saved.dealPlanning!.termSpaces.find(t => t.projectId === project.id)!;
      const result = await searchTerms(saved, goal, space, saved.dealPlanning!.cashContext);
      setSearch({ key: draftKey, revision: saved.revision, pending: false, result });
      if (result.status === "ready") void trackEvent("result_calculated", { dataKind: ws.household.isSynthetic ? "sample" : "own", inputPath: "manual" });
    } catch (e) { setSearch({ key: draftKey, revision: saved.revision, pending: false, error: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
    setTimeout(() => document.getElementById("deal-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  const stale = !!search && (search.key !== draftKey || search.revision !== ws.revision);
  const savedGoalId = (ws.dealPlanning?.goals ?? []).filter(g => g.projectId === project.id).at(-1)?.id ?? null;
  const r = search?.result;

  /** A computed one-constraint relaxation can be applied to the form, then searched again. */
  function applyRelaxation(rx: NoFeasibleTerms["relaxations"][number]) {
    const c = rx.requiredCents !== null ? centsToInput(rx.requiredCents) : null;
    if (rx.constraint === "price_max" && c) setDraft({ ...draft, price: { ...draft.price, max: c } });
    if (rx.constraint === "additional_sep" && c) setDraft({ ...draft, sepMax: c });
    if (rx.constraint === "minimum_cash" && c) setDraft({ ...draft, keepAtLeast: c });
    if (rx.constraint === "latest_payment_date" && rx.requiredDate) setDraft({ ...draft, windows: { ...draft.windows, latestDate: rx.requiredDate } });
    if (rx.constraint === "date_target") setDraft({ ...draft, byDate: { ...draft.byDate, ...(rx.requiredDate ? { date: rx.requiredDate } : {}), ...(c ? { amount: c } : {}) } });
  }

  return <section id="deal-panel" className="plan-section deal-panel" aria-labelledby="deal-title">
    <div className="row gap wrap between">
      <h2 id="deal-title" className="section-title small">Find terms for “{project.title}”</h2>
      <button type="button" className="btn ghost small" onClick={onClose}>Close</button>
    </div>
    <p className="muted small">Tell Headroom what your household needs. It searches prices and payment dates you&apos;d be willing to ask for — on top of your agreed projects — and shows only terms it actually calculated.
      {unpaid.length > 0 && <> Still open: {unpaid.map(e => `${money(e.amountCents)} expected ${shortDate(e.date)}`).join(", ")}.</>}</p>
    <Readiness ws={ws} intent="two_year_terms" projectId={project.id} onAnswer={onGoToPath} onSubmit={onSubmitAnswer} />
    <GoalForm ws={ws} project={project} goal={draft} onChange={setDraft} problems={problems} touched={touched} fixedReceived={fixed} />
    {message && <p className="field-error" role="alert">{message}</p>}
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={busy} onClick={() => void find()}>{busy ? "Searching…" : search ? "Search again" : "Find terms"}</button>
      <span className="muted small">Your goal and limits are saved with the plan.</span>
    </div>

    <div id="deal-result" aria-live="polite">
      {stale && <p className="stale-banner" role="status">Your goal or plan changed. These results use the earlier facts — search again before choosing.</p>}
      {search?.pending && <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" /> Searching terms within your limits…</p>}
      {search?.error && <div className="blocked unavailable" role="alert"><div className="blocked-head"><AlertTriangle size={20} aria-hidden="true" /><div><h3>The search failed</h3><p>{search.error}</p><p className="hint">Your goal is kept.</p></div></div></div>}
      {r && !search?.pending && (r.status === "needs_data" || r.status === "unsupported" || r.status === "unavailable") && <BlockedDeal result={r} onGoToForecast={onGoToForecast} />}
      {!search?.pending && r?.status === "no_feasible_terms" && <NoTerms result={r} onApply={applyRelaxation} />}
      {!search?.pending && r?.status === "ready" && <Variants ws={ws} result={r} stale={stale} onChoose={v => onChoose(v, r)} onGoToForecast={onGoToForecast} />}
      {!search?.pending && r?.status === "ready" && !stale && savedGoalId && <Explain ws={ws} subject="deal_choice" refId={savedGoalId} label="Why these options?" />}
    </div>
  </section>;
}

function BlockedDeal({ result, onGoToForecast }: { result: Extract<DealSearchResult, { status: "needs_data" | "unsupported" | "unavailable" }>; onGoToForecast: () => void }) {
  const title = result.status === "needs_data" ? "A few facts are needed before terms can be searched"
    : result.status === "unsupported" ? "Headroom can't search terms for this situation" : "Term search isn't available";
  return <div className={`blocked ${result.status === "needs_data" ? "needs" : result.status}`} role="status">
    <div className="blocked-head">{result.status === "unsupported" ? <CircleSlash size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
      <div><h3>{title}</h3><p>{humanizeDates(result.message)}</p></div></div>
    {result.fields.length > 0 && <ul className="missing-list">{result.fields.map(f => <li key={f.path + f.reason}>
      <div><strong>{f.path.startsWith("forecasts") ? "Profit forecast" : f.path.startsWith("dealPlanning") || f.path.startsWith("goal") ? "Your goal" : f.path.startsWith("projects") ? "Project details" : f.path}</strong><span>{humanizeDates(f.reason)}</span></div>
      {f.path.startsWith("forecasts") && <button type="button" className="btn small secondary" onClick={onGoToForecast}>Fix this</button>}
    </li>)}</ul>}
  </div>;
}

const CONSTRAINT_TEXT: Record<string, string> = {
  minimum_cash: "Cash you want to keep", date_target: "Money by your date", price_bounds: "Price range", payment_windows: "Payment dates",
  max_payments: "Number of payments", additional_sep_limit: "Your SEP-IRA limit", sep_legal_limit: "SEP-IRA legal limit", sep_cash: "Cash set aside for SEP-IRA",
  timing_confirmation: "Payment timing confirmation", new_terms_confirmation: "Client open to new terms", fixed_facts: "Payments already made",
};
const RELAX_LABEL = { price_max: "A higher price", latest_payment_date: "A later payment date", additional_sep: "More SEP-IRA", minimum_cash: "A smaller cash goal", date_target: "A different date goal" } as const;
const RELAX_TEXT = { price_max: "Ask up to", latest_payment_date: "Allow payment until", additional_sep: "Allow extra SEP-IRA up to", minimum_cash: "Keep at least", date_target: "Change the date goal to" } as const;

function NoTerms({ result, onApply }: { result: NoFeasibleTerms; onApply: (rx: NoFeasibleTerms["relaxations"][number]) => void }) {
  const extra = result as NoFeasibleTerms & { nearest?: Array<{ variant: DealVariant; shortfallCents: number; unmet: string[] }>; binding?: string[] };
  return <div className="blocked unsupported no-terms" role="status">
    <div className="blocked-head"><XCircle size={20} aria-hidden="true" /><div><h3>No terms within your limits meet this goal</h3>
      <p>Headroom searched {searchedText(result)} and none met every limit. Nothing is recommended.</p></div></div>
    <ul className="missing-list">{result.violated.map(v => <li key={v.id + v.detail}><div><strong>{CONSTRAINT_TEXT[v.id] ?? v.id}</strong><span>{humanizeDates(v.detail)}</span></div></li>)}</ul>
    {!!extra.nearest?.length && <div className="nearest-options"><h4 className="small-head">Closest calculated options inside your limits</h4><p className="small">These are valid terms, but they still miss your goal. Nothing is selected for you.</p>
      {extra.nearest.slice(0, 2).map(({ variant, shortfallCents, unmet }) => <details key={variant.id} className="explain"><summary>{money(variant.terms.priceCents)} price · {signedMoney(variant.twoYearCashDeltaCents)} extra cash after both settlements</summary>
        <p className="small">Compared with {result.baseline.label.toLowerCase()}, through {shortDate(result.horizon.settlementThrough)}. Added retirement: {money(variant.retirementAddedCents)}, separate from cash.</p>
        <p>{variant.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join("; ")}</p><p className="small">Largest gap among missed targets: {money(shortfallCents)}. {unmet.map(k => CONSTRAINT_TEXT[k] ?? k).join("; ")}</p>
      </details>)}</div>}
    {result.relaxations.length > 0 ? <div className="relax">
      <p className="small"><strong>Calculated changes to one limit</strong> (within the search checked, other limits unchanged):</p>
      <ul className="relax-list">{result.relaxations.map((rx, i) => { const usable = rx.requiredCents !== null || rx.requiredDate !== null;
        return <li key={i}>
          <span>{usable ? <>{RELAX_TEXT[rx.constraint]} {rx.requiredCents !== null ? <strong className="num">{money(rx.requiredCents)}</strong> : null}{rx.requiredDate ? <strong> {shortDate(rx.requiredDate)}</strong> : null}
            <span className="muted small"> — </span></> : <strong>{RELAX_LABEL[rx.constraint]}: </strong>}<span className="muted small">{humanizeDates(rx.explanation)}</span></span>
          {usable && <button type="button" className="btn small ghost" onClick={() => onApply(rx)}>Use this in my goal</button>}
        </li>; })}</ul></div>
      : <p className="hint">No single change to one limit makes this goal work inside the searched range.</p>}
    {result.warnings.length > 0 && <details className="explain"><summary>Search notes ({result.warnings.length})</summary><ul className="bullets small">{result.warnings.map(w => <li key={w}>{humanizeDates(w)}</li>)}</ul></details>}
  </div>;
}

function searchedText(r: ReadyDealSearch | NoFeasibleTerms) {
  const s = r.search;
  return `${s.evaluated} combination${s.evaluated === 1 ? "" : "s"} (prices in ${money(s.priceStepCents)} steps, ${s.paymentDateCandidates} payment date${s.paymentDateCandidates === 1 ? "" : "s"}${s.sepStepCents ? `, SEP-IRA in ${money(s.sepStepCents)} steps` : ""})`;
}

function Variants({ ws, result, stale, onChoose, onGoToForecast }: { ws: HouseholdWorkspace; result: ReadyDealSearch; stale: boolean; onChoose: (v: DealVariant) => void; onGoToForecast: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"settled" | "by_date">("settled");
  // Mobile (design C): one selected option shown in full, the others as selection rows.
  const [sel, setSel] = useState(result.recommendedVariantId);
  useEffect(() => { setSel(result.recommendedVariantId); }, [result]);
  const sorted = [...result.variants].sort((a, b) => Number(b.id === result.recommendedVariantId) - Number(a.id === result.recommendedVariantId)).slice(0, 3);
  return <div className="deal-result">
    <div className="horizon" role="radiogroup" aria-label="Which money to show">
      {([["settled", "After tax settlements"], ["by_date", "By your date"]] as const).map(([k, label]) =>
        <label key={k} className={view === k ? "on" : ""}><input type="radio" name="horizon" checked={view === k} onChange={() => setView(k)} />{label}</label>)}
    </div>
    <p className="baseline-note"><strong>Compared with: {result.baseline.label}.</strong> {humanizeDates(result.baseline.description)} Cash is what your family keeps after both tax years settle (through {shortDate(result.horizon.settlementThrough)}) — not a bank balance.</p>
    {result.cashCompleteness === "household_incomplete" && <p className="notice warn small">Your balance goal can&apos;t be confirmed because the cash picture isn&apos;t marked complete. Only this project&apos;s money is shown; Headroom doesn&apos;t say whether your household will cover every bill.</p>}
    <div className={`variant-grid joined-variant ${stale ? "is-stale" : ""}`}>
      {sorted.filter(v => v.id === sel || !sorted.some(x => x.id === sel) && v.id === sorted[0]?.id).map(v => <VariantCard selected key={v.id} ws={ws} v={v} recommended={v.id === result.recommendedVariantId} expanded={open === v.id}
        onToggle={() => setOpen(open === v.id ? null : v.id)} onChoose={() => onChoose(v)} disabled={stale} result={result} onGoToForecast={onGoToForecast} view={view} />)}
    </div>
    {sorted.length > 1 && <fieldset className="choice-rows">
      <legend className="section-title small">Compare your choices</legend>
      {sorted.map(v => {
        const rob = (v as { robustness?: { holds: boolean } }).robustness;
        const date = v.dateTargets.find(t => t.achievedCents !== null);
        const amount = view === "by_date" ? (date?.achievedCents ?? null) : v.twoYearCashDeltaCents;
        return <label key={v.id} className={`choice-row ${v.id === sel ? "on" : ""}`}>
          <input type="radio" name="variant-choice" checked={v.id === sel} onChange={() => setSel(v.id)} />
          <span className="choice-main"><strong>{PURPOSE[v.purpose]}{v.id === result.recommendedVariantId ? " · Our pick" : ""}</strong>
            <span>{v.retirementAddedCents > 0 ? `+${money(v.retirementAddedCents)} retirement` : "No added retirement"}{rob && !rob.holds ? " · Sensitive to income" : ""}</span></span>
          <span className={`choice-amount num ${amount !== null && view === "settled" ? signClass(amount) : ""}`}>{amount === null ? "—" : view === "settled" ? signedMoney(amount) : money(amount)}</span>
        </label>;
      })}
      <p className="hint">{view === "settled"
        ? `Amounts are cash after both tax settlements, compared with ${result.baseline.kind === "accept_as_offered" ? "accepting as offered" : "declining this project"}. Retirement is separate.`
        : "Amounts use your date goal. Select a choice to see whether the figure means gross receipts, available project cash or household balance."}</p>
    </fieldset>}
    <p className="hint">Searched {searchedText(result)}. {result.search.exhaustiveWithinSpace ? "Every combination within your limits was checked." : humanizeDates(result.search.note)}
      {result.simplerVariantThresholdCents > 0 && ` A simpler option is preferred when the more complex one adds less than ${money(result.simplerVariantThresholdCents)}.`}</p>
    {result.warnings.length > 0 && <details className="explain"><summary>Conditions and notes ({result.warnings.length})</summary><ul className="bullets small">{result.warnings.map(w => <li key={w}>{humanizeDates(w)}</li>)}</ul></details>}
  </div>;
}

function VariantCard({ ws, v, recommended, expanded, onToggle, onChoose, disabled, result, onGoToForecast, view, selected }: {
  ws: HouseholdWorkspace; v: DealVariant; recommended: boolean; expanded: boolean; onToggle: () => void; onChoose: () => void; disabled: boolean;
  result: ReadyDealSearch; onGoToForecast: () => void; view: "settled" | "by_date"; selected: boolean;
}) {
  const goalMet = v.constraints.every(c => c.satisfied) && v.dateTargets.every(t => t.met !== false);
  // Round 5 engine fields (Claude 2): cash vs declining AND vs the offer as it stands; robustness of the pick.
  const byDate = v.dateTargets.find(t => t.achievedCents !== null) ?? null;
  // Round 5 engine fields (Claude 2 bc99600): who must agree, and money from this project at each date.
  const agree = (v as { clientAgreement?: { required: boolean; changes: Array<"price" | "dates">; note: string | null } }).clientAgreement;
  const mbd = (v as { moneyByDate?: Array<{ date: string; receivedCents: number; availableCents: number; event: string }> }).moneyByDate ?? [];
  const yearEnd = mbd.find(r => r.date === "2026-12-31") ?? null;
  const cmp = (v as { comparisons?: { versusDeclineCents: number; versusOfferedCents: number | null; versusOriginalOfferCents?: number | null } }).comparisons;
  const rob = (v as { robustness?: { holds: boolean; basis: string; roomCents: number | null } }).robustness;
  return <article className={`variant ${recommended ? "recommended" : ""} ${goalMet ? "" : "unmet"} ${selected ? "is-selected" : "is-unselected"}`} aria-labelledby={`v-${v.id}`}>
    <div className="variant-outcome">
    <header><p className="tile-k">{PURPOSE[v.purpose]}</p>{recommended && <span className="pill good"><Star size={13} aria-hidden="true" /> Our pick</span>}</header>
    <h3 id={`v-${v.id}`} className="variant-title">{humanizeDates(v.label)}</h3>
    {view === "settled" ? <>
      <p className={`tile-big num ${signClass(v.twoYearCashDeltaCents)}`}>{signedMoney(v.twoYearCashDeltaCents)}</p>
      <p className="tile-sub">Extra cash after both tax settlements · {result.baseline.kind === "accept_as_offered" ? "compared with accepting as offered" : "compared with declining this project"} · 2026–2027 tax years, final settlement in {result.horizon.settlementThrough.slice(0, 4)}</p>
    </> : <>
      {byDate && byDate.achievedCents !== null ? <>
        <p className="tile-big num">{money(byDate.achievedCents)}</p>
        <p className="tile-sub">{humanizeDates(byDate.explanation)}</p>
      </> : yearEnd ? <>
        <p className="tile-big num">{money(yearEnd.availableCents)}</p>
        <p className="tile-sub">Available from this project by Dec 31, 2026 — after its costs, any extra SEP-IRA and the tax set aside. No date goal is set.</p>
      </> : <p className="tile-sub">No money-by-date figures for this option.</p>}
      {mbd.length > 0 && <table className="mbd"><caption className="visually-hidden">Money from this project by date</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Received</th><th scope="col">Available</th></tr></thead>
        <tbody>{mbd.map(r => <tr key={r.date}><th scope="row"><span>{shortDate(r.date)}</span><span className="mbd-event">{humanizeDates(r.event)}</span></th>
          <td className="num">{money(r.receivedCents)}</td><td className={`num ${r.availableCents < 0 ? "neg" : ""}`}>{money(r.availableCents)}</td></tr>)}</tbody></table>}
      {mbd.length > 0 && <p className="hint">Received = gross payments. Available = after this project&apos;s costs, extra SEP-IRA and the tax and credit change set aside; the last row matches the result after both returns.</p>}
    </>}
    </div><div className="variant-actionable">
    {v.retirementAddedCents > 0 && <p className="tile-line">+ <strong className="num">{money(v.retirementAddedCents)}</strong> into retirement (not counted as cash)</p>}
    {cmp && cmp.versusOfferedCents !== null && v.purpose !== "as_offered" && <p className="tile-line"><span className={`num ${signClass(cmp.versusOfferedCents)}`}>{signedMoney(cmp.versusOfferedCents)}</span> compared with the offer as it stands</p>}
    {cmp?.versusOriginalOfferCents !== null && cmp?.versusOriginalOfferCents !== undefined && <p className="tile-line"><span className={`num ${signClass(cmp.versusOriginalOfferCents)}`}>{signedMoney(cmp.versusOriginalOfferCents)}</span> compared with the original client offer · cash after both tax settlements</p>}
    {(agree ? agree.required : v.purpose !== "as_offered") && <p className="tile-line small"><span className="client-agreement">Client agreement needed</span>{" "}
      for the changed {agree && agree.changes.length ? agree.changes.map(c => c === "price" ? "price" : "payment dates").join(" and ") : "price or payment dates"}. Proposed payments, not money received.</p>}
    {agree?.note && <details className="explain"><summary>Payment timing conditions</summary><p className="small">{humanizeDates(agree.note)}</p></details>}
    {rob && !rob.holds && <p className="notice warn small">Little room: {rob.roomCents !== null ? `about ${money(rob.roomCents)} of extra 2026–2027 profit could break this` : "a small change in income could break this"}{rob.basis === "declared_ranges" ? " within the income ranges you entered" : ""}. Check the details before you choose.</p>}
    <dl className="terms">
      <div><dt>Ask for</dt><dd className="num">{money(v.terms.priceCents)}</dd></div>
      <div><dt>Payments</dt><dd>{v.terms.payments.map(p => `${money(p.amountCents)} on ${shortDate(p.date)}`).join(" · ") || "—"}</dd></div>
      {v.terms.additionalSep && <div><dt>Extra SEP-IRA</dt><dd>{money(v.terms.additionalSep.amountCents)} for {v.terms.additionalSep.year} ({personName(ws.household, v.terms.additionalSep.personId)})</dd></div>}
    </dl>
    {view === "settled" && v.dateTargets.map(t => <p key={t.targetId} className={`target ${t.met ? "met" : t.met === false ? "missed" : ""}`}>
      {t.met ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} {humanizeDates(t.explanation)}{t.achievedCents !== null ? ` (${money(t.achievedCents)})` : ""}</p>)}
    {v.aca.some(a => a.creditLost) && <p className="target missed"><XCircle size={14} aria-hidden="true" /> Loses the {v.aca.filter(a => a.creditLost).map(a => a.year).join(" and ")} premium tax credit</p>}
    {v.differenceFromBestCents !== 0 && <p className="hint">{money(Math.abs(v.differenceFromBestCents))} less cash than the option with the most cash{v.purpose === "simplest" || v.purpose === "as_offered" ? " — with fewer changes to ask for" : ""}.</p>}
    <div className="card-actions">
      <button type="button" className="btn ghost small" aria-expanded={expanded} onClick={onToggle}>{expanded ? "Hide details" : "Money by date & details"}</button>
      <button type="button" className="btn primary small" disabled={disabled || !goalMet} onClick={onChoose}>Prepare client reply</button>
    </div>
    </div>
    {expanded && <VariantDetails ws={ws} v={v} result={result} onGoToForecast={onGoToForecast} />}
  </article>;
}

const BASIS = { fixed: "Received", proposed: "If agreed", estimated: "Estimate" } as const;

function VariantDetails({ ws, v, result, onGoToForecast }: { ws: HouseholdWorkspace; v: DealVariant; result: ReadyDealSearch; onGoToForecast: () => void }) {
  const flows = [...v.datedFlows].sort((a, b) => a.date.localeCompare(b.date));
  return <div className="variant-details">
    <h4 className="small-head">Money by date</h4>
    {flows.length === 0 ? <p className="muted small">No dated flows were returned.</p> : <ol className="timeline">{flows.map((f, i) => <li key={i} className={`basis-${f.basis}`}>
      <span className="t-date">{shortDate(f.date)}</span>
      <span className="t-label">{humanizeDates(f.label)} <span className={`basis-tag ${f.basis === "fixed" ? "actual" : ""}`}>{BASIS[f.basis]}</span></span>
      <span className={`t-amt num ${signClass(f.amountCents)}`}>{signedMoney(f.amountCents)}</span></li>)}</ol>}
    <p className="hint">“Received” already happened and stays as it is. “If agreed” depends on the client accepting. “Estimate” comes from the tax model (for example settlement when you file).</p>
    {v.aca.length > 0 && <><h4 className="small-head">Health-insurance subsidy</h4>
      <ul className="bullets small">{v.aca.map(a => <li key={a.year}>{a.year}: credit {money(a.ptcCents)}{a.creditLost ? " — lost" : ""} (income for the subsidy {money(a.magiCents)})</li>)}</ul></>}
    <h4 className="small-head">Your limits</h4>
    <ul className="constraint-list">{v.constraints.map(c => <li key={c.id + c.detail} className={c.satisfied ? "ok" : "bad"}>{c.satisfied ? "✓" : "✗"} {CONSTRAINT_TEXT[c.id] ?? c.id}: <span className="muted">{humanizeDates(c.detail)}</span></li>)}</ul>
    {v.actions.length > 0 && <><h4 className="small-head">What you would do</h4>
      <ul className="bullets small">{v.actions.map(a => <li key={a.id}>{humanizeDates(a.title)} <span className="muted">· {a.dueDate ? `by ${shortDate(a.dueDate)}` : a.dueCondition ?? "no fixed date"}</span></li>)}</ul></>}
    <Sensitivity ws={ws} v={v} result={result} onGoToForecast={onGoToForecast} />
    {!v.verifiedExact && <p className="hint warn">This option wasn&apos;t re-checked with the exact year calculation.</p>}
  </div>;
}

function Sensitivity({ ws, v, result, onGoToForecast }: { ws: HouseholdWorkspace; v: DealVariant; result: ReadyDealSearch; onGoToForecast: () => void }) {
  const [state, setState] = useState<DecisionSensitivityResult | "loading" | null>(null);
  useEffect(() => { setState(null); }, [v.id]);
  const goal = ws.dealPlanning?.goals.find(g => g.id === result.goalId);
  if (!goal) return null;
  return <details className="explain sensitivity" onToggle={e => { if ((e.target as HTMLDetailsElement).open && state === null) { setState("loading"); void sensitivity(ws, goal, v, result.searchFingerprint).then(setState); } }}>
    <summary>What could change this answer?</summary>
    {state === "loading" && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Checking…</p>}
    {state && state !== "loading" && state.status !== "ready" && <p className="small">{state.message}</p>}
    {state && state !== "loading" && state.status === "ready" && <>
      {state.firstChange && <p className="small"><strong>First thing that could change it:</strong> {humanizeDates(state.firstChange)}</p>}
      <ul className="bullets small">{state.items.map(it => <li key={it.id}>{humanizeDates(it.description)} — {humanizeDates(it.outcomeChange)}
        {it.thresholdCents !== null && <> (at <strong className="num">{money(it.thresholdCents)}</strong>{it.currentCents !== null ? `, now ${money(it.currentCents)}` : ""})</>}
        <span className="muted"> · {it.checked === "exact_threshold" ? "solved exactly" : it.checked === "interval_checked" ? "checked across a range" : "depends on an unconfirmed fact"}</span>
        {it.path.startsWith("forecasts") && <> <button type="button" className="link-btn" onClick={onGoToForecast}>Go to this figure</button></>}</li>)}</ul>
      {state.items.length === 0 && <p className="small">Nothing within the checked ranges changes this answer.</p>}
    </>}
  </details>;
}
