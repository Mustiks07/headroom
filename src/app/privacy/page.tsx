import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Privacy & your data — Headroom" };

export default function Privacy() {
  return <>
    <SiteHeader />
    <main id="main" className="shell page-pad prose-page">
      <p className="eyebrow">Privacy</p>
      <h1 className="page-title">Your data</h1>
      <h2>No account</h2>
      <p>Headroom has no sign-up, login or email requirement. If cloud saving is available, the app uses an invisible guest session tied to this browser; otherwise plans are saved only in this browser. Plans are not synced between devices.</p>
      <h2>What is kept</h2>
      <p>The figures you enter or confirm, the calculation result, the option you chose, actions you confirmed and the history of changes. Don&apos;t enter Social Security numbers, bank account numbers or Marketplace passwords — Headroom never asks for them.</p>
      <h2>Documents</h2>
      <p>If document analysis is available, a file you choose is sent to Headroom&apos;s server only to propose figures. Every figure needs your approval before it is used. When analysis isn&apos;t available, Headroom says so and you enter figures manually.</p>
      <p>With your explicit permission, PDF/image reading and AI assistance send the selected file or sentence and relevant project/payment context to the configured AI provider. This release connects through BasisWeb, a third-party Claude-compatible gateway. Headroom does not retain the original uploaded file. Confirmed figures and short source excerpts may be saved with your plan. You can use manual entry without sending data to the AI provider.</p>
      <h2>Calculations</h2>
      <p>Tax and subsidy figures come from a deterministic calculation with versioned rules — not from an AI model. Each result carries the rule version and a fingerprint of the inputs.</p>
      <h2>Deleting your data</h2>
      <p>Delete a single plan from its page, or remove everything at once with <Link className="text-link" href="/plans">Clear my data</Link>.</p>
    </main>
    <SiteFooter />
  </>;
}
