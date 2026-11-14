"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Design C working-screen navigation: Your offer → Your facts → Your terms. The page that owns the
 * journey (check workspace, household plan) reports the current step and handles a click; the header
 * only displays it. Steps a page can't open yet are shown but disabled, with the reason as a title.
 */
export type JourneyStep = "offer" | "facts" | "terms";
export type JourneyState = { current: JourneyStep; disabled?: Partial<Record<JourneyStep, string>> };

const STATE_EVENT = "headroom:journey";
const GO_EVENT = "headroom:journey-go";
const LABELS: Record<JourneyStep, string> = { offer: "Your offer", facts: "Your facts", terms: "Your terms" };

/** Page side: publish the current step and react to header clicks. */
export function useJourney(state: JourneyState, onGo: (step: JourneyStep) => void) {
  const go = useRef(onGo);
  go.current = onGo;
  const key = JSON.stringify(state);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<JourneyState>(STATE_EVENT, { detail: state }));
    (window as { __headroomJourney?: JourneyState }).__headroomJourney = state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const h = (e: Event) => go.current((e as CustomEvent<JourneyStep>).detail);
    window.addEventListener(GO_EVENT, h);
    return () => { window.removeEventListener(GO_EVENT, h); delete (window as { __headroomJourney?: JourneyState }).__headroomJourney; };
  }, []);
}

/** Header side. */
export function JourneyNav() {
  const [state, setState] = useState<JourneyState | null>(null);
  useEffect(() => {
    const initial = (window as { __headroomJourney?: JourneyState }).__headroomJourney;
    if (initial) setState(initial);
    const h = (e: Event) => setState((e as CustomEvent<JourneyState>).detail);
    window.addEventListener(STATE_EVENT, h);
    return () => window.removeEventListener(STATE_EVENT, h);
  }, []);
  const steps: JourneyStep[] = ["offer", "facts", "terms"];
  return <nav className="journey-nav" aria-label="Your progress">
    <ol>{steps.map(s => {
      const reason = state?.disabled?.[s];
      return <li key={s}><button type="button" className="journey-step" aria-current={state?.current === s ? "step" : undefined}
        aria-disabled={reason ? true : undefined} title={reason}
        onClick={() => { if (!reason) window.dispatchEvent(new CustomEvent<JourneyStep>(GO_EVENT, { detail: s })); }}>
        {LABELS[s]}
      </button>{reason && <span className="visually-hidden"> — {reason}</span>}</li>;
    })}</ol>
  </nav>;
}
