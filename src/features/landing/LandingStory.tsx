"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, FileText, RefreshCw } from "lucide-react";
import "./landing.css";

const steps = [
  { title: "Read the offer", detail: "Start with the message. Confirm the facts that matter." },
  { title: "Compare your choices", detail: "See what changes when the terms change." },
  { title: "Prepare your reply", detail: "Turn a decision into a clear next step." },
];

/** An interactive explanation, deliberately without a second marketing calculator. */
export function LandingStory() {
  const [step, setStep] = useState(1);
  return <div className="landing-story">
    <section className="shell landing-value" aria-labelledby="landing-value-title">
      <div className="landing-value-copy">
        <p className="landing-kicker">A clearer answer to a bigger offer</p>
        <h2 id="landing-value-title">The price isn’t<br />what you keep.</h2>
        <p>Project costs, taxes and health insurance change the answer. See the whole picture before you agree.</p>
        <a href="#how" className="landing-inline-link">Find your next move <ArrowDown size={18} aria-hidden="true" /></a>
      </div>
      <figure className="landing-offer-figure" aria-label="An offer becomes a decision after project costs, taxes and insurance are considered">
        <div className="landing-paper-backing" aria-hidden="true" />
        <div className="landing-offer-sheet">
          <div className="landing-sheet-top"><FileText size={20} aria-hidden="true" /><span>Client offer</span><span className="landing-sheet-index">01</span></div>
          <p>Brand identity project</p>
          <strong>$12,000</strong>
          <span className="landing-sheet-note">Payment terms: to be agreed</span>
        </div>
        <ol className="landing-offer-breakdown">
          <li><span>Project costs</span></li>
          <li><span>Tax &amp; health insurance</span></li>
          <li><span>Money for you <ArrowRight size={17} aria-hidden="true" /></span></li>
        </ol>
        <figcaption>Illustrative offer. Your result uses your own figures.</figcaption>
      </figure>
    </section>

    <section className="shell landing-workbench-section" aria-labelledby="how">
      <div className="landing-section-rule"><span>FROM OFFER TO DECISION</span><span>01 — 03</span></div>
      <h2 id="how">Make the terms<br />work for you.</h2>
      <div className="landing-workbench-grid">
        <div className="landing-step-list" aria-label="Explore how Headroom works">
          {steps.map((item, i) => <button type="button" key={item.title} className="landing-step" aria-pressed={step === i} aria-controls="landing-preview" onClick={() => setStep(i)}>
            <span className="landing-step-number">0{i + 1}</span>
            <span><strong>{item.title}</strong><span className="landing-step-detail">{item.detail}</span></span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>)}
        </div>
        <div className="landing-workbench" id="landing-preview" aria-live="polite" aria-atomic="true">
          <div key={step} className="landing-preview-content">
            <div className="landing-preview-top"><span>HOW IT WORKS</span><span>0{step + 1} / 03</span></div>
            {step === 0 && <>
              <h3>Start with the actual offer.</h3>
              <blockquote>“We’d like to book the brand project. The budget is $12,000. Can we discuss the payment schedule?”</blockquote>
              <dl className="landing-fact-rows">
                <div><dt>Project price</dt><dd>$12,000 <span>From the message</span></dd></div>
                <div><dt>Payment dates</dt><dd>Confirm with the client</dd></div>
                <div><dt>Your household facts</dt><dd>Added by you</dd></div>
              </dl>
              <p className="landing-preview-note">Review extracted facts before using them. You can enter figures directly, too.</p>
            </>}
            {step === 1 && <>
              <h3>One offer. Different ways forward.</h3>
              <p className="landing-preview-intro">Compare the cash left after taxes and health insurance, with retirement money shown separately.</p>
              <div className="landing-options-ledger">
                <div><span><span className="landing-option-dot" />Accept as offered</span><span>Your starting point</span></div>
                <div className="landing-option-highlight"><span><span className="landing-option-dot" />Split the payment</span><span>If you can agree terms</span></div>
                <div><span><span className="landing-option-dot" />Change the price</span><span>Work toward your goal</span></div>
              </div>
              <p className="landing-preview-note">Available choices depend on your facts and constraints. Your calculation shows the difference.</p>
            </>}
            {step === 2 && <>
              <h3>Leave with a next move.</h3>
              <div className="landing-reply-sheet"><span className="landing-reply-label">YOUR DECISION PACK</span>
                <p>Terms to discuss.<br />Actions to take.<br />Numbers you can explain.</p>
                <div><Check size={17} aria-hidden="true" /> Client reply draft</div>
                <div><Check size={17} aria-hidden="true" /> Dated actions and calendar export</div>
                <div><Check size={17} aria-hidden="true" /> A calculation record for your accountant</div>
              </div>
              <p className="landing-preview-note">You review and send the reply. A proposed change becomes an agreement only when the client accepts.</p>
            </>}
            <Link className="btn primary landing-main-action" href="/check?start=project">Check my offer <ArrowRight size={20} aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
    </section>

    <section className="landing-return" aria-labelledby="landing-return-title">
      <div className="shell landing-return-grid">
        <div>
          <p className="landing-kicker"><RefreshCw size={15} aria-hidden="true" /> KEEP THE ANSWER CURRENT</p>
          <h2 id="landing-return-title">When the client<br />changes the plan.</h2>
          <p className="landing-return-lead">A different payment date. A smaller deposit. A new offer. Update the facts and see what needs to change next.</p>
        </div>
        <div className="landing-change-sheet">
          <div className="landing-change-message"><span>CLIENT MESSAGE</span><p>“Can we move the final payment to January?”</p></div>
          <div className="landing-change-dates"><div><span>Original timing</span><strong>December</strong></div><ArrowRight size={26} aria-hidden="true" /><div><span>Proposed timing</span><strong>January</strong></div></div>
          <p>Compare both years before changing your plan.</p>
          <Link href="/household" className="btn primary landing-main-action">Open your plans <ArrowRight size={20} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>

    <section className="shell landing-fit" aria-labelledby="landing-fit-title">
      <div><p className="landing-kicker">FOR PEOPLE WHO WORK FOR THEMSELVES</p><h2 id="landing-fit-title">Your figures.<br />Your decision.</h2><p>Built for independent professionals with Marketplace health insurance and income that can change.</p></div>
      <div className="landing-fit-detail">
        <div><span>Start where you are</span><strong>Paste an offer, add a document or enter figures.</strong></div>
        <div><span>Understand the result</span><strong>Follow each key number back to its calculation.</strong></div>
        <div><span>Keep it useful</span><strong>Save, revisit and export your plan.</strong></div>
        <details><summary>Check whether Headroom fits your situation</summary><p>Federal planning for single or married-filing-jointly households in Texas, Florida and Tennessee, with one sole-proprietor business. Supports 2026 and 2027, Marketplace coverage, wages, interest and an owner-only SEP-IRA. The calculation checks your case before producing a result.</p><Link className="landing-inline-link" href="/terms">Read the full scope <ArrowRight size={16} aria-hidden="true" /></Link></details>
      </div>
    </section>
    <section className="shell landing-closing" aria-label="Get started">
      <div><h2>A better-informed yes.</h2><p>Start with the offer in front of you.</p></div>
      <div><Link className="btn primary landing-main-action" href="/check?start=project">Check my offer <ArrowRight size={20} aria-hidden="true" /></Link><Link className="landing-pricing-link" href="/pricing">See pricing &amp; what’s included</Link></div>
    </section>
  </div>;
}
