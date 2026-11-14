import Link from "next/link";
import { notFound } from "next/navigation";
import { getDemoCase } from "@/fixtures/cases";
import { calculateComparison } from "@/lib/engine";

export default async function Demo({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { case: id = "family-cliff" } = await searchParams;
  const input = getDemoCase(id);
  if (!input) notFound();
  const result = await calculateComparison(input);
  return <main className="shell"><nav><Link className="wordmark" href="/">headroom<span>↗</span></Link><Link href="/">← Examples</Link></nav>
    <section className="hero"><p className="eyebrow">SHARED INPUT / {input.id}</p><h1>{input.title}</h1>
      <p className="intro">{input.evidence[0].label}</p>
      <div className="notice" role="status">{result.status === "ready" ? "The engine has returned a calculation. The comparison interface is being implemented." : result.message}</div>
      <p>Developer handoff: Claude 1 owns the interface; Claude 2 implements the shared calculator; Claude 3 implements storage and document import.</p>
    </section>
  </main>;
}
