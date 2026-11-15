"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileUp, FlaskConical } from "lucide-react";
import type { SavedPlan } from "@/domain/contracts";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { workspaceFixture } from "@/fixtures/workspace";
import { analyzeWorkspaceFile } from "@/lib/client/api";
import { dateTime } from "@/features/format";
import { planRepository } from "@/features/plan/storage";
import { MigrationReview } from "./MigrationReview";
import { workspaceRepo } from "./store";
import { newId, now } from "./ops";

export function HouseholdList({ deleted = false }: { deleted?: boolean }) {
  const router = useRouter();
  const [plans, setPlans] = useState<HouseholdWorkspace[] | null>(null);
  const [v1, setV1] = useState<SavedPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(deleted ? "Household plan deleted." : null);
  const [migrating, setMigrating] = useState<{ plan: SavedPlan; source: "browser" | "cloud" | "json" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setPlans(await workspaceRepo().list()); } catch (e) { setError(`Household plans couldn't be loaded: ${e instanceof Error ? e.message : String(e)}`); setPlans([]); }
    try { setV1(await planRepository().list()); } catch { setV1([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openSample() {
    try {
      const at = now();
      const ws = HouseholdWorkspaceSchema.parse({ ...structuredClone(workspaceFixture), id: newId("ws-sample"), revision: 0, updatedAt: at,
        events: [...workspaceFixture.events, { id: newId("evt-opened"), at, kind: "workspace_created", description: "Opened a copy of the synthetic sample household plan.", refs: {}, previousFingerprint: null, nextFingerprint: null }] });
      const saved = await workspaceRepo().save(ws, null);
      router.push(`/household/${encodeURIComponent(saved.id)}`);
    } catch (e) { setError(`The sample couldn't be opened: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const a = analyzeWorkspaceFile(await file.text());
      if (a.status === "invalid") { setError(a.message); return; }
      if (a.status === "v1_plan") { setMigrating({ plan: a.plan, source: "json" }); return; }
      const saved = await workspaceRepo().save({ ...a.workspace, revision: 0 }, null, a.legacySnapshot ? { legacySnapshot: a.legacySnapshot } : undefined);
      router.push(`/household/${encodeURIComponent(saved.id)}?saved=1`);
    } catch (e) { setError(`The file couldn't be restored: ${e instanceof Error ? e.message : String(e)}`); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return <div className="shell page-pad">
    <p className="eyebrow">My plans</p>
    <h1 className="page-title">One plan for your household&apos;s year</h1>
    <p className="intro">Your profit forecast, the projects you&apos;ve agreed, payments as they arrive and SEP-IRA contributions — kept together, so a new offer is checked on top of everything else.</p>
    {error && <p className="notice warn" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="row gap wrap cta-row">
      <Link href="/check" className="btn primary">Start from my own figures <ArrowRight size={16} /></Link>
      <button type="button" className="btn secondary" onClick={() => void openSample()}><FlaskConical size={16} /> Open the sample household plan</button>
    </div>
    <p className="muted small">Start with your household or a client offer. Confirmed facts stay in your plan, so you only update what changes.</p>

    {plans === null ? <p className="loading-line"><span className="spinner" aria-hidden="true" /> Loading…</p>
      : plans.length === 0 ? <p className="muted">No household plans yet.</p>
      : <ul className="plan-list">{plans.map(d => <li key={d.id}><Link className="plan-link" href={`/household/${encodeURIComponent(d.id)}`}>
        <span className="plan-title">{d.household.title}{d.household.isSynthetic && <span className="pill neutral small-pill">Sample</span>}</span>
        <span className="muted small">{d.projects.length} project{d.projects.length === 1 ? "" : "s"} · revision {d.revision} · updated {dateTime(d.updatedAt)}{workspaceRepo().locationOf(d.id) === "cloud" ? " · guest cloud" : " · this browser"}</span>
        <span className="small">{d.events.at(-1)?.description ?? "Continue with the saved household facts."}</span>
        <ArrowRight size={16} aria-hidden="true" className="go-icon" /></Link></li>)}</ul>}

    {migrating ? <MigrationReview plan={migrating.plan} source={migrating.source} onCancel={() => setMigrating(null)}
      onDone={id => router.push(`/household/${encodeURIComponent(id)}?saved=1`)} />
      : v1.length > 0 && <section className="plan-section" aria-labelledby="v1-title">
        <h2 id="v1-title" className="section-title small">Earlier single-project plans</h2>
        <p className="muted small">Bring one into a household plan. You&apos;ll review what moves over first; the original plan stays as it is.</p>
        <ul className="plan-list">{v1.map(p => <li key={p.id}><div className="plan-link">
          <span className="plan-title">{p.input.opportunity.title}</span>
          <span className="muted small">revision {p.revision} · updated {dateTime(p.updatedAt)}</span>
          <span className="row gap"><button type="button" className="btn small secondary" onClick={() => setMigrating({ plan: p, source: workspaceRepo().locationOf(p.id) === "cloud" ? "cloud" : "browser" })}>Review and convert</button>
            <Link className="link-btn" href={`/plan/${encodeURIComponent(p.id)}`}>Open as it is</Link></span>
        </div></li>)}</ul>
      </section>}

    <section className="plan-section" aria-labelledby="restore-title">
      <h2 id="restore-title" className="section-title small">Restore from a file</h2>
      <p className="muted small">A household plan file (or an older single-project plan file) downloaded from Headroom. Nothing is imported unless the whole file is valid.</p>
      <label className="btn secondary small file-btn"><FileUp size={16} /> Choose a JSON file
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={e => void onFile(e.target.files?.[0])} /></label>
    </section>
  </div>;
}
