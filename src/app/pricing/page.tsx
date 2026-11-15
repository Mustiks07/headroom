import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { DemoCheckout } from "@/features/pricing/DemoCheckout";

export const metadata: Metadata = { title: "Pricing — Headroom" };

export default function Pricing() {
  return <>
    <SiteHeader current="pricing" />
    <main id="main" className="shell page-pad">
      <p className="eyebrow">Pricing</p>
      <h1 className="page-title">One price per household, for the whole year</h1>
      <p className="intro">Checking your subsidy risk is free. The yearly plan is for keeping a household decision current as work, pay and insurance change.</p>
      <div className="price-grid">
        <section className="price-card">
          <h2>Free check</h2>
          <p className="price">$0</p>
          <ul className="ticks">
            <li><Check size={16} aria-hidden="true" /> Your current-year subsidy risk</li>
            <li><Check size={16} aria-hidden="true" /> Income limit and room for more profit</li>
            <li><Check size={16} aria-hidden="true" /> Show the calculation for every figure</li>
          </ul>
          <Link href="/check" className="btn ghost">Check my subsidy</Link>
        </section>
        <section className="price-card featured">
          <h2>Household plan</h2>
          <p className="price">$99 <span>/ year, per household</span></p>
          <ul className="ticks">
            <li><Check size={16} aria-hidden="true" /> Compare options for new projects: SEP-IRA, split payment, price</li>
            <li><Check size={16} aria-hidden="true" /> A saved plan with dated actions</li>
            <li><Check size={16} aria-hidden="true" /> Update after any change — new income, cancelled payment, spouse income, coverage</li>
            <li><Check size={16} aria-hidden="true" /> Accountant-ready PDF and restorable JSON exports</li>
          </ul>
          <DemoCheckout />
        </section>
      </div>
      <p className="muted small">Planned annual price. All features are currently available at no charge, including your own data — no card or account needed.</p>
    </main>
    <SiteFooter />
  </>;
}
