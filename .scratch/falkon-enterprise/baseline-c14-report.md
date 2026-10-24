> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/falkon-v1/.loop/worktrees/c14/tests/eval
> tsx cli.ts report --dataset history --model haiku --arms clone-tools-git,clone-tools-git-prs --reference clone-tools-git

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: clone-tools-git runs of this model. Differences are arm minus reference, per question id, pooled across o3-history. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 24; recall 0.7034; precision 0.5029; cost 0.0259.

### clone-tools-git-prs (dev)

Coverage clone-tools-git-prs: 24/24 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: find_symbol_definitions 2, get_diff 167, get_provenance 21, get_pull_request 45, grep 92, list_branches 1, list_commits 43, list_repos 16, read_file 56, search_discussions 23.
Kind why (n 10): recall 0.7667; precision 0.2188.
Kind what-when (n 7): recall 0.8333; precision 0.7857.
Kind ticket-to-code (n 7): recall 0.9048; precision 0.6362.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8264 | 0.7034 | 24 | 0.1230 [-0.0139, 0.2510] |
| precision | 0.5059 | 0.5029 | 24 | 0.0030 [-0.1133, 0.1131] |
| cost | 0.0449 | 0.0259 | 24 | 0.0190 [-0.0044, 0.0505] |

Recall wins 11, losses 3, ties 10 against the reference.
Mean turns 21.54; mean wall clock 70349 ms.
Reference: n 24, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 16; recall 0.6719; precision 0.6048; cost 0.0294.

### clone-tools-git-prs (hidden)

Coverage clone-tools-git-prs: 16/16 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: find_symbol_definitions 3, get_diff 120, get_provenance 18, get_pull_request 44, grep 71, list_commits 35, list_repos 12, list_tree 2, read_file 28, search_discussions 14.
Kind why (n 6): recall 1.0000; precision 0.3720.
Kind what-when (n 5): recall 0.8214; precision 0.7533.
Kind ticket-to-code (n 5): recall 0.8000; precision 0.7250.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8817 | 0.6719 | 16 | 0.2098 [0.0699, 0.3452] |
| precision | 0.6015 | 0.6048 | 16 | -0.0033 [-0.1325, 0.1117] |
| cost | 0.0356 | 0.0294 | 16 | 0.0061 [-0.0072, 0.0247] |

Recall wins 8, losses 2, ties 6 against the reference.
Mean turns 23.44; mean wall clock 75222 ms.
Reference: n 16, failed 0, malformed 0, leaks 0.

## Pooled verdict (dev and hidden)

### clone-tools-git-prs

Coverage clone-tools-git-prs: 40/40 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-prs: find_symbol_definitions 5, get_diff 287, get_provenance 39, get_pull_request 89, grep 163, list_branches 1, list_commits 78, list_repos 28, list_tree 2, read_file 84, search_discussions 37.
Kind why (n 16): recall 0.8542; precision 0.2763.
Kind what-when (n 12): recall 0.8284; precision 0.7722.
Kind ticket-to-code (n 12): recall 0.8611; precision 0.6732.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8485 | 0.6908 | 40 | 0.1577 [0.0589, 0.2554] |
| precision | 0.5441 | 0.5437 | 40 | 0.0005 [-0.0877, 0.0841] |
| cost | 0.0412 | 0.0273 | 40 | 0.0139 [-0.0016, 0.0341] |

Recall wins 19, losses 5, ties 16 against the reference.
Mean turns 22.30; mean wall clock 72298 ms.
Reference: n 40, failed 0, malformed 0, leaks 0.

clone-tools-git-prs: PASS. n 40; recall difference 0.1577 [0.0589, 0.2554]; wins 19, losses 5, ties 16.
