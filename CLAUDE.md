@AGENTS.md

## Working with Claude Code on this repo

- Start any sizeable change in plan mode. Read the relevant sections of `docs/ARCHITECTURE.md` and `docs/DESIGN.md`, then propose a plan with the files you'll touch and how you'll verify it. Build only after the plan is agreed.
- Keep a short checklist of the change's acceptance checks and tick them off with evidence: command output, test names, screenshot paths.
- Keep the "Status" section in `AGENTS.md` true when something it lists changes.
- Ask before adding a dependency that isn't named in `docs/ARCHITECTURE.md`.
- Ask before changing the protocol in `packages/shared`, and bump the protocol version when you do.
- Run `npm install`, `npm run build`, `npm run typecheck` and `npm test` before pushing. CI (`.github/workflows/ci.yml`) runs the same on every push and pull request.
