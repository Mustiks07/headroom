"use client";

import { ArrowRight, FileSearch, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import type { CaseInput, ReadyRiskAssessment } from "@/domain/contracts";
import { money } from "@/features/format";
import type { DrawerContent } from "./CalculationDrawer";

const COPY = {
  below_cliff: { pill: "Below the limit", tone: "good", icon: ShieldCheck, title: "Your subsidy looks protected at this forecast",
    body: "Your forecast income is under the limit for your household. Big changes in income can still change this." },
  at_risk: { pill: "Close to the limit", tone: "warn", icon: ShieldAlert, title: "Your subsidy may be at risk",
    body: "Your forecast is close to the income limit for your household. A modest increase in profit could end the credit for the year." },
  over_cliff: { pill: "Above the limit", tone: "bad", icon: ShieldX, title: "Your forecast is above the subsidy limit",
    body: "At this income the premium tax credit ends for the year. Advance credit you received may have to be repaid when you file." },
  no_credit: { pill: "No credit expected", tone: "neutral", icon: ShieldQuestion, title: "No premium tax credit is expected for this forecast",
    body: "This isn't caused by an income limit. The calculation shows why the credit is zero with these facts." },
} as const;

export function RiskResult({ assessment, input, stale, onShowCalc, onCompare }: {
  assessment: ReadyRiskAssessment; input: CaseInput; stale: boolean;
  onShowCalc: (content: DrawerContent) => void; onCompare?: () => void;
}) {
  const r = assessment.risk;
  const copy = COPY[r.state];
  const Icon = copy.icon;
  const ratio = r.thresholdMagiCents > 0 ? Math.min(r.forecastMagiCents / r.thresholdMagiCents, 1.3) : 0;
  const settlement = r.advanceSettlementCents;
  const familySize = input.years.find(y => y.year === r.year)?.taxFamilySize;

  return <section className={`risk-card tone-${copy.tone} ${stale ? "is-stale" : ""}`} aria-labelledby="risk-title" aria-busy={stale}>
    {stale && <p className="stale-banner" role="status">Your inputs changed. This check is out of date until it recalculates.</p>}
    <div className="risk-head">
      <span className={`pill ${copy.tone}`}><Icon size={15} aria-hidden="true" /> {copy.pill}</span>
      <span className="muted small">{r.year} forecast · from the figures you entered</span>
    </div>
    <h3 id="risk-title" className="finding">{copy.title}</h3>
    {!stale && <p className="finding-body">{copy.body}</p>}

    <div className="meter-block">
      <div className="meter-labels">
        <div><span className="k">Income counted for the subsidy</span><span className="v num">{money(r.forecastMagiCents)}</span></div>
        <div className="right"><span className="k">Limit for your household{familySize ? ` of ${familySize}` : ""}</span><span className="v num">{money(r.thresholdMagiCents)}</span></div>
      </div>
      <div className="meter" aria-hidden="true">
        <div className="meter-fill" style={{ width: `${(ratio / 1.3) * 100}%` }} />
        <div className="meter-mark" style={{ left: `${(1 / 1.3) * 100}%` }} />
      </div>
      <p className="hint">“Income counted for the subsidy” is your household&apos;s modified adjusted gross income (MAGI) for the Marketplace — not your bank deposits or business revenue.</p>
    </div>

    <dl className="figures">
      <div><dt>Estimated {r.year} premium tax credit</dt><dd className="num">{money(r.subsidyCents)}</dd></div>
      <div><dt>{settlement > 0 ? "Estimated advance credit to repay" : settlement < 0 ? "Estimated extra credit when you file" : "Advance credit settlement when you file"}</dt>
        <dd className={`num ${settlement > 0 ? "neg" : settlement < 0 ? "pos" : ""}`}>{settlement === 0 ? "None expected" : money(Math.abs(settlement))}</dd></div>
      <div><dt>Room for more business profit in {r.year}</dt>
        <dd className="num">{r.additionalProfitHeadroomCents === null ? "Not computed" : money(r.additionalProfitHeadroomCents)}</dd></div>
    </dl>
    {r.additionalProfitHeadroomCents !== null && !stale && <p className="hint">This is extra <strong>profit</strong> (after business costs), not extra revenue, under these assumptions:</p>}
    {!stale && r.headroomAssumptions.length > 0 && <ul className="bullets small">{r.headroomAssumptions.map(a => <li key={a}>{a}</li>)}</ul>}
    {!stale && assessment.warnings.length > 0 && <ul className="warnings">{assessment.warnings.map(w => <li key={w}>{w}</li>)}</ul>}

    <details className="explain">
      <summary>What counts as income here?</summary>
      <p>For Marketplace subsidies, income is your household&apos;s adjusted gross income plus tax-exempt interest and a few other items. For a self-employed person, adjusted gross income starts with business profit, then subtracts half of self-employment tax, SEP-IRA contributions and the self-employed health insurance deduction. Wages of both spouses count. The standard deduction does not reduce it.</p>
    </details>
    <p className="disclaimer">A planning estimate from the figures you entered, not an eligibility decision from the Marketplace or tax advice.</p>
    <div className="row gap wrap">
      <button type="button" className="btn ghost small" disabled={stale} onClick={() => onShowCalc({
        title: `${r.year} subsidy check`, subtitle: "Every figure comes from the calculation engine.", trace: r.trace, input,
        meta: { engineVersion: assessment.engineVersion, rulesVersion: assessment.rulesVersion, fingerprint: assessment.calculationFingerprint },
        assumptions: r.headroomAssumptions,
      })}><FileSearch size={16} /> Show the calculation</button>
      {onCompare && <button type="button" className="btn secondary small" onClick={onCompare}>Check a new project <ArrowRight size={16} /></button>}
    </div>
  </section>;
}
