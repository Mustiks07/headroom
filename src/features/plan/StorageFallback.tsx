"use client";

import { useState } from "react";
import { Download, HardDrive } from "lucide-react";
import type { SavedPlan } from "@/domain/contracts";
import { CloudSaveFailedError } from "@/lib/client/api";
import { downloadJson, fileStamp, planFile, planRepository } from "./storage";

/**
 * Shown after a cloud save failed (Claude 3 seam). Offers an explicit local save or a JSON
 * download; never claims the cloud save happened and never overwrites the cloud copy.
 */
export function StorageFallback({ error, plan, onSaved }: { error: unknown; plan: SavedPlan; onSaved: (saved: SavedPlan) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!(error instanceof CloudSaveFailedError)) return null;
  const copy = error.operation === "update";

  async function saveHere() {
    setBusy(true); setProblem(null);
    try { onSaved(await planRepository().saveLocally({ ...plan, revision: 0 })); }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return <div className="row gap wrap" role="group" aria-label="Other ways to keep this plan">
    <button type="button" className="btn small secondary" disabled={busy} onClick={saveHere}>
      <HardDrive size={15} /> {copy ? "Save a separate copy in this browser" : "Save in this browser instead"}</button>
    <button type="button" className="btn small ghost" onClick={() => downloadJson(planFile(plan), `headroom-plan-${fileStamp()}.json`)}>
      <Download size={15} /> Download JSON</button>
    {copy && <p className="hint">The copy is a new plan stored only in this browser. The cloud version stays as it was.</p>}
    {problem && <p className="hint warn">{problem}</p>}
  </div>;
}
