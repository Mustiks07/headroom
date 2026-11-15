<p align="center">
  <a href="https://headroom-amber.vercel.app"><img src="assets/readme/hero.png" width="100%" alt="Headroom. Before you say yes. See what a client offer leaves your household after taxes and health insurance."></a>
</p>

<p align="center">
  <strong><a href="https://headroom-amber.vercel.app">Open Headroom ↗</a> &nbsp; · &nbsp; <a href="https://raw.githubusercontent.com/Mustiks07/headroom/main/docs/presentation/headroom-business-cup.pdf">Download 10-slide pitch</a> &nbsp; · &nbsp; <a href="docs/demo/round6-judge-script.md">Live walkthrough</a> &nbsp; · &nbsp; <a href="docs/presentation/README.md">Evidence & business model</a></strong>
</p>

**Know what the project really pays.** Headroom calculates what a client offer adds to your household after costs, taxes and health insurance. Find terms that fit your cash needs, prepare a reply, and recalculate when the deal changes.

For US adults **25–45** who work for themselves and buy Marketplace health insurance. **No signup. No card. Open in your browser.**

## Same fee. Better terms.

One **$12,000 offer**. Two payment schedules. Two very different outcomes for an illustrative Tennessee family.

| The client pays | Extra household cash after tax settlements |
|---|---:|
| $12,000 on December 20, 2026 | **−$3,616** |
| $5,400 on December 15, 2026 + $6,600 on January 4, 2027 | **+$8,310** |

> **$11,926 better than the original terms.** Same fee. No additional retirement contribution.

<a href="docs/artifacts/round6/ui/case1-terms-desktop.png"><img src="docs/artifacts/round6/ui/case1-terms-desktop.png" width="100%" alt="Actual Headroom result: the same $12,000 fee split into $5,400 in December and $6,600 in January leaves $8,310 extra cash versus declining, an $11,926 improvement over the original terms."></a>

Calculated example, compared with declining the unpaid project after both tax settlements. Uses county benchmark assumptions; requires client agreement and eligible payment timing. [Inputs and independent check →](docs/artifacts/round6/scenarios/decision-cases.md)

**[Check your own offer →](https://headroom-amber.vercel.app/check?start=project)**

<details>
<summary><strong>Reproduce the $12,000 calculation</strong></summary>

1. Download [the case 1 plan](https://raw.githubusercontent.com/Mustiks07/headroom/main/docs/artifacts/round6/ui/case-1-importable.json).
2. Open [Your plans](https://headroom-amber.vercel.app/household) → **Restore from a file**.
3. Choose **Find workable terms → Find terms**. Headroom recalculates from the inputs.

</details>

## Work out the deal. Keep the plan current.

| When something happens | What Headroom does |
|---|---|
| **A new offer** | Confirm the extracted facts. See what accepting it would leave your household. |
| **Different terms needed** | Compare permitted prices, dates and retirement contributions against your cash needs. |
| **A client counteroffer** | Preview its effect before applying it. Keep the original offer in the history. |
| **A partial payment** | Record what arrived and when. Keep the remainder separate. |
| **Updated income or documents** | Review the changes and recalculate the same plan. |
| **Ready to act** | Edit the client reply. Export the decision, calendar actions and restorable plan. |

You send the reply. Headroom keeps **proposed, agreed and received** separate.

## Built around your next decision

- **Your limits shape the answer.** Cash needed, payment deadlines, negotiable dates and retirement budget.
- **The answer becomes an action.** Terms to discuss, a client reply and a dated plan.
- **The next visit builds on the last.** New facts update the decision; the original offer stays in its history.

Existing ACA calculators and financial planners cover adjacent needs. [See how the workflows compare →](docs/research/round6-competition-pitch.md)

## AI reads. Code calculates.

<img src="assets/readme/workflow.svg" width="100%" alt="Offer or document → review confirmed facts → deterministic financial engine → terms, reply and dated plan. Real changes return to the review step.">

AI helps read offers and documents. **You confirm the facts.** A versioned financial engine calculates the tax, insurance credit and household cash.

- **Missing stays missing.** Unknown spouse income is never treated as zero.
- **Every fact has context.** Source, person and year stay attached; conflicts need review.
- **Money stays distinct.** Spendable cash, retirement principal and credit settlement are separate.
- **Manual input keeps working.** Calculations and text-PDF reading do not require AI. Scans and photos use pasted or manual figures.

**Next.js · TypeScript · Vercel · Supabase** — one web app, with guest saving and no account screen.

[Architecture](docs/ARCHITECTURE.md) · [Financial engine](docs/ENGINE_SPEC.md) · [Source registry](docs/SOURCES.md) · [Privacy](https://headroom-amber.vercel.app/privacy)

## Open the app. Inspect the evidence.

- **Public app:** offer comparison → workable terms → saved plan → downloaded PDF → reopen.
- **Working journeys:** document review, counteroffers, partial payments and missing facts; mobile inspected at **360px**.
- **Private guest data:** **28 Supabase isolation checks** passed.

<details>
<summary><strong>Build, AI checks and verification scope</strong></summary>

Production build and TypeScript checks passed. Browser checks covered family, ordinary profitable offer, missing facts, document review, counteroffer, partial payment, save/reopen and PDF/calendar outputs. Supabase checks included cross-guest access and server-only AI counters.

Live provider smoke checks exercised an offer email and a text W-2 PDF. These are bounded engineering checks, not general AI accuracy or professional tax certification. Historical decisions retain their original inputs; stale results cannot become a current export.

</details>

[Release record](docs/handoffs/integration-round6.md) · [Actual screenshots and exports](docs/artifacts/round6/ui/) · [Technical proof](docs/demo/round6-technical-proof.md)

## Pay for a decision. Return for the next deal.

The household pays. **The current app is free to use.** Proposed pricing:

| One decision | Ongoing project work |
|---|---|
| **$29** · one offer, 30 days of revisions | **$99/year** · validate after repeat demand |

First channels to test: **broker referrals and independent-worker communities**. Explore the official market data, paid alternatives and reproducible economics:

[Market and launch decisions](docs/research/round6-launch-decisions.md) · [Pricing research](docs/research/round6-monetization-review.md) · [Unit economics and sensitivities](docs/research/round6-economics.md) · [97 participant repositories reviewed](docs/research/COMPETITOR_REPOS_ROUND5.md)

## Run it yourself

Use Node 22.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Calculations and browser-local storage work without credentials. For optional cloud save and AI, copy `.env.example` to `.env.local` and follow [deployment configuration](docs/DEPLOYMENT.md). Never commit credentials.

```sh
npm run typecheck
npm test
npm run build
```

For the current browser walkthrough use [the round 6 script](docs/demo/round6-judge-script.md). The legacy `check:ui` script targets older screens.

<details>
<summary><strong>Supported calculations and review boundaries</strong></summary>

The current scope is federal planning for Texas, Florida and Tennessee; single or married filing jointly; one sole-proprietor business; supported W-2 wages and interest; full-year Marketplace eligibility in 2026–2027; and an owner-only SEP-IRA. It is a planning tool, not tax filing or an official Marketplace eligibility decision.

The search evaluates permitted candidates and rechecks displayed options with the full engine. It does not claim a global optimum between search points. Calendar files are downloadable snapshots, not a live subscription. Some illustrative insurance inputs use CMS county plan candidates with address availability and eligibility assumed.

Current versions: `headroom-engine-1.3.0`, `headroom-household-1.0.1`, `headroom-deal-1.2.0`, `us-federal-aca-2026-2027.r3`.

[Engine scope](docs/ENGINE_SPEC.md) · [Finite acceptance checks](docs/ACCEPTANCE.md) · [Integrated handoff](docs/handoffs/integration-round6.md)

</details>

<details>
<summary><strong>Specification, collaboration and research archive</strong></summary>

[Product specification](docs/TZ.md) · [Design system C](docs/design/c-open/README.md) · [Round 6 shared brief](docs/tasks/ROUND6_SHARED.md) · [Claude 1 delivery](docs/handoffs/claude1-round6.md) · [Claude 2 delivery](docs/handoffs/claude2-round6.md) · [Claude 3 delivery](docs/handoffs/claude3-round6.md) · [Research index](docs/research/README.md)

Contributors start with [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md), using separate branches/worktrees and the shared domain contracts. Public-facing figures must match the current engine and documented source.

</details>

---

**Business Cup · Money · B2C · Web**

**[Try Headroom ↗](https://headroom-amber.vercel.app) · [Download the pitch](https://raw.githubusercontent.com/Mustiks07/headroom/main/docs/presentation/headroom-business-cup.pdf) · [Submission materials](docs/presentation/README.md)**
