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
- Dataset `o3-history.json` frozen as it stands (human, 2026-10-23): 16 a / 12 b / 12 c, 24 dev / 16 hidden, 10 repositories. Known weak (a) items accepted: hist-a-04 and hist-a-10 (ticket key readable in the repo at the pin), hist-a-02, -05, -12, -16 (medium strength); hist-a-13 and hist-a-14 carry two change units for one ticket. The spot-check of 4 hidden questions (`history-mining/spotcheck.md`) was done by the human (reported 2026-10-25).
- D104 (human, 2026-10-23): an attempt by `clone-tools` or another arm at a git history tool it is denied counts as a denied attempt, like `research_codebase`, not as a leak. Implemented in cycle 13 before the baseline.

## Cycle 13 results: the Phase 0 baseline floor (2026-10-23)

S46 kept: D104 (denied git-tool attempts count as denied attempts, not leaks) and, for `--dataset history` only, the pilot stop rule "plain-arm recall at least 0.70" is skipped (the plain arm is expected low, D100). Both arms, all 40 questions, Haiku (claude-haiku-5-5), one run each, fresh stack over the deepened corpus. Raw runs `eval-runs-c13/`, full report `baseline-c13-report.md` (`report --reference clone-tools`). Failed 0, malformed 0 on every run. Agent spend this cycle $1.0485 (cumulative Phase 0 $1.574 of the $5 cap, D102).

| | clone-tools | clone-tools-git | difference [95% CI], paired |
|---|---|---|---|
| recall, all 40 | 0.096 | **0.696** | 0.600 [0.515, 0.682] (38 wins, 0 losses, 2 ties) |
| precision, all 40 | 0.125 | 0.567 | 0.443 [0.299, 0.578] |
| recall, dev 24 / hidden 16 | 0.083 / 0.115 | 0.686 / 0.710 | |
| recall, kind (a) why, 16 | 0.063 | 0.531 | |
| recall, kind (b) what and when, 12 | 0.000 | 0.839 | |
| recall, kind (c) ticket to code, 12 | 0.236 | 0.771 | |
| mean cost per run | $0.007 | $0.032 | |

**The floor for Phase 1 is `clone-tools-git` recall 0.696 (precision 0.567), with `clone-tools` at 0.096.** A history capability must beat 0.696 on this stratum (D8). The headroom is mostly kind (a) (0.531: the change is found, the ticket text is not) and kind (c) (0.771); kind (b) is 0.839 but costs the most per run. Single-run Haiku results are noisy per question; the pooled numbers carry the comparison.

Flags: the pooled verdict prints "withheld" because the reference arm `clone-tools` has 1 leak flag: hist-a-05 read a file under its own Claude scratchpad (`/private/tmp/claude-501/...`), which the leak pattern treats as private; no corpus or eval data was read, a false positive of the harness pattern, left as is. `clone-tools` made 3 denied git-tool attempts in hidden and 1 in dev (D104 working). The `clone-tools-git` arm's own gate verdict is not a regression gate; it is a floor, not a pass or fail.

## Cycle 14 plan: pull request ingestion, measured against the floor (gate 1 approved 2026-10-23)

Goal: Falkon stores pull requests with their comments and review comments, links each commit to its pull request and each pull request to its ticket keys, and gives agents tools to read them. Success is measured on the 40-question history stratum against a same-day rerun of `clone-tools-git` (floor recorded in cycle 13: recall 0.696).

Why this first (evidence, cycle 13): the "why" questions score 0.531 with git tools alone because the ticket and rationale sit in pull request or Jira text. Of the 16 "why" tickets, 11 appear in the pull request title, body or branch name and 5 only in Jira (hist-a-03, -06, -11, -13, -14); pull requests can recover at most 9 more ticket units, so the ceiling is about +0.28 on "why" and about +0.11 overall (0.696 to about 0.81); a realistic gain is about half. "What changed and when" and "ticket to code" are expected to move about zero. GitHub issues are disabled on the OpenMRS frontend repositories, so issues cannot be measured here.

### Decisions (human, 2026-10-23, unless marked default)

| # | Decision |
|---|---|
| D105 | Order: Phase 2 (pull requests and issues) before Phase 1 (git-only tools); amends the order in D82. Phase 1's declaration-level history and pickaxe search stay for a later cycle; the new provenance tool may use a bounded `git log -L` on a path and line span. |
| D106 | Storage: Postgres tables only, behind the `ProvenanceStore` port (D87). Markdown in a Zoekt-indexed companion repository is added later only if pull request search measurably misses. |
| D107 | This cycle loads data from a recorded snapshot through a `DiscussionSource` port (adapters: snapshot now, live GitHub next cycle). Same mapper, linker and writer for both. The live GitHub sync is cycle 15. |
| D108 | Success rule: the D8 rule over all 40 questions for the new arm against a same-day `clone-tools-git` rerun; "why" reported separately; one Sonnet confirmation only if Haiku is inside the noise (D26 pattern). Eval spend cap for Phase 2: $5. |
| D109 | The snapshot is fetched once with the human's `gh` login (read-only, public data), stored outside the repository under `$EVAL_O3_DIR/github-snapshot/`, with a checksum manifest committed under `tests/eval/datasets/`. Approved by the human. Contents cut at each repository's pin date (later merges appear as open with no merge commit). The token never enters the repository, the stack or a log. |
| D110 (default) | Pull requests now; the table keeps a `kind` so issues reuse the pipeline later. No claim is made for issues. |
| D111 (default) | Backfill: pull requests updated in the last 24 months (live default, configurable). Eval snapshot: the 12 gold repositories, pull requests created up to 24 months before each pin. The other 30 Product repositories have no pull request data and say so in the result. |
| D112 (default) | Ticket keys in pull request text: an operator-configured list of project keys (TRUNK, RESTWS, O3 for OpenMRS) plus Jira browse links; no generic pattern. |
| D113 (default) | New tools register only when `MCP_HISTORY_TOOLS=on`; with it off the registration snapshots stay byte-identical (regression gate check 1). The only guidance is in the tool descriptions; no new server-instruction recipe for the first measurement. |
| D114 (default) | Store author logins, never emails. Pull request text is untrusted third-party content, like source code. Rows are keyed by repository so visibility equals the repository's (new isolation point P12 in the ADR). |

### Slices (all built by Claude agents; reviews by a different Sonnet reviewer)

**S47. Pull request snapshot for the eval corpus.** Tier standard. Network, writes outside the repository.
- Goal: `pnpm eval -- corpus discussions` fetches pull requests, comments, review comments and changed-file lists for the 12 gold repositories, cut at each pin date, into `$EVAL_O3_DIR/github-snapshot/`, and writes the checksum manifest.
- Scope: `tests/eval/cli.ts` subcommand and its test (fake `gh`), `tests/eval/datasets/github-snapshot.manifest.json`, the snapshot itself.
- Done: re-running changes nothing; a validation script shows every gold change unit's pull request present and its merge commit reachable from the repository's pin; no file contains a token.
- Verify: `pnpm typecheck && pnpm test`; the validation script output.
- Blocked by: none.

**S48. Store, ports, linker and snapshot import.** Tier hard (schema and linking edge cases).
- Goal: Postgres tables for discussions, comments, changed files, links and sync state; `ProvenanceStore` and `DiscussionSource` ports in `packages/shared`; a Postgres adapter; a backend queue that imports the snapshot; a linker that ties commits to pull requests (merge commit sha, `(#N)` squash subject, `Merge pull request #N`) and pull requests to ticket keys (D112), checking every commit against the local clone.
- Scope: `packages/db/prisma/schema.prisma`, `packages/shared`, `packages/backend`, `docs/adr/0001-falkon-architecture.md` (isolation point P12, provenance section), tests.
- Done: a fixture covering squash, merge-commit, rebase and force-pushed pull requests links correctly; re-import is idempotent; an edited or deleted comment is replaced; on the eval stack every gold (commit, pull request) pair is linked and verified.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- stack up` with the snapshot, then a SQL count check.
- Adversarial cases (reviewer checks): empty pull request body; a body naming two ticket keys; a commit naming a pull request that is not in the snapshot; a force-pushed head sha; the same number in two repositories; a very large pull request (files and comments truncated with a flag); a link into a repository outside the caller's Product (dropped); a repository never imported (reported as a coverage gap, not empty).
- Blocked by: S47.

**S49. Agent tools behind `MCP_HISTORY_TOOLS`.** Tier standard.
- Goal: `get_pull_request`, `search_discussions`, `get_provenance` (one anchor: commit, pull request, ticket, or path with optional line span), all bounded (about 24 KB output, 20 hits per page, query words ANDed, ticket keys and `#N` exact), reading only Postgres and the local clone; never GitHub.
- Scope: `packages/shared` tool registry and `toolText.json`, `packages/web/src/lib/tools.ts` and `mcp.ts`, contract snapshots, isolation tests.
- Done: with the flag off the existing registration snapshots are byte-identical; with it on the new tools follow the existing ones; an out-of-Product repository behaves exactly like a missing one; a never-imported repository returns a coverage gap.
- Verify: `pnpm typecheck && pnpm test`.
- Blocked by: S48.

**S50. Eval arm and measurement.** Tier standard. Costs money.
- Goal: arm `clone-tools-git-prs` (git arm plus the new tools) on its own eval stack with the flag on and the snapshot mounted; run `clone-tools-git` and the new arm on all 40 questions on Haiku the same day; report with `--reference clone-tools-git`.
- Scope: `tests/eval/harness.ts`, `data.ts`, `cli.ts`, `stack.ts` and tests; other arms deny the new tools and count attempts as denied attempts (D104).
- Done: per-kind and per-question results, tool-call counts, the D108 verdict.
- Verify: `pnpm eval -- run --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs`, then `pnpm eval -- report --dataset history --model haiku --reference clone-tools-git`.
- Blocked by: S47 to S49.

Not in this cycle: the live GitHub adapter (cycle 15), issues, Markdown materialisation, git-only tools, Jira.

### Limits and budget

- The loop may decide alone: details inside each slice's scope, fix rounds, a re-run of a failed eval run once.
- It stops for: any new dependency or Postgres extension; any change to the tool registration with the flag off; any secret or real-token step; ADR or glossary changes beyond the planned P12 and provenance text; a change to how existing datasets score; eval spend over $5.
- Budget: 1.5M subagent tokens and 360 minutes (S48 is hard and the largest; recent cycles used 0.26M to 0.98M).
- Gate 2 fires when S50's report exists, or on any trigger.

## Cycle 14 results: pull request ingestion beats the floor (2026-10-24)

S47 to S50 kept (commits `4432a93`, `16f7204`, `2cfff99`, `8717ea4`, plus the stack fix `6081f09`). Claude agents built them; separate Sonnet reviewers checked S47, S48 and S49 (S48 and S49 each needed a fix round: S48 for a poison-pill import, S49 for number limits and exports); S50 had no separate review.

Measurement (Haiku, one run per question, same day, fresh stacks, all 40 questions; raw runs `eval-runs-c14/`, report `baseline-c14-report.md`; `--reference clone-tools-git`):

| | clone-tools-git (same-day rerun) | clone-tools-git-prs | difference [95% CI] |
|---|---|---|---|
| recall, all 40 | 0.691 | **0.849** | +0.158 [0.059, 0.255] (19 wins, 5 losses, 16 ties) |
| "why" (16) | 0.531 | 0.854 | |
| "what changed and when" (12) | 0.823 | 0.828 | |
| "ticket to code" (12) | 0.771 | 0.861 | |
| precision, all 40 | 0.544 | 0.544 | 0.000 [-0.088, 0.084]; "why" precision is low (0.276) |
| mean cost per run | $0.027 | $0.041 | +$0.014 [-0.002, 0.034] |

The D108 rule passes: the lower bound of the recall difference is above zero. Dev alone: +0.123 [-0.014, 0.251]; hidden alone: +0.210 [0.070, 0.345]. Tool use in the new arm (all runs): get_pull_request 89, search_discussions 37, get_provenance 39. The cycle 13 floor run of the git arm scored 0.696 and this rerun 0.691: the same-day noise is small. "Why" rose to 0.854, above the 0.81 ceiling predicted from title/body/branch keys alone, because ticket keys also reach the agent through pull request comments and the link text.

Notes: an earlier pilot of the new arm was invalid (the web service of the pull request stack did not have `MCP_HISTORY_TOOLS` on, so the agent never saw the tools; the arm equalled the git arm); fixed in `6081f09` with a test; those runs are kept untracked in `eval-runs-c14-invalid/`. The runner reserves $1 per run in flight against the spend cap, which stopped the first attempt at $1.56 actual spend, so the reservation ceiling was raised to $7 for the rerun; actual Phase 2 spend $3.69 of the $5 cap. Gold links on the stack: all 89 change units (84 distinct pairs) linked and verified; 9,116 pull requests imported in about 65 seconds, 76 MB of new tables.

Open limits: five "why" tickets appear only in Jira; Jira ingestion is Phase 3. Known weak spots: five questions got worse (hist-a-09 0.50 to 0.00, hist-b-05 0.75 to 0.00, hist-b-09 1.00 to 0.86, hist-c-01 and hist-c-09 each 1.00 to 0.67), precision on "why" is low because the agent lists many items, and the cost rises 50%.

## Cycle 14 follow-up (2026-10-24)

[`c14-followup-analysis.md`](c14-followup-analysis.md) explains the five questions that got worse and the low "why" precision. Short form: three of the five were lost by the answer prompt and parser, not the tools (the prompt's format example uses the repository name `openmrs-core`, and span paths without the repository prefix are silently dropped); one is a search usability gap (all query words must match); one is noise. "Why" precision is low because the agent lists source spans that no "why" gold contains (95 of 173 items); without spans it is 0.616. No gold is wrong. The recommended eval fixes (prompt example and span rule, a dropped-span counter, a hint when a multi-word search finds nothing) are not part of cycle 15; any rerun needs a new spend approval.

## Cycle 15 plan: the live GitHub sync (gate 1 approved 2026-10-24, with S58 added)

Goal: a deployed Falkon fills and refreshes its pull request store from GitHub by itself, so the history tools work for real users and not only on the recorded snapshot. The live adapter implements the existing `DiscussionSource` port (ADR 4.11, decision D107); the mapper, linker, writer, store and tools do not change except where a slice below says so. Success is not an eval score: it is that the adapter produces the same stored shape as the snapshot path for the same pull requests (parity test on recorded GitHub responses), survives the adversarial cases below, and passes one real-token smoke run by the human at gate 2.

Base `main` at the commit that holds this plan. Cycle branch `loop/falkon-enterprise-c15`. Roles: Opus plans (this session), Sonnet decides and commits after gate 1, Claude implements (S53 on Opus, the rest Sonnet or Haiku as marked), a different Sonnet reviewer checks each slice (Codex is not used).

### Decisions (grilled 2026-10-24 with the human unless marked default)

| # | Decision |
|---|---|
| D115 | Permissions: before a repository's first sync, and again when its connection token changes, the sync sends one cheap read of that repository's pull requests and of their conversation comments. A refusal stores `access = no-access` for the repository, and the history tools report a coverage gap `pull requests not readable for <repo>: the token needs Pull requests: Read and Issues: Read` (the conversation comments of a pull request come from the issues API, which is why Issues: Read is needed even though issues are not synced). Other repositories keep syncing. |
| D116 | Cadence: a tick every 30 seconds (like `scheduleTick`) enqueues each repository whose last run is older than the sync interval, default 15 minutes (`settings.discussionSyncIntervalMs`). Repositories are staggered so a Product does not burst. A weekly full reconcile (`settings.discussionReconcileIntervalMs`, default 7 days) re-reads every pull request updated in the last 30 days regardless of the cursor, to catch edits that did not move the updated time. Polling only; no webhooks. |
| D117 | Backfill: pull requests updated in the last 24 months on a repository's first sync (`settings.discussionBackfillMonths`, default 24; same window as decision D111). Older history stays reachable through git. |
| D118 | Rate limits: the sync reads the remaining budget from every GraphQL response and REST header. At less than 10% remaining it stops reading, saves its progress, records `status = waiting` with `waitUntil` = GitHub's reset time and requeues the job delayed to that time. The budget it leaves is for cloning and connection listings that share the token. Tools keep serving stored data. |
| D119 | Scope: pull requests only. The `kind` column stays; issues are a later cycle with their own measurement (GitHub issues are off on the OpenMRS frontend repositories). |
| D120 | Smoke test: automated tests run on raw GitHub responses recorded once (S51, with the human's `gh` login on public repositories, as decision D109 did; no token in any file). The real-token proof is a script the human runs (S57): `scripts/sync-smoke.sh` reads the token from the human's shell environment (`read -s GITHUB_TOKEN; export GITHUB_TOKEN`), syncs two small public repositories into a throwaway database, prints counts, request use and pass or fail, and writes the token nowhere. No agent ever sees the token. |
| D121 | Authors: logins only, as decision D114. The GraphQL query asks only for `login` on users; never name, email or avatar. |
| D122 | Freshness: with `MCP_HISTORY_TOOLS` on, every history tool result lists, for each repository it touched, `lastSyncedAt` and `stale: true` when the last success is older than twice the sync interval, or the last run failed, is waiting for the rate limit, or has no access. It is read from the stored sync-state rows; no tool calls GitHub (request-path rule). With the flag off nothing changes. The server-wide instruction text is not changed. |
| D123 (default) | Opt-in: a GitHub connection syncs pull requests only when its config has `"discussions": true`. Off by default, because it is outbound traffic with the operator's token. The snapshot path (`DISCUSSIONS_SNAPSHOT_DIR`, used by the eval) keeps working and wins when set. |
| D124 (default) | Fetch design: incremental discovery with the REST issues listing (`state=all`, `sort=updated`, `direction=asc`, `since=cursor`), keeping the items that carry `pull_request`; detail for each number by GraphQL in batches (the fragment, page caps and `truncated` flags of the S47 snapshot, reused so both sources store the same shape). The cursor is the newest `updatedAt` processed per repository (the existing `DiscussionSyncState.cursorUpdatedAt`); ascending order means an interrupted run resumes without skipping. Transport is Octokit already in the backend (`@octokit/rest` includes the GraphQL client): no new dependency. GitHub Enterprise uses the connection's `url`. |
| D125 (default) | Head-branch shas are never stored (ADR 4.11 stays). The `commits/{sha}/pulls` fallback links default-branch commits that no merge sha or `(#N)` subject names (rebase and merge-queue merges), at most 50 probes per run, results (including "none") remembered so a commit is asked once. |
| D126 (default) | Errors store fixed strings only, never GitHub text; the token is never logged; GitHub error bodies are not stored. Pull request text stays untrusted (decision D114). |
| D128 | Eval spend: a new cap of $5 for cycle 15 (human, 2026-10-24); the earlier Phase 2 cap ($3.69 of $5 used) is closed. It pays for the S61 rerun of both arms. |
| D127 (default) | Live sync reads happen only in the backend worker. A test pins that the history tool module and the web tools import no network client. ADR 4.11 is amended in place in S57 (live adapter, permissions, freshness; "polling only"); isolation point P12 is unchanged because rows stay keyed by repository. |

### Slices

**S51. Record raw GitHub responses for fixtures.** Tier mechanical. Agent claude. Network with the human's `gh` login (read-only, public data; the human's approval of this plan covers it, as decision D109 did).
- Goal: raw REST and GraphQL responses for two small public OpenMRS repositories (one with squash merges, one with at least one rebase-merged pull request if any exists), plus one very large pull request, recorded as fixtures with no token and no author emails.
- Scope: `packages/backend/src/fixtures/github/` (JSON files and a README listing the exact requests), `scripts/record-github-fixtures.sh` (uses `gh api`; the human can re-run it).
- Done: each fixture file is valid JSON, under 2 MB, contains no `Authorization`, token-looking string or email address (a grep check in the verify step), and the README names the request that produced each file and the date.
- Verify: `pnpm typecheck`; `grep -rEi "ghp_|github_pat_|authorization|@[a-z0-9.-]+\.[a-z]{2,}" packages/backend/src/fixtures/github` finds nothing except the documented bot noreply form (the check script lists exceptions explicitly).
- Adversarial cases (reviewer checks): a pull request with no body; one with more than 100 comments (page cap); one from a deleted user (`author: null`); one whose head repository was deleted.
- Blocked by: none.

**S52. Sync state, rate-limit yield and no-access in the import core.** Tier standard. Agent claude.
- Goal: the import core can express "waiting for the rate limit", "no access" and "reconciling" and resume correctly.
- Scope: `packages/db/prisma/schema.prisma` and one additive migration (`DiscussionSyncState`: `access`, `waitUntil`, `reconciledAt`, widened `status` values), `packages/shared/src/provenance.ts` (`SyncState`, a `RateLimited` signal a source can throw, `NoAccess`), `packages/backend/src/discussions.ts` (`importDiscussions` handles both signals: saves progress and cursor, never marks them failed), the Postgres store, tests.
- Done: a fake source that throws `RateLimited(resetAt)` after three pull requests leaves three stored, the cursor at the third pull request's updated time, `status = waiting`, `waitUntil = resetAt`, and the next run starts after the cursor; a fake `NoAccess` stores `access = no-access`, imports nothing and leaves other repositories alone; the snapshot source tests pass unchanged; the migration is additive and existing rows read as `access = unknown`.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/backend test`; with `PROVENANCE_TEST_DATABASE_URL` set to a disposable database, the contract tests in `provenancePg`.
- Adversarial cases: yield on the very first item (cursor must not move); yield in the middle of a repository with a skipped malformed item (cursor stays before the skipped item); two repositories, one waiting and one fine; a `waitUntil` in the past (resume now).
- Blocked by: none.

**S53. The GitHub adapter.** Tier hard (cursor, pagination and rate-limit correctness). Agent claude on Opus.
- Goal: `githubSource(connection)` implements `DiscussionSource` against GitHub: permission probe (D115), backfill window (D117), incremental discovery and detail (D124), reconcile mode (D116), rate-limit yield (D118), enterprise `url`, logins only (D121).
- Scope: `packages/backend/src/githubDiscussions.ts` and tests with the S51 fixtures through a fake transport; reuse the S47 fragment from `tests/eval/discussions.ts` by moving the shared part into `packages/backend` (the eval keeps working through an import). No new dependency.
- Done: a parity test shows the adapter's `Discussion` for each fixture pull request equals what `mapSnapshotPull` gives for the same pull request; backfill never requests anything older than the window; a second run with the stored cursor requests only items updated since; a 403 on the probe yields `NoAccess`; a response showing 9% remaining yields `RateLimited` with GitHub's reset time; a 5xx or abuse-limit response retries as `fetchWithRetry` does and then fails with a fixed error; reconcile ignores the cursor for the last 30 days.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a pull request with 101 comments (truncated flag set, not silent); `author: null`; a force-pushed pull request (no head sha reaches the store); two pages of the issues listing where an item moves between runs; clock skew (`since` uses the stored cursor, not the local clock); an empty repository; a repository renamed since the last run; the token missing (clear fixed error, no request sent); a GraphQL error body that contains the word "token" (not stored or logged).
- Blocked by: S51, S52.

**S54. Scheduler, queue and settings.** Tier standard. Agent claude.
- Goal: the backend runs the sync on a schedule (D116, D123).
- Scope: `packages/backend/src/index.ts` (new queue `discussion-sync`, `discussionTick` like `scheduleTick`, delayed requeue for `waitUntil`, graceful close), `packages/shared/src/config.ts` (`discussionSyncIntervalMs`, `discussionReconcileIntervalMs`, `discussionBackfillMonths`, connection `discussions` flag), `README.md` configuration table, tests.
- Done: with a fake source, a due repository is enqueued once per interval (job id dedupes), a waiting repository is not enqueued before `waitUntil`, a repository whose connection has no `discussions: true` is never enqueued, the snapshot path still works when `DISCUSSIONS_SNAPSHOT_DIR` is set, and shutdown closes the new queue and worker. Live sync never runs inside a tool request.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a thousand repositories due at once (staggered, not a burst; bounded jobs per tick); a job that outlives its lock; two backend processes (job id dedupe); config reload turning the flag off mid-run (the running job finishes, no new jobs).
- Blocked by: S52, S53.

**S55. Freshness in the history tools.** Tier standard. Agent claude.
- Goal: D122.
- Scope: `packages/shared/src/historyTools.ts`, `historyToolText.json`, the `ProvenanceStore` read of sync state, contract snapshots under the flag, tests.
- Done: with `MCP_HISTORY_TOOLS` off the registration snapshots are byte-identical to `main`; with it on, each of the three tools' results carries `freshness` for the repositories it touched; stale, failed, waiting and no-access states are covered by tests; an out-of-Product repository does not appear in `freshness` (P12); no network import in the tools module (test).
- Verify: `pnpm typecheck && pnpm test`; the contract snapshot test files from cycle 14.
- Adversarial cases: a repository never imported (coverage gap, not stale); a repository with a failed run and an old success; `lastSyncedAt` null; a result touching many repositories (list capped and flagged).
- Blocked by: S52.

**S56. Unlinked-commit fallback.** Tier standard. Agent claude.
- Goal: D125.
- Scope: `packages/backend/src/githubDiscussions.ts` (a probe function), `packages/backend/src/discussions.ts` (call it after `commitLinks` for commits with no link, bounded), schema (a small `CommitPullProbe` table, additive), `LinkSource` gets `commit-pulls-api`, tests.
- Done: with a fixture of a rebase-merged pull request, every commit of it gains a verified link once; a commit with no pull request is probed once and then skipped; at most 50 probes per run; a probe that returns a pull request outside the store is dropped; a 403 on the probe stops probing for that run without failing the sync.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a commit with several pull requests; a commit not in the clone; the rate limit hit mid-probing (yield, progress kept).
- Blocked by: S53, S54.

**S57. Smoke script, documentation, ADR amendment.** Tier standard. Agent claude.
- Goal: the human can prove the live path with a real token (D120), and the docs say how an operator turns it on.
- Scope: `scripts/sync-smoke.sh` (hidden prompt for the token, a disposable compose project named `falkon-eval-sync` or a plain throwaway Postgres, never the `falkon` project), `README.md` (turning it on, the token permissions, the intervals), `docs/adr/0001-falkon-architecture.md` (4.11 amended in place: live adapter built, permissions, freshness, polling only, the fallback), `CONTEXT.md` only if a new domain term ships (decision D101's rule).
- Done: the script exits non-zero without a token, never echoes it, stores it only in the process environment, prints repositories synced, pull requests stored, commit links, requests used and remaining budget; `shellcheck` is clean; the README names the exact fine-grained token permissions (Pull requests: Read, Issues: Read, Contents: Read for cloning); the ADR text matches the code (no claim that is not built).
- Verify: `pnpm typecheck && pnpm test`; `shellcheck scripts/sync-smoke.sh`; a dry run of the script with a deliberately wrong token shows the fixed no-access message and exits non-zero.
- Blocked by: S53, S54, S55, S56.

**S58. Eval prompt, parser and rescore fixes.** Tier standard. Agent claude. No model spend (added by the human at gate 1; follows `c14-followup-analysis.md`).
- Goal: remove the answer-format flaws found in cycle 14 without running a paid eval.
- Scope: `tests/eval/harness.ts` (history prompt only: the format example uses `<repository-name>` placeholders instead of `openmrs-core`; spans are cited as `<repository-name>/<path>`, resolving the clash with the product paragraph; for why and when questions only the answering change and ticket go in the array, related changes in prose), `parseAnswer` (counts spans it drops as `droppedSpans` in the run record and report), `report.ts`, tests. The prompt of the non-history datasets stays byte-identical (test).
- Done: a test pins the old non-history prompt text; the new history prompt contains no literal `openmrs-core` example; rescoring the stored cycle 14 runs prints the same recall and precision as `baseline-c14-report.md` plus a new dropped-span count (53 git arm, 60 new arm); no scoring rule changes.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- report --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs --reference clone-tools-git` with `EVAL_RUNS_DIR=.scratch/falkon-enterprise/eval-runs-c14`, diffed against the recorded report.
- Adversarial cases: a span path with and without the prefix; a path in two repositories; a malformed fence; 21 items.
- Blocked by: none. A rerun of the arms with the new prompt needs a new spend approval and is not part of this cycle.

**S59. Search hint when a multi-word search finds nothing.** Tier standard. Agent claude. Added by the human after gate 1 (2026-10-24).
- Goal: an agent whose all-words-required `search_discussions` query finds nothing learns what to do (cause of the hist-a-09 loss in `c14-followup-analysis.md`).
- Scope: `packages/shared/src/historyTools.ts`, `historyToolText.json`, tests. Only the flag-gated `search_discussions`; reads Postgres only.
- Done: with more than one word and `totalCount` 0, the result carries `hint` ("all words are required; try fewer or the title words") and up to 5 `partialMatches` (newest first, each naming `matchedWords`) from a bounded any-word search under the same 2 s timeout and repository filter; one word, or any hit, adds neither; with the flag off the registration snapshots are byte-identical; an out-of-Product repository never appears in `partialMatches` (P12).
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: 8 words (the cap); every word matching a different pull request; a query of only ticket-key or `#N` shape (exact lookups stay exact, no hint); the timeout firing during the fallback (hint kept, `truncated` names it).
- Blocked by: none.

**S60. Repository-name hint on "not found".** Tier standard. Agent claude. Added by the human after gate 1.
- Goal: a bare repository name (`openmrs-esm-core`) that the server rejects tells the agent the spelling that works, saving the roughly four wasted calls per run seen in cycle 14.
- Scope: the shared repository-not-found error in the tool runner (`packages/shared/src/tools.ts` or where the graph shows it) and its tests. Error text only: no tool schema, description or registration changes.
- Done: when a bare name matches exactly one repository in the caller's effective set, the error says `Repository "x" not found. Did you mean "github.com/openmrs/x"?`; no match or several matches keep today's text unchanged; a repository outside the effective set is never suggested (P12); registration snapshots are byte-identical with the flag off; tests that pin the old text are updated and listed in the slice report.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a name matching two repositories in different hosts; a name matching only an out-of-Product repository; case differences; empty and path-like input.
- Blocked by: none.

**S61. Rerun of both arms with the fixes.** Tier standard. Agent claude (verifier runs the commands). Costs money, under D128.
- Goal: measure the effect of S58, S59 and S60 on the 40 history questions, Haiku, same day, both arms.
- Scope: eval runs only (`.scratch/falkon-enterprise/eval-runs-c15/`, a short report `baseline-c15-report.md` and a results note in this spec). No product code.
- Done: both arms complete 40 of 40 with zero failed or malformed runs; `report --reference clone-tools-git`; per-kind recall and precision against the cycle 14 numbers (new arm 0.849 recall, 0.544 precision, "why" precision 0.276), the dropped-span count, and the count of "repository not found" errors per run (cycle 14: 164 and 176 in 40 runs); cost within D128.
- Verify: `pnpm eval -- run --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs` on a disposable `falkon-eval*` stack, then `pnpm eval -- report --dataset history --model haiku --reference clone-tools-git`.
- Stops and asks the human if: `EVAL_O3_DIR` or the snapshot is not available, or projected spend exceeds D128.
- Blocked by: S58, S59, S60.

### Regression gate

Check 1 (registration snapshots with `MCP_HISTORY_TOOLS` off) stays byte-identical; nothing in this cycle changes how existing datasets score; `pnpm typecheck && pnpm test` pass; the cycle 14 pull request eval stack still imports the snapshot (S54 keeps `DISCUSSIONS_SNAPSHOT_DIR` working). The only paid run is S61, inside the D128 cap.

### Order, limits, budget

- Wave 1: S51 and S52 in parallel. Wave 2: S53 and S55 in parallel. Wave 3: S54. Wave 4: S56. Wave 5: S57. S58, S59 and S60 run in wave 1 beside S51 and S52 (three parallel at a time, the rest as slots free; S58 touches only `tests/eval`). S61 runs after S58 to S60 land, before gate 2. Gate 2 also needs the human's real-token smoke run.
- The loop may decide alone: details inside each slice's scope, fix rounds, a rerun of a failed verify once.
- It stops for: any new dependency; any change to the tool registration with the flag off; any step that needs a real token or the human's `gh` login beyond S51; ADR or glossary changes beyond the planned 4.11 amendment; a change to how existing datasets score; a schema change beyond the additive ones named above; any push or pull request; spend over the D128 cap of $5.
- Docker: one stack at a time, only disposable `falkon-eval*` projects; never the human's `falkon` project or the `falcon-sourcebot-*` containers.
- Budget: 2.0M subagent tokens and 420 minutes (the last four cycles used 0.26M to 1.05M; S53 is hard; S58 to S61 add about 0.4M and an hour).
- Gate 2 fires when S57 is kept and the human has the smoke result, or on any trigger.

### Not in this cycle

- Issues, webhooks, Jira, the git-only history tools of Phase 1, visibility synced from GitHub (Phase 6).

## Cycle 15 results: the live GitHub sync (gate 2 approved 2026-10-24)

Built on the cycle branch `loop/falkon-enterprise-c15` (base `a87c380`): S51 recorded GitHub responses; S52 sync state (rate-limit yield, no-access); S53 the GitHub adapter; S54 scheduler, queue and settings; S55 freshness in the history tools; S56 unlinked-commit fallback; S57 smoke script, README and ADR 4.11 amendment; S58 eval prompt, parser and rescore fixes; S59 search hint; S60 repository-name hint; S61 the paid rerun. Claude agents built them; a separate Sonnet reviewer checked every slice. Six of the nine slices reviewed by a Sonnet reviewer needed one fix round, each for a real defect found by review: S59 (an unparenthesised OR in the new SQL would have escaped the repository scope, a Product-isolation breach), S60 (the hint lookup could replace the not-found error), S53 (a rate-limit 403 was recorded as no-access, the probe skipped the issues-comments permission, the cursor could skip unread items), S54 (repositories failing before any state was saved starved the others; a running backfill could be queued twice), S56 (one commit GitHub does not know blocked every older commit), S57 (a Postgres readiness race, a cleanup that could remove another run's container, ADR wording). S52, S55 and S58 passed review without blocking findings; S51 (recorded fixtures) was checked by the main session (grep for tokens and emails, JSON validity, size).

Not yet verified: the new SQL and the live path against a real Postgres and a real GitHub. The Postgres variants of the contract tests skip without `PROVENANCE_TEST_DATABASE_URL`; the real-token smoke run (`scripts/sync-smoke.sh`) is the human's step at this gate.

Rerun (S61, D128; Haiku, one run per question, same day, fresh stacks, 40 of 40 per arm; raw runs `eval-runs-c15/`, report `baseline-c15-report.md`; `--reference clone-tools-git`). Spend $2.7108 of the new $5 cap.

| | clone-tools-git | clone-tools-git-prs |
|---|---|---|
| recall, all 40 (cycle 14) | 0.745 (0.691) | 0.844 (0.849) |
| precision, all 40 (cycle 14) | 0.563 (0.544) | 0.576 (0.544) |
| "why" recall / precision (cycle 14) | 0.531 / 0.349 (0.531 / 0.336) | 0.844 / 0.498 (0.854 / 0.276) |
| "what changed and when" recall / precision | 0.843 / 0.640 (0.823 / 0.788) | 0.764 / 0.610 (0.828 / 0.772) |
| "ticket to code" recall / precision | 0.931 / 0.773 (0.771 / 0.576) | 0.924 / 0.648 (0.861 / 0.673) |

Difference, new arm minus git arm: recall +0.099 [0.012, 0.188] (14 wins, 6 losses, 20 ties); dev +0.047 [-0.056, 0.158]; hidden +0.177 [0.021, 0.318]. The printed verdict is "withheld", not a pass or fail, because the git arm has one leak flag: hist-b-09 used the built-in Grep on the Claude CLI's own tool-result spill folder for an oversized diff (the harness path pattern does not recognise the folder itself; same class as the cycle 13 flag on hist-a-05; no corpus data was read). Without the flag the lower bound is above zero.

What the numbers say. (1) The prompt and parser fixes (S58) worked: the three questions lost to them in cycle 14 recovered on the new arm (the repository-name example hist-b-05, the span-prefix cases hist-c-01 and hist-c-09), the search-usability question hist-a-09 also recovered, dropped spans are 0 in both arms, and the git arm improved on kind "ticket to code" (0.771 to 0.931) from the same fixes. (2) "Why" precision of the new arm rose from 0.276 to 0.498, as predicted. (3) The new arm's recall did not rise, so the gap over the git arm shrank from +0.158 to +0.099, because the git arm benefited from S58 too; the new arm lost recall on other questions (hist-a-14 0.67 to 0.00, hist-a-07 1.00 to 0.50, hist-b-12 0.83 to 0.33 and others), at one run per cell this is within noise of the kind seen in cycle 13 to 14, but it is not proven noise. (4) "What changed and when" precision fell in both arms (about -0.15), which the S58 instruction to list only the answering change probably causes (fewer spans listed, so fewer sure hits); to be checked before the prompt is frozen. (5) "Repository not found" errors fell only modestly (like-for-like count of tool results: git arm 82 to 68, new arm 88 to 68; 66 and 68 of them carried the "Did you mean" hint). The 164 and 176 quoted in the cycle 14 analysis counted each error twice, so the earlier "about four wasted calls per run" is really about two. (6) The search hint was returned twice in 28 `search_discussions` calls. (7) Tool use in the new arm: get_pull_request 80, search_discussions 28, get_provenance 39.

Note for the runner: with concurrency 3 and a $1 per-run reservation, the runner stops new runs when ledger spend plus the reservation passes the cap even though real spend is lower; the dev split needed seven reruns of the same command. Also `stack down` leaves the `--prs on` stack up (`stack down --prs on` is needed).

Real-token smoke (human, 2026-10-24, classic token with repo scope, `scripts/sync-smoke.sh`): first run FAILED with 'no commit links' because the 24-month window excluded the old default repositories (1 pull request stored, an open one); a smoke-design defect, fixed in the follow-up (the smoke reads a 120-month window; the product default stays 24). Second run PASS: backfill window 120 months; openmrs-module-dataentrystatistics 10 pull requests, 6 rule links, 1 api link; openmrs-contrib-keycloak-smart-auth 21 pull requests, 10 rule links, 0 api links; 31 pull requests stored, 16 rule and 1 api commit links; 50 REST and 4 GraphQL requests; budget 4950 REST and 4996 GraphQL of 5000 each; permission probe ok for both. This proves the real GitHub path end to end (probe, discovery, GraphQL detail, linking, the `commits/{sha}/pulls` fallback, request accounting) on two small public repositories; it does not exercise the rate-limit yield, a no-access token, a long backfill or the scheduler, and the Postgres variants of the contract tests are still not run.

Gate 2 decisions (human, 2026-10-24): approve and merge; the ADR section 8 failure rows and the P12 gap-text edit are accepted; `CONTEXT.md` stays unchanged for now (drafts kept: Discussion, a pull request of one repository with its comments, reviews and changed files as stored at its last sync, third-party text, visible exactly where its repository is; Provenance link, a stored directed relationship from a commit or a Discussion to a Discussion or a ticket key, with the rule that found it); the permission probe stays on every run as built (this departs from the wording of D115: probe before the first sync and on token change; the ADR says so); the runner quirks (the $1 per-run reservation stopping runs early, `stack down` not stopping the `--prs on` stack) are left as they are.

## Cycle 16 plan: settle the history answer prompt (planned 2026-10-24; stopped at gate 1, analysis only)

Goal: freeze the history answer prompt on evidence, with the smallest work that can do it. Evidence: [`c15-rerun-analysis.md`](c15-rerun-analysis.md) (read-only analysis of the stored cycle 14 and 15 runs; no spend). Two findings: (1) the S58 prompt line makes agents add a ticket to "what changed and when" answers whose gold has only pull requests, which explains the precision fall (0.886 and 0.950 without the ticket items); it also did not remove source spans from "why" answers; (2) two of the pull request arm's recall losses (hist-a-14, hist-c-03) were runs that started before the pull request import finished (33 to 41 repositories reported "not ingested" against the usual 30), and the rest are within one-run noise; the "why" lead is unchanged (+0.323, +0.312). This cycle is deliberately small and is not a priority over the roadmap: the human asked at the grilling why it is being worked on at all, and the plan below is the minimum that closes the prompt question; gate 1 may also choose to stop with the analysis alone.

Base `main` at the commit that holds this plan. Cycle branch `loop/falkon-enterprise-c16`. Roles: Opus plans, Sonnet decides and commits after gate 1, Claude implements (Sonnet), a different Sonnet reviewer checks each slice. Codex is not used.

### Gate 1 outcome (human, 2026-10-24)

Stopped with the analysis only: S62, S63 and S64 are not built and nothing is spent (the $5 cap of D132 is unused and lapses with the cycle). The history answer prompt stays as cycle 15 left it, and it is not frozen. Known and left as is: the S58 line adds non-scoring ticket items to "what changed and when" answers (precision 0.640 and 0.610 against 0.886 and 0.950 without them), spans still appear in "why" answers, and the eval runner does not wait for the pull request import (two contaminated cycle 15 runs, hist-a-14 and hist-c-03). The human's priority is the roadmap. If prompt or runner work is picked up later, start from [`c15-rerun-analysis.md`](c15-rerun-analysis.md) and the slices above.

### Decisions (grilled 2026-10-24 with the human unless marked default)

| # | Decision |
|---|---|
| D129 | Scope and priority (human): work on this only as far as it is necessary; it is not a high priority against the roadmap (Phase 1 git history tools next). The cycle is two no-spend slices and one capped paid pass, then stops at gate 2; no further prompt iteration after it. Gate 1 may instead end the cycle with the analysis. |
| D130 (default, proposed by the planner, open to strike at gate 1) | Prompt: the history answer prompt says a ticket goes in the array only when the question asks which ticket or names one, and a source span only when the question asks which lines or where in the code. Pull requests and commits stay as in cycle 15. The prompt text of the non-history datasets stays byte-identical. |
| D131 (default) | Runner: with the pull request tools on, the eval preflight waits (bounded, default 20 minutes) until none of the 12 repositories in `github-snapshot.manifest.json` is reported as "not ingested", and fails with their names if it never happens. A run record keeps `importGaps`: the snapshot repositories reported "not ingested" in its tool results; the report lists such runs as contaminated and withholds the verdict, as it does for a leak. |
| D132 | Spend (human, 2026-10-24): a cap of $5 "if it is necessary to work on this any further". One pass of both arms costs about $2.7, so the cap pays for one pass and part of a second. The loop runs one pass and stops; it never starts a second without a new approval. The cycle 15 cap ($5, $2.71 spent) is closed. |
| D133 | Freeze rule (human): the prompt is frozen when the one pass shows (a) "what changed and when" precision at least 0.77 in both arms, (b) the lower bound of the pull request arm's recall lead over the git arm above zero, (c) no contaminated run, zero failed or malformed runs, and (d) no fall in "ticket to code" recall below 0.90 in either arm (cycle 15: 0.931 and 0.924), so the new rule did not cost ticket or span hits. If any fails, the loop stops and reports; it does not iterate on the prompt. With one pass the lead interval is wide: a lower bound at or below zero is reported as "not shown", and the human decides whether to spend more. |
| D134 | Search matching (human asked whether fuzzy search should exist): yes in principle (it is a real usability gap, exact words only), but it is a product change with its own measurement. Parked as a roadmap candidate, not in this cycle, so the paid pass measures only the prompt. |

### Slices

**S62. Eval runner waits for the pull request import and flags contaminated runs.** Tier standard. Agent claude. No spend.
- Goal: D131.
- Scope: `tests/eval/preflight.ts`, `tests/eval/cli.ts`, `tests/eval/report.ts`, `tests/eval/runner.ts` or the run record writer as needed, their tests. No product code.
- Done: with a fake MCP client whose `search_discussions` first reports snapshot repositories as not ingested and later does not, the preflight polls and then passes; if it never clears within the bound, the error names the repositories still missing; with the pull request tools off (git arm) nothing changes and no call to `search_discussions` is made; a run whose tool results name a snapshot repository as not ingested gets `importGaps` set, the report lists it as contaminated and the verdict is withheld; rescoring the stored cycle 15 runs prints the same recall and precision as `baseline-c15-report.md` plus the contaminated list (expected: hist-a-14 and hist-c-03 in the pull request arm).
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- report --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs --reference clone-tools-git` with `EVAL_RUNS_DIR=.scratch/falkon-enterprise/eval-runs-c15`, diffed against the recorded numbers.
- Adversarial cases: a stack with all 12 repositories already imported (no wait); a repository outside the manifest reported as not ingested (not contamination, it is expected); the poll hitting an MCP error (fixed error, not an endless loop); the bound reached; a tool result that is not JSON.
- Blocked by: none.

**S63. History prompt: tickets and spans only when asked.** Tier standard. Agent claude. No spend.
- Goal: D130.
- Scope: `tests/eval/harness.ts` (history prompt only) and `tests/eval/harness.test.ts`.
- Done: a test pins the old non-history prompt text byte for byte; the history prompt contains the new rule and no literal repository example; a test over the 40 dataset questions classifies by relation and checks that the instruction does not forbid what that relation's gold needs (the 12 "ticket to code" questions name a ticket and their gold counts it; 8 of them ask which lines); scoring code is unchanged.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a question that names a ticket and asks for the change (ticket to code); a "why" question that also asks "which lines" (span allowed); wording that a Haiku agent could read as "never list a ticket" (reviewer reads the final text for that).
- Blocked by: none.

**S64. One paid pass of both arms and the freeze decision.** Tier standard. Agent claude (verifier runs the commands). Costs money, under D132.
- Goal: measure D130 and D131 on the 40 history questions, Haiku, both arms, same day, fresh stacks.
- Scope: eval runs only (`.scratch/falkon-enterprise/eval-runs-c16/`, `baseline-c16-report.md`, a results note in this spec). No product code.
- Done: both arms complete 40 of 40 with zero failed, malformed or contaminated runs; per-kind recall and precision against cycle 15 (git 0.745 and 0.563, prs 0.844 and 0.576; "what changed" precision 0.640 and 0.610; "why" precision 0.349 and 0.498; "ticket to code" recall 0.931 and 0.924); ticket and span items listed per kind; the D133 verdict written plainly as frozen, not frozen, or not shown; spend within D132.
- Verify: `pnpm eval -- run --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs` on a disposable `falkon-eval*` stack (`stack down --prs on` to stop it), then `pnpm eval -- report --dataset history --model haiku --reference clone-tools-git`.
- Stops and asks the human if: `EVAL_O3_DIR` or the snapshot is unavailable, the preflight cannot clear the import, or projected spend passes $5.
- Blocked by: S62, S63.

### Regression gate

Nothing in `packages/` changes, so registration snapshots and existing datasets are untouched; `pnpm typecheck && pnpm test` pass; the non-history prompt stays byte-identical; scoring (`score.ts`) is unchanged.

### Order, limits, budget

- Wave 1: S62 and S63 in parallel (disjoint files except `tests/eval`; S62 does not touch `harness.ts`). Wave 2: S64.
- The loop may decide alone: wording inside D130 as long as the done condition holds, fix rounds, one rerun of a failed verify.
- It stops for: any product code change; any change to scoring or datasets; spend over $5; a second paid pass; push or pull request; ADR or glossary changes (none planned: this cycle touches eval tooling only).
- Docker: one stack at a time, only disposable `falkon-eval*` projects; never the human's `falkon` project or the `falcon-sourcebot-*` containers.
- Budget: 0.6M subagent tokens and 150 minutes (cycle 15 used 0.26M to 1.05M for larger slices; S62 and S63 are small).
- Gate 2 fires when S64 is done, or on any trigger.
- A dependency install in the cycle worktree is needed for `pnpm test` (the main checkout currently has no `node_modules`); install there, never symlink.

### Not in this cycle

Fuzzy or word-form matching in `search_discussions` (D134), further prompt iteration after D133, any second pass or extra runs per cell (would need a new spend approval), Phase 1 git history tools.

## Cycle 17 plan: retire `packages/web` (gate 1 approved 2026-10-24)

Goal: one web surface. The Falkon UI (`packages/ui`, Next 16, host port 3100) and the Nest `api` service take over everything the inherited Next 15 app `packages/web` (host port 3000) still does, and `packages/web` is deleted. This fulfils MVP spec D16 and D61 (retire the engine's own pages after the Falkon UI reaches parity) and ADR 4.6 (the old Next.js routes are removed once contract and golden tests pass against the Nest boundary). It is not a history-phase cycle; it was taken up at the human's request after the human found two Next.js apps running and the inherited UI on port 3000.

Base `main` at the commit that holds this plan. Cycle branch `loop/falkon-enterprise-c17`. Roles: Opus plans, Sonnet decides and commits after gate 1, Claude implements, a different Sonnet reviewer checks each slice. Codex is not used.

Gate 1 (human, 2026-10-24): plan approved as written; the main session switched to Sonnet for the build, as the loop prescribes. Not started: no cycle branch or worktree exists yet.

### Inventory (2026-10-24, read from the tree)

`packages/web` holds two different things:
- Retire-able Next.js pages and routes: pages `/` (code search, 68 lines), `/repos`, `/ask`, `/chat/[id]`, `/knowledge`; routes `/api/search` (GET and POST), `/api/search/stream`, `/api/repos`, `/api/chat`, `/api/chat/blocking`, `/api/ask`, `/api/chats`, `/api/knowledge` (GET status, POST scan, delete, include) and the unscoped `/api/mcp`.
- Engine core that must move, not be deleted: `src/lib/mcp.ts` (the MCP server, tool registration, server instructions, `ask_codebase`, `research_codebase`, `list_language_models`), `src/lib/tools.ts` and `repos.ts` (tool dependencies), `src/lib/ask/*` (the Ask agent, prompts, evidence, UI chat stream). The Nest `api` already imports these by relative path (`packages/api/src/main.ts`, `threads.ts`, `tsconfig.json`, three test files), so `/mcp/<product>` and the Falkon UI chat already run this code.

Already covered by the Falkon UI and the Nest `api`: Products (list, create, edit, delete), connections and their repositories, status and sync, chat threads per Product (Ask), connect page, settings, setup, Product-scoped MCP at `/mcp/<product>`, and authentication through `AUTH_MODE` (`none`, or `apiKey` reading the same `ACCESS_FILE`).

Gaps, and what this cycle does with each (decisions below): code search page and API; knowledge base actions; plain HTTP Ask and chat history; the `ask_codebase` link to `/chat/<id>`; the eval harness, eval stack and `scripts/ops-smoke.sh`, which use `/api/mcp` and the `web` service; and other references to `packages/web` (Dockerfile build line, root `dev:web` script, `tests/originality/originality.ts` paths, a comment in `packages/contracts/src/chat.ts`, a source read in `packages/shared/src/historyTools.test.ts`, README, ADR 2.3, 4.6 and section 9 check 4, which counts six services).

### Decisions (grilled 2026-10-24 with the human unless marked default)

| # | Decision |
|---|---|
| D135 | Search: the Falkon UI gains a Product-scoped search page with the same features as web's page (query box with the full query syntax, regex and case toggles, results grouped by file with highlighted lines and the match summary); no streaming, no code-host links, no file viewer. A new Nest route serves it, scoped to the Product's repositories. Web's `/api/search` and `/api/search/stream` are removed with web. |
| D136 | Plain HTTP Ask and chat endpoints (`/api/chat/blocking`, `/api/ask`, `/api/chat`, `/api/chats`) are dropped, not ported. Ask stays reachable through the Falkon UI chat and the MCP tool `ask_codebase`. The README says so. |
| D137 | The unscoped `/api/mcp` is removed. The eval stack and `scripts/ops-smoke.sh` use `/mcp/<product>` on the `api` service, with a Product holding all 42 O3 repositories; the MCP flags (`MCP_INSTRUCTIONS`, `MCP_IMPACT_RECIPE`, `MCP_HISTORY_TOOLS`) are set on the `api` service. |
| D138 | Knowledge base: the Falkon UI settings page gains a per-repository scan, delete and re-include control, through a Product-scoped Nest route that sets `kbRequest` as web's route does; only repositories of that Product can be targeted (P12). Web's document list page is dropped (documents stay reachable through search and the read tools). |
| D139 | `ask_codebase`: chats it creates through `/mcp/<product>` are saved as that Product's threads, and its link opens `/<product>/chat/<thread>` in the Falkon UI. The base URL comes from a setting (default `http://127.0.0.1:3100`). The tool description's sentence about the link changes; that is a reviewed wording change under regression check 1, and the input schema does not change. |
| D140 | No paid eval run. Regression check 3 is shown by free checks: registration snapshots byte-identical (except the D139 sentence), the contract and golden search tests passing on the new paths, and the eval preflight passing against `/mcp/<product>` on a disposable stack. |
| D141 (default) | The engine core moves from `packages/web/src/lib` into `packages/api/src/engine/` (its only consumer once web is gone), with its tests. Its dependencies (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@modelcontextprotocol/sdk`, `dedent`) move to `packages/api/package.json` at the same versions; no new dependency, no version change. During the cycle web imports the moved code from the new place, so the build stays green until web is deleted. |
| D142 (default) | `FALKON_API_KEY` (web's single shared key) and the `falkon_key` cookie are dropped with web; `AUTH_MODE=apiKey` with `ACCESS_FILE` is the remaining key mechanism. The README's upgrade note says so. |
| D143 (default) | Gate 2 fires when S70 is kept or on any other trigger; the loop's "three slices finished" trigger is set aside for this cycle, as cycle 15 did, because S65 to S69 are each small and S70 needs all of them. |

### Slices

**S65. Move the engine core out of `packages/web`.** Tier standard. Agent claude.
- Goal: D141.
- Scope: `packages/web/src/lib/{mcp.ts,tools.ts,repos.ts,serviceError.ts,ask/}` and their tests move to `packages/api/src/engine/`; imports in `packages/api` (`main.ts`, `threads.ts`, tests, `tsconfig.json`, `build.mjs` if needed) and in `packages/web` updated; `packages/api/package.json` and `packages/web/package.json` dependency lists; `tests/originality/originality.ts` paths; the comment in `packages/contracts/src/chat.ts`; the source read in `packages/shared/src/historyTools.test.ts`. No behaviour change.
- Done: `git log --follow` shows the moves as renames; the MCP registration snapshots (flag off and on) are byte-identical; every moved test passes from its new place; the api esbuild bundle builds and starts; web still builds and its routes still work through the new imports; `pnpm originality` exits 0 where it ran before.
- Verify: `pnpm install && pnpm db:generate && pnpm typecheck && pnpm test`; `pnpm --filter @falkon/api build`; `pnpm --filter @falkon/web build`.
- Adversarial cases: a test that resolves fixtures by relative path; the lazy child-process test (`lazy.child.ts`) whose path is computed at run time; the api bundle missing a dynamic import (`uiChat`); a dependency version drifting during the move.
- Blocked by: none.

**S66. Eval harness and ops smoke on the Product path.** Tier standard. Agent claude. Needs Docker (disposable `falkon-eval*` projects only); no model spend.
- Goal: D137.
- Scope: `tests/eval/stack.ts`, `tests/eval/cli.ts`, `tests/eval/preflight.ts` if needed, their tests, `scripts/ops-smoke.sh`, the eval section of `README.md`.
- Done: `stack up` creates a Product (for example `o3`) holding all 42 repositories and prints `http://127.0.0.1:<port>/mcp/o3`; the MCP flags are set on the `api` service; `preflight` passes against it with and without `--prs on`; reporting stored runs prints the same numbers as before (nothing about scoring changes); `scripts/ops-smoke.sh` talks to the api service. The `web` service is still defined until S70, but nothing in the eval or the smoke depends on it.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- stack up` then `pnpm eval -- preflight`, then `stack down` (and `stack down --prs on` for the pull request stack); the stored cycle 15 report rescored and diffed.
- Adversarial cases: a Product created twice on a re-used stack; an API key set (`AUTH_MODE=apiKey`) and missing; the v6 reference arm, which keeps its own external URL; a stack started before the Product exists (preflight names the cause).
- Blocked by: none.

**S67. Search in the Falkon UI.** Tier standard. Agent claude.
- Goal: D135.
- Scope: `packages/contracts` (search request and response schemas), `packages/api/src/` (a Product-scoped search route on the listener the UI uses, delegating to `search` from `@falkon/shared` with the Product's repository filter), `packages/ui` (a route handler, a page under `(workspace)/[productId]/search`, a navigation entry, the mock used when `ENGINE_URL` is unset), tests.
- Done: the page runs a query and shows results grouped by file with highlighted lines, match and file counts, `+` when not exhaustive, and query-syntax errors as messages; a repository outside the Product never appears (P12, test with two Products); the golden search query set (regression check 2) returns identical results through the new route as through `@falkon/shared` directly; regex and case toggles work.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/ui build`.
- Adversarial cases: an empty query; a query naming `repo:` outside the Product; a search context (`context:`) that spans two Products; a huge result (capped like web's 500 default and 5000 maximum); a Zoekt timeout; an unknown Product slug.
- Blocked by: none.

**S68. Knowledge base actions in the Falkon UI settings.** Tier standard. Agent claude.
- Goal: D138.
- Scope: `packages/contracts`, `packages/api/src/ui.ts` (or a sibling) with a Product-scoped action route, `packages/ui` settings page and route handler, tests.
- Done: per repository of the Product, scan, delete and re-include buttons set `kbRequest` and `kbRequestedAt` exactly as web's `/api/knowledge` POST does, and the status shown afterwards reflects the pending request; a repository outside the Product is refused (P12); an unknown repository is a 404.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/ui build`.
- Adversarial cases: a repository in two Products; delete on a repository with no knowledge base; double click (idempotent); knowledge base disabled in config (controls hidden or refused with a clear message).
- Blocked by: none.

**S69. `ask_codebase` links to the Falkon UI thread.** Tier standard. Agent claude.
- Goal: D139.
- Scope: `packages/api/src/engine/` (after S65: `mcp.ts`, `ask/chat.ts`), `packages/api/src/main.ts` or `app.ts` (pass the Product slug into the MCP server), `packages/shared/src/config.ts` or env for the UI base URL, README, tests.
- Done: an `ask_codebase` call through `/mcp/<product>` saves a chat with that `productId`, which then appears in the Falkon UI's thread list for the Product, and the returned link is `<ui base>/<product>/chat/<id>`; the registration snapshot differs only in the one description sentence, which the reviewer checks by hand; the input schema is unchanged.
- Verify: `pnpm typecheck && pnpm test`.
- Adversarial cases: a public chat (`visibility: PUBLIC`) and how the UI shows it; a Product slug with characters that need encoding; the UI base URL unset (the default is used); a chat created under `AUTH_MODE=apiKey` by a key that is not the UI principal (thread list rule decided in the slice and tested).
- Blocked by: S65.

**S70. Delete `packages/web`.** Tier standard. Agent claude.
- Goal: one web surface.
- Scope: delete `packages/web`; `docker-compose.yml` (remove the `web` service; the backend and other services keep working), `docker/Dockerfile` (drop the web build), root `package.json` (`dev:web`), `pnpm-lock.yaml` (by `pnpm install`), `tests/eval/stack.ts` (drop the web service), `scripts/ops-smoke.sh` (five services; the six-service check and its memory line updated), `README.md` (ports, services table, upgrade notes for D136, D137 and D142), `docs/adr/0001-falkon-architecture.md` amended in place (2.3, 3, 4.6 "the old routes are removed", section 9 check 4's service count), `CONTEXT.md` only if a term changes. Whether the Falkon UI moves to host port 3000 is not part of this slice (the human may ask at gate 2).
- Done: `grep -rn "@falkon/web\|packages/web" --exclude-dir=node_modules --exclude-dir=.scratch .` finds nothing; `docker compose up --build` comes up cold with no `web` service; `scripts/ops-smoke.sh` passes (cold start, index, resync on push, delete a repository, memory printed for five services); the Falkon UI's chat, search, settings, status and connect pages work against the stack; `/mcp/<product>` answers the eval preflight.
- Verify: `pnpm install && pnpm typecheck && pnpm test`; `docker compose -p falkon-eval-c17 up --build -d` then `scripts/ops-smoke.sh` (disposable project; never the human's `falkon` project); the eval preflight from S66.
- Adversarial cases: a lingering import of a deleted file (caught by typecheck); the Dockerfile still copying `packages/web`; an operator's existing `config.json` or `.env` naming `FALKON_API_KEY` (documented, ignored, no crash); the old `falkon_key` cookie arriving at the UI (ignored).
- Blocked by: S65, S66, S67, S68, S69.

### Regression gate

Check 1: registration snapshots byte-identical except the one `ask_codebase` sentence of D139, reviewed by hand. Check 2: the golden search set passes through `@falkon/shared` and through the new search route. Check 3: no paid run (D140); preflight on `/mcp/<product>` and the unchanged report of stored runs stand in. Check 4: `scripts/ops-smoke.sh` on five services. `pnpm typecheck && pnpm test` pass after every slice.

### Order, limits, budget

- Wave 1: S65, S66, S67 in parallel (S66 touches only `tests/eval` and `scripts`; S67 adds new files beside S65's moves and must not edit moved files). Wave 2: S68 and S69 (S69 after S65). Wave 3: S70.
- The loop may decide alone: details inside each slice's scope, file names under `packages/api/src/engine/`, the UI layout of the new page and controls within the existing design, fix rounds, one rerun of a failed verify.
- It stops for: any new dependency or version change; any change to the MCP tool registration beyond the D139 sentence; any change to how existing datasets score; a schema change (none planned); ADR or glossary changes beyond the S70 amendment; any paid model call; any push or pull request; Docker beyond disposable `falkon-eval*` projects.
- Docker: one stack at a time, only disposable `falkon-eval*` projects; never the human's `falkon` project or the `falcon-sourcebot-*` containers.
- Budget: 1.6M subagent tokens and 360 minutes (recent cycles used 0.26M to 1.05M for three to four slices; six slices here, none hard).

### Not in this cycle

Moving the Falkon UI to host port 3000; a file viewer or code-host links in search; streaming search; a knowledge base document list; porting plain HTTP Ask.

## Cycle 17 results: `packages/web` retired (gate 2 approved 2026-10-24)

Gate 2 (human, 2026-10-24): approved and merged (`6968a37`). Decisions: upgrade Next.js now; drop the `AUTH_URL` browse links rather than point them anywhere (a feature that is not implemented and not needed now is removed, with no dead links); the Falkon UI stays on host port 3100; prune the loop skill. Follow-ups done the same day, each reviewed and merged to `main`: the Next.js bump to 16.4.3 (`d67b107`; the registry reports no advisory for it, the three advisories against 16.4.0 were a Server Actions denial of service and two critical remote code executions) and the removal of `AUTH_URL`, the `list_repos` `url` field, the legacy chat link and the Ask answer source links (`5df8e36`; portable Ask citations are now code spans naming repository, path and lines; the `list_repos` contract snapshot lost its `url` field and nothing else changed). The full suite on the merged `main` passes (typecheck, tests 0 failures, api and UI builds exit 0, no advisory message on the UI build). Still not run: the live eval preflight on the Product path (needs `EVAL_O3_DIR`), `docker compose up --build` on the real compose file, the Falkon UI pages on a live stack, the Postgres variants of the tests.

Built on the cycle branch `loop/falkon-enterprise-c17` (base `43e0609`, tip `97f38da`). Claude agents built each slice and a different Sonnet reviewer checked each; five of the six needed one fix round, and the main session fixed stale comments and ADR paths in S65 itself.

| Slice | Outcome |
|---|---|
| S65 engine core to `packages/api/src/engine/` | kept; 68 tests moved (web plus api 209 before and after); MCP registration snapshots byte-identical |
| S66 eval and ops smoke on the Product path | kept; fix round: Product creation retries 404 and 5xx on a cold start, token file forced to mode 600; **live preflight not run** (`EVAL_O3_DIR` unset) |
| S67 search in the Falkon UI | kept; fix round: golden parity test now compares the request sent, highlight ranges clamped, search contexts cached (30 s TTL, 2 s timeout) |
| S68 knowledge base actions in settings | kept; fix round: `pending` status scoped and ranked below failures, Delete needs a confirm press |
| S69 `ask_codebase` links to the Falkon UI thread | kept; fix round: the saved chat now carries evidence so the thread renders the answer; thread list narrowed; deleted chat tolerated |
| S70 delete `packages/web` | kept; fix round: golden runner requires its routes, admin token off the command line, ADR P9 row, stale comments; 41 files, 115 added, 1,260 removed |

Checks on the tip: `pnpm typecheck` exit 0; `pnpm test` exit 0 with 0 failures (contracts 23, tests/eval 114, shared 178, ui 29 and 45, backend 75 passed and 18 skipped, api 214 passed and 14 skipped; the skips are the Postgres-gated tests); api build exit 0; no reference to `@falkon/web` or `packages/web` outside `.scratch`; rescore of the stored cycle 15 runs unchanged (git arm recall 0.7446 precision 0.5631, pull request arm 0.8438 and 0.5765). `scripts/ops-smoke.sh` on a disposable `falkon-eval-smoke` project, run twice by the S70 builder (once before and once after its review fixes): every step PASS including `golden-baseline` (the capture through the api search route equals `tests/golden/expected.json`) and `golden-stability`; memory for five services 494 MB then 541 MB against the 654 MB ceiling. The Falkon UI build (`next build`) exits 1 intermittently with a Next.js 16.4.0 security-advisory message that says to retry; the retry passes (observed in every slice).

Decided without the human (beyond the spec's wording): the UI search route has no mock when `ENGINE_URL` is unset (an existing UI test requires 503); the admin port in the eval stack is the MCP port plus 100; the thread list shows chats created by the UI or anonymous callers or marked PUBLIC, while a chat from an API key stays out of the list but its link opens it (get, delete and continue are guarded by `productId` only, as before); the `ask_codebase` link base is a new optional setting `FALKON_UI_URL` (default `http://127.0.0.1:3100`); the `golden-api` smoke step was removed as redundant once search and MCP both run through the api; `FALKON_API_KEY` and the `falkon_key` cookie are gone (D142); S70 also edited `.env.example`, the architecture diagrams and the golden runner.

Not verified: the live eval preflight on `/mcp/o3` (plain and `--prs on` stacks), `docker compose up --build` on the real `docker-compose.yml`, the Falkon UI pages against a live stack, the Postgres variants of the tests. Open: `AUTH_URL` still feeds the repository browse links in `list_repos` and the source links in Ask answers, default `http://localhost:3000`, which pointed at the deleted web app; those links now open nothing. The Next.js security upgrade (16.4.0 flagged) is the human's decision.

## Cycle 18 plan: live connections, no polling (gate 1 approved 2026-10-24)

Gate 1 (human, 2026-10-24): plan approved as written.

Goal: nothing in Falkon's browser-to-server traffic polls, and a dropped connection loses nothing. A chat answer keeps generating when the browser loses its network or the stream breaks, and the page resumes it from the start of the answer instead of failing with "The answer didn't arrive" and re-running the model. The status page, the thread list and the chat page update over one server-sent event stream per Product instead of the 2-second and 30-second status poll, and a lost connection shows a "Reconnecting" notice instead of an error page. Requests the UI makes of the backend worker (sync, retry, knowledge base actions) start at once instead of waiting for the worker's 30-second tick. It is not a history-phase cycle; it was taken up at the human's request ("a proper watchdog", then "no polling, only SSE, throughout Falkon").

Base `main` at `5a4c2d9`. Cycle branch `loop/falkon-enterprise-c18` in `.loop/worktrees/resume`; the first commit holds this plan, and the uncommitted start of S71 (built before the loop began: `packages/api/src/liveAnswers.ts`, the resume and stop routes in `threads.ts`, the `hang`-with-`rest` turn in `fakeOpenAi.ts`, three api tests, one failing) is S71's starting point. Roles: Opus planned; Sonnet decides and commits after gate 1; Claude implements; a different Sonnet reviewer checks each slice; Codex is not used (D149). The UI redesign on `ui/premium-shadcn` rewrites `chat-view.tsx` and `workspace-shell.tsx` and is not committed; this cycle keeps its edits to those two files to a few lines each and puts new logic in new files (D150).

### Inventory (2026-10-24, read from the tree)

- Browser polling: one, the status `useSWR` in `packages/ui/src/components/layout/workspace-shell.tsx` (`refreshInterval` 2 s while building, else 30 s). A failed poll sets `statusError`, and both `status-view.tsx` and `chat-view.tsx` then replace the whole page with `ErrorState`, which also unmounts a chat mid-answer.
- Chat: `ThreadService.message` passes the HTTP request's abort signal to the agent, so a dropped connection aborts the turn and only the question is stored; the UI uses `useChat` with `DefaultChatTransport`, no resume.
- Requests polled by the worker: `Connection.syncRequestedAt` and `Repo.indexRequestedAt` (claimed in `scheduleTick`), `Repo.kbRequest` (claimed in `kbTick`), each on a 30-second `setInterval` in `packages/backend/src/index.ts`.
- Schedules on the same timers (kept, D157): reindex after `reindexIntervalMs`, config connection resync, pull request sync, knowledge base refresh.
- Dead settings: `resyncConnectionPollingIntervalMs` and `reindexRepoPollingIntervalMs` in `packages/shared/src/config.ts`, read nowhere.
- The status text embeds the generation age (`generationAge`, and the `current` sentence "published 5 minutes ago"), which only stays true because the poll refreshes it.
- Redis runs in compose and the backend uses `ioredis` 5; the `api` service has no `REDIS_URL` and no Redis client.
- AI SDK 6.0.167 (read from `node_modules/ai/dist/index.mjs`): `resumeStream()` with a 204 returns without calling `onFinish` and leaves the status unchanged; a reconnect fetch error sets status `error` without `onFinish`; a resumed stream replays from its first chunk, so a partial assistant message must be dropped before resuming or its parts are duplicated.

### Decisions (grilled 2026-10-24 with the human)

| # | Decision |
|---|---|
| D144 | A running answer is kept in memory in the `api` process (`LiveAnswers`), not in Redis: the turn runs in that single process, so the buffer lives exactly as long as the turn can. Revisit only if Falkon runs more than one `api` instance. No `Chat` column. |
| D145 | A new question on a thread whose answer is still running is refused: 409 `ANSWER_RUNNING`, "An answer is still being written in this thread." |
| D146 | Leaving the page or losing the connection no longer stops an answer; it runs to its end and is stored. Only an explicit Stop (`POST /ui/products/:slug/threads/:id/stop`) ends it early, keeping the question only, as today. |
| D147 | Opening or reloading a thread whose answer is running resumes it (`useChat` `resume`). The question appears with the answer when it finishes and the thread is reloaded from the server; showing the pending question earlier would need a contract change and is left out. |
| D148 | Chat watchdog: after a stream error that is not a refusal from the server (`ApiError`), the answer shows as still working, not as an error, and the page resumes it: at once on the browser's `online` event, else after 1, 2, 4, 8, 15 and then every 30 seconds, with no retry limit. A 204 (nothing running) reloads the thread: a stored answer is shown; otherwise today's "The answer didn't arrive" error shows and an empty first thread is discarded as today. Stop also calls the server's stop route. |
| D149 | Claude builds, a different Sonnet reviewer checks, Codex is not used (as in recent cycles). |
| D150 | Built from `main`; `chat-view.tsx` and `workspace-shell.tsx` get only a few lines each, the new logic lives in new files, so the redesign merge has small conflicts; whichever lands second resolves them. |
| D151 | Once a status has loaded, a lost status connection never replaces a page: the status page keeps the last status, and the chat page never turns into an error page over status. The full-page error stays only for a page that never loaded a status. |
| D152 | One shared "Reconnecting" notice in the workspace shell, shown while the Product event stream is disconnected, gone on reconnect. |
| D153 | The status poll is replaced by one server-sent event stream per Product, `GET /ui/products/:slug/events`: the full current status on connect, then a new status on every change. The browser's `EventSource` reconnects by itself, and every connection starts with the full state, so nothing is missed. |
| D154 | The same stream carries the thread list (on connect and on change), so a thread made through `ask_codebase` or another tab appears without a reload. The product list and Product settings stay fetch-on-load (they change only by the user's own actions). |
| D155 | The `api` learns of changes by Redis publish and subscribe. The `api` gains `ioredis` at the backend's version (`^5.4.0`; the one new dependency this cycle); the compose `api` service gains `REDIS_URL` and a dependency on the healthy `redis` service. |
| D156 | UI requests to the worker (sync, retry, knowledge base scan, delete, include) still write their request row, which stays the durable record, then the `api` announces it on Redis and the worker claims it at once. The worker's existing claims at start and on its tick stay, so a request made while the worker was down is still taken. |
| D157 | Time schedules (reindex, config resync, pull request sync, knowledge base refresh) stay on the worker's 30-second timer this cycle: they are schedules, not waits for a change. Moving them to queue-delayed jobs is a possible later cycle. |
| D158 | `resyncConnectionPollingIntervalMs` and `reindexRepoPollingIntervalMs` and their defaults are deleted. |
| D159 | The status carries the generation's publish time as `generationAt` (epoch milliseconds, nullable); `generationAge` is removed and the sentences drop the age phrase. The page renders the age and refreshes it every minute with a local timer that makes no request. A contract change, approved here. |
| D160 | The change signal is bare (no payload) on one Redis channel. The worker publishes it when an index, connection sync, knowledge base or pull request job starts, finishes or fails, and after it claims a request; the `api` publishes it after its own writes (Product create, edit and delete, sync and knowledge requests, a thread turn stored or a thread deleted). On a signal the `api` recomputes the status and thread list of each Product that has at least one open stream, at most twice a second however many signals arrive, and sends an event only to streams whose data changed. Products nobody watches cost nothing. |
| D161 | Each open stream sends an SSE comment line every 25 seconds so proxies and browsers keep an idle connection open; it reads nothing. |

### Slices

**S71. Resumable chat answers.** Tier standard. Agent claude.
- Goal: D144 to D148.
- Scope: `packages/api/src/{liveAnswers.ts,threads.ts,threads.test.ts,admin.ts}` (the route list), `packages/api/src/engine/ask/{agent.ts,fakeOpenAi.ts}`, the admin route-enumeration test; `packages/ui/src/app/api/products/[productId]/threads/[threadId]/{stream,stop}/route.ts`, `packages/ui/src/lib/api/{chat-transport.ts,client.ts}`, one new hook file under `packages/ui/src/features/chat/` for the watchdog, a few lines in `chat-view.tsx`, `packages/ui/tests/`; ADR 4.5 "Chat transport (S21)" and the admin route list amended in place.
- Done: an api test drops the client mid-answer, resumes through `GET .../stream`, and gets the whole answer from its first chunk, with the model run once and the answer stored once; Stop through the new route leaves only the question stored and the next turn works; resume and stop with nothing running are 204 and store nothing; another Product's thread is 404 on both; a second message while one runs is 409. UI tests: a stream error mid-answer keeps the working state, a resume after the `online` event finishes the answer, a 204 resume reloads the thread and shows the stored answer, a 204 with nothing stored shows the existing error and discards an empty first thread, Stop calls the stop route, and a page opened on a thread resumes.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/api build`; `pnpm --filter @falkon/ui build`.
- Adversarial cases: the stream drops before the first chunk (question stored or not); the drop happens while the network is still down (the resume fetch fails and backoff continues); the answer finishes while the page is offline (204 then the stored answer); two tabs resuming the same answer; Stop pressed while reconnecting; the thread deleted while an answer runs; a model error mid-answer (no endless retry: the error chunk ends the turn, resume is 204, the error shows); the in-memory buffer is dropped once the turn ends.
- Blocked by: none.

**S72. Change signal and instant worker requests.** Tier standard. Agent claude.
- Goal: D155, D156, D158, and the publishing half of D160.
- Scope: one small module for the signal (publish and subscribe over `ioredis`, injectable so tests need no Redis) in `packages/shared/src/`; `packages/backend/src/index.ts` (publish on job start, finish and failure and after claims; subscribe and claim at once on a request signal); the `api` writers in `packages/api/src/{ui.ts,knowledge.ts,threads.ts}` publish after their writes; `packages/api/package.json` and `pnpm-lock.yaml` (`ioredis`); `docker-compose.yml` (`api` gets `REDIS_URL` and `depends_on` redis); `tests/eval/stack.ts` if its stack defines the `api` service environment; `packages/shared/src/config.ts` (delete the two settings); tests; ADR 4.5 "UI Products and status (S20b)" and the scheduling text amended in place; `README.md` if it lists settings.
- Done: a test shows a sync request from the `api` is claimed by the worker without waiting for a tick (worker logic tested with the injected signal); a request written while no subscriber runs is still claimed by the tick; each worker job start, finish and failure publishes the signal; the two dead settings are gone and nothing references them; the `api` starts and serves when Redis is down (the signal is best effort; requests are still claimed by the tick and the stream from S74 still answers on connect).
- Verify: `pnpm install && pnpm typecheck && pnpm test`; `pnpm --filter @falkon/api build`.
- Adversarial cases: Redis down at `api` start and back later (reconnects without a restart); a burst of signals (no storm of claims: a claim already running is not started twice); a request claimed by the tick and the signal at once (claimed exactly once, as the existing `updateMany` claim guarantees); an operator `config.json` still naming a deleted setting (ignored, no crash).
- Blocked by: none.

**S73. Generation time in the page.** Tier standard. Agent claude.
- Goal: D159.
- Scope: `packages/contracts/src/index.ts` (`statusSchema`), `packages/api/src/uiProduct.ts` and its tests, the UI mock and the pages that show the age (`status-view.tsx`, `settings-view.tsx`, `chat-view.tsx` status line if it shows age), one small shared age formatter in `packages/ui/src/lib/`, `packages/ui/tests/`.
- Done: the status carries `generationAt` and no `generationAge`; no status sentence names an age; the status page shows the age computed from `generationAt` and it advances a minute later with no request (fake timers); contract tests updated.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/ui build`.
- Adversarial cases: no generation yet (`generationAt` null); a generation from the future (clock skew: shown as "just now"); a page left open across midnight and for days.
- Blocked by: none.

**S74. Product event stream replaces the status poll.** Tier standard. Agent claude.
- Goal: D151 to D154, the consuming half of D160, D161.
- Scope: `packages/api/src/` (a Product events service and route `GET /ui/products/:slug/events`, the admin route list and its enumeration test), `packages/contracts` (the event schema: `status` and `threads` events), `packages/ui/src/app/api/products/[productId]/events/route.ts` (streamed through the same-origin proxy like chat), a new hook under `packages/ui/src/` that owns the `EventSource`, a few lines in `workspace-shell.tsx` (status and threads from the hook, no `refreshInterval`, the Reconnecting notice), `status-view.tsx` and `chat-view.tsx` (no page-replacing error once a status has loaded), `packages/ui/tests/`; ADR 4.5 amended in place (status served as a stream; route list).
- Done: an api test opens the stream and gets the status and thread list first, then a new status within a second of a published signal after a repository's status changes, and nothing when the signal changes nothing; two streams on one Product cause one recompute per coalescing window; a Product nobody watches is never recomputed; another Product's events never arrive; an unknown Product is 404; the keep-alive comment arrives every 25 seconds (fake timers). UI tests: no `refreshInterval` or timer-driven fetch remains in `packages/ui/src` (a test greps for it), the shell shows the Reconnecting notice when the stream errors and hides it on the next event, the status page keeps the last status through a disconnect, a chat mid-answer stays mounted through a status disconnect, and a new thread pushed on the stream appears in the list.
- Verify: `pnpm typecheck && pnpm test`; `pnpm --filter @falkon/api build`; `pnpm --filter @falkon/ui build`.
- Adversarial cases: the browser opens many tabs on one Product (one recompute per window); a stream left open for hours (no growing memory per stream; a closed stream is removed from the watcher set); a Product deleted while watched (the stream ends); Redis down (the stream still sends the state on connect, and the notice is not shown because the stream itself is fine); the UI proxy must not apply its 15-second timeout to this stream; per-request work is bounded as `AGENTS.md` requires (the recompute reads the latest row per key, as `status` already does).
- Blocked by: S71 (both edit `chat-view.tsx`), S72, S73.

### Regression gate

Check 1: the MCP registration snapshots are unchanged (no tool changes). Check 2: the golden search set is unchanged. Check 3: no paid run; nothing that scores changes. Check 4: `scripts/ops-smoke.sh` is not changed; the compose change adds only `REDIS_URL` and a `depends_on` to `api`. `pnpm typecheck && pnpm test` pass after every slice.

### Order, limits, budget

- Wave 1: S71, S72 and S73 in parallel (S71 touches chat files and `threads.ts`; S72 touches `threads.ts` only to add one publish line after the turn is stored, so S72 builds on the cycle branch after S71 is kept if both are ready together; S73 touches the status contract and pages). Wave 2: S74.
- The gate-2 trigger "three slices finished" is set aside for this cycle, as cycles 15 and 17 did, because S74 needs S72 and S73 and the cycle's goal is incomplete without it.
- The loop may decide alone: details inside each slice's scope, file and hook names, the exact notice wording within the existing design, fix rounds, one rerun of a failed verify.
- It stops for: any dependency beyond `ioredis` in `api`; any contract change beyond D159 and the S74 event schema; any MCP tool change; changes to how the time schedules work (D157); ADR or glossary changes beyond the amendments named in the slices; any paid model call; any push or pull request; Docker beyond disposable `falkon-eval*` projects.
- Not verified by the loop, for the human at gate 2: the manual check of starting an answer, turning the network off and on, and seeing it continue, on the real stack.
- Budget: 1.4M subagent tokens and 300 minutes (recent cycles used 1.05M to 1.3M tokens for four to six slices; four slices here, none hard).

### Not in this cycle

Moving the worker's time schedules to queue-delayed jobs (D157); a pending question shown during a resumed answer (D147); running more than one `api` instance; live updates for the product list and Product settings (D154).

## Cycle 18 results: live connections, no polling (merged to `main` at `2d11740`; recorded as gate 2 approved on 2026-10-29)

Built on `loop/falkon-enterprise-c18` (base `5a4c2d9`). Claude agents built each slice and a different Sonnet reviewer checked each; every slice needed one fix round. Checks on the tip: `pnpm typecheck` exit 0; `pnpm test` exit 0 with 0 failures (contracts 24, tests/eval 114, shared 183, ui 34 and 62, backend 79 passed and 18 skipped, api 236 passed and 14 skipped; skips are the Postgres-gated tests); api and UI builds exit 0; no `refreshInterval` in the UI and `setInterval` only in the local age timer.

| Slice | Outcome |
|---|---|
| S71 resumable chat answers | kept; fix round: the reviewer's blocking gap was untested adversarial cases (failed start, mid-answer error, reader cancel, thread deleted mid-answer), now covered; a resume sent while the turn is starting now waits instead of getting 204; a failed Stop no longer claims the answer stopped |
| S72 change signal and instant worker requests | kept; fix round: a subscription made while Redis is down is now sent when Redis returns (it was lost after 20 retries); `ioredis` lives in `shared` only |
| S73 generation time in the page | kept; fix round: mock sentences left ungrammatical, age now computed from the real clock |
| S74 Product event stream | kept; fix round: a refused first connect is now retried with backoff, throwing and stalled writes drop the stream, chat-only header no longer on the events stream |

Decided without the human: the in-memory buffer instead of Redis for running answers (D144, per the plan); the model failure mid-answer is stored as the existing fixed abstention answer and shown after a resume (the slice text said nothing stored; this matches how a model that stops without an answer already behaved); SWR stays the page's store and the event stream writes into its cache, with the first load still one fetch; with `ENGINE_URL` unset the events route answers a silent open stream so mock mode neither errors nor retries; a request signal also runs one claim pass at worker start; the registry (operator Product create, update, delete) also publishes a change.

Not verified: the manual check (start an answer, turn the network off and on, see it continue) and the status page on the live compose stack; Redis down then back with a real Redis (tested only with a fake server and a dead port); the Postgres variants of the tests; `docker compose up --build` with the new `REDIS_URL` on the api service.

## Cycle 19 plan: Phase 1 vanilla git history, and the roadmap that follows (planned 2026-10-29 with the human; reviewed by an Opus agent the same day; the loop's grill and gate 1 still to run)

Inputs: [`falkon-candidates-from-sourcegraph.md`](falkon-candidates-from-sourcegraph.md) (candidates C1 to C20 and the tool parity map; "C" numbers below refer to it), [`sourcegraph-8.1.1335-study.md`](sourcegraph-8.1.1335-study.md), and ADR-0001 4.2 (the two-tier amendment of 2026-10-29). The planning session checked, against the code, the statements the candidates file marked unchecked, and an Opus agent reviewed this plan and found two blocking errors (the tag fact and the budget), now corrected below.

### Decisions (human, 2026-10-29)

| # | Decision |
|---|---|
| D162 | The two tiers of MCP tools (the human's "T1"). Falkon offers **vanilla tools**, which need no server model, stay the default and stay model-free permanently, and **agent tools**, which run a server model so Falkon can act agentically. D3 (the MVP rule that serving needs no model) and ADR 4.2 are amended accordingly (ADR 4.2, merged at `8fab114`). D84 (whether a model may embed queries on the serving path) is not changed: it concerns embeddings only and stays open until Phase 4. |
| D163 | One endpoint and a flag (the human's "T2"). Both tiers are served on `/mcp/<product>`, switched by the operator config key `agentTools.enabled`, default `false`, with a per-Product override `agentTools: false`. The tier is on only when the flag is on and a model is usable: an entry in the `models` list of the Falkon config, or the `LLM_*` environment fallback that Ask already uses (`configuredLanguageModels`); ADR 4.2 is amended now to say so. Caps, tunable in config: per call 200,000 tokens and 120 seconds; per Product 2,000,000 tokens a day. Every agent call is metered and shown on the Product status. |
| D164 | The first agent tool and the bar (the human's "T3"). The first agent tool is `find_code`, a code-finding sub-agent that returns checked repository, path, line range and index revision items. The bar: the two tiers together reach parity with or exceed Sourcegraph's tool list and today's Falkon, and each agent tool passes D8 (a new capability must beat the engine without it on its own question set) at equal total cost, meaning server model tokens plus the client's tokens priced from one price table. Stated honestly: the roadmap reaches tool-list parity except precise definitions and references (Phase 5), the feature-location and architecture answer recipes and Deep Search's conversation features (not planned); answer quality can only be measured against today's Falkon, because Sourcegraph cannot be run here. |
| D165 | `ask_codebase` moves to the agent tier (the human's "T4"). `ask_codebase` and `list_language_models` leave the vanilla list in one deliberate change of the tool contract (regression gate check 1), made in the tier foundation cycle. The MCP prompt also named `ask_codebase` and the model-free `research_codebase` tool stay vanilla; the later `research` agent tool is a different, model-backed tool and its description says so. After the move, the vanilla list with the agent tier off is held fixed. |
| D166 | Order (human, after the review). Cycle 19: Phase 1 vanilla git history. Cycle 20: the agent tier foundation, tested with the existing fake model only (the flag, the move of `ask_codebase`, caps and metering, the checked-evidence result shape, the `finder` role, prompt caching). Cycle 21: vanilla search parity (keyword search, search time bound, search at an unindexed revision, a BM25 trial). Cycle 22: `find_code` and its paid run. Cycle 23: the aggregation sandbox. Cycle 24: Ask loop robustness. Cycle 25: `research`. Cycle 26: `explain_change` and `impact`. Each cycle has its own gate 1 and the order can change there. |
| D167 | The cycle 19 tools register behind a new flag `MCP_GIT_TOOLS=on`, not `MCP_HISTORY_TOOLS`, so the measurement shows git history alone. They register in their own list after the pull request tools, so the snapshot with only the pull request flag on stays byte-identical. Snapshots are recorded for: both flags off (unchanged), git flag only, both on. |
| D168 | Keyword search for loose questions (C1) is a new tool, `search_keywords`, with repositories, revisions and a continuation cursor as parameters; `grep` is not changed. |
| D169 | The aggregation sandbox (C10) **is built** (human, over the planner's recommendation to park it), as its own cycle, because the human's bar is tool-list parity and the evaluator is Sourcegraph's tool for counting and listing questions. It is a vanilla tool: the client writes the script, no server model runs. It stays off by default until a security review of the interpreter, its child process, its limits (time, searches per script, result size) and its Product scoping has passed. Open for that cycle's gate 1: which interpreter (Sourcegraph uses Lua; a new interpreter dependency was a stop condition in earlier cycles, and Node's `vm` is not a security boundary). Recorded in ADR 4.2 as decided, not built. |
| D170 | The sync path may be opened (human). Cycle 19 adds only what the tag tools need (slice S77); the rest of the read-only fetch hardening (C6: protocol version 2, no `FETCH_HEAD` write, LFS smudge skipped, log redaction) is a later small standalone slice with no change to clone or shard layout. |
| D171 | `research` (C17) comes after vanilla parity, Ask loop robustness (C3) and caps with metering. |
| D172 | The pull request tools leave their flag only after the cycle 19 paid run; both flags are decided together on that evidence. |
| D173 | Prompt caching for Ask and the agent loops (new candidate C21) is built in the tier foundation cycle. No cache option is set anywhere in `packages/api` or `packages/shared` (the knowledge base only reads cached-token counts from replies), and an agent loop resends its whole history each step, so without it the equal-total-cost comparison in D164 is biased against the agent tier. Which provider caches how (explicit markers on Anthropic models, automatic on OpenAI-compatible endpoints) is checked in that cycle, not assumed; the claim that Sourcegraph marks the last message for caching comes from study Pass 8. |
| D174 | Search at a revision the index does not hold (C9) is built in the vanilla search parity cycle. |
| D175 | The symbol tools (`find_symbol_definitions`, `find_symbol_references`) stay as they are until Phase 5 (SCIP); release notes say that precise navigation is Phase 5. Not planned: forks, sharing and quotas of Deep Search (C13), a chart tool. |
| D176 | Unbounded reads on the request path are fixed inside the planned cycles. `get_diff` returns the whole diff with no cap: slice S76 caps it by stopping the git process once the byte limit is read (not by cutting a string after it was fully buffered), the limit is chosen at gate 1, and diffs below it are unchanged; diffs above it change for the baseline arms and for Ask too, which the human accepts at gate 1 (the cycle 15 run already showed a large diff spilling to a file). `grep` sets no Zoekt wall-time bound (`max_wall_time` is 0): the search parity cycle adds the bound and a timeout hint (C5) and reviews it against the golden set. Also listed so they are decided, not forgotten: `read_file` loads the whole blob before capping; `list_commits` and `get_diff` run git with no timeout, so the 30-second message in `list_commits` can never fire; `list_commits` counts the whole history on every call. S76 fixes the git timeout for the tools it touches; the rest are left unless gate 1 adds them. |
| D177 | Housekeeping in this planning edit: cycle 18 is recorded as merged; ADR regression check 1 reads "the vanilla tool list with the agent tier and every opt-in tool flag off" instead of "the 11 MCP tools" (13 are registered today and the move changes the list again), with the note in ADR 9 that it departs from the MVP spec's wording; the glossary's "Vanilla tool" and the opening sentence of `CONTEXT.md` no longer say vanilla tools are always available or that the serving path never needs a model. |
| D178 | Paid-run budget (human): $5 in total for every paid model call in the whole roadmap, not per cycle. It buys about one paired pass. Therefore, paid runs measure **the new arm only** and compare it with the stored results of the old arm from cycle 15 (same Haiku model, same corpus), which departs from the rule of rerunning both arms on the same day (human accepts). The loop makes no paid call without an explicit go-ahead at a gate; every paid run states its estimated cost first, runs a small pilot before the full pass, and stops at its cap. Before any paid run the per-run cost reservation of the runner (now $1 per run in flight) is lowered so it does not stall under a small cap. Which provider bills which run is named at the gate: the eval client is the Claude command-line tool (billed by Anthropic), the server model of an agent tool is billed by the configured provider (DeepInfra for the human); if the client moves to a DeepInfra model the harness needs new work and the stored baselines no longer apply. Expected cost: about $0.04 per question per arm, so cycle 19's 40 questions cost about $1.6 to $1.8; cycle 21 and later paid runs will not fit in the remainder without more credit or a smaller question set (hidden split only), decided at those gates. Tests use the existing fake model (`fakeOpenAi.ts`), never a paid one. Question sets that an agent must author for later cycles (the counting set, the long-thread set) are counted against the budget unless the human authors them. |

**Open conflict, raised to the human, not resolved (2026-10-29).** `design-review.md` section 4 "Dropped" lists "a server-side orchestrator", and its table gives "a model on the serving path, against D3" as the reason. ADR 4.2 (D162) removes that reason, so the remaining question is narrower: whether agent tools are bounded sub-agent tools or a pipeline (query decomposition, intent router) that replaces the tool surface. The human said they will think more on it. Nothing in cycle 19 depends on it; the tier foundation cycle's gate 1 must resolve it first, for example by stating that agent tools are bounded sub-agent tools and not such a pipeline, and annotating the design review line.

### Code facts that shaped the plan (checked 2026-10-29, corrected after the review)

- Tags: the incremental fetch is `fetch --prune <url> +refs/heads/*:refs/heads/*` (`packages/backend/src/git.ts`). Git follows tags automatically when a fetch stores into local refs, so new tags on branch commits do arrive (the reviewer tested this). The real gaps are tags on commits no branch reaches, tags deleted on the host (never removed locally), and tags moved on the host (never updated). Adding a full tag fetch with prune would also delete local tags the host deleted, and where a repository's `tags` setting asks for tag indexing, tag changes change the indexed revisions.
- `get_diff` has no cap and no paging. `grep` has no wall-time bound and no timeout hint. `read_file` caps at 500 lines and 5,120 bytes and keeps the head with an offset to continue.
- `list_commits` already has `query`, `since`, `until`, `author`, `ref`, `path` and paging, but takes exactly one repository. Ticket keys are found by `ticketKeys()` in `packages/shared/src/provenance.ts`, but only for the operator's configured projects, and `DISCUSSION_TICKET_KEYS` is read only by the backend. Pull request numbers from commit subjects (`(#N)` and `Merge pull request #N from`) are written inline in the backend's `commitLinks` (`packages/backend/src/discussions.ts`), which the api cannot import.
- Zoekt is called with default scoring (no BM25 option) and an unlimited wall time. Symbol results from Zoekt carry no end line.
- The eval client is the Claude command-line tool on Haiku or Sonnet (`tests/eval/harness.ts`).

### Slices (cycle 19; refined by the loop's grill, approved at gate 1 on 2026-10-29)

All tools are model-free, additive, read only the local bare clones (never the code host), respect the Product's effective repository set, and register only when `MCP_GIT_TOOLS=on`. Every tool is bounded: a git time limit per repository, a total deadline, a concurrency cap, a byte cap, a result cap and a cap on repositories scanned, each stated in the output with a coverage gap when reached. Search terms are passed to git in attached form (for example `-G<term>`) so a leading dash cannot be read as an option, and ref globs are validated separately from plain refs.

**Shared design (set at the grill, so the slices do not each invent it).**
- The seven new tools are `search_commits`, `search_diffs`, `compare_revisions`, `list_refs`, `check_ancestry`, `get_range_history`, `list_contributors`. They live in one new file `packages/shared/src/gitTools.ts` with its own registry (`gitToolDefinitions`, `gitToolNames`, the same shape as `historyTools.ts`), wording in a new `packages/shared/src/gitToolText.json` written originally (D9), and are registered in `packages/api/src/engine/mcp.ts` right after the pull request block.
- S75 builds, once, the bounded git runner every later tool uses: it starts `git` with `spawn`, never through `simpleGit`, kills the child when a byte limit or a time limit is reached, and returns what it read with a flag saying which limit fired. It also holds the repository fan-out helper (concurrency 4, per-repository limit 15 seconds, total deadline 40 seconds, at most 50 repositories scanned) and the answer cap (about 24 KB of JSON, as `historyTools.ts`). Constants named in one place.
- Free-text terms (authors, message terms, content terms, file names) are matched as literal strings: `--fixed-strings` and `-i` for author and message, and for content terms one `-G` pattern built from the escaped terms joined by `|` (git honours only one `-G`, and an unescaped term would hand the caller a regular-expression engine on the server).
- Shared files are owned by the chain S75, S76, S78, S79, S80, which therefore runs in that order: `gitTools.ts`, `gitToolText.json`, the registration block in `mcp.ts`, `tests/contract/registration-git.json` and `registration-git-history.json`. S77 and S81 touch none of them.
- Tests use real temporary git repositories built in the test (no network), the fake `ToolDeps` pattern of `historyTools.test.ts`, and the `snapshot()` helper of `tests/contract/snapshot.ts`.
- Common verify: `pnpm typecheck && pnpm test`; for api work also `pnpm --filter @falkon/api build`.

**S75. `search_commits` and the bounded runner.** Tier standard. Agent codex. Blocked by: none.
- Goal: the commit search tool of the plan (several repositories; revisions including ref globs; authors up to 5, OR; message terms OR; content terms in changed lines which need a date window, a files filter or a repository filter; files OR; `after` and `before` through the existing date helpers; count default 50, at most 100). Each commit lists ticket keys and pull request numbers read from its message, marked read from the message and unverified. First move the two pull request number patterns (`(#N)` at the end of a subject; `Merge pull request #N from`) out of `packages/backend/src/discussions.ts` into `packages/shared/src/provenance.ts` and have the backend import them (no behaviour change), and make the operator's ticket keys reach the api: a `ticketKeys` field on `ToolDeps` filled from `DISCUSSION_TICKET_KEYS` in `packages/api/src/engine/tools.ts`, and that variable passed to the `api` service in `docker-compose.yml`. Register the flag and the two new contract snapshots (git flag only; both flags on).
- Scope: `packages/shared/src/gitTools.ts`, `gitToolText.json`, `provenance.ts` (+ its test), `index.ts` (export), `packages/backend/src/discussions.ts` (import only), `packages/api/src/engine/tools.ts`, `packages/api/src/engine/mcp.ts`, `packages/api/src/engine/ask/mcp.git.test.ts` (new, like `mcp.history.test.ts`), `tests/contract/registration-git*.json`, `docker-compose.yml` (the api environment line only).
- Done: with `MCP_GIT_TOOLS` unset and with only `MCP_HISTORY_TOOLS=on`, the existing registration snapshots pass unchanged (byte-identical); with the git flag on, `search_commits` is listed after the pull request tools and the new snapshots match; a test builds a temporary repository with known commits and gets exactly the expected hashes for each filter alone and for combinations; ticket keys and pull request numbers appear on the right commits and the discussion import still passes its tests with the moved patterns.
- Verify: common verify; `pnpm --filter @falkon/backend test`.
- Adversarial cases (reviewer-checked): an author, term, file or ref that starts with `-` or equals `--output=/tmp/x` or `--upload-pack=…` (no option is read, and nothing is written); a ref glob that is `--all`, contains `..`, or is empty (refused with a reason); content terms with no date window, files or repository filter (refused with the reason, git not run); a regular-expression term such as `.*` or `(` matches literally; a repository the Product's scope excludes behaves exactly like a missing one; one repository that times out gives a coverage gap and the others still answer; more than 50 repositories gives a gap that names how many were skipped; count 0, 101, negative; `after` later than `before`; unparseable dates; the same commit reachable from two refs appears once; an author with non-UTF-8 bytes; a 1 MB commit message is cut per commit and says so; lower-case ticket keys; an empty result says which filters were applied; the answer never exceeds the byte cap.

**S76. `search_diffs`, `compare_revisions` and the bounded diff.** Tier standard. Agent codex. Blocked by: S75.
- Goal: diff search for a pattern in added lines, removed lines or both, with dates, files and authors; compare two revisions with paged file diffs (default 50, at most 100 files); a shared helper that, when a byte limit is hit, keeps the first 75% and the last 25% with a marker stating how much was removed (C4); and the `get_diff` byte cap and git timeout of D176, using the S75 runner (git is killed once the limit is read; the diff is not buffered whole and cut afterwards). The cap is `GET_DIFF_MAX_BYTES` = 30,000 bytes (set at gate 1).
- Scope: `packages/shared/src/gitTools.ts` and text json, `packages/shared/src/tools.ts` (`getDiff` only), `packages/shared/src/tools.test.ts` or the existing get_diff test file, `packages/api/src/engine/mcp.ts` (nothing new unless the registry needs it), snapshots for the git flag, `packages/api/src/engine/ask/` (a test that Ask sees the marker).
- Done: a diff below the cap is byte-identical to today's `get_diff` output (a test compares both on a small fixture); a diff above it comes back at most cap-plus-marker long, with the first 75% and last 25% and a marker with the removed byte count; a test with a very large generated diff shows the git child was killed (the runner reports `limit: "bytes"`) and memory stayed bounded; `get_diff` with the git timeout turned very low reports a timeout, not a hang; the registration snapshot with the git flag now lists three tools.
- Verify: common verify.
- Adversarial cases: a diff of exactly the cap and of one byte more; a binary-file diff; a rename-only diff; a diff whose single line is larger than the cap; the marker must not split a multi-byte character or leave a half line without saying so; compare of a revision to itself (empty, says so); compare of an unknown revision, of `-x`, and of a revision in another repository; page beyond the last page; 101 files requested; a pattern that matches only in context lines (not counted as added or removed); both-direction search reports which side matched.

**S77. Tag gaps in the clones.** Tier standard. Agent claude (the operations smoke needs Docker, which the Codex sandbox cannot reach). Blocked by: none. Runs beside S75.
- Goal: tags that no branch reaches, tags deleted on the host and tags moved on the host become correct in the clones: add `+refs/tags/*:refs/tags/*` to the incremental fetch with pruning limited to the two namespaces (heads and tags), and the same on the first clone (`clone --bare` already copies tags, so the first clone changes nothing; the test says so). Clone and shard layout format unchanged; existing clones need only the next fetch.
- Scope: `packages/backend/src/git.ts` (`cloneOrFetch`), `packages/backend/src/sync.test.ts` and `syncSmoke.test.ts` additions, `docs/adr/0001-falkon-architecture.md` only where it names the fetch refspec (amend in place), `scripts/ops-smoke.sh` is not edited.
- Done: tests build a "host" repository and a clone, then fail first and pass after the change for exactly three cases: a tag on a commit no branch reaches arrives; a tag deleted on the host disappears from the clone; a tag moved on the host moves in the clone. The case "new tag on a branch commit" passes before and after. Where a repository's `tags` setting selects tags for indexing, a test shows the revisions chosen by `sortedRefs` follow the clone after a deletion and a move. `scripts/ops-smoke.sh` passes (run by the main session on the disposable `falkon-eval*` project, since it needs Docker).
- Verify: `pnpm --filter @falkon/backend test`; common verify; the operations smoke script.
- Adversarial cases: a host with no tags (the prune must not delete anything it should keep); a tag and a branch with the same name; an annotated tag moved to another commit; a fetch that fails midway leaves the old tags in place; a force-pushed branch plus a deleted tag in one fetch; a repository whose host refuses tag listing (the heads fetch must not be lost); a very large number of tags (the fetch time does not change the per-request path, it is on the worker).
- Stop for the human if the change needs a new index or a layout change (it must not).

**S78. `list_refs` and `check_ancestry`.** Tier standard. Agent codex. Blocked by: S76 (shared files), S77 (tags).
- Goal: heads only, tags only, and "which refs contain this commit" (`git tag --contains`, `git branch --contains`, both bounded and with the runner's limits); ancestry with `git merge-base --is-ancestor`, answering yes, no, or "a revision could not be resolved" as three distinct results.
- Scope: `gitTools.ts`, its text json, snapshots, tests as in the shared design.
- Done: tests on a temporary repository with branches and tags give the expected ref lists for a commit in one branch, in several, and in none; ancestry answers match `git` for linear, merged and unrelated histories; the snapshots list the two new tools after the earlier ones.
- Verify: common verify.
- Adversarial cases: a commit prefix that is ambiguous or too short; a revision starting with `-`; a repository with thousands of tags (capped, gap says how many); a tag that points at a tag; a commit not in this repository; ancestry of a commit with itself (yes); two unrelated roots (no); a detached or empty repository (no refs, says so).

**S79. `get_range_history`.** Tier standard. Agent codex. Blocked by: S78.
- Goal: history of a line range or of a function in a file (`git log -L <start>,<end>:<path>` or `-L :<function>:<path>`; Zoekt supplies no end line), and for a commit the declarations its hunks touched (hunk headers of the diff). No Sourcegraph equivalent. Question kind: "what changed and when".
- Scope: `gitTools.ts`, text json, snapshots, tests.
- Done: tests with a temporary repository whose function moves and changes give the commits that git itself reports for that range; a commit's touched declarations match its hunk headers; a range that does not exist at the revision says so.
- Verify: common verify.
- Adversarial cases: a function name with regex characters or a leading dash (git reads `:<funcname>` as a regular expression, so the name is escaped); a range beyond the file end; a start after the end; a file that was renamed (follow, or say history stops at the rename); a binary file; a path with `..`; a function that exists twice in a file; a very long history (commit count capped, byte cap on the diff text, gap stated); `git log -L` running long (killed at the time limit and says so).

**S80. `list_contributors`, the history recipes and the documents.** Tier standard. Agent codex. Blocked by: S79.
- Goal: the repositories an author works on, and the top authors of a path or repository in a time window (`git shortlog`-style counts, bounded). Recipes (find the release containing a commit, find vulnerable versions, never claim absence without evidence) written originally (D9), reachable only on the flagged path so default bytes stay identical. ADR and glossary: the git history tools, the `MCP_GIT_TOOLS` flag and the shared bound described in one place each, amended in place.
- Scope: `gitTools.ts`, text json, the research-brief recipe file the flagged path appends to (find it with the graph), snapshots, `docs/adr/0001-falkon-architecture.md`, `CONTEXT.md`, `README.md` (the flag line), tests.
- Done: counts match `git shortlog -sne` on a fixture; the recipes appear only with the flag on and the flags-off research brief is byte-identical (the existing research output snapshot passes); the originality test (`tests/originality`) passes on the new text; documents name the flag and the seven tools.
- Verify: common verify; `pnpm --filter @falkon/api build`; the originality tests run by `pnpm test`.
- Adversarial cases: an author with two emails or name spellings (counted as given by git, and says so); an empty repository; a window with no commits; a path that never existed; the top-authors list for a repository with hundreds of thousands of commits (the time limit fires and the result says it is partial, never presented as complete); a recipe sentence must not tell the client that a missing result proves absence.

**S81. Eval harness for the new arm.** Tier standard. Agent claude (eval harness and leak patterns; its checks are the security of the measurement). Blocked by: none. Runs beside S75.
- Goal: a new arm `clone-tools-git-history` (the seven core tools plus `list_commits`, `get_diff`, `list_branches`, plus the seven new tools); the new tool names added to the deny lists of the other arms so a call there counts as a denied attempt, not a leak; a stack option that sets `MCP_GIT_TOOLS=on` and `DISCUSSION_TICKET_KEYS` on the api service, with a test that the flag reaches the api (cycle 14's first pilot was invalid exactly because it did not); a pilot check that fails the run when the new tool names are absent from the registration the arm saw, and a report line counting calls per new tool; fix both leak patterns that withheld earlier verdicts (the CLI's own scratchpad read in cycle 13, the tool-result spill folder in cycle 15, in `harness.ts`); lower the runner's per-run cost reservation (D178) so it does not stall under a small cap.
- Scope: `tests/eval/harness.ts`, `data.ts` (the `Arm` type), `stack.ts`, `runner.ts`, `report.ts`, `cli.ts` as needed, their tests, `tests/eval/README.md`.
- Done: tests show the arm's allowed tools are exactly the fourteen named, every other arm's deny list names the seven, `stack.ts` output for the new arm sets both variables on the api service and the other arms do not, the run refuses to start (and a pilot fails) when the api registration lacks the new names, a spend cap of $2 with the lowered reservation lets two runs in flight start, and the two leak patterns no longer mark a scratchpad read or a spill-folder read as a leak while a read of `.env`, `.local` or `eval` still is. No model is called.
- Verify: `pnpm --filter ./tests/eval test` (or `cd tests/eval && pnpm test`); `pnpm typecheck`.
- Adversarial cases: a path that looks like the spill folder but contains `..`; the spill folder of another user; a deny list that misses one of the seven names; the cap reached while two runs are in flight; the stack flag set for one arm and leaking into the next run; the registration check when the api answers an older server (fails with a clear message).

**S82. Paid measurement.** Tier none (main session). Agent: main session only, never an implementer. Blocked by: S75 to S81 all kept, and the human's separate go-ahead after gate 2 (see the gate 1 record).
- Goal: the new arm only, Haiku, one run per question, 40 questions, compared with the stored cycle 15 results of the old arm (D178). A pilot of five questions comes first, and its tool-call counts must show the new tools being called (the cycle 14 lesson) before the full pass. The D8 rule decides. The Claude command-line tool bills Anthropic. Estimated cost before the run: about $0.04 per question, so about $0.20 for the pilot and $1.6 to $1.8 for the full pass; the runner stops at the cap.
- Scope: `tests/eval/` run outputs under the existing `eval-runs-c19` folder and a report `baseline-c19-report.md` in `.scratch/falkon-enterprise/`; no code.
- Done: the report states the per-kind recall of both arms, the interval, the cost spent, and the D8 verdict; the pull request flag and the git flag are left unchanged (D172: decided by the human at gate 2 on this evidence).
- Honest limits stated in the result: at 40 questions the interval is about ±0.1 and the old arm already scores 0.84 to 0.93 on two of the three question kinds, so the real headroom is the "why did this change" questions; `list_refs`, `check_ancestry`, `compare_revisions` and `list_contributors` have few or no questions of their own and stay behind the flag unless the combined arm passes.

### Regression gate

Check 1 (tool contract): flags off, registration snapshots byte-identical; flags on, new entries per D167. Check 2 (golden search) unchanged. Check 3 (Ask quality): the reference arms are unchanged except that `get_diff` has a cap (D176), so large-diff answers can change; no paid check 3 run is possible within the budget, and the human accepts that at gate 1. Check 4: `scripts/ops-smoke.sh` passes after S77. `pnpm typecheck && pnpm test` pass after every slice.

### Gate 1 record (cycle 19)

Approved by the human on 2026-10-29: slices S75 to S81 as written, the order, limits and budget below. Choices made at the gate: `GET_DIFF_MAX_BYTES` is 30,000 bytes (about 7,500 tokens); the paid measurement S82 runs only after gate 2, on a separate go-ahead stating its estimated cost (pilot about $0.20, full pass $1.6 to $1.8, cap about $2).

**S76b. Review follow-ups to S76 (added 2026-10-31 at the human's request; scope stays inside S76's files).** Tier standard. Agent claude. Two parts. Part A (can run beside S78): `get_diff` must not list as `sources` the files whose text fell entirely in the cut middle (or the marker must say which files were cut); test it, and test that the Ask agent cannot get a citation source for cut text. Part B (after S78 is merged, because it edits `gitTools.ts`): (1) `search_diffs` parser test for an added line `++ x` and a removed line `-- y` (content, not headers), asserting side and line number; (2) paths that git quotes (tab, double quote, backslash) are unquoted in the `file` label, with a test; (3) a type change in `compare_revisions` (symlink to file, T status) yields both diff sections for the one entry without dropping the whole page's diffs, with a test. Done: each of the four has a test that failed first and passes; the flags-off and history-only snapshots stay byte-identical.

### Order, limits, budget (cycle 19; approved at gate 1)

- Wave 1: S75, S77 and S81 in parallel (disjoint files). Wave 2, one at a time because they share `gitTools.ts`, its text json, the `mcp.ts` block and the snapshots: S76 after S75 is kept, then S78 (needs S77 kept too), then S79, then S80. S82 last, only on a go-ahead.
- Before the first slice: probe `codex exec` with a one-line prompt (cycle 12: it failed on every model); if it fails, Codex slices move to Claude Sonnet agents. Run the verify commands once on the base and record pre-existing failures. Check that the pilot arm list has the new tool names before any paid call (cycle 14).
- Reviewers: the Sonnet `loop-reviewer` reviews Codex-built slices; Codex (read-only) reviews the Claude-built S77 and S81. Reviewers flag ponytail violations as blocking and check the adversarial cases.
- The gate-2 trigger "three slices finished" is set aside for this cycle, as cycles 15, 17 and 18 did, because the goal is incomplete before S80 and S81.
- The loop may decide alone: details inside each slice's scope, file and constant names, tool parameter names inside the plan's meaning, the bound values named in the shared design, fix rounds, one rerun of a failed verify.
- It stops for: any new dependency; any change to a current tool other than the `get_diff` cap of S76; any contract or snapshot change when the flags are off; any change to clone or shard layout or to the index; ADR or glossary changes beyond the amendments named in S77 and S80; any paid model call (S82 needs the go-ahead); any push or pull request; Docker beyond the disposable `falkon-eval*` projects and the operations smoke; a tool that needs the code host or the network.
- Not verified by the loop, for the human at gate 2: the seven tools against real large clones (the openmrs corpus), and whether a client model uses them well, which only S82 can show.
- Budget: 1.8M subagent tokens and 420 minutes for S75 to S81 (recent cycles used 1.0M to 1.3M tokens and 200 to 300 minutes for four to six slices; seven slices, none hard, and a fix round for every Codex slice in earlier cycles). S82 is outside this budget and has its own cap of about $2.

### Roadmap after cycle 19 (planned in full at each cycle's own gate 1)

- **Cycle 20, agent tier foundation, fake model only.** The `agentTools` flag and per-Product override (D163); the move of `ask_codebase` and `list_language_models` with the one-time snapshot re-record and a release note (D165); caps and metering with usage on the Product status, each bounded per request; a shared checked-evidence result shape for agent tools (items checked against reads the agent made, dropped-item count, coverage gaps, `generated: true`); a `finder` role in `models`; prompt caching (D173). Gate 1 first resolves the open conflict above.
- **Cycle 21, vanilla search parity.** `search_keywords` (C1: tokenising, stemming, stop words, OR); the `grep` wall-time bound and timeout hint (C5, D176); a BM25 trial for the new tool only (C16); search at an unindexed revision (C9, D174). Question sets: dev and hidden on Haiku, and o3-history.
- **Cycle 22, `find_code`** (C7: vanilla read tools only, Product scope injected server side, no network, no writes, 18 turns and 120 seconds by default) and its equal-total-cost paid run on dev, hidden and impact.
- **Cycle 23, aggregation sandbox (C10, D169).** Security review and interpreter choice at gate 1; off by default until it passes; a counting-and-listing question set is built for its D8 run.
- **Cycle 24, Ask loop robustness.** Compaction with an evidence ledger, overflow recovery, a forced final answer (C3), follow-up history repair (C14); a long-thread question set.
- **Cycle 25, `research`** (C17, D171) with `ask_codebase` as its synchronous form.
- **Cycle 26, `explain_change` and `impact`** (C19, C20).
- **Standalone, any time after the cycle that needs them:** per-Product exclude globs (C11); the rest of the fetch hardening (C6, D170). **With Phase 5:** the usages ladder and nearest-indexed-commit tables (C8), per-commit symbols (C15). **Later, decided separately:** Phase 3 Jira, Phase 6 identity.

## Cycle 19 results: vanilla git history tools (merged to `docs/cycle19-plan` at `8816bda`; gate 2 approved 2026-10-31)

Built on `loop/falkon-enterprise-c19` (base `52c390d`). Sonnet agents built and a different Sonnet reviewer checked every slice (Codex failed its probe again, as in cycle 12). Kept: S75 `search_commits` with the bounded git runner (one fix round), S76 `search_diffs`, `compare_revisions` and the bounded `get_diff` (30,000 bytes), S76b review follow-ups added by the human, S77 tag gaps in the clones, S78 `list_refs` and `check_ancestry`, S79 `get_range_history` (one fix round), S80 `list_contributors`, recipes and documents (ADR 4.12), S81 the eval arm `clone-tools-git-history`. Checks on the tip: typecheck exit 0; shared 292, backend 86 (18 skipped), api 251 (14 skipped), contracts 25, ui 34 and 68, eval 123 pass, 0 fail; api and ui builds exit 0; flags-off and history-only registration snapshots byte-identical.

Not verified: S82, the paid measurement, was not run (needs a separate go-ahead; about $0.20 pilot, $1.6 to $1.8 full pass, cap about $2); `scripts/ops-smoke.sh` after the tag change (Docker image build fails on npm registry resets, also on the base branch; the human runs it); the full originality scan (`ORIGINALITY_REF_DIR` unset); `packages/shared/src/opsSmoke.test.ts` hangs about 15 minutes per test on the build machine, before and after the cycle, and was excluded from every run. The cycle exceeded its token budget (about 2.5M reported against 1.8M) because the loop did not total tokens at each merge.

Decided without the human: `list_refs` uses `git for-each-ref --contains` for branches and tags; `list_contributors` passes `--use-mailmap`; the research recipes reach `research_codebase` and the `ask_codebase` prompt when `MCP_GIT_TOOLS=on`; the eval arm lists 17 tools (the slice text said fourteen); the ticket keys `TRUNK,RESTWS,O3` are hardcoded in the eval stack.

Known limits left: a host that refuses tag listing fails the whole fetch including branches; `gitRead.diff` in `packages/shared/src/git.ts` has no callers and is uncapped.

### Cycle 19 paid measurement (S82), run 2026-10-31 with the human's go-ahead

New arm `clone-tools-git-history` only, Haiku, one run per question, 40 questions (dev 24, hidden 16), compared with the stored cycle 15 results of `clone-tools-git` (D178; different day, same model and corpus). Spent $0.34 of the $2 cap (pilot of 6 runs $0.06; the Claude command line bills Anthropic). Full tables: [`baseline-c19-report.md`](baseline-c19-report.md); runs in `eval-runs-c19/` (a copy of the cycle 15 runs plus the new ones, with its own ledger).

| Pooled, 40 questions | New arm | Old arm | Difference [95% CI] |
|---|---:|---:|---|
| recall | 0.8250 | 0.7446 | +0.080 [0.027, 0.137] |
| precision | 0.5749 | 0.5631 | +0.012 [-0.090, 0.109] |
| cost per question | $0.0085 | $0.0331 | -$0.0246 [-0.044, -0.008] |

Recall wins 10, losses 1, ties 29. No new-arm run failed, was malformed or leaked. By kind (new arm): what-when 1.00, ticket-to-code 0.97, why 0.58 (n 16; the headroom the plan named, and where recall is still lowest). The new tools were used: `search_commits` 57 calls, `search_diffs` 39, `get_range_history` 17, `compare_revisions` 4; `list_refs`, `check_ancestry` and `list_contributors` were never called (as the plan expected: no questions of their own).

Limits: the tool's pooled verdict is withheld because the stored cycle 15 reference has one leaked run in the hidden split (flagged by the cycle 15 leak pattern, since fixed in S81); the arms ran on different days; at 40 questions the interval is about ±0.1 and the old arm already scored 0.84 to 0.93 on two kinds; the cost fall is large and not explained by the tools alone (prompt caching and the day were not controlled), so treat it as indicative. D8 verdict is for the human: recall does not fall (lower bound above -0.1) and rises; whether that meets "beat the engine without it" depends on the leaked reference run. D172 (the pull request flag decision) is the human's, on this evidence.

## Cycle 19b: ticket recall follow-ups (human, 2026-10-31; loop-planned, built on the trace read in [`why-analysis-c19.md`](why-analysis-c19.md))

Finding: on the 16 "why" questions the git-history arm finds the answering change every time but the ticket on 2 of 16; the key sits in the pull request body, which only `get_pull_request` returns, and `get_provenance` returned an empty ticket list in 18 of 19 calls. Human decision: work the model-free fixes before judging any agent tool.

Decision (loop, to veto): the candidate "join stored pull request tickets into `search_commits` and `list_commits`" is not built. `list_commits` is a core tool (changing it breaks the flags-off snapshots) and `search_commits` is defined as reading only the local clones (cycle 19 intro); the recipe sentence below reaches the same result through a tool call.

**T1. `get_provenance` returns the tickets of pull requests.** Tier standard. Agent claude. Blocked by: none.
- Goal: find why `get_provenance` returns an empty ticket list where `get_pull_request` holds the key (from the traces: 18 of 19 calls), and fix the cause in `packages/shared/src/historyTools.ts` (and `provenance.ts` if the cause is there).
- Scope: `historyTools.ts`, `provenance.ts`, their tests, the history snapshots only if the schema or text must change (prefer a code-only fix; the flags-off snapshot never changes).
- Done: a test built from the real shape of the failing case (a commit whose pull request holds a ticket key in its body or title) fails first and passes; `get_provenance` for a commit, a pull request and a ticket anchor returns the same ticket keys `get_pull_request` returns for that pull request; no change to flags-off output.
- Verify: `pnpm typecheck`, shared tests (minus `opsSmoke`), api tests, api build.
- Adversarial cases: a key in a pull request comment only (not in the body: stays out, say so); two pull requests for one commit; a pull request in a repository outside the Product scope; a lower-case key; an empty store; a key of a project the operator did not configure.

**T2. A recipe sentence in the `search_commits` description.** Tier mechanical. Agent claude. Blocked by: none.
- Goal: when `search_commits` shows a pull request number and no ticket key, its description tells the client to open that pull request (with the pull request tools, when they are registered) before concluding there is no ticket; one sentence, own words (D9), no claim that a missing key proves absence.
- Scope: `packages/shared/src/gitToolText.json` (the `search_commits` text), the two git registration snapshots, one test that pins the sentence.
- Done: the flags-off and history-only snapshots stay byte-identical; only `registration-git.json` and `registration-git-history.json` change; the sentence is in the registered description.
- Verify: common verify (shared minus `opsSmoke`, api tests, typecheck).

**T3. The combined measurement arm.** Tier standard. Agent claude. Blocked by: none (the paid run waits for the human's go).
- Goal: an arm `clone-tools-git-history-prs` with the clone-tools-git-prs tools plus the seven git history tools, and a stack option that sets both flags (`stack up --prs on --git-history on`: its own project, port and state dir), so the one deciding experiment (both flags on) can run. The deny lists of all other arms name the new arm's difference correctly; preflight requires all ten PR/git tools to be listed; the report counts calls for the new and the PR tools.
- Scope: `tests/eval/` only.
- Done: tests show the arm's tool list, the deny lists, the stack env (both flags on the api service, the backend importing the snapshot as in `--prs on`), that the flags do not leak into other stacks, and preflight failing when either tool family is missing. No model call, no Docker in tests.
- Verify: `cd tests/eval && pnpm test`; `pnpm typecheck`.
- Adversarial cases: only one flag reaching the api; port clash with the 3403 and 3404 stacks; the PR-tools snapshot mount missing.

Order: T1, T2, T3 in parallel (disjoint files). Then one paid run of the combined arm, new arm only, on the same 40 questions (dev 24, hidden 16), compared with the stored cycle 15 old arm and the cycle 19 git-history arm: estimated $0.35, cap $1.00, pilot first; **needs the human's go-ahead**. Limits as in cycle 19 (no dependency, no push, no snapshot change with the flags off). Budget: 500k subagent tokens.

### Cycle 19b paid measurement: both flags on (run 2026-10-31 with the human's go-ahead; merged at `ce03794`)

Arm `clone-tools-git-history-prs` (pull request tools and the seven git tools, after fixes T1 to T3), Haiku, 40 questions, new arm only, against the stored cycle 15 arms and the cycle 19 git-history arm (different days). This arm's spend about $0.32 (ledger $0.69 in total with the first measurement; limit $1.00 for this run; the Claude command line bills Anthropic). Reports: `baseline-c19b-vs-clone-tools-git.md`, `...-vs-clone-tools-git-history.md`, `...-vs-clone-tools-git-prs.md`; runs in `eval-runs-c19/`.

| Pooled, 40 questions | recall | precision | cost per question |
|---|---:|---:|---:|
| old arm `clone-tools-git` (cycle 15) | 0.7446 | 0.5631 | $0.0331 |
| PR arm `clone-tools-git-prs` (cycle 15) | 0.8438 | 0.5765 | $0.0347 |
| git-history arm (cycle 19, first measurement) | 0.8250 | 0.5749 | $0.0085 |
| **both flags on (this run)** | **0.8979** | 0.6308 | $0.0088 |

Differences of this run: against the old arm recall +0.153 [0.067, 0.238] (wins 17, losses 4, ties 19); against the PR arm +0.054 [-0.019, 0.129]; against the git-history arm +0.073 [-0.006, 0.154]. "Why" recall: 0.58 (git-history arm) to **0.83** (n 16); what-when 1.00; ticket-to-code 0.88 (it was 0.97 with the git-history arm alone: a drop to watch, not explained). Both tool families were used (`get_pull_request` 54 calls, `get_provenance` 21, `search_discussions` 9, `search_commits` 36, `search_diffs` 20).

Limits: the tool withholds its pooled verdict because two runs are flagged as leaks and the stored cycle 15 old arm has one. The two flagged runs (`hist-a-08`, `hist-a-13`) called a tool named bare `grep` (not `mcp__falkon__grep`), which does not exist; nothing outside the MCP server was read. At 40 questions the interval is about ±0.1, so the gain over the PR arm and the git-history arm is not established, only the gain over the old arm is; the arms ran on different days; the cost fall against cycle 15 is not explained by the tools alone. The first pass of the hidden split stopped at the runner's reservation ceiling (3 runs in flight at $0.25 each against the ledger cap) and was finished with a higher ceiling; real spend never neared the limit. **Open for the human:** the D172 decision (the pull request flag leaves its flag with the git flag, on this evidence), and whether to count the bare-`grep` runs as leaks (the harness does today).

## Cycle 19c: both history flags released together (human decision 2026-10-31, D172 closed)

Decision (human): on the evidence of the cycle 19 and 19b paid measurements, `MCP_HISTORY_TOOLS` (pull request tools) and `MCP_GIT_TOOLS` (git history tools) leave their opt-in state together: the ten tools are registered by default.

**R1. Both flag families default on.** Tier standard. Agent claude. Blocked by: none.
- Goal: each flag is on unless set to `off` (the same shape as `MCP_INSTRUCTIONS=off`): `MCP_HISTORY_TOOLS=off` and `MCP_GIT_TOOLS=off` are the operator's off switches. Default registration order: the existing tools, then the three pull request tools, then the seven git tools (unchanged order). The research-brief git recipes follow the git flag. The tool contract changes once, deliberately, like D165 (regression gate check 1 now reads: the tool list with both flags set to `off` is byte-identical to the cycle 18 list).
- Scope: `packages/api/src/engine/mcp.ts` (the two conditions and the recipe option; one small shared helper only if used three times), comments in `tools.ts`/`historyTools.ts`/`gitTools.ts`/`engine/tools.ts`, the api tests that pin the lists (set both flags `off` where they mean the old list; add one test that the default list equals the both-on snapshot), `tests/eval/stack.ts` and its tests (the stacks of the reference arms must set both flags `off` explicitly so their registrations stay what the stored results saw, unless the stack's own flag turns them on), `tests/eval/preflight.ts` messages, `README.md`, `docs/adr/0001-falkon-architecture.md` (4.11, 4.12 and the regression check wording in section 9, amended in place; mention the release and the off switch), `CONTEXT.md` only if a glossary term no longer fits.
- Done: with both flags `off` the registration and every other current snapshot is byte-identical (existing snapshots unchanged); with the variables unset the registration equals `registration-git-history.json` byte for byte; `off` on one flag removes only that family; `research_codebase` output with the git flag `off` is byte-identical to the stored research snapshot and with it unset contains the git recipes; typecheck, shared (minus `opsSmoke`), backend, api, contracts, ui, eval tests and the api and ui builds pass.
- Adversarial cases: a value that is neither `on` nor `off` (empty string, `0`, `false`, `OFF`): decide and document one rule (recommended: only the exact text `off`, case-insensitive after trimming, disables; everything else enables), tested; the history tools when no pull request data was ever imported (they must answer with coverage gaps, never throw: the existing no-ingest tests); Ask's own tool runner and `list_language_models`/`ask_codebase` are unaffected; a Product listener and the legacy path register the same list.
- Stop for the human if any current snapshot would have to change.

### Cycle 19c result (merged at `11dcae0`, 2026-10-31; D172 closed)

R1 kept after a clean review and one quality round (comment placement, a stale error text, and a Product-listener test of the default list with both variables unset). `MCP_HISTORY_TOOLS` and `MCP_GIT_TOOLS` now default on; exactly `off` (trimmed, case-insensitive) disables a family; any other value enables it. The default registration equals `registration-git-history.json` byte for byte; with both flags `off` it equals the cycle 18 list; no snapshot file changed. The eval stacks of the reference arms pin both flags `off`, so the stored cycle 15 results keep their meaning. Checks on the tip: typecheck exit 0; shared 296, backend 86 (18 skipped), api 255 (14 skipped), contracts 25, ui 34 and 68, eval 131 pass, 0 fail; api and ui builds exit 0.

Still open: `scripts/ops-smoke.sh` after the tag change (Docker network was intermittent; it built fine later, so it can run now); the full originality scan (`ORIGINALITY_REF_DIR`); whether the two bare-`grep` runs count as leaks; the unexplained fall of ticket-to-code recall (0.97 to 0.88) between the git-history arm and the combined arm; pull request comments are still not parsed for ticket keys (one stored question needs it).

## Cycle 20: close the cycle 19 open items (human, 2026-11-01; loop-planned)

Roadmap note: the agent tier foundation planned above as cycle 20 (D166) moves to the next cycle; this cycle only closes the open items of 19c. No agent tool work, no dependency, no push.

Gate 1: approved by the human on 2026-11-01. The human does not know the reference directory path; the loop builds it from the local reference image with the recipe in `.scratch/falkon-mvp/originality.md` (image is local, no network), in the scratch directory, never in the repo.

Human answers at the grill: the bare-`grep` runs are not leaks; ticket keys in pull request comments are to be parsed; `docs/cycle19-plan` is merged to `main` locally at the end, without a push; the originality reference directory path is still to be given.

**S83. Ops smoke on a working network.** Tier mechanical. Agent claude (needs Docker and network). Blocked by: none.
- Goal: run `scripts/ops-smoke.sh` on the cycle 19c tip to confirm the tag change and default-on flags survive the full stack.
- Done: the script exits 0 and prints PASS for every step including teardown; if the image build fails on a registry reset, retry once, then record the failure and stop (no fix attempt on the network).
- Verify: the script itself. Scope: no file changes.

**S84. Full originality scan.** Tier mechanical. Agent claude. Blocked by: none (the loop builds the reference set from the local image per the recipe; paths scanned may have changed since cycle 9: check the scan list in `tests/originality/originality.ts`).
- Goal: `ORIGINALITY_REF_DIR=<dir> pnpm originality` on the tip.
- Done: exit 0, or each hit listed with file and reference; fixing a hit is a new slice the human approves (rewriting shipped prompt or tool text in own words, D9). Scope: none.

**S85. Bare `grep` runs are not leaks.** Tier standard. Agent claude. Blocked by: none.
- Goal: the harness leak check treats a call to a tool named bare `grep` (not an MCP tool, nothing executed outside the server) as a failed tool call, not a leak; real leaks (a shell or file read outside the MCP server) still flag.
- Scope: `tests/eval/` leak pattern (`harness.ts` and where the runner or report reads it), its tests, and regenerated reports for cycle 19b (no model call).
- Done: tests with the real shape of `hist-a-08` and `hist-a-13` (bare `grep`) show no leak; a test with a real leak shape (a `Bash` or `Read` tool use) still flags; the cycle 15 flagged run stays flagged; the cycle 19b pooled verdict is no longer withheld by those two runs (the remaining cycle 15 leak may still withhold it: report which).
- Adversarial cases: a tool named `grep` inside an MCP prefix; mixed-case `Grep`; a bare `grep` that succeeded in a transcript; an empty transcript.
- Verify: `cd tests/eval && pnpm test`; `pnpm typecheck`.

**S86. Why did ticket-to-code recall fall (0.97 to 0.88)?** Tier standard. Agent claude, analysis only. Blocked by: none.
- Goal: from the stored runs in `eval-runs-c19/`, name the cause for each ticket-to-code question whose score differs between the git-history arm and the combined arm (n 7 and 5 in the reports; check which questions overlap): noise (one run, same tools), a tool regression, or a different question set.
- Done: a short note appended to `why-analysis-c19.md`; a regression found becomes a proposed slice, not a fix. No paid call (decision, loop, to veto).

**S87. Ticket keys from pull request comments.** Tier standard. Agent claude. Blocked by: none.
- Goal: a ticket key written only in a comment on a pull request appears in the `tickets` of `get_pull_request` and `get_provenance` (source recorded as its own value, so a comment key is distinguishable from a title or body key), as stored question `hist-a-11` (key RESTWS-1038 in a comment) needs. First locate where comments are held at import and at link time (scout) and choose the smallest place; if the links are built at import, say whether stored data needs a re-import.
- Scope: `packages/shared/src/provenance.ts`, the mapper that holds comments, `historyTools.ts` only if the output source field must change, tests. The flags-off list never changes.
- Done: a test built from the real shape of that question fails first and passes; the default and flags-off registration snapshots stay byte-identical (stop for the human if one must change); `get_pull_request` still lists title/body keys first.
- Adversarial cases: a key in a bot or quoted reply; a lower-case key; a key of a project the operator did not configure; thousands of comments (the scan is bounded, no unbounded read on the request path); a comment on a pull request outside the Product scope; the same key in body and comment (listed once, body source wins); a deleted or empty comment.
- Verify: `pnpm typecheck`; shared tests (minus `opsSmoke`); api tests; api build.

**S88. Merge `docs/cycle19-plan` into `main`.** Tier mechanical. Agent claude. Blocked by: S85, S87, and the human's approval at gate 2.
- Goal: after the cycle tip passes all checks, merge to `main` locally. No push (human decision).
- Done: `main` equals the tip; checks pass on `main`.

Order: S83, S85, S86, S87 start in parallel (S83 uses Docker and no files; S85 `tests/eval/`; S86 notes; S87 `packages/shared`). S84 runs when the path arrives. Then S88 at landing.
Limits: the loop decides alone the cause in S86, the exact source value in S87, and reruns of the smoke script. It stops for the human on a changed snapshot, a hit in the originality scan, a paid call, a dependency, or any push. Budget: 600k subagent tokens and 150 minutes (recent cycles used about 1.0M tokens for four to six slices; this one has two code slices and three runs).

## Next

Phase 1 (cycle 19 plan above): shipped git history tools beyond `list_commits`, `get_diff` and `list_branches`, measured against this floor, after the live sync lands (the human put the live sync first at the start of cycle 15 planning).
