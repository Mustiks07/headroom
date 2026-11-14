"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FlaskConical } from "lucide-react";
import { workspaceFixture } from "@/fixtures/workspace";
import { HouseholdWorkspaceSchema } from "@/domain/household-workspace";
import { dateTime } from "@/features/format";
import { listDrafts, writeDraft, type DraftSummary } from "./draftStore";
import { newId, now } from "./ops";

export function HouseholdList() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDrafts(listDrafts()); }, []);

  function openSample() {
    try {
      const at = now();
      const ws = HouseholdWorkspaceSchema.parse({ ...structuredClone(workspaceFixture), id: newId("ws-sample"), updatedAt: at,
        events: [...workspaceFixture.events, { id: newId("evt-opened"), at, kind: "workspace_created", description: "Opened a copy of the synthetic sample household plan.", refs: {}, previousFingerprint: null, nextFingerprint: null }] });
      writeDraft(ws);
      router.push(`/household/${encodeURIComponent(ws.id)}`);
    } catch (e) { setError(`The sample couldn't be opened: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return <div className="shell page-pad">
    <p className="eyebrow">Household plans</p>
    <h1 className="page-title">One plan for your household&apos;s year</h1>
    <p className="intro">Your profit forecast, the projects you&apos;ve agreed, payments as they arrive and SEP-IRA contributions — kept together, so a new offer is checked on top of everything else.</p>
    {error && <p className="notice warn" role="alert">{error}</p>}
    <div className="row gap wrap cta-row">
      <Link href="/check" className="btn primary">Start from my own figures <ArrowRight size={16} /></Link>
      <button type="button" className="btn secondary" onClick={openSample}><FlaskConical size={16} /> Open the sample household plan</button>
    </div>
    <p className="muted small">Start with “Check my subsidy”; after the check, choose <strong>Make this my household plan</strong>.</p>
    {drafts === null ? <p className="loading-line"><span className="spinner" aria-hidden="true" /> Loading…</p>
      : drafts.length === 0 ? <p className="muted">No household plans in this browser yet.</p>
      : <ul className="plan-list">{drafts.map(d => <li key={d.id}><Link className="plan-link" href={`/household/${encodeURIComponent(d.id)}`}>
        <span className="plan-title">{d.title}{d.isSynthetic && <span className="pill neutral small-pill">Sample</span>}</span>
        <span className="muted small">{d.projects} project{d.projects === 1 ? "" : "s"} · updated {dateTime(d.updatedAt)} · draft in this browser</span>
        <ArrowRight size={16} aria-hidden="true" className="go-icon" /></Link></li>)}</ul>}
    <p className="muted small">Single-project plans saved earlier are under <Link className="text-link" href="/plans">My plans</Link>.</p>
  </div>;
}
