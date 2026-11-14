# Headroom

**Plan your income. Protect your health-insurance subsidy.**

Headroom is a browser-based planning product for self-employed US adults. It helps a household understand how changing income affects its ACA subsidy, compare feasible next steps, and update its plan when income changes again.

**Current status: integrated application, with local guest use available without service keys.** The English interface, deterministic financial engine and backend are connected. No signup, email, password or card is required. Optional cloud storage and AI document reading require configuration; they are not represented as live services until checked in deployment.

See the [round 2 integration review](docs/handoffs/integration-round2.md) for checked journeys, corrections and remaining work. Current calculation versions: `headroom-engine-1.1.1` / `us-federal-aca-2026-2027.r3`.

## Try it locally

- Open `/demo?case=family-cliff`: edit a project offer, constrain retirement contributions, compare payment schedules and save a plan.
- Open `/demo?case=ordinary-gig`: see a profitable project where no special intervention is needed.
- Open `/demo?case=missing-spouse-income`: confirm the missing facts before a result is shown.
- Open `/check` for your own current-year subsidy check. Comparing a project across years requires the second-year forecast.

Saved plans reopen in the same browser. “Something changed” first checks the amounts and dates already agreed, then shows new proposals for explicit review. An accepted update records a revision and preserves history. Old rule versions have a separate review/upgrade path. PDF and restorable JSON exports include inputs, assumptions and calculation versions. CSV/TXT imports propose figures for confirmation; PDF/image analysis is optional.

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

**Current assignments:** read the [round 3 shared brief](docs/tasks/ROUND3_SHARED.md), then [Claude 1 — household journey](docs/tasks/CLAUDE1_ROUND3.md), [Claude 2 — combined decisions](docs/tasks/CLAUDE2_ROUND3.md), or [Claude 3 — durable household workspace](docs/tasks/CLAUDE3_ROUND3.md). Round 2 is integrated; its briefs remain as history. Round 3 features are planned, not present in the current release.

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

The initial scope covers federal planning for Texas, Florida and Tennessee, single or married filing jointly, one sole-proprietor business, supported W-2 wages and interest, and full-year Marketplace eligibility in 2026–2027. Unsupported situations return an explanation. The [round 2 engine handoff](docs/handoffs/claude2-round2.md) and its integration correction list limits, rounding and search assumptions. Supported business-profit and interest ranges are independent: validity and loss of credit use the engine's monotone bounds; spendable-cash stress uses finite checks and is not a proven global minimum. Payroll, retirement and insurance ranges remain blocked.

The included households are synthetic. Some insurance inputs are derived from published CMS county plan candidates, with address availability and personal eligibility assumed. Reference examples are not actual customer savings or independently reviewed tax returns. See [the audit notes](docs/ENGINE_SPEC.md) before reusing the legacy Python prototype.

## Contest delivery

The contest submission needs a public guest URL, English UI, an English PDF deck of at most 10 slides, and this public repository. The live link and deck will be added when those artifacts are ready and checked. The $99/year price is a business hypothesis. Checkout is explicitly demo/test mode; no real customer payments or independent professional tax review are claimed.
