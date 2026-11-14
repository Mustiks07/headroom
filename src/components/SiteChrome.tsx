import Link from "next/link";

export function SiteHeader({ current }: { current?: "demo" | "check" | "plans" | "pricing" }) {
  const link = (href: string, key: typeof current, text: string) =>
    <Link href={href} aria-current={current === key ? "page" : undefined} className="nav-link">{text}</Link>;
  return <header className="site-header">
    <div className="shell nav-row">
      <Link href="/" className="wordmark" aria-label="Headroom home">headroom<span aria-hidden="true">↗</span></Link>
      <nav aria-label="Main navigation" className="nav-links">
        {link("/check", "check", "Check my subsidy")}
        {link("/demo", "demo", "Sample households")}
        {link("/household", "plans", "My plans")}
        {link("/pricing", "pricing", "Pricing")}
      </nav>
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
