"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Paperclip } from "lucide-react";
import { trackEvent } from "@/lib/client/api";
import { PASTED_KEY } from "./StartChooser";

/**
 * The white offer-entry tray on the cobalt stage (design C). The pasted text goes into the same
 * import review as files (/check?start=project&pasted=1); nothing is read or sent here.
 */
export function HeroEntry() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError("Paste the offer or describe the project — or add a document instead."); field.current?.focus(); return; }
    void trackEvent("start", { dataKind: "own", inputPath: "paste" });
    if (text.length > 8000) { setError("This reader accepts up to 8,000 characters. Shorten the offer before continuing."); return; }
    try { sessionStorage.setItem(PASTED_KEY, text); } catch { setError("This browser could not carry the text to the next page. Use Enter figures below, or allow browser storage."); return; }
    router.push("/check?start=project&pasted=1");
  }
  return <form className="entry-tray" onSubmit={submit} noValidate>
    <label htmlFor="hero-offer" className="tray-label">Start with a client offer</label>
    <div className="tray-row">
      <textarea id="hero-offer" ref={field} rows={1} maxLength={8000} value={text} placeholder="Paste the offer or describe the project…"
        aria-invalid={!!error} aria-describedby={error ? "hero-offer-error" : "hero-offer-hint"}
        onChange={e => { setText(e.target.value); if (error) setError(null); }} />
      <button type="submit" className="btn primary hero-cta">Check my offer <ArrowRight size={20} aria-hidden="true" /></button>
    </div>
    {error ? <p id="hero-offer-error" className="field-error" role="alert">{error}</p>
      : <p id="hero-offer-hint" className="visually-hidden">For example: Project fee $12,000, expected payment December 20, 2026.</p>}
    <div className="tray-links">
      <Link href="/check?start=project&doc=1" onClick={() => void trackEvent("start", { dataKind: "own", inputPath: "document" })}><Paperclip size={18} aria-hidden="true" /> Add document</Link>
      <Link href="/check?start=project" onClick={() => void trackEvent("start", { dataKind: "own", inputPath: "manual" })}>Enter figures</Link>
      <Link href="/#how">How it works</Link>
      <span className="tray-note">No account needed</span>
    </div>
  </form>;
}
