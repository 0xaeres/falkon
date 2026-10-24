
> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/falkon-v1/.loop/worktrees/s61/tests/eval
> tsx cli.ts -- report --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs --reference clone-tools-git

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: clone-tools-git runs of this model. Differences are arm minus reference, per question id, pooled across o3-history. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 24; recall 0.7763; precision 0.5783; cost 0.0387.

### clone-tools-git-prs (dev)

Coverage clone-tools-git-prs: 24/24 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: find_symbol_definitions 2, get_diff 156, get_provenance 23, get_pull_request 48, glob 1, grep 85, list_commits 37, list_repos 1, read_file 56, search_discussions 19.
Dropped spans clone-tools-git-prs: 0.
Kind why (n 10): recall 0.7500; precision 0.3599.
Kind what-when (n 7): recall 0.8354; precision 0.7027.
Kind ticket-to-code (n 7): recall 0.9167; precision 0.6177.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8235 | 0.7763 | 24 | 0.0472 [-0.0556, 0.1583] |
| precision | 0.5351 | 0.5783 | 24 | -0.0432 [-0.1793, 0.0917] |
| cost | 0.0309 | 0.0387 | 24 | -0.0078 [-0.0203, 0.0012] |

Recall wins 5, losses 4, ties 15 against the reference.
Mean turns 19.33; mean wall clock 54968 ms.
Reference: n 24, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 16; recall 0.6972; precision 0.5404; cost 0.0247.

### clone-tools-git-prs (hidden)

Coverage clone-tools-git-prs: 16/16 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: get_diff 110, get_provenance 16, get_pull_request 32, grep 62, list_commits 37, list_repos 3, read_file 26, search_discussions 9.
Dropped spans clone-tools-git-prs: 0.
Kind why (n 6): recall 1.0000; precision 0.7270.
Kind what-when (n 5): recall 0.6643; precision 0.4800.
Kind ticket-to-code (n 5): recall 0.9333; precision 0.6910.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8743 | 0.6972 | 16 | 0.1771 [0.0208, 0.3177] |
| precision | 0.6385 | 0.5404 | 16 | 0.0982 [-0.0662, 0.2664] |
| cost | 0.0404 | 0.0247 | 16 | 0.0157 [-0.0045, 0.0445] |

Recall wins 9, losses 2, ties 5 against the reference.
Mean turns 19.94; mean wall clock 54707 ms.
Reference: n 16, failed 0, malformed 0, leaks 1.

## Pooled verdict (dev and hidden)

### clone-tools-git-prs

Coverage clone-tools-git-prs: 40/40 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: find_symbol_definitions 2, get_diff 266, get_provenance 39, get_pull_request 80, glob 1, grep 147, list_commits 74, list_repos 4, read_file 82, search_discussions 28.
Dropped spans clone-tools-git-prs: 0.
Kind why (n 16): recall 0.8438; precision 0.4976.
Kind what-when (n 12): recall 0.7641; precision 0.6099.
Kind ticket-to-code (n 12): recall 0.9236; precision 0.6482.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8438 | 0.7446 | 40 | 0.0992 [0.0117, 0.1879] |
| precision | 0.5765 | 0.5631 | 40 | 0.0133 [-0.0922, 0.1191] |
| cost | 0.0347 | 0.0331 | 40 | 0.0016 [-0.0100, 0.0154] |

Recall wins 14, losses 6, ties 20 against the reference.
Mean turns 19.57; mean wall clock 54864 ms.
Reference: n 40, failed 0, malformed 0, leaks 1.

clone-tools-git-prs: withheld (incomplete coverage, failed, malformed or leaking runs). n 40; recall difference 0.0992 [0.0117, 0.1879]; wins 14, losses 6, ties 20.
