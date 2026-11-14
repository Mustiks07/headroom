import Link from "next/link";
import { MobileNav } from "./MobileNav";
import { JourneyNav } from "./JourneyNav";

/** Native mark (docs/design/c-open/headroom-mark.svg), currentColor; decorative next to the wordmark. */
export function HeadroomMark({ size = 28 }: { size?: number }) {
  return <svg className="mark" width={Math.round(size * 64 / 48)} height={size} viewBox="0 0 64 48" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M4 4C24 4 18 20 32 20C46 20 40 4 60 4V44C40 44 46 28 32 28C18 28 24 44 4 44V4Z" />
  </svg>;
}

type Current = "demo" | "check" | "plans" | "pricing";
const LINKS: Array<{ href: string; key: Current; text: string }> = [
  { href: "/start?intent=offer", key: "check", text: "Check an offer" },
  { href: "/demo", key: "demo", text: "Try a sample" },
  { href: "/household", key: "plans", text: "Your plans" },
  { href: "/pricing", key: "pricing", text: "Pricing" },
];

/** Cobalt header on every page (design C). `stage` = sits on the landing page's cobalt stage. */
export function SiteHeader({ current, stage = false, journey = false }: { current?: Current; stage?: boolean; journey?: boolean }) {
  return <header className={`site-header ${stage ? "on-stage" : ""} ${journey ? "has-journey" : ""}`}>
    <div className="shell nav-row">
      <Link href="/" className="wordmark" aria-label="Headroom home"><HeadroomMark /><span>headroom</span></Link>
      {journey ? <JourneyNav /> : <nav aria-label="Main navigation" className="nav-links">
        {LINKS.map(l => <Link key={l.key} href={l.href} aria-current={current === l.key ? "page" : undefined} className="nav-link">{l.text}</Link>)}
      </nav>}
      <MobileNav links={LINKS} current={current} />
    </div>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="shell footer-row">
      <p>Headroom is a planning tool, not tax or legal advice, and not a Marketplace eligibility decision. Sample households are synthetic.</p>
      <nav aria-label="Footer" className="footer-links">
        <Link href="/privacy">Privacy &amp; your data</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/pricing">Pricing</Link>
      </nav>
    </div>
  </footer>;
}
