@AGENTS.md

## Working with Claude Code on this repo

- Start each milestone in plan mode. Read the milestone in `docs/BUILD-PLAN.md` and the relevant sections of `docs/ARCHITECTURE.md` and `docs/DESIGN.md`, then propose a plan with the files you'll touch and how you'll verify it. Build only after the plan is agreed.
- Keep a short checklist of the milestone's acceptance checks and tick them off with evidence: command output, test names, screenshot paths.
- When a milestone is done, update the "Status" line in `AGENTS.md`.
- Ask before adding a dependency that isn't named in `docs/ARCHITECTURE.md`.
- Ask before changing the protocol in `packages/shared`, and bump the protocol version when you do.
