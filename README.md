# Headroom

**Plan your income. Protect your health-insurance subsidy.**

Headroom is a browser-based planning product for self-employed US adults. It helps a household understand how changing income affects its ACA subsidy, compare feasible next steps, and update its plan when income changes again.

**Current status: shared development foundation.** The financial engine, complete UX, cloud persistence and AI document import are assigned to three development branches. The current site clearly identifies this status and does not fabricate financial results.

## Development

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Node 22 is the development baseline. Copy `.env.example` to `.env.local` when connecting optional services. No credentials are needed to build this foundation.

```sh
npm run typecheck
npm test
npm run build
```

## Team handoff

| Branch | Responsibility | Assignment |
| --- | --- | --- |
| [`claude1`](https://github.com/Mustiks07/headroom/tree/claude1) | English interface and complete user journey | [Claude 1](docs/tasks/CLAUDE1.md) |
| [`claude2`](https://github.com/Mustiks07/headroom/tree/claude2) | Financial engine, scenarios and verification | [Claude 2](docs/tasks/CLAUDE2.md) |
| [`claude3`](https://github.com/Mustiks07/headroom/tree/claude3) | Supabase, APIs, documents and integration | [Claude 3](docs/tasks/CLAUDE3.md) |

Use separate clones or worktrees. Start by reading [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

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

Financial outcomes must come from a deterministic, versioned engine. AI may extract facts and explain a calculation, but it does not calculate taxes. Unknown values are never silently treated as zero. Retirement principal, available cash and advance-credit settlement are shown separately.

The included households are synthetic. Some insurance inputs are derived from published CMS county plan candidates, with address availability and personal eligibility assumed. Reference examples are not actual customer savings or independently reviewed tax returns. See [the audit notes](docs/ENGINE_SPEC.md) before reusing the legacy Python prototype.

## Contest delivery

The release must provide a complete public guest journey, English UI, an English PDF deck of at most 10 slides, and this public repository. The live link and deck will be added when the actual artifacts are ready and checked. There are no claimed customers, payments or live integrations in this foundation.
