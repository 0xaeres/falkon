# Pilot, cycle 12 (rule D100)

Model Haiku (claude-haiku-5-5), dataset `o3-history`, 6 dev questions (2 per kind, `pilotIds(dataset, 6)`), arms `clone-tools` and `clone-tools-git`. Stack: fresh `falkon-eval` project after `stack down -v`, over the 42 deepened checkouts. Spend $0.0716 of the $5 cap (D102). Raw runs: `.scratch/falkon-enterprise/eval-runs/haiku/`. 12 runs, 0 leaks, 0 malformed, 0 failed.

| Question | Kind | clone-tools recall | clone-tools-git recall |
|---|---|---|---|
| hist-c-03 | c | 0.25 | 0.50 |
| hist-c-06 | c | 0.33 | 0.67 |
| hist-a-14 | a | 0.00 | 1.00 |
| hist-a-03 | a | 0.00 | 1.00 |
| hist-b-08 | b | 0.00 | 1.00 |
| hist-b-01 | b | 0.00 | 1.00 |
| **Mean** | | **0.097** | **0.861** |

The run script's own stop line ("plain-arm pilot recall 0.097, needs at least 0.70") is the MVP rule for the older sets; it does not apply here, where a low plain-arm recall is the point.

## Verdict under D100

- `clone-tools-git` pilot recall 0.861 is at or above 0.85: **TOO EASY**. By 0.011, from a 6-question sample: five of six questions score 1.00 on kinds (a) and (b); the two kind (c) questions score 0.50 and 0.67. The git history tools solve the (a) and (b) questions in two `list_commits` calls.
- `clone-tools` recall is not at or below 0.05 on every question (hist-c-03 0.25, hist-c-06 0.33): **gradient present**, so no "no gradient" flag. The gap between arms is 0.76, which is the floor Phase 1 would need to beat; a floor this high leaves little headroom above `clone-tools-git`.

D100 says rewrite and re-pilot, at most two rounds. The spec's autonomy limits stop the loop for a "too easy" verdict, so no rewrite was attempted: the human decides (see `.loop/REVIEW.md`).

## Round 1 (after the human chose "rewrite kinds (a) and (b)", 2026-10-23)

Changes (details in `history-mining/rewrite-notes.md`): all 16 kind (a) texts lost every file, class, path and identifier anchor and are phrased from the symptom only; all 12 kind (b) questions now anchor on a directory plus a mechanical criterion (a line containing a named token added or removed, or a declaration's line range), with gold of 4 to 7 change units against 11 to 94 anchor commits. Kind (c) unchanged. Same 6 pilot ids, Haiku, fresh stack, one run per cell. Raw runs: `.scratch/falkon-enterprise/eval-runs-r1/`. Validator: 0 violations. Spend $0.2858 (cumulative $0.357 of $5).

| Question | Kind | clone-tools recall | clone-tools-git recall | git tool calls (git arm) |
|---|---|---|---|---|
| hist-c-03 | c | 0.25 | 1.00 | list_commits 2, get_diff 1 |
| hist-c-06 | c | 0.67 | 0.67 | list_commits 1 |
| hist-a-14 | a | 0.00 | 1.00 | list_commits 1, get_diff 2 |
| hist-a-03 | a | 0.00 | 1.00 | list_commits 2 |
| hist-b-08 | b | 0.00 (leak, see below) | 1.00 | list_commits 11, get_diff 21 |
| hist-b-01 | b | 0.00 | 0.71 | list_commits 5, get_diff 20 |
| **Mean** | | **0.153** | **0.897** | |

### Verdict under D100, round 1: still TOO EASY (0.897 at or above 0.85); `clone-tools` gradient present (0.153).

What the rewrite did and did not do:
- Kind (b) became expensive (20 or more `get_diff` calls on two questions, one at 0.71) but Haiku still reached full recall on b-08. Kind (b) is no longer solved by one call; it is solved by effort.
- Kind (a) did not get harder. With the anchors removed Haiku greps for the symptom, finds the code, then one or two `list_commits` calls on that path show the commit, whose subject carries the PR number and ticket key. Both pilot (a) questions still score 1.00. Locating the code is cheap on this corpus; the history step after it is the shipped tool.
- Cause, as far as this evidence shows: gold units (commit, PR, ticket) are identifiable from a commit subject, and `list_commits` on a path returns subjects. Anchor removal changes how the model finds the path, not what the tool gives back. Kind (c) also scored 1.00 on one question this round (0.50 before), so single-run noise is large on 6 questions.

Leak flag (clone-tools, hist-b-08): the plain arm called `list_commits` once (denied; the tool replied "No such tool available") because the server instructions name it. The harness counts any call outside the allowlist as a leak (only `research_codebase` attempts are counted as denied attempts, not leaks). Recall of that run is 0 either way. This is a harness rule on evaluation semantics, left unchanged; decision in `.loop/REVIEW.md`.
