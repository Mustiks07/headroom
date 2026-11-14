import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getDemoCase } from "@/fixtures/cases";
import { samples } from "@/features/samples";
import { Workspace } from "@/features/workspace/Workspace";

export const metadata: Metadata = { title: "Sample households — Headroom" };

export default async function Demo({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { case: id } = await searchParams;
  const input = id ? getDemoCase(id) : undefined;
  return <>
    <SiteHeader current="demo" />
    <main id="main">
      {input ? <Workspace key={input.id} seed={input} mode="demo" initialStep={input.opportunity.grossRevenueCents > 0 ? "compare" : "household"} />
        : <section className="shell page-pad">
          {id && <p className="notice warn" role="alert">That sample household doesn&apos;t exist. Choose one below.</p>}
          <p className="eyebrow">Sample households · synthetic data</p>
          <h1 className="page-title">Pick a household to explore</h1>
          <p className="intro">Each one opens as an editable workspace. Results come from the same calculation as your own data — change any figure and watch them update.</p>
          <div className="sample-grid">
            {samples.map((s, i) => <Link className="sample-card" key={s.id} href={`/demo?case=${s.id}`}>
              <span className="eyebrow">0{i + 1} · {s.kicker}</span>
              <h3>{s.question}</h3>
              <ul>{s.facts.map(f => <li key={f}>{f}</li>)}</ul>
              <span className="go">Open and edit <ArrowRight size={15} /></span>
            </Link>)}
          </div>
          <p className="muted small">Prefer your own figures? <Link className="text-link" href="/check">Check my subsidy</Link>.</p>
        </section>}
    </main>
    <SiteFooter />
  </>;
}
