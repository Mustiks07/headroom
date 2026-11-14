import Link from "next/link";
import { TrackVisit } from "@/features/start/TrackVisit";
import { ArrowRight, CalendarClock, FileSearch, Layers, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { samples } from "@/features/samples";
import { ContinuePlan } from "@/features/start/ContinuePlan";
import { HeroEntry } from "@/features/start/HeroEntry";

export default function Home() {
  return <>
    <SiteHeader stage />
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="shell hero-inner">
          <h1 id="hero-title">Before you say yes.</h1>
          <p className="hero-lead">See what a client offer leaves you after tax and health insurance.</p>
          <div className="hero-entry"><HeroEntry /></div>
          <div className="hero-scene" aria-hidden="true">
            <picture>
              <source type="image/webp" srcSet="/brand/hero-scene-640.webp 640w, /brand/hero-scene-1024.webp 1024w, /brand/hero-scene-1536.webp 1536w" sizes="(max-width: 800px) 92vw, 960px" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/hero-scene-1024.webp" alt="" width={1536} height={1024} decoding="async" fetchPriority="high" />
            </picture>
            <div className="offer-paper"><span>Client offer</span><strong>$12,000</strong></div>
          </div>
        </div>
      </section>
    <div className="after-stage">
      <ol className="shell flow-strip" aria-label="How it works">
        <li>Your offer</li><li>Your facts</li><li>Your next move</li>
      </ol>
      <div className="shell after-entry">
        <ContinuePlan />
        <TrackVisit />
        <p className="small muted">Not about an offer? <Link className="text-link" href="/start?intent=year">Check my year&apos;s income</Link> — whether this year keeps your subsidy, no project needed. The $12,000 above is illustrative.</p>
      </div>

      <section className="shell band" aria-labelledby="why">
        <div className="why-grid">
          <div>
            <p className="eyebrow">Why this matters</p>
            <h2 id="why" className="section-title">One more invoice can cost more than it pays.</h2>
          </div>
          <div className="prose">
            <p>Marketplace premium credits are based on your household&apos;s income for the whole year. When income rises past the limit for your household, the credit can end — and advance credit already paid to your insurer may have to be repaid when you file.</p>
            <p>Business profit, bank deposits and the income the Marketplace counts are three different numbers. Headroom works out the one that matters and shows each step.</p>
          </div>
        </div>
      </section>

      <section className="shell" aria-labelledby="how">
        <p className="eyebrow">How it works</p>
        <h2 id="how" className="section-title">From “am I at risk?” to a plan you can keep current</h2>
        <ol className="how-grid">
          <li><ShieldCheck size={22} aria-hidden="true" /><h3>Check your subsidy</h3><p>Enter this year&apos;s forecast — or import a pay stub. See your income for the subsidy, your household&apos;s limit, and how much room is left.</p></li>
          <li><Layers size={22} aria-hidden="true" /><h3>Compare what you can do</h3><p>Accept as offered, add a SEP-IRA contribution, split the payment between years, or negotiate the price — only the options your limits allow.</p></li>
          <li><CalendarClock size={22} aria-hidden="true" /><h3>Keep the plan current</h3><p>Save the plan with dated actions. When something changes, update one figure and see exactly what moved.</p></li>
        </ol>
        <p className="how-note"><FileSearch size={16} aria-hidden="true" /> Every key number has <strong>Show the calculation</strong>: the input it came from, the rule it used and the assumptions behind it.</p>
      </section>

      <section className="shell" aria-labelledby="samples">
        <p className="eyebrow">Sample households · synthetic data</p>
        <h2 id="samples" className="section-title">See it work before typing anything</h2>
        <div className="sample-grid">
          {samples.map((s, i) => <Link className="sample-card" key={s.id} href={`/demo?case=${s.id}`}>
            <span className="eyebrow">0{i + 1} · {s.kicker}</span>
            <h3>{s.question}</h3>
            <ul>{s.facts.map(f => <li key={f}>{f}</li>)}</ul>
            <span className="go">Open and edit <ArrowRight size={15} /></span>
          </Link>)}
        </div>
      </section>

      <section className="shell scope" aria-labelledby="scope">
        <div>
          <p className="eyebrow">What this version covers</p>
          <h2 id="scope" className="section-title">Honest about its limits</h2>
        </div>
        <div className="scope-cols">
          <div><h3>Covered</h3><ul className="bullets">
            <li>Federal taxes for Texas, Florida and Tennessee residents</li>
            <li>Single or married filing jointly, 2026 and 2027 tax years</li>
            <li>One sole-proprietor business, W-2 wages for each spouse, interest</li>
            <li>Marketplace coverage and an owner-only SEP-IRA</li>
          </ul></div>
          <div><h3>Not covered — we say so instead of guessing</h3><ul className="bullets">
            <li>Other states&apos; income tax, S-corps and partnerships</li>
            <li>Itemized deductions, capital gains, rental or Social Security income</li>
            <li>Coverage that changes mid-year unless the engine supports it</li>
            <li>Tax advice or a Marketplace eligibility decision</li>
          </ul></div>
        </div>
      </section>

      <section className="shell price-teaser">
        <div><p className="eyebrow">Pricing</p><h2 className="section-title">$99 / year, per household</h2>
          <p className="muted">Checking your risk is free. A year of plan updates, scenarios and accountant-ready exports is $99. In this demo, everything is unlocked.</p></div>
        <Link href="/pricing" className="btn ghost">See what&apos;s included</Link>
      </section>
    </div>
    </main>
    <SiteFooter />
  </>;
}
