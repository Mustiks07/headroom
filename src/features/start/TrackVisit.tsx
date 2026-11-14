"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/client/api";

const KEY = "headroom.visited.v1";

/** Sends one anonymous `first_visit` per browser. Stores only a flag — no id, no data. */
export function TrackVisit() {
  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, "1"); } catch { return; }
    void trackEvent("first_visit", { dataKind: "unknown", inputPath: "none" });
  }, []);
  return null;
}
