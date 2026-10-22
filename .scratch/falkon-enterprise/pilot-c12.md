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
