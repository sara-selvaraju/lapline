@AGENTS.md

## Working with Claude Code on this repo

- Start each milestone in plan mode. Read the milestone in `docs/BUILD-PLAN.md` and the relevant sections of `docs/ARCHITECTURE.md` and `docs/DESIGN.md`, then propose a plan with the files you'll touch and how you'll verify it. Build only after the plan is agreed.
- Keep a short checklist of the milestone's acceptance checks and tick them off with evidence: command output, test names, screenshot paths.
- When a milestone is done, update the "Status" line in `AGENTS.md`.
- Ask before adding a dependency that isn't named in `docs/ARCHITECTURE.md`.
- Ask before changing the protocol in `packages/shared`, and bump the protocol version when you do.

## Development workflow

### Setup (already in place)
- GitHub repo is the source of truth. Railway deploys automatically from `main` via its GitHub integration.
- Railway "Wait for CI" is on: a deploy only proceeds after GitHub Actions passes on that commit.
- GitHub Actions workflow `.github/workflows/ci.yml` runs on every PR and on push to `main`. Its job id is `build`; do not rename it, as branch protection depends on it.
- `main` is protected by a ruleset: no direct pushes, no force pushes, PRs required, and the `build` check must pass before merging.

### Loop for every change
1. Start from an up-to-date main: `git checkout main && git pull`.
2. Create a short descriptive branch, e.g. `feat/track-elevation` or `fix/timing-overlay`.
3. Make the change in small, focused commits.
4. Run the install and build locally (plus lint/test if present) before pushing.
5. Push the branch and open a PR with `gh pr create`, with a brief summary of what changed and why.
6. Watch the checks with `gh pr checks --watch`. If they fail, read the log, fix, and push again.
7. Do not merge. Report the PR URL and check status, and wait for me to review and merge.

### Rules
- Never push to `main` directly or attempt to bypass branch protection.
- Never deploy with `railway up`. Deploys happen only by merging to `main`. The Railway CLI is fine for logs and variables.
- Don't modify `.github/workflows/ci.yml` or Railway settings unless I ask.
- If a change is too large for one PR, propose how to split it before starting.
