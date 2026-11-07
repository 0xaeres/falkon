# Repo refactor: ship only Falkon, standard layout, faster

## Goal

One repository that ships only what Falkon needs to run, laid out the way a pnpm and Next.js project is conventionally laid out, with a measured performance pass. Behaviour does not change: MCP tool names, input schemas, prompts, HTTP routes and stored data stay as they are.

## Decisions (grilled 2026-11-07, human)

| # | Decision |
|---|---|
| R1 | The eval harness (`tests/eval` and its datasets) moves to a new sibling repository `falkon-eval` at `~/Desktop/projects/falkon-eval`. History is kept with `git subtree split --prefix=tests/eval`. The one shared file, `packages/backend/src/githubQuery.ts`, is copied into the new repository as a vendored file. No GitHub remote is created and nothing is pushed. |
| R2 | `tests/originality` stays in Falkon as a root script, because it gates shipped prompt text and needs no eval code. It runs under the shared package's runner (`pnpm --filter @falkon/shared exec tsx ...`, the pattern `golden:record` uses), and its test keeps running under `pnpm test`. |
| R3 | Layout: deployables move to `apps/ui`, `apps/api`, `apps/backend`; libraries stay in `packages/shared`, `packages/contracts`, `packages/db`. Package names stay `@falkon/*`. |
| R4 | UI refactor: split `chat-view`, `setup-wizard`, `status-view`, `workspace-shell` into feature subfolders; leave the vendored `components/ai-elements/prompt-input.tsx` alone; move the feature files out of `src/lib` into the feature that owns them; pilot server-side fetching on the status and connect pages only. |
| R5 | Performance rule: measure a baseline first (Docker image size, first-load JavaScript per route, p95 of search and one MCP tool call), then keep only changes the numbers justify. Behaviour does not change; the regression gate below holds. |
| R6 | The earlier `delete-flows` cycle is parked until this refactor lands. Its spec stays. The three empty worktrees and branches (`loop/delete-flows`, `loop/delete-flows-s1`, `loop/delete-flows-s3`, none with commits beyond `main`) are removed. |

## Regression gate

Every slice: `pnpm install` clean in its worktree, `pnpm db:generate`, `pnpm typecheck`, `pnpm test` all pass, and `git diff --stat` stays inside the slice scope. No test is deleted or weakened to pass; a test may change only its import paths or its location. S4 adds the live check: `docker compose up --build` and `sh scripts/ops-smoke.sh` PASS.

## Autonomy limits

The loop may decide alone: file moves and splits inside a slice's scope; names of new files inside feature folders; Dockerfile layout; path and location sentences in `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, the ADR and `docs/` (where something lives, never a decision). The digest lists every such edit.

The loop must stop for: a new dependency or any lockfile change beyond removing entries; a change to an ADR decision or to `CONTEXT.md` vocabulary; any change to MCP tool names, schemas or prompt text; any push, pull request, remote creation or deletion beyond the three named worktrees; a lockfile that does not pass a frozen install; a behaviour change a client could see; an optimization that misses its rule (it is reverted, not tuned).

Budget for the whole refactor: 3,000,000 subagent tokens and 8 hours wall-clock, sized from the last cycles (0.4 to 2.5 million tokens and 90 to 600 minutes for four to eight slices). The loop stops at gate 2 after every three finished slices, so expect stops after S3 and after S6.

## Slices

Order: eval extraction, apps move, baseline, then Dockerfile and UI split in parallel, UI pilot, optimizations.

### S1 Extract the eval harness (tier standard, agent claude, blocked by none)

Before the first slice: remove the three empty `delete-flows` worktrees and branches (R6) and run the regression gate once on `main`, recording pre-existing failures.

Goal: Falkon holds no eval code; `falkon-eval` is a working repository with the harness history.

Scope: `tests/eval`, root `package.json` (drop `eval` script, repoint `originality`), `pnpm-workspace.yaml`, `packages/shared/package.json` (test glob picks up the originality test), `tests/originality`, `README.md` and `CONTRIBUTING.md` and `AGENTS.md` eval sections (point at the new repository and say how it finds Falkon), comments naming `tests/eval/...` in `packages/backend/src`, `scripts/record-github-fixtures.sh`, `scripts/ops-smoke.sh`. Outside the worktree: the new `~/Desktop/projects/falkon-eval` directory only.

Done when:
- In Falkon, `grep -rnE "tests/eval|@falkon/eval" . --exclude-dir=node_modules --exclude-dir=.scratch --exclude-dir=.loop` prints nothing; `pnpm install`, `pnpm typecheck`, `pnpm test` pass, and the originality test still runs inside `pnpm test`.
- In `falkon-eval`: `git log --oneline | wc -l` is more than 1, `pnpm install && pnpm typecheck && pnpm test` pass, `FALKON_DIR` (a path to a Falkon checkout) replaces every assumption that the harness sits inside Falkon, and its README lists the commands the Falkon README listed.
- Adversarial: none (no secrets, polling or growing tables). The implementer must not read or copy `.env`.

### S2 Move services to `apps/` (tier standard, agent codex, blocked by S1)

Goal: `apps/{ui,api,backend}` and `packages/{shared,contracts,db}`.

Scope: `git mv` of three directories; `pnpm-workspace.yaml`; root `package.json` filters; `tsconfig` extends and references; `docker/Dockerfile` and `docker-compose.yml` paths; `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/`, the ADR and `CONTEXT.md` path links; scripts under `scripts/`; test fixtures that name a moved path.

Done when: regression gate passes; `grep -rnE "packages/(ui|api|backend)" . --exclude-dir=node_modules --exclude-dir=.scratch --exclude-dir=.loop` prints nothing; `docker compose config` is valid; `pnpm --filter @falkon/ui build` succeeds. Adversarial: none.

### S3 Performance baseline (tier mechanical, agent claude, blocked by S2)

Goal: numbers that later slices are judged against. No code change.

Scope: writes `.scratch/repo-refactor/baseline.md` only.

Done when the file records, with the exact commands used: image size from `docker build` and `docker image ls`; first-load JavaScript per route from `next build` output; p95 over at least 50 calls each for one search request and one MCP tool call against the fixture stack (`docker compose up` with `tests/fixtures`), plus the machine and date. A number that cannot be measured says why. It also lists findings: the three largest first-load JavaScript contributors and the three slowest request-path calls.

### S4 Multi-stage Dockerfile (tier standard, agent claude, blocked by S3; runs in parallel with S5)

Goal: a runtime image holding production dependencies and built output only.

Scope: `docker/Dockerfile`, `.dockerignore`, `docker-compose.yml` only if a command path changes.

Done when: the build uses a frozen lockfile; the runtime stage holds no tests, `.scratch`, docs or dev dependencies; `docker compose up --build` and `sh scripts/ops-smoke.sh` PASS on all services; image size is at least 20% below the baseline. Rule: if the image is not 20% smaller or ops smoke fails, revert and record why. Adversarial: the lockfile must satisfy the frozen install without edits (else block); the image must not contain `.env`.

### S5 UI split (tier standard, agent codex, blocked by S3; parallel with S4)

Goal: no non-vendored UI source file over 400 lines; feature code lives with its feature.

Scope: `apps/ui/src/features`, `apps/ui/src/components/layout`, `apps/ui/src/lib` (feature files move out; `api/`, `format.ts`, `utils.ts` stay), `apps/ui/tests` import paths.

Done when: `wc -l` on every file outside `components/ui` and `components/ai-elements` is 400 or less; UI tests pass with assertions unchanged; typecheck and tests pass; first-load JavaScript per route is not above the baseline by more than 2%. Adversarial: none.

### S6 Server-side fetch pilot on status and connect (tier standard, escalate to hard after one failed fix round, agent claude, blocked by S5)

Goal: the status and connect pages put real data in the first HTML and keep their live updates.

Scope: `apps/ui/src/app/(workspace)/[productId]/{status,connect}/page.tsx`, their views in `apps/ui/src/features`, `apps/ui/src/lib/api/server.ts`.

Done when: a test renders each page with a stubbed engine and finds the data in the HTML; live updates still work (the existing SWR or event hooks start from the server data as their initial value); typecheck and tests pass; first-load JavaScript for both routes is not above the baseline. Adversarial (reviewer checks each): engine down (timeout, then the existing reconnecting notice, never a 500); empty Product; stale data after navigation; unbounded response (bounded read, as `AGENTS.md` requires); the engine token never reaches client code.

### S7 Measured optimizations (tier standard, agent codex, blocked by S4, S5, S6)

Goal: apply at most three optimizations taken from the findings list in `baseline.md`.

Scope: only files named in a finding. Request-path code follows the `AGENTS.md` rule: no remote I/O or unbounded reads per request.

Done when: for each kept optimization the primary metric it targets improves at least 10% over the baseline, no other baseline metric worsens by more than 2%, and the regression gate passes. An optimization that misses its rule is committed with its result, then reverted in a separate commit. Adversarial for request-path edits: empty result, very large result, stale cache entry, cache load timeout.

## Analyze (2026-11-07)

Every slice has a scope, runnable verify commands and an observable done condition. Blocked-by edges: S1 none; S2 on S1; S3 on S2; S4 and S5 on S3; S6 on S5; S7 on S4, S5, S6. No cycle. S4 and S5 touch disjoint files (Dockerfile versus `apps/ui/src`). Together the slices cover the goal (separate eval, standard layout, UI structure, Docker size, measured performance) and add nothing outside it.

## Build notes

- 2026-11-07: the Codex probe failed (model not supported on this ChatGPT account), so every slice runs as `agent: claude` and the Sonnet `loop-reviewer` reviews. `main` moved from `aca2f39` to `2b90349` before the cycle branch was cut (the earlier delete-flows and product-setup-only cycles had merged); the cycle branch starts from `2b90349`. The three empty delete-flows worktrees were already gone.

## Gate 1

Approved by the human on 2026-11-07 (all seven slices, limits and budget as written).

## Cycle 1 results (slices S1 to S3 kept; landed on `main` 2026-11-07, human approved with +loop +project)

- S1 `9ee75f5` (Falkon) and `58477b3` (falkon-eval), S2 `384cd30` (Falkon) and `cff93eb` (falkon-eval), S3 `e315195`. Baseline numbers are in `baseline.md`.
- Open for cycle 2, unanswered at approval, so the digest's recommendations stand as defaults until the human says otherwise: add a Falkon-side test that the root `package.json` and shipped files carry no predecessor name (the eval harness's own check can no longer read Falkon); copy the recorded floor (`.scratch/falkon-mvp/eval-floor`, 84 files, about 3.2 MB) into `falkon-eval` so its tests run without `FALKON_DIR`; aim S7 at the chat route's first-load JavaScript (511 KB gzip) and the Docker image only, since request p95 is at most 11 ms.
- Left in the main checkout, not deleted: `tests/eval/.local/` (three eval stack state directories with their tokens; regenerable with the harness's `stack up`, which now lives in `falkon-eval`).
- Cycle 2 plan: S4 (multi-stage Dockerfile) and S5 (UI split) in parallel, then S6, then S7.

