# Falkon S0 regression baseline

Recorded in worktree `loop/s0`, 2026-10-18 to 2026-10-19. This slice adds tests, fixture data and operational scripts. Production source remains unchanged. Nothing was committed.

## Starting state

Before adding files, `pnpm typecheck && pnpm test` exited 0. All four packages typechecked; shared ran 52 tests and web ran 11 tests. No pre-existing failures were observed in those commands. The normal package test scripts do not discover the shared knowledge-base tests in nested directories; this is existing behavior, not a claim that every test file in the repository was run.

Existing query tests already pinned literal/regex terms, AND/OR precedence, quoted phrases and escapes, negated groups/filters, filter aliases, language canonicalization, wildcard revisions, empty groups, basic contexts, and the documented permissive syntax quirks. Existing mapping tests covered rune columns, multiline ranges, counts, stream exhaustiveness, match-limit clamping and default HEAD. Existing config tests covered the example, partial defaults, schema rejection, environment tokens and token/number overrides.

Added tests cover the missing public branches: repository/knowledge expansion, remaining modifier values, trimmed/empty contexts, tokenizer boundaries and nested regex groups; filename chunks, absent locations, symbol parents, scoped requests, knowledge ranking and transport streaming; local/remote config loading and errors, every supported connection discriminator, knowledge-base settings and validation, remaining override types, and secret-manager success/failure branches. Secret-manager, model catalog and HTTP transports are mocked, with no external service required.

## Four regression checks

| Check | Files and evidence | What still needs a running stack |
| --- | --- | --- |
| Tool contract | `packages/web/src/lib/ask/mcp.contract.test.ts`, `tests/contract/fixture.ts`, `tests/contract/snapshot.ts` and six JSON snapshots. MCP `tools/list` pins registration order, exact descriptions, annotations and SDK-generated JSON schemas for all 11 tools, plus conditional `ask_codebase`. `tools/call` pins 84 output envelopes and their recorded Zoekt transport requests, including query IR and options covering text, empty results, paging, line/byte/tree/search truncation, missing repositories/files, transport errors, traversal/NUL paths and dash-prefixed refs. Both empty and configured model lists are recorded. | None for these unit contracts. Zoekt is mocked, so actual index semantics belong to the golden check. |
| Search behavior | `tests/golden/queries.json`, `run.ts`, `normalize.ts`, `diff.ts`; `packages/shared/src/golden.test.ts`, `queryParser.branches.test.ts`, `zoektMapping.branches.test.ts`; `tests/fixtures/` and `packages/shared/src/fixtures.test.ts`. The set contains 50 queries and 11 equivalent MCP grep calls. Canned HTTP/SSE tests verify normalization, strict diff failure and runner request/session behavior. Coverage checks require complete syntax tokens and explicit regex, case, page and limit fields. When `tests/golden/expected.json` exists, a test requires the four metadata-filter queries to be recorded as successful searches (their results are frozen as recorded; see the metadata-filter non-goal below); it reports a clear skip while the baseline is absent. | The coordinator must record real search results before the next production slice, repeat the smoke run, and require an empty diff against `tests/golden/expected.json`. No live result file is fabricated here. |
| Ask quality | This document records the v6.0.1 O3 floor from the old repository's cycle 18 result: **dev 0.973, hidden 0.923**. These are supplied historical measurements, not a new evaluation. | S5 ports the evaluation harness; rerun the O3 strata after prompt changes. The lower confidence bound of clone minus floor must be at least -0.05. S0 does not run an LLM or establish a new floor. |
| Ops | `scripts/ops-smoke.sh`, `tests/fixtures/build.sh`, `tests/fixtures/config.json` and the fixture trees. The script uses an isolated compose project with fresh volumes, builds/starts the existing image, waits for each repository, checks oversized-file exclusion, compares two golden captures, commits a change and waits for scheduled reindexing, removes a connection and checks deletion plus surviving repositories, sums memory for every container, enforces the 654 MB ceiling and tears down volumes on success or failure. | Cold start, indexing, resync, deletion, golden stability and memory measurements remain unverified until Docker is available. The 545 MB historical figure covers the whole clone stack: backend, web, zoekt, postgres and redis. The script sums all five, converts Docker units to decimal MB, and prints PASS or FAIL against 654 MB, the +20% ceiling. Mocked command tests cover comparison/recording, unit conversion, ceiling equality and overflow, dependency failure, bounded deletion failure, log dumping and teardown; they do not establish live performance. |

## Fixtures and recording

The four repositories are `fixtures.test/atlas`, `ledger`, `worker` and `archive`, with TypeScript, Java and Python source. Every repository has `main`, a distinct `feature` branch, and lightweight tag `v1`. Authors, dates, SHA-1 object format, content and commit messages are fixed. The fixture test builds twice and compares every printed revision hash. No `.git` directory is kept in the source fixture trees.

`atlas/oversized.txt` is over the fixture config's explicit 1,024-byte index limit. This keeps the checked-in fixture small while testing the same size-limit behavior. Worker and archive carry `zoekt.fork=1` and `zoekt.archived=1` Git config markers in built repositories. Ledger carries `zoekt.public=0` for the private visibility case; the other fixtures carry `zoekt.public=1`. The current generic Git connection schema cannot set fork/archive flags, and its database rows always report false. These markers are inert: the generic git connector hard-codes `zoekt.archived=0`, `zoekt.fork=0` and `zoekt.public=1` (`packages/backend/src/connectors/genericGit.ts`), and only the GitHub connector sets them from real repository data. The live baseline (recorded 2026-10-19) therefore returns no files for `archived:only`, `fork:only` and `visibility:public`, and all four repositories for `visibility:private`. **Named non-goal:** the archived, fork and visibility filters are frozen as the engine returns them today and are not verified against real archived, forked or private repositories; verifying them needs the GitHub connector with network access and is deferred. The `visibility:private` result looks odd and is flagged for a check against the reference v6 release in S13.

The fixture config uses `file:///fixtures/repos/...` URLs. The smoke script mounts its disposable build at `/fixtures`, uses no operator environment file, and never writes Git metadata under `tests/fixtures/repos/`. Run it from any directory:

```sh
# First live record, performed by the coordinator:
GOLDEN_RECORD=1 sh scripts/ops-smoke.sh
pnpm test
# A second run must match the saved baseline:
sh scripts/ops-smoke.sh
# Retain the first normalized capture outside the disposable directory:
GOLDEN_OUTPUT="$PWD/before.json" sh scripts/ops-smoke.sh
```

The smoke script always takes two normalized captures and fails if they differ. If `tests/golden/expected.json` exists, it also diffs the capture against that file and fails on any difference, including when `GOLDEN_RECORD=1`. Without the file it prints a WARN and still checks capture stability. Only `GOLDEN_RECORD=1` writes `tests/golden/expected.json`, after all smoke checks pass. To replace an existing baseline intentionally, retain and review the old file first, then remove it before the explicit record run. Do not silently update drift away.

The deletion check relies on the backend's config reload watcher. It edits only the disposable config, waits at most `SMOKE_TIMEOUT` seconds plus one in-flight request/poll interval, and reports a clear failure if index deletion does not follow. Failures dump `docker compose logs --tail=200` before teardown. Prerequisites check that pnpm can load the golden runner and explain when `pnpm install` is needed.

To capture for review against an already running stack with those fixtures mounted:

```sh
BASE_URL=http://127.0.0.1:3000 pnpm golden:record "$PWD/before.json"
BASE_URL=http://127.0.0.1:3000 pnpm golden:record "$PWD/after.json"
pnpm golden:diff "$PWD/before.json" "$PWD/after.json"
```

Use absolute output paths because the pnpm commands execute in `packages/shared`. `API_KEY` optionally supplies a bearer token. The recorder initializes an MCP session only when a query includes a grep call, handles JSON and SSE replies, and closes the session. It removes timings and sorts unordered branches and ranges. Zoekt returns equally ranked files in varying order between identical queries (probed over four captures of one stack: same file sets, different order), so `files` is sorted by repository and path and the per-file blocks of the grep text output are sorted the same way; matches, chunks and symbols inside a file keep Zoekt's order. A change in which files make a result, or in order within a file, is caught; a change in cross-file ranking order is not (named limitation). Counts, error envelopes, source text and `isSearchExhaustive` are preserved. The diff compares normalized files strictly and exits nonzero on any difference.

Search pagination is a named non-goal of this baseline except where the route supports it. Today's `/api/search` GET route reads `limit` and ignores `page`. The page-one/page-two cases have been removed; limit-one, limit-two and exhaustive exercise the supported `limit` parameter. Limit-one includes `page: 1` solely to cover the recorder option shape; this makes no claim about page behavior. Tool pagination is separately frozen for commits, branches and repositories. The exhaustive flag is a returned property, retained in every recorded response.

## Local verification

- The new contracts first failed on missing snapshots; the normalizer/diff tests first failed on missing implementation.
- `UPDATE_SNAPSHOTS=1 pnpm test` records the six contract snapshots, then `pnpm test` passes without changing their SHA-256 hashes.
- Fix-round `pnpm typecheck && pnpm test` passes: all four packages typecheck; shared has 76 passes and one expected live-baseline skip, web has 13 passes. There are no failures, 89 passes total. `UPDATE_SNAPSHOTS=1 pnpm test` also passes; the subsequent normal test run leaves all six snapshot SHA-256 hashes unchanged.
- Probes must use a temporary copy or a test-only override. Production files are never mutated in place for fix-round verification.
- The mutation probe exposed this worktree's dependency symlinks resolving the parent checkout. A test-only module-resolution hook now pins `@sbc/shared` to this worktree, with the same CommonJS module instance used by the MCP server. An invalid fallback Zoekt URL prevents accidental socket use if injection breaks.
- `bash -n scripts/ops-smoke.sh tests/fixtures/build.sh`, `sh -n scripts/ops-smoke.sh tests/fixtures/build.sh` and ShellCheck 0.11.0 pass. The checker was installed under `/tmp`, without a repository dependency change.
- A temporary copy of the golden test and helpers accepts synthetic non-empty metadata results, then rejects empty archived-only, fork-only and visibility-private results individually. The first probe invocation could not resolve tsx from the workspace root; running from the shared package corrected the probe setup. Only the copied files were written.
- `git diff --check` passes. `git diff --stat -- ':!*.test.ts' ':!package.json'` is empty; `package.json` changes only script entries. New-file scope and prohibited spelling checks pass.
- Docker, real golden captures, Ask evaluations and memory measurements were not run. No environment file was read.

Graph use: project lookup, transport symbol search and path coverage check against the parent checkout index. The new worktree test/runner paths are missing from that index; current source was read directly, including route, transport and tool implementations. No graph absence claim was used.

## Ask-quality check, cycle 3 (S5), 2026-10-19

Stack: current engine (main at 2ea50f2 plus S3/S5, no engine change), 42 O3 repositories as generic git connections, no auth. Agent: headless `claude` CLI per `tests/eval`. Floor: the recorded reference v6 runs (`.scratch/falkon-mvp/eval-floor/`), reproduced exactly from the stored runs (dev 0.9726 n=48, hidden 0.9229 n=32). Pilot: 10 runs, all stop rules passed. Full runs: 160 runs, zero failed, zero malformed, zero leaked, zero denied-tool attempts. Spend $7.54 of the $15 cap. Raw runs: `eval-results/runs-cycle3.tar.gz`; reports: `eval-results/report-{dev,hidden}.md`.

| Arm | Split | Recall (arm / floor) | Difference [95% CI] | Gate (lower bound >= -0.05) | Precision diff | Cost per run |
|---|---|---|---|---|---|---|
| clone-tools | dev | 0.950 / 0.973 | -0.023 [-0.076, 0.021] | FAIL | -0.033 | $0.042 |
| clone-tools | hidden | 0.926 / 0.923 | +0.003 [-0.094, 0.093] | FAIL | +0.027 | $0.042 |
| clone-research | dev | 0.905 / 0.973 | -0.068 [-0.122, -0.019] | FAIL | -0.107 | $0.053 |
| clone-research | hidden | 0.943 / 0.923 | +0.020 [-0.062, 0.103] | FAIL | -0.025 | $0.052 |

Reading: the gate as written fails all four rows. For clone-tools the means are within noise of the floor (dev -0.023, hidden +0.003) and match the earlier 0.967/0.948 clone measurement; the failure is the interval width at n=48 and n=32 (half-width about 0.05 to 0.09), which a point estimate near zero cannot clear. For clone-research dev the failure is real: the arm is worse on dev (CI excludes zero) with lower precision and 27% higher cost; on hidden it is not distinguishable from the floor. `research_codebase` was called first in 80 of 80 research runs. This is a rule miss, reported to the human at gate 2; nothing was rerun or retuned.
