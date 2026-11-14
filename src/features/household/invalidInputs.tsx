"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Draft } from "./draft";

export interface InvalidEntry { text: string; message: string; low?: string; high?: string }
export interface InvalidApi {
  get(key: string): InvalidEntry | undefined;
  set(key: string, entry: InvalidEntry | null): void;
}

const Ctx = createContext<InvalidApi | null>(null);

/**
 * Typed-but-invalid amounts live in the draft (draft.ui.invalid), not only in
 * the input box. Recording one counts as an edit: results become stale and
 * buildCaseInput refuses to calculate until it is fixed.
 */
export function InvalidInputsProvider({ draft, update, children }: {
  draft: Draft; update: (mutate: (d: Draft) => void) => void; children: React.ReactNode;
}) {
  const invalid = draft.ui.invalid;
  const api = useMemo<InvalidApi>(() => ({
    get: key => invalid?.[key],
    set: (key, entry) => {
      const current = invalid?.[key];
      if (!entry && !current) return;
      if (entry && current && current.text === entry.text && current.message === entry.message && current.low === entry.low && current.high === entry.high) return;
      update(d => {
        const next = { ...(d.ui.invalid ?? {}) };
        if (entry) next[key] = entry; else delete next[key];
        d.ui.invalid = Object.keys(next).length ? next : undefined;
        if (!d.ui.invalid) delete d.ui.invalid;
      });
    },
  }), [invalid, update]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useInvalidInputs(): InvalidApi | null {
  return useContext(Ctx);
}

/** Same registry for forms that are not backed by the /check draft (e.g. household-plan edit panels). */
export function LocalInvalidProvider({ children, onCountChange }: { children: React.ReactNode; onCountChange?: (n: number) => void }) {
  const [entries, setEntries] = useState<Record<string, InvalidEntry>>({});
  const api = useMemo<InvalidApi>(() => ({
    get: key => entries[key],
    set: (key, entry) => setEntries(prev => {
      const cur = prev[key];
      if (!entry && !cur) return prev;
      if (entry && cur && cur.text === entry.text && cur.message === entry.message && cur.low === entry.low && cur.high === entry.high) return prev;
      const next = { ...prev };
      if (entry) next[key] = entry; else delete next[key];
      return next;
    }),
  }), [entries]);
  const count = Object.keys(entries).length;
  useEffect(() => { onCountChange?.(count); }, [count, onCountChange]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
