
> falkon@ eval /Users/aeres/Desktop/projects/falkon-v1
> pnpm --filter @falkon/eval eval -- report --dataset history --model haiku --arms clone-tools-git-history --reference clone-tools-git


> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/falkon-v1/tests/eval
> tsx cli.ts -- report --dataset history --model haiku --arms clone-tools-git-history --reference clone-tools-git

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: clone-tools-git runs of this model. Differences are arm minus reference, per question id, pooled across o3-history. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 24; recall 0.7763; precision 0.5783; cost 0.0387.

### clone-tools-git-history (dev)

Coverage clone-tools-git-history: 24/24 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history: compare_revisions 4, find_symbol_definitions 1, find_symbol_references 1, get_diff 17, get_range_history 14, glob 1, grep 73, list_commits 7, list_repos 7, list_tree 2, read_file 43, search_commits 40, search_diffs 21.
New tool calls clone-tools-git-history: search_commits 40, search_diffs 21, compare_revisions 4, list_refs 0, check_ancestry 0, get_range_history 14, list_contributors 0.
Dropped spans clone-tools-git-history: 1.
Kind why (n 10): recall 0.5667; precision 0.3337.
Kind what-when (n 7): recall 1.0000; precision 0.7457.
Kind ticket-to-code (n 7): recall 0.9524; precision 0.7098.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8056 | 0.7763 | 24 | 0.0293 [-0.0208, 0.0789] |
| precision | 0.5636 | 0.5783 | 24 | -0.0147 [-0.1561, 0.1255] |
| cost | 0.0099 | 0.0387 | 24 | -0.0288 [-0.0565, -0.0068] |

Recall wins 4, losses 1, ties 19 against the reference.
Mean turns 10.83; mean wall clock 36416 ms.
Reference: n 24, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 16; recall 0.6972; precision 0.5404; cost 0.0247.

### clone-tools-git-history (hidden)

Coverage clone-tools-git-history: 16/16 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history: find_symbol_definitions 1, get_diff 9, get_range_history 3, grep 50, list_commits 14, list_repos 4, read_file 22, search_commits 17, search_diffs 18.
New tool calls clone-tools-git-history: search_commits 17, search_diffs 18, compare_revisions 0, list_refs 0, check_ancestry 0, get_range_history 3, list_contributors 0.
Dropped spans clone-tools-git-history: 0.
Kind why (n 6): recall 0.6111; precision 0.3402.
Kind what-when (n 5): recall 1.0000; precision 0.7222.
Kind ticket-to-code (n 5): recall 1.0000; precision 0.7633.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8542 | 0.6972 | 16 | 0.1570 [0.0573, 0.2656] |
| precision | 0.5918 | 0.5404 | 16 | 0.0514 [-0.0772, 0.1752] |
| cost | 0.0064 | 0.0247 | 16 | -0.0183 [-0.0447, -0.0034] |

Recall wins 6, losses 0, ties 10 against the reference.
Mean turns 9.81; mean wall clock 32630 ms.
Reference: n 16, failed 0, malformed 0, leaks 1.

## Pooled verdict (dev and hidden)

### clone-tools-git-history

Coverage clone-tools-git-history: 40/40 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history: compare_revisions 4, find_symbol_definitions 2, find_symbol_references 1, get_diff 26, get_range_history 17, glob 1, grep 123, list_commits 21, list_repos 11, list_tree 2, read_file 65, search_commits 57, search_diffs 39.
New tool calls clone-tools-git-history: search_commits 57, search_diffs 39, compare_revisions 4, list_refs 0, check_ancestry 0, get_range_history 17, list_contributors 0.
Dropped spans clone-tools-git-history: 1.
Kind why (n 16): recall 0.5833; precision 0.3361.
Kind what-when (n 12): recall 1.0000; precision 0.7359.
Kind ticket-to-code (n 12): recall 0.9722; precision 0.7321.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8250 | 0.7446 | 40 | 0.0804 [0.0271, 0.1369] |
| precision | 0.5749 | 0.5631 | 40 | 0.0117 [-0.0896, 0.1093] |
| cost | 0.0085 | 0.0331 | 40 | -0.0246 [-0.0438, -0.0084] |

Recall wins 10, losses 1, ties 29 against the reference.
Mean turns 10.43; mean wall clock 34902 ms.
Reference: n 40, failed 0, malformed 0, leaks 1.

clone-tools-git-history: withheld (incomplete coverage, failed, malformed or leaking runs). n 40; recall difference 0.0804 [0.0271, 0.1369]; wins 10, losses 1, ties 29.
