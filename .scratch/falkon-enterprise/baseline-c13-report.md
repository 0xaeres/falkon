> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/falkon-v1/.loop/worktrees/c13/tests/eval
> tsx cli.ts report --dataset history --model haiku --arms clone-tools,clone-tools-git --reference clone-tools

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: clone-tools runs of this model. Differences are arm minus reference, per question id, pooled across o3-history. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 24; recall 0.0833; precision 0.1140; cost 0.0077.

### clone-tools-git (dev)

Coverage clone-tools-git: 24/24 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.6861 | 0.0833 | 24 | 0.6028 [0.4792, 0.7250] |
| precision | 0.5755 | 0.1140 | 24 | 0.4615 [0.2566, 0.6524] |
| cost | 0.0381 | 0.0077 | 24 | 0.0304 [0.0075, 0.0611] |

Recall wins 22, losses 0, ties 2 against the reference.
Mean turns 21.92; mean wall clock 71806 ms.
Reference: n 24, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 16; recall 0.1146; precision 0.1406; cost 0.0057.

### clone-tools-git (hidden)

Coverage clone-tools-git: 16/16 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.7098 | 0.1146 | 16 | 0.5952 [0.5000, 0.7024] |
| precision | 0.5549 | 0.1406 | 16 | 0.4143 [0.2249, 0.5872] |
| cost | 0.0241 | 0.0057 | 16 | 0.0184 [0.0034, 0.0409] |

Recall wins 16, losses 0, ties 0 against the reference.
Mean turns 20.63; mean wall clock 64308 ms.
Reference: n 16, failed 0, malformed 0, leaks 1.

## Pooled verdict (dev and hidden)

### clone-tools-git

Coverage clone-tools-git: 40/40 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.6956 | 0.0958 | 40 | 0.5998 [0.5152, 0.6818] |
| precision | 0.5673 | 0.1246 | 40 | 0.4426 [0.2986, 0.5776] |
| cost | 0.0325 | 0.0069 | 40 | 0.0256 [0.0095, 0.0460] |

Recall wins 38, losses 0, ties 2 against the reference.
Mean turns 21.40; mean wall clock 68807 ms.
Reference: n 40, failed 0, malformed 0, leaks 1.

clone-tools-git: withheld (incomplete coverage, failed, malformed or leaking runs). n 40; recall difference 0.5998 [0.5152, 0.6818]; wins 38, losses 0, ties 2.
