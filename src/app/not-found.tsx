import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export default function NotFound() {
  return <>
    <SiteHeader />
    <main id="main" className="shell page-pad">
      <h1 className="page-title">This page doesn&apos;t exist</h1>
      <p className="intro">Check your subsidy, or open a sample household.</p>
      <div className="row gap"><Link className="btn primary" href="/check">Check my subsidy</Link><Link className="btn ghost" href="/demo">Sample households</Link></div>
    </main>
    <SiteFooter />
  </>;
}
