"use client";
import { useState } from "react";
import { type HouseholdWorkspace, workspaceToCaseInput } from "@/domain/household-workspace";
import { buildCaseInput, draftFromCase, type Draft } from "@/features/household/draft";
import { CoverageEditor, HouseholdBasics, ScopeEditor, type Update } from "@/features/household/editors";
import { InvalidInputsProvider } from "@/features/household/invalidInputs";
import { workspaceFromCase } from "./ops";
import { newWorkspaceEvent } from "@/lib/client/api";

/** Edit household facts in the same plan; managed project profit is never written into a base forecast. */
export function HouseholdDetails({ ws, onSave, onClose }: { ws: HouseholdWorkspace; onSave: (next: HouseholdWorkspace, summary: string) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromCase(workspaceToCaseInput(ws).input));
  const [year, setYear] = useState<2026 | 2027>(2026);
  const [problems, setProblems] = useState<Array<{ path: string; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const update: Update = fn => setDraft(old => { const next = structuredClone(old); fn(next); return next; });
  const problemAt = (path: string) => problems.find(p => p.path === path)?.reason;
  async function save() {
    const built = buildCaseInput(draft, "risk");
    if (!built.ok) { setProblems(built.problems); return; }
    // Removing an owner with recorded history would orphan facts; require a new household in that case.
    const ids = new Set(built.input.people.map(p => p.id));
    if (ws.projects.some(p => !ids.has(p.ownerPersonId)) || ws.retirement.contributions.some(c => !ids.has(c.personId)) || ws.retirement.targets.some(c => !ids.has(c.personId))) {
      setProblems([{ path: "people", reason: "A person with recorded projects or contributions cannot be removed from this plan." }]); return;
    }
    const rebuilt = workspaceFromCase(built.input, ws.forecasts, false);
    const next = { ...ws, household: { ...rebuilt.household, title: ws.household.title }, evidence: rebuilt.evidence,
      forecasts: ws.forecasts.filter(f => ids.has(f.personId)), events: [...ws.events, newWorkspaceEvent("forecast_updated", "Updated household and coverage facts; existing projects and base forecasts preserved.")] };
    setBusy(true);
    if (await onSave(next, "Household and coverage facts updated. Existing project terms and base profit forecasts were preserved.")) onClose();
    setBusy(false);
  }
  return <section className="plan-section household-details" id="household-details" aria-labelledby="details-title">
    <div className="row between wrap gap"><h2 id="details-title" className="section-title small">Household & coverage</h2><button className="btn ghost" type="button" onClick={onClose}>Close</button></div>
    <InvalidInputsProvider draft={draft} update={update}>
      <HouseholdBasics draft={draft} update={update} problemAt={problemAt} />
      <div className="horizon" role="group" aria-label="Coverage year">{([2026, 2027] as const).map(y => <button className={`btn ${year === y ? "secondary" : "ghost"}`} key={y} type="button" aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div>
      <CoverageEditor draft={draft} update={update} problemAt={problemAt} yearIndex={year === 2026 ? 0 : 1} />
      <ScopeEditor draft={draft} update={update} problemAt={problemAt} />
    </InvalidInputsProvider>
    {!!problems.length && <ul className="notice warn" role="alert">{problems.map(p => <li key={p.path}>{p.reason}</li>)}</ul>}
    <div className="row gap"><button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save household facts"}</button><button className="btn ghost" type="button" onClick={onClose}>Discard changes</button></div>
  </section>;
}
