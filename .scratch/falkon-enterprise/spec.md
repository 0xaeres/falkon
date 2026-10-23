# Falkon enterprise: why and history

## Goal

Falkon answers "why did this change, what changed, and what implemented this ticket" for one Product, from evidence it can verify: commits, pull requests, tickets, and source spans. This is ADR-0001 capability 5. The review that set the direction is [`design-review.md`](design-review.md). The earlier delivery spec, `.scratch/falkon-mvp/spec.md` (D1 to D81), stays as the record of the MVP; its decisions still hold unless a decision below amends one.

Phase 0 (cycles 12 and 13) builds the measuring stick before any capability: a why-and-history question stratum on OpenMRS, a scorer that understands commits, pull requests and tickets, and two baseline arms. Phases 1 to 6 are in `design-review.md` section 4 and are planned one cycle at a time.

## Decisions (grilled 2026-10-22, human)

| # | Decision |
|---|---|
| D82 | (E1) First target is sources and history: Phase 1 git history tools, Phase 2 GitHub pull requests and issues, Phase 3 Jira. Identity and permissions (Phase 6) come later. |
| D83 | (E2) The why-and-history stratum is built on OpenMRS. |
| D84 | (E3) Open: whether a model may embed queries on the MCP serving path. D3 stays binding until Phase 4 is entered with evidence. |
| D85 | (E4) ArcadeDB, not FalkorDB or Qdrant, is the store for the graph plane. This amends MVP spec D2 ("No ArcadeDB") and ADR-0001 4.1 from Phase 5 on; recorded in the ADR now as decided, not built. |
| D86 | (E5) Open: whether a hosted offering is planned. Moot for ArcadeDB (Apache 2.0); answer before any SSPL or BSL dependency. |
| D87 | (E6) Postgres holds every new table until SCIP is introduced (Phase 5). ArcadeDB enters with SCIP and then also holds the provenance links of Phases 1 to 3, which until then sit behind a `ProvenanceStore` port so the move is an adapter change plus a one-time copy. |
| D88 | Question kinds: (a) why it changed, gold = the change and its ticket; (b) what changed and when, gold = the changes to a file or declaration; (c) ticket to code, gold = the change, the ticket and the source spans it touched. Rationale that lives only in docs (kind d) is out of Phase 0. |
| D89 | 40 questions: 16 of kind (a), 12 of (b), 12 of (c); 24 dev and 16 hidden, stratified per kind. |
| D90 | Answers and gold carry four evidence kinds: a source span `{path, startLine, endLine}`, a commit `{repo, commit}`, a pull request `{repo, pr}`, a ticket `{ticket}`. Recall counts gold units of every kind. |
| D91 | Gold units: a **change unit** is one squash-merged commit and its pull request, and citing either the commit or the pull request scores it once; a **ticket unit** is one Jira key; a **span unit** is a source span as today. |
| D92 | Matching: a commit matches when the repository matches and the cited SHA is a prefix of at least 7 characters of the gold SHA; a pull request when repository and number match; a ticket when the key matches case-insensitively; a span by the existing `covers` rule, unchanged. |
| D93 | One fenced JSON array of at most 20 items, each item one of the four shapes. History questions get their own prompt; the prompt of the existing datasets stays byte-identical, so their recorded runs score the same. |
| D94 | New dataset `tests/eval/datasets/o3-history.json`, selected by `--dataset history` like `o3-impact`. The question schema's `required` becomes a typed union; `accepted.json` extends to the new kinds for precision. |
| D95 | Corpus: the same O3 Product (42 repositories, same pinned commits). The checkouts under `EVAL_O3_DIR` get full history with `git fetch --unshallow` in place (heads and pins unchanged). Preflight refuses a shallow checkout for `--dataset history`. Questions come from repositories whose commits carry ticket keys (`openmrs-core` TRUNK, `openmrs-module-webservices.rest` RESTWS, `openmrs-esm-*` O3). |
| D96 | Contamination window: each question targets a change merged in the six months before its repository's pinned commit; older history may appear as context. |
| D97 | Authoring: an Opus agent mines (commit, pull request, ticket) triples from git history, the GitHub API (`gh`) and the public Jira (`https://openmrs.atlassian.net/rest/api/3`, anonymous), and drafts each question and its gold. The human spot-checks 25% of the questions, all from the hidden split. Author tag `history-probe`. Answering runs on Haiku, and on Sonnet only for confirmation; never on the authoring model. |
| D98 | Kinds (a) and (c) are phrased from the symptom or rationale in the ticket or pull request body, not from the commit subject's wording, and are tagged `vocab: natural`, so a `git log --grep` on subject words alone does not solve them. |
| D99 | Baseline arms: `clone-tools` (the seven tools, history tools denied) and `clone-tools-git` (the same plus the shipped `list_commits`, `get_diff`, `list_branches`). The gap between them is the floor Phase 1 must beat. |
| D100 | Freeze rule: before freezing, both arms run on a pilot of 6 dev questions (2 per kind) on Haiku and the scores go to the human. `clone-tools-git` pilot recall at or above 0.85 means too easy: rewrite and re-pilot, at most two rounds. `clone-tools` recall at or below 0.05 on every pilot question is flagged as no gradient. The freeze is a human decision at a gate. |
| D101 | ADR-0001 is amended in place now for what is decided: capability 5 becomes the target; "Why and history" leaves the non-goals; 4.1 records D85 and D87 as decided, not built; 2.2 says its semantic-stack verdict was measured on code only. `CONTEXT.md` gains Change, Discussion, Ticket and Provenance only when they ship (`docs/agents/domain.md`). AGENTS.md points to this spec. |
| D102 | Spend cap for Phase 0 eval model calls: $5 (Haiku); a Sonnet confirmation only if Haiku shows a gap worth confirming (D26 pattern). |
| D103 | Cycle cut: cycle 12 = S43, S44, S45 (scorer, corpus, dataset and pilot), stopping at gate 2 for the spot-check and the pilot scores; cycle 13 = freeze and the full two-arm baseline. |

## Regression gate

The four checks of the MVP spec ("Regression gate") hold for every slice. Phase 0 touches only `tests/eval`, the eval corpus and documentation, so checks 1, 2 and 4 are unchanged by construction; `pnpm typecheck && pnpm test` must pass. Check 3's scoring must not move: S43's rescore of the recorded cycle 11 Haiku runs must reproduce `.scratch/falkon-mvp/gate3-c11-report-rerun.md`.

## Cycle 12 plan: the measuring stick (gate 1 approved 2026-10-22)

Base `main` at `54bcec8`. Cycle branch `loop/falkon-enterprise-c12`. Roles: Opus plans (main session), Sonnet decides and commits after gate 1, Haiku verifies; Codex builds S43, Claude builds S44 (network, writes outside the repository) and S45 on Opus (D97); the reviewer is always the other model family.

### Slices

**S43. Typed evidence in the eval harness.** Tier standard. Agent codex.
- Goal: the harness reads, scores and reports the four evidence kinds (D90 to D94) and runs the `clone-tools-git` arm (D99), without changing how existing datasets score.
- Scope: `tests/eval/score.ts`, `data.ts`, `harness.ts`, `cli.ts`, `report.ts`, `preflight.ts` and their tests; `tests/eval/datasets/accepted.json` shape only if needed. Nothing outside `tests/eval`.
- Done:
  - `score.ts` scores mixed gold and answers by the D91 units and D92 rules; tests cover a commit matched by 7-character prefix, a 6-character prefix rejected, wrong repository rejected, a pull request scoring the change unit its commit also scores (once, not twice), a ticket matched case-insensitively, and spans unchanged.
  - `data.ts` accepts typed `required` items and a change unit as `{repo, commit, pr}`; existing datasets still parse unchanged.
  - `parseAnswer` accepts the four shapes and still drops what it drops today for spans; a test feeds each shape and a malformed one.
  - `--dataset history` loads `o3-history.json` and uses a history prompt; a test pins the existing prompt text byte-identical to `main`.
  - Arm `clone-tools-git` allows `list_commits`, `get_diff` and `list_branches` and is not flagged as a leak for them; every other arm still denies them (test).
  - Rescoring the stored cycle 11 Haiku runs (`pnpm eval -- report --model haiku`, `EVAL_RUNS_DIR=.scratch/falkon-mvp/eval-runs`) prints the same numbers as `gate3-c11-report-rerun.md`.
- Verify: `pnpm typecheck && pnpm test`; the rescore command above, diffed against the recorded report.
- Adversarial cases (reviewer checks): empty gold of one kind; an answer citing the same change by commit and by pull request; a SHA prefix shared by two gold commits; upper-case and lower-case ticket keys; 21 items (truncated at 20).
- Blocked by: none.

**S44. Full history for the eval corpus.** Tier mechanical. Agent claude.
- Goal: every checkout under `EVAL_O3_DIR` has full history at its pinned head (D95), and the harness refuses a shallow one for history questions.
- Scope: `tests/eval/cli.ts` (a `corpus deepen` subcommand that runs `git fetch --unshallow` per checkout and then checks the head) and its test; the preflight shallow check in `tests/eval/preflight.ts` (or `cli.ts` where the pin check lives) and its test; the checkouts themselves.
- Done: `git rev-parse --is-shallow-repository` prints `false` for all 42 checkouts and every `HEAD` still equals its pin in `o3.json`; any pilot or run against a shallow checkout (every dataset, so this needs no S43 code) fails with a message naming the checkout and the fix; the eval stack's `down -v` then `up` is noted in the README of `tests/eval` (or the CLI usage comment) as required after deepening, since existing bare clones keep their old depth.
- Verify: `pnpm typecheck && pnpm test`; `for d in $(jq -r '.repositories[].checkout' tests/eval/datasets/o3.json); do git -C "$EVAL_O3_DIR/$d" rev-parse --is-shallow-repository HEAD; done` shows `false` and the pins.
- Blocked by: none. Touches `cli.ts` beside S43, so S44 merges after S43 and rebases if needed.

**S45. Mine, draft and pilot the why-and-history stratum.** Tier hard (authoring judgement, D97). Agent claude on Opus.
- Goal: `tests/eval/datasets/o3-history.json` with 40 questions meeting D88, D89, D96 and D98, its mining record, and a pilot report (D100).
- Scope: `tests/eval/datasets/o3-history.json`; `tests/eval/datasets/accepted.json` (new entries only); `.scratch/falkon-enterprise/history-mining/` (candidate triples with their sources: SHA, PR URL, ticket URL, and the sentence each question was phrased from); `.scratch/falkon-enterprise/pilot-c12.md`. No code changes.
- Done:
  - The dataset parses with the S43 schema; 16/12/12 per kind, 24 dev and 16 hidden, stratified; every target change merged within six months before its repository's pin; every gold commit exists in its checkout's history at the pin; every gold span lies inside its file at the pin; every ticket key resolves on the public Jira.
  - Each (a) and (c) question shares no run of 4 or more words with its commit subject (checked by a script whose output is in the mining record).
  - The spot-check list names 25% of the questions (4 hidden) for the human.
  - Pilot: the main session (or the verifier) brings the eval stack up fresh (`stack down -v`, `stack up`) on the deepened corpus and runs both arms on 6 dev questions (2 per kind) on Haiku; `pilot-c12.md` reports recall per arm and question and the D100 verdict. Spend within the D102 cap.
- Verify: `pnpm typecheck && pnpm test`; the validation script's output (counts, window, existence checks, word-overlap check) shows zero violations; `pnpm eval -- report --pilot --dataset history --model haiku`.
- Blocked by: S43 (schema and arm), S44 (history).

### Order, limits, budget

- S43 and S44 run in parallel; S45 after both are kept.
- The loop may decide alone: implementation details inside each scope, fix rounds, re-running a failed pilot run once.
- It stops for: any change to how existing datasets score, any new dependency, any product code change (outside `tests/eval`), a pilot verdict of "too easy" or "no gradient" (the human decides the rewrite), spend over $5.
- Budget: 1.2M subagent tokens and 300 minutes wall clock for the cycle (recent cycles used 0.26M to 0.83M; S45 is Opus and live, so doubled).
- Gate 2 fires when S45's pilot report exists, or on any trigger of the agent loop.

## Cycle 12 results (gate 2 approved 2026-10-23)

- S43 kept (`46ff81c`), S44 kept (`a7d86e0`), S45 kept (`6b24ba6` to `96064b5`, pilot results `f8c54bf`). Built on Claude agents only: Codex rejected every model on the human's ChatGPT account, and the human dropped Codex from the loop. Reviews were Sonnet.
- The regression-gate rescore of the stored cycle 11 runs could not be reproduced (stored runs differ from `gate3-c11-report-rerun.md`, original runs directory gone); the scorer was shown unchanged by byte-identical `report` output on `main` and the S43 branch.
- D100 pilot (Haiku, 6 dev questions): `clone-tools-git` 0.861 (too easy), rewrite 1 (anchors removed, kind (b) mechanical) 0.897, rewrite 2 (kind (a) targets whose commit message names no ticket, human option i) 0.689 and `clone-tools` 0.139: passes. Report `pilot-c12.md`; mining record and rewrite notes under `history-mining/`.
- Dataset `o3-history.json` frozen as it stands (human, 2026-10-23): 16 a / 12 b / 12 c, 24 dev / 16 hidden, 10 repositories. Known weak (a) items accepted: hist-a-04 and hist-a-10 (ticket key readable in the repo at the pin), hist-a-02, -05, -12, -16 (medium strength); hist-a-13 and hist-a-14 carry two change units for one ticket. The spot-check of 4 hidden questions (`history-mining/spotcheck.md`) stays with the human.
- D104 (human, 2026-10-23): an attempt by `clone-tools` or another arm at a git history tool it is denied counts as a denied attempt, like `research_codebase`, not as a leak. Implemented in cycle 13 before the baseline.

## Cycle 13 (outline, planned after gate 2 of cycle 12)

Implement D104 in `tests/eval/harness.ts` (with tests), run both arms on all 40 questions on Haiku, report `clone-tools-git` against `clone-tools` (`report --reference clone-tools`), and record the floor for Phase 1. Spend inside the D102 cap ($5 total; $0.526 used in cycle 12).
