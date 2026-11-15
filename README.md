# Headroom

**Plan your income. Protect your health-insurance subsidy.**

Headroom is a browser-based planning product for self-employed US adults. It helps a household understand how changing income affects its ACA subsidy, compare feasible next steps, and update its plan when income changes again.

**[Open Headroom](https://headroom-amber.vercel.app) · [Try the family example](https://headroom-amber.vercel.app/demo?case=family-cliff) · [Use your own figures](https://headroom-amber.vercel.app/check)**

**Live on Vercel, with guest cloud save connected to Supabase.** No signup, email, password or card is required. Round 5 connects the selected C interface, goal-based terms, confirmed text updates, historical decision PDFs and current calendar exports. BasisWeb text assistance and text-PDF extraction have been exercised with real provider requests; photos/scanned PDFs are not supported by the configured gateway. All checkout access is no-charge. See the [round 5 integration handoff](docs/handoffs/integration-round5.md) for exact verification and remaining gaps.

Current calculation versions: `headroom-engine-1.3.0` / `us-federal-aca-2026-2027.r3`; household layer `headroom-household-1.0.1`, deal search `headroom-deal-1.1.0`. Earlier reviews remain available as history, including [round 4](docs/handoffs/integration-round4.md).

## Try it locally

- Open `/demo?case=family-cliff`: edit a project offer, constrain retirement contributions, compare payment schedules and save a plan.
- Open `/demo?case=ordinary-gig`: see a profitable project where no special intervention is needed.
- Open `/demo?case=missing-spouse-income`: confirm the missing facts before a result is shown.
- Open `/check` for your own current-year subsidy check. Comparing a project across years requires the second-year forecast.
- Open `/household` for a persistent household plan: an annual or year-to-date forecast, multiple client projects, actual payments, yearly SEP goals and recorded contributions. A sample household is available immediately.

Saved plans reopen in the same browser. “Something changed” first checks the amounts and dates already agreed, then shows new proposals for explicit review. An accepted update records a revision and preserves history. Old rule versions have a separate review/upgrade path. PDF and restorable JSON exports include inputs, assumptions and calculation versions. CSV/TXT imports propose figures for confirmation; PDF/image analysis is optional.

The household workspace separates expected money from payments already received. A new offer is compared on top of existing agreements; changing unpaid terms preserves deposits. Recording a SEP contribution reduces both the unpaid goal and the cash still available. “My income changed” checks the existing plan before suggesting changes. Download the [synthetic annual forecast example](docs/artifacts/round3/annual-income-forecast-explanation-synthetic.pdf) to inspect the exported facts, estimates and calculation trace.

**Find terms for your goal:** enter how much more cash you want to keep, your retirement-contribution limit and an optional date target. Headroom searches allowed prices and payment schedules and shows up to three distinct calculated choices. Choose terms to create a client-message draft, decision PDF and calendar. Record agreement and actual payments to update the plan. No message is sent automatically. The search does not claim a global optimum. Historical decision records retain their original context after later updates; current-plan exports require current calculations. Calendar downloads are snapshots, not a live subscription.

## Development

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Node 22 is the development baseline. Copy `.env.example` to `.env.local` when connecting optional services. Calculation and browser-local plan storage need no credentials.

```sh
npm run typecheck
npm test
npm run build
```

For the bounded browser check, install Chromium once with `npx playwright install chromium`, build the app, then run `npm run check:ui`. It starts a production server on a free port; set `BASE_URL` to use an already running server instead. The script uses an isolated browser context and synthetic households.

## Team handoff

| Branch | Responsibility | Assignment |
| --- | --- | --- |
| [`claude1`](https://github.com/Mustiks07/headroom/tree/claude1) | English interface and complete user journey | [Claude 1](docs/tasks/CLAUDE1.md) |
| [`claude2`](https://github.com/Mustiks07/headroom/tree/claude2) | Financial engine, scenarios and verification | [Claude 2](docs/tasks/CLAUDE2.md) |
| [`claude3`](https://github.com/Mustiks07/headroom/tree/claude3) | Supabase, APIs, documents and integration | [Claude 3](docs/tasks/CLAUDE3.md) |

Use separate clones or worktrees. Start by reading [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

**Next assignments:** [round 6 shared brief](docs/tasks/ROUND6_SHARED.md), [Claude 1 — complete user experience](docs/tasks/CLAUDE1_ROUND6.md), [Claude 2 — trusted decisions and evidence](docs/tasks/CLAUDE2_ROUND6.md), [Claude 3 — common data/AI path](docs/tasks/CLAUDE3_ROUND6.md). These cover the remaining first-input, semantic multi-document, negotiation and partial-payment gaps. They are requirements, not claims that every requested feature is already live.

## Specification

- [Product and implementation specification / ТЗ](docs/TZ.md)
- [Architecture and interface agreements](docs/ARCHITECTURE.md)
- [Financial engine requirements](docs/ENGINE_SPEC.md)
- [Design and English copy](docs/DESIGN.md)
- [Finite acceptance and release checks](docs/ACCEPTANCE.md)
- [Deployment and service configuration](docs/DEPLOYMENT.md)
- [Business assumptions and pitch evidence](docs/BUSINESS.md)
- [Demand, alternatives, first-Cup evidence and modeled unit economics](docs/research/round5-business-research.md)
- [Participant repository comparison and paid-value research](docs/research/README.md)
- [Selected C design — implemented visual system and reference images](docs/design/c-open/README.md)
- [C continuation — proposed lower landing and working-screen compositions](docs/design/c-round6/README.md)
- [Paid demand, pricing experiments and economics assumptions](docs/research/round6-paid-demand.md)
- [Current competitors and the ten-slide evidence plan](docs/research/round6-competition-pitch.md)
- [Code-backed product gap audit](docs/research/round6-product-gap-audit.md)
- [Archived visual exploration — rejected](docs/design/round5/design-direction.md)
- [Official sources and research boundaries](docs/SOURCES.md)

## Calculation boundaries

Financial outcomes come from a deterministic, versioned engine. AI may extract document facts; it does not calculate taxes. Unknown household facts block the affected calculation. Retirement principal, available cash and advance-credit settlement are shown separately.

The initial scope covers federal planning for Texas, Florida and Tennessee, single or married filing jointly, one sole-proprietor business, supported W-2 wages and interest, and full-year Marketplace eligibility in 2026–2027. Unsupported situations return an explanation. The [round 4 engine handoff](docs/handoffs/claude2-round4.md) and [integration review](docs/handoffs/integration-round4.md) list limits and corrections. Supported business-profit and interest ranges are independent: validity and loss of credit use the engine's monotone bounds; spendable-cash stress uses finite checks and is not a proven global minimum. Payroll, retirement and insurance ranges remain blocked. The standard comparison has limited multi-payment alternatives; the goal-based search adds permitted price and timing choices for one project's unpaid terms, holding other commitments fixed.

The included households are synthetic. Some insurance inputs are derived from published CMS county plan candidates, with address availability and personal eligibility assumed. Reference examples are not actual customer savings or independently reviewed tax returns. See [the audit notes](docs/ENGINE_SPEC.md) before reusing the legacy Python prototype.

## Contest delivery

The contest submission needs a public guest URL, English UI, an English PDF deck of at most 10 slides, and this public repository. The verified guest URL is [headroom-amber.vercel.app](https://headroom-amber.vercel.app). The deck will be linked after its final artifact is ready and checked. The $99/year price is a business hypothesis. Checkout is explicitly demo/test mode; no real customer payments or independent professional tax review are claimed.
