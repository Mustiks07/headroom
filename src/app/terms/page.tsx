import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Terms — Headroom" };

export default function Terms() {
  return <>
    <SiteHeader />
    <main id="main" className="shell page-pad prose-page">
      <p className="eyebrow">Terms</p>
      <h1 className="page-title">What Headroom is — and isn&apos;t</h1>
      <p>Headroom is a planning tool for self-employed households with Marketplace health insurance. It estimates federal taxes and premium tax credits from the figures you provide, for the situations listed as supported.</p>
      <ul className="bullets">
        <li>It is not tax, legal or financial advice, and not a Marketplace eligibility decision.</li>
        <li>Results are estimates. They depend on your figures, the benchmark premium you enter and the stated assumptions.</li>
        <li>Headroom does not send messages, file documents or move money for you. Actions count as done only when you confirm them.</li>
        <li>Moving a payment into another year is only valid if the money really can&apos;t be received earlier and your accounting method allows it. Never back-date documents or hide income.</li>
        <li>Sample households are synthetic. The demo checkout collects no payment.</li>
      </ul>
    </main>
    <SiteFooter />
  </>;
}
