# Cycle 8 handover (2026-10-21)

State: `main` holds cycles 1-7 (local, not pushed; tip is the AGENTS.md request-path commit after f77a313). Typecheck and all tests green; `scripts/ops-smoke.sh` passes (memory 525.7 MB).

Landed this stretch: cycle 6 admin token (S27, D37: generated once into `${DATA_DIR}/secrets/admin.token`, `scripts/admin-token.sh show|reset`); GitHub App method built then removed (D41); Sign in with GitHub device flow cancelled (D40); cycle 7 knowledge base default-on (S11a, S11b, S11c; D42 to D44). Chat model = DeepInfra via the human's `.env` (never read it).

Connection path for testing: personal access token only.

Remaining MVP (spec "Cycle 7 plan" map change): cycle 8 = (1) fixes from the human's PAT end-to-end run (wizard to real GitHub, first sync, chat; feedback not yet received: ask first), (2) S13 original rewrite of inherited text (Ask prompts, tool descriptions, KB prompts, UI copy leftovers: no-model docs link naming the predecessor, chat empty state says "mock dataset", config generic-git Product shows provider github-enterprise) with the Falkon config schema and one-time converter, removal of `SOURCEBOT_*`, the old header and `/api/ee/*`, Dockerfile and README scrub, under the Ask-quality gate; (3) mechanical rename `@sbc/*` to `@falkon/*` and DB names last (no fold into packages/core: dropped); (4) S15 final regression gate (all four checks), README, release notes.
Carried non-blocking items: connector-skipped repos stay "Building"; concurrent turns on one thread overwrite each other; failed first message leaves an empty thread; dead `Credential.lastError`; literal `[n]` in code needs a zero-width space; S25 80-question control verdict withheld by an open leak false positive; P6 (knowledge isolation citation rule) deferred.
Not verified anywhere: PAT wizard against real GitHub; knowledge `ready` for an api-created Product on a real stack.

Rules: AGENTS.md (naming rule, `pnpm typecheck && pnpm test`, one `pnpm install` per worktree, never read `.env`, request-path code rule); `/agent-loop` is user-invoked; Claude only (no Codex), Sonnet builds/reviews, Haiku verifies, Opus only if a slice is truly hard; no push or PR without the human; amend the ADR in place; contract snapshots `tests/contract` and `tests/golden/expected.json` untouched. An old cycle 4 digest sits in the main checkout's `.loop/REVIEW.md` (stale; ask before deleting).
