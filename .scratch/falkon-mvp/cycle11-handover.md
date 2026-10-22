# Cycle 11 handover (2026-10-22)

State: `main` (local, not pushed) holds cycles 1 to 10; tip is the "Spec: gate 2 decision, cycle 10 approved" commit (`ba4b94f`). Typecheck, 471 tests, UI build, originality (0 shared runs) and the name greps are green. No remote is configured.

Remaining MVP: cycle 11 = S15, the final regression gate, plus the release. Read `.scratch/falkon-mvp/spec.md`: "Regression gate (Q15)", "Cycle 10 plan" (D62 to D74, D74 names S15), "Cycle 10 results", "Gate 2 decision, cycle 10".

## The human's machine (not repository state)

- Postgres volume `falkon_pgdata` is already renamed in place: role and database `sbc` are now `falkon`, password `falkon`, data intact (2 chats, 1 Product, 2 connections). The human's stack (compose project `falkon`) is stopped and its image `falkon-app` is 25 hours old, built before the rename; a rebuild was started and cut off. The human rebuilds with `docker compose up --build -d` in the main checkout when they want it (compose reads `.env` itself; an agent must never read or copy `.env`). Do not do it for them unless asked.
- `FALKON_API_KEY` is an optional password the operator invents: it guards the old web app's `/api/*` on port 3000 only (cookie `falkon_key`); the engine's own switch is `AUTH_MODE` (default `none`). The human's `.env` may still use the pre-cycle-9 variable names (agents cannot check).
- `falcon-sourcebot-*` containers are the human's reference stack: do not touch.

## S15 inputs

1. Golden baseline: `tests/golden/expected.json` line 2811 holds the old grep "Results truncated" hint, which S38 reworded (D67); the live golden diff in `scripts/ops-smoke.sh` will differ on that one line. DECIDED (D75): re-record that line only.
2. Memory: ops-smoke probe of `c788fbf` passed every functional step; memory 665.67 MB against the 654 MB ceiling. DECIDED (D76): information only, not a keep condition, no memory work this cycle.
3. Status page first load shows a spinner for 3 to 5 s on a disposable stack. DECIDED (D77): quick bounded look, fix only if small, else known limit.
4. Optional "later" items: no real `lastIndexedAt` in the contract; `chat-view.tsx` is 600 lines; `packages/ui/public/brand` ships unused Jira, GitLab and other icons; collapsed-nav tooltip. Out of scope.

S15 scope (D74): the four regression checks (tool contract, golden search, Ask quality D25, ops incl. memory as information); the built-image content check (`docker run --rm --entrypoint sh <img> -c 'cd /app; find . -name .scratch -not -path "*/node_modules/*"; grep -rIl -i -E "sourcebot|falcon" --exclude-dir=node_modules --exclude-dir=.next .'` must print nothing); a real-browser UI check on the human's model (status, Connect, chat with Markdown and mermaid, toasts, failed-first-send flow; screenshots at 1280 and 375 px into `.scratch/falkon-mvp/`); gate 3 on Haiku (D66); release 0.1.0 (all package versions; the MCP server version is a literal `0.0.1` in `packages/web/src/lib/mcp.ts`; `RELEASE_NOTES.md`; README pass; local tag `v0.1.0` only after gate 2 approval; no push). Release notes must say `.scratch/` (529 tracked files naming the predecessor, eval gold) moves to a private branch or repository before any public push (D65).

## How to run the live pieces (recipes that worked)

- Disposable stack with the human's model: memory note `live-smoke-with-human-env` (override file with an absolute `env_file` path, own `-p` name, ports and image tag; config mounted from the scratchpad; a clone of the repo with `.scratch/` removed and a fixed https `origin` as the corpus, D54). The cycle 9 smoke script (`smoke.mjs`), question list, override and config are saved in `/Users/aeres/Library/Application Support/Claude/side-session-notes/local_4f3a953e-83ef-4353-a448-9c6c9fa78869/cycle9-smoke/`. Probe one `reply` turn first (the provider returned HTTP 402 "positive balance" once). `docker compose build backend` for the image takes 10 to 25 minutes under load; run it in the background.
- Gate 3 on Haiku: `pnpm eval -- stack up` (corpus `/Users/aeres/Desktop/projects/falkon/.local/eval`, port 3400), then `pnpm eval -- pilot --model haiku --arms clone-tools`, `run --split dev|hidden`, `report`, with a fresh `EVAL_RUNS_DIR` containing only the recorded `v6-tools` runs: copy `.scratch/falkon-mvp/eval-runs/haiku/openmrs-xrepo*/raw/v6-tools` into `<dir>/haiku/<dataset>/raw/v6-tools`, and in `xrepo-framework-to-chart-25.json` (dataset `openmrs-xrepo-unnamed`) set `"leak": false` (it read the client's own spill file; D58 exempts that). A run flagged by the traversal rule (a `Read` of its own work dir through `..`) blocks the hidden split: set it aside, rerun it, and report a sensitivity row (cycle 9 did this). Last result (cycle 9): PASS, recall +0.090 [0.040, 0.149], 17 wins and 2 losses, $0.62. `pnpm eval -- stack down -v` afterwards.
- Originality check: `ORIGINALITY_REF_DIR=<dir> pnpm -s originality`; recipe in `.scratch/falkon-mvp/originality.md` and memory note `sourcebot-v6-image-contents`; the reference directory is rebuilt from the v6.0.1 image (about 3 minutes). It is currently at 0.
- Ops: `sh scripts/ops-smoke.sh` (needs Docker, about 15 minutes cold; ports 3300 to 3302; prints PASS lines and a memory figure). Run it in the background.

## Rules

AGENTS.md (naming rule, `pnpm typecheck && pnpm test`, one `pnpm install` per worktree, never read or copy `.env`, request-path rule). `/agent-loop` is user-invoked. Claude only, no Codex. Planner Opus for steps 1 to 4; builders and reviewers Sonnet, verifiers Haiku, always pass `model`. Caveman ultra in chat; normal prose in code, commits, specs and the digest; load `ponytail` before any edit; graph-first. No push, PR or merge before the human replies at gate 2. Amend the ADR in place. `tests/contract` and `tests/golden/expected.json` untouched except the D75 line.

Lessons from cycles 9 and 10 (apply them):
- Builder briefs: "finish in the foreground: no sleep timers, background commands, or `eza`/`ls -R`/`find` over the repo root" (an `eza` call hung 16 minutes); check `ps` for the slice worktree before starting a verifier; start a verifier only after the builder's FINAL report; verifiers sequentially per worktree.
- Each slice worktree needs its own `pnpm install --frozen-lockfile && pnpm db:generate` (never symlink node_modules); `rm -f packages/ui/.next/lock` before a UI build; `opsSmoke.test.ts` is timing-sensitive under load (rerun that package alone once). Cut slice worktrees in `.loop/worktrees/` from the cycle branch tip (add `.loop/` to the git exclude if needed).
- A worktree session cannot write into the main checkout (a hook blocks it): write the digest `.loop/REVIEW.md` in the cycle worktree.
- Read the stored tool trace of an Ask turn (`Chat.messages` parts: `tool-*` and `data-source` entries) before diagnosing a quality bug; the answer text alone misled cycle 9. Take UI screenshots before the design review, not after. A "write it in your own words" slice must name every inherited text surface.
- Package test scripts must quote their globs (`"src/**/*.test.ts"`); an unquoted `**` is expanded by `sh` and skips nested tests.
- Probe external prerequisites (model provider balance, Docker, the ops-smoke baseline) with one cheap call before the first slice.

Carried, non-blocking: concurrent turns on one thread overwrite each other (documented limit); `Credential.lastError` is an unused column (no migration planned); mermaid drawing, streaming flicker and the failed-first-send flow have no automated browser test; a sync already running when a Product is edited can briefly show a new member as Skipped (needs a `syncStartedAt` column). The skill prune pass (`SKILL.md` 2250 words against 2000) still waits for the human's yes; the loop-edit proposals (graph-use line x3, probe-prerequisites x4) were not accepted at gate 2 and may be offered again in the digest. At the end, write the `runs.tsv` row and up to three `observations.md` lines in `~/.agents/skills/agent-loop` (commit there).
