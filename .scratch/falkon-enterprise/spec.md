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

## Cycle 15 plan: the live GitHub sync (draft, waiting at gate 1)

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

### Regression gate

Check 1 (registration snapshots with `MCP_HISTORY_TOOLS` off) stays byte-identical; nothing in this cycle changes how existing datasets score; `pnpm typecheck && pnpm test` pass; the cycle 14 pull request eval stack still imports the snapshot (S54 keeps `DISCUSSIONS_SNAPSHOT_DIR` working). No paid eval run is planned.

### Order, limits, budget

- Wave 1: S51 and S52 in parallel. Wave 2: S53 and S55 in parallel. Wave 3: S54. Wave 4: S56. Wave 5: S57. Gate 2 also needs the human's real-token smoke run.
- The loop may decide alone: details inside each slice's scope, fix rounds, a rerun of a failed verify once.
- It stops for: any new dependency; any change to the tool registration with the flag off; any step that needs a real token or the human's `gh` login beyond S51; ADR or glossary changes beyond the planned 4.11 amendment; a change to how existing datasets score; a schema change beyond the additive ones named above; any push or pull request; any eval run that costs money (Phase 2 cap $5, $3.69 used; a new approval is required).
- Docker: one stack at a time, only disposable `falkon-eval*` projects; never the human's `falkon` project or the `falcon-sourcebot-*` containers.
- Budget: 1.6M subagent tokens and 360 minutes (the last four cycles used 0.26M to 1.05M; S53 is hard).
- Gate 2 fires when S57 is kept and the human has the smoke result, or on any trigger.

### Not in this cycle (decide at gate 1)

- The eval prompt, parser and search-hint fixes from the follow-up analysis. They are small, cost nothing to build, and only a rerun costs money. Offered as an optional slice S58 (prompt example and span rule, a dropped-span counter, rescore of stored runs), or deferred to the cycle that reruns the arms.
- Issues, webhooks, Jira, the git-only history tools of Phase 1, visibility synced from GitHub (Phase 6).

## Next

Phase 1: shipped git history tools beyond `list_commits`, `get_diff` and `list_branches`, measured against this floor, after the live sync lands (the human put the live sync first at the start of cycle 15 planning).
