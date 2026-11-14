"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "headroom.demo-access.v1";

/**
 * Explicit demo checkout: no card fields, no payment, nothing recorded as a
 * purchase. Everything is already unlocked; this only demonstrates the flow.
 */
export function DemoCheckout() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => { try { setActive(localStorage.getItem(KEY) === "1"); } catch { /* ignore */ } }, []);

  if (active) return <div className="notice ok" role="status">
    <strong>Demo access is active in this browser.</strong> No payment was collected and nothing was recorded as a purchase.
    <div className="row gap"><Link className="btn small primary" href="/check">Check my subsidy</Link>
      <button type="button" className="link-btn" onClick={() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setActive(false); }}>Reset demo</button></div>
  </div>;

  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Get the household plan</button>;

  return <div className="checkout" role="group" aria-labelledby="checkout-title">
    <p id="checkout-title" className="checkout-flag">Demo checkout. No payment will be collected.</p>
    <dl className="summary-list">
      <div><dt>Plan</dt><dd>Household plan, 12 months</dd></div>
      <div><dt>Price</dt><dd>$99.00 — not charged in this demo</dd></div>
    </dl>
    <div className="row gap wrap">
      <button type="button" className="btn primary" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setActive(true); }}>Complete demo checkout</button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  </div>;
}
