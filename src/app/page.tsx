import Link from "next/link";
import { demoCases } from "@/fixtures/cases";

export default function Home() {
  return <main className="shell">
    <nav aria-label="Main navigation"><Link href="/" className="wordmark">headroom<span>↗</span></Link><span className="badge">Development foundation</span></nav>
    <section className="hero"><p className="eyebrow">YOUR INCOME. YOUR HEALTH COVERAGE.</p>
      <h1>Earn with a clearer<br />picture of what you keep.</h1>
      <p className="intro">Understand how a new freelance project could affect your family's health-insurance subsidy—and compare your next steps.</p>
      <p className="notice">This repository contains the shared specification and development foundation. The financial engine and complete application are being implemented.</p>
    </section>
    <section aria-labelledby="examples"><h2 id="examples">Shared development examples</h2><div className="cards">
      {demoCases.map((item, index) => <Link className="card" key={item.id} href={`/demo?case=${item.id}`}><span className="eyebrow">0{index + 1} / ILLUSTRATIVE</span><h3>{item.title}</h3><span>Open example →</span></Link>)}
    </div></section>
    <footer>Headroom · Business Cup · Synthetic examples, no customer records.</footer>
  </main>;
}
