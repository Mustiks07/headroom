# Headroom

**Plan your income. Protect your health-insurance subsidy.**

Headroom is a browser-based planning product for self-employed US adults. It helps a household understand how changing income affects its ACA subsidy, compare feasible next steps, and update its plan when income changes again.

**[Open Headroom](https://headroom-amber.vercel.app) · [Try the family example](https://headroom-amber.vercel.app/demo?case=family-cliff) · [Use your own figures](https://headroom-amber.vercel.app/check)**

**Current status: live on Vercel, with guest cloud save connected to Supabase.** The English interface, deterministic financial engine and backend are connected. No signup, email, password or card is required. Public calculation, cloud save/reopen and PDF export were checked on November 15, 2026; see the [live release handoff](docs/handoffs/vercel-live-release.md). CSV/TXT import is available. AI PDF/image reading is not enabled, and checkout remains explicitly in demo mode.

See the [round 4 integration review](docs/handoffs/integration-round4.md) for checked journeys, corrections and remaining work. Current calculation versions: `headroom-engine-1.2.0` / `us-federal-aca-2026-2027.r3`; household layer `headroom-household-1.0.1`, deal search `headroom-deal-1.0.0`.

## Try it locally

- Open `/demo?case=family-cliff`: edit a project offer, constrain retirement contributions, compare payment schedules and save a plan.
- Open `/demo?case=ordinary-gig`: see a profitable project where no special intervention is needed.
- Open `/demo?case=missing-spouse-income`: confirm the missing facts before a result is shown.
- Open `/check` for your own current-year subsidy check. Comparing a project across years requires the second-year forecast.
- Open `/household` for a persistent household plan: an annual or year-to-date forecast, multiple client projects, actual payments, yearly SEP goals and recorded contributions. A sample household is available immediately.

Saved plans reopen in the same browser. “Something changed” first checks the amounts and dates already agreed, then shows new proposals for explicit review. An accepted update records a revision and preserves history. Old rule versions have a separate review/upgrade path. PDF and restorable JSON exports include inputs, assumptions and calculation versions. CSV/TXT imports propose figures for confirmation; PDF/image analysis is optional.

The household workspace separates expected money from payments already received. A new offer is compared on top of existing agreements; changing unpaid terms preserves deposits. Recording a SEP contribution reduces both the unpaid goal and the cash still available. “My income changed” checks the existing plan before suggesting changes. Download the [synthetic annual forecast example](docs/artifacts/round3/annual-income-forecast-explanation-synthetic.pdf) to inspect the exported facts, estimates and calculation trace.

**Find terms for your goal:** in a household project, enter how much more cash you want to keep, your retirement-contribution limit and an optional date target. Headroom searches allowed prices and payment schedules and shows up to three distinct, calculated choices. Choose terms to create a client-message draft, decision PDF and calendar file. Record the client's agreement and actual payments to update the plan. No message is sent automatically. The search is approximate with exact checks of the displayed choices; it does not claim a global optimum. A saved decision's exports currently require its original calculation to remain current; historical exports after agreement are part of the next round.

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

**Next assignments:** read the [round 5 shared brief](docs/tasks/ROUND5_SHARED.md), then [Claude 1 — document-assisted journey](docs/tasks/CLAUDE1_ROUND5.md), [Claude 2 — readiness, change previews and explanations](docs/tasks/CLAUDE2_ROUND5.md), or [Claude 3 — AI, confirmed commands and exports](docs/tasks/CLAUDE3_ROUND5.md). Round 4 is integrated. The full document-first and natural-language workflows are next-round work, not current release claims.

## Specification

- [Product and implementation specification / ТЗ](docs/TZ.md)
- [Architecture and interface agreements](docs/ARCHITECTURE.md)
- [Financial engine requirements](docs/ENGINE_SPEC.md)
- [Design and English copy](docs/DESIGN.md)
- [Finite acceptance and release checks](docs/ACCEPTANCE.md)
- [Deployment and service configuration](docs/DEPLOYMENT.md)
- [Business assumptions and pitch evidence](docs/BUSINESS.md)
- [Official sources and research boundaries](docs/SOURCES.md)

## Calculation boundaries

Financial outcomes come from a deterministic, versioned engine. AI may extract document facts; it does not calculate taxes. Unknown household facts block the affected calculation. Retirement principal, available cash and advance-credit settlement are shown separately.

The initial scope covers federal planning for Texas, Florida and Tennessee, single or married filing jointly, one sole-proprietor business, supported W-2 wages and interest, and full-year Marketplace eligibility in 2026–2027. Unsupported situations return an explanation. The [round 4 engine handoff](docs/handoffs/claude2-round4.md) and [integration review](docs/handoffs/integration-round4.md) list limits and corrections. Supported business-profit and interest ranges are independent: validity and loss of credit use the engine's monotone bounds; spendable-cash stress uses finite checks and is not a proven global minimum. Payroll, retirement and insurance ranges remain blocked. The standard comparison has limited multi-payment alternatives; the goal-based search adds permitted price and timing choices for one project's unpaid terms, holding other commitments fixed.

The included households are synthetic. Some insurance inputs are derived from published CMS county plan candidates, with address availability and personal eligibility assumed. Reference examples are not actual customer savings or independently reviewed tax returns. See [the audit notes](docs/ENGINE_SPEC.md) before reusing the legacy Python prototype.

## Contest delivery

The contest submission needs a public guest URL, English UI, an English PDF deck of at most 10 slides, and this public repository. The verified guest URL is [headroom-amber.vercel.app](https://headroom-amber.vercel.app). The deck will be linked after its final artifact is ready and checked. The $99/year price is a business hypothesis. Checkout is explicitly demo/test mode; no real customer payments or independent professional tax review are claimed.
