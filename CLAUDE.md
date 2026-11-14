# Start here

Read `AGENTS.md` and follow the assignment matching your branch:

- `claude1` → `docs/tasks/CLAUDE1_ROUND5.md`
- `claude2` → `docs/tasks/CLAUDE2_ROUND5.md`
- `claude3` → `docs/tasks/CLAUDE3_ROUND5.md`

Read `docs/handoffs/integration-round4.md` and `docs/tasks/ROUND5_SHARED.md` first. The base specification is `docs/TZ.md`. Shared types are `src/domain/contracts.ts`, `src/domain/household-workspace.ts` and `src/domain/deal-planning.ts`; Claude 3 publishes the additive round 5 assistance contract first.
Then read `docs/tasks/ROUND5_RESEARCH_ADDENDUM.md` for the completed competitor/paid-value research. **The user rejected the round5 visual direction: do not implement its logo, palette, fonts or screen compositions as a selected design.** **Selected design, November 15: the user chose C — saturated cobalt, chrome H and chartreuse action. Read `docs/design/c-open/README.md`, `spec.md`, `tokens.json` and `claude1-handoff.md`; these are the current implementation references.** `docs/design/round5` remains a rejected archive. Continue existing functional work; do not restart it. Concepts are not evidence of released features. Continue round5 functional work. Assistance contract commit `97b608c3a3bcf873b41ae59ae1270a8740b35eb7` is available from Claude 3.
This is an existing shared foundation. Implement your assigned part; do not generate a competing app or change the core product.
Use a separate clone/worktree. Fetch and merge `origin/main` normally before starting. Leave the current handoff in `docs/handoffs/claudeN-round5.md`, commit and push your own branch. Codex reviews and integrates `main`.
