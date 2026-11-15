import Link from "next/link";
import { TrackVisit } from "@/features/start/TrackVisit";
import { LandingStory } from "@/features/landing/LandingStory";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
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

      <LandingStory />
    </div>
    </main>
    <SiteFooter />
  </>;
}
