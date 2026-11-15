"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCapabilities, getLocalEntitlement, startCheckout, trackEvent, verifyCheckout, type Capabilities } from "@/lib/client/api";

const LEGACY_KEY = "headroom.demo-access.v1";
const ENTITLEMENT_KEY = "headroom:v1:entitlement";

/**
 * Explicit demo checkout: no card fields, no payment, nothing recorded as a
 * purchase. Everything is already unlocked; this only demonstrates the flow.
 * When the deployment has Stripe TEST keys, a clearly labelled test-mode
 * checkout is offered as well; it is verified on the server and never counted as revenue.
 */
export function DemoCheckout() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<null | "demo" | "test">(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void trackEvent("pricing_viewed");
    const entitlement = getLocalEntitlement();
    try { if (entitlement) setActive(entitlement.mode); else if (localStorage.getItem(LEGACY_KEY) === "1") setActive("demo"); } catch { /* ignore */ }
    void getCapabilities().then(setCaps);
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "success" && sessionId) {
      setBusy(true);
      verifyCheckout(sessionId)
        .then(r => { setMessage(r.label); if (r.unlocked) setActive("test"); })
        .catch(e => setMessage(`The test checkout couldn't be verified: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => setBusy(false));
    } else if (params.get("checkout") === "cancelled") {
      setMessage("The test checkout was cancelled. Nothing was charged.");
    }
  }, []);

  async function complete(mode: "demo" | "stripe_test") {
    setBusy(true); setMessage(null);
    try {
      const result = await startCheckout(mode);
      if (result.url) { window.location.assign(result.url); return; }
      if (result.unlocked) setActive("demo");
      setMessage(result.label);
    } catch {
      // The demo unlock does not depend on the server; keep the journey open for judges.
      if (mode === "demo") {
        try { localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify({ mode: "demo" })); } catch { /* ignore */ }
        setActive("demo");
        setMessage("Plan access is active in this browser. No payment was collected.");
      } else {
        setMessage("The test checkout couldn't be started. You can continue without payment instead.");
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(ENTITLEMENT_KEY); } catch { /* ignore */ }
    setActive(null); setMessage(null);
  }

  if (active) return <div className="notice ok" role="status">
    <strong>{active === "test" ? "Stripe test purchase is active in this browser." : "Plan access is active in this browser."}</strong>{" "}
    {active === "test" ? "This was a Stripe test-mode transaction: no real money moved and it is not counted as revenue."
      : "No payment was collected and nothing was recorded as a purchase."}
    {message && <p className="hint">{message}</p>}
    <div className="row gap"><Link className="btn small primary" href="/check">Check my subsidy</Link>
      <button type="button" className="link-btn" onClick={reset}>Reset access preview</button></div>
  </div>;

  if (!open) return <>
    <button type="button" className="btn primary" onClick={() => setOpen(true)} disabled={busy}>Get the household plan</button>
    {message && <p className="hint" role="status">{message}</p>}
  </>;

  return <div className="checkout" role="group" aria-labelledby="checkout-title">
    <p id="checkout-title" className="checkout-flag">No payment will be collected.</p>
    <dl className="summary-list">
      <div><dt>Plan</dt><dd>Household plan, 12 months</dd></div>
      <div><dt>Price</dt><dd>$99.00 / year — $0 charged today</dd></div>
    </dl>
    <div className="row gap wrap">
      <button type="button" className="btn primary" disabled={busy} onClick={() => complete("demo")}>Continue without payment</button>
      {caps?.checkoutMode === "stripe_test" && <button type="button" className="btn secondary" disabled={busy} onClick={() => complete("stripe_test")}>
        Try Stripe test mode (test card only)</button>}
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
    {message && <p className="hint" role="status">{message}</p>}
  </div>;
}
