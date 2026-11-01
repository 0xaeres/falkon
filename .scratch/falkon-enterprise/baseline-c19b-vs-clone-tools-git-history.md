
> falkon@ eval /Users/aeres/Desktop/projects/falkon-v1
> pnpm --filter @falkon/eval eval -- report --dataset history --model haiku --arms clone-tools-git-history-prs --reference clone-tools-git-history


> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/falkon-v1/tests/eval
> tsx cli.ts -- report --dataset history --model haiku --arms clone-tools-git-history-prs --reference clone-tools-git-history

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: clone-tools-git-history runs of this model. Differences are arm minus reference, per question id, pooled across o3-history. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 24; recall 0.8056; precision 0.5636; cost 0.0099.

### clone-tools-git-history-prs (dev)

Coverage clone-tools-git-history-prs: 24/24 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history-prs: find_symbol_definitions 2, find_symbol_references 1, get_diff 14, get_provenance 15, get_pull_request 47, get_range_history 6, glob 1, grep 71, list_commits 3, list_repos 8, read_file 42, search_commits 32, search_diffs 17, search_discussions 8.
New tool calls clone-tools-git-history-prs: search_commits 32, search_diffs 17, compare_revisions 0, list_refs 0, check_ancestry 0, get_range_history 6, list_contributors 0.
PR tool calls clone-tools-git-history-prs: get_pull_request 47, search_discussions 8, get_provenance 15.
Dropped spans clone-tools-git-history-prs: 1.
Kind why (n 10): recall 0.7667; precision 0.4996.
Kind what-when (n 7): recall 1.0000; precision 0.7959.
Kind ticket-to-code (n 7): recall 0.9167; precision 0.6130.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8785 | 0.8056 | 24 | 0.0729 [-0.0208, 0.1667] |
| precision | 0.6191 | 0.5636 | 24 | 0.0555 [-0.0920, 0.1989] |
| cost | 0.0096 | 0.0099 | 24 | -0.0003 [-0.0021, 0.0011] |

Recall wins 5, losses 2, ties 17 against the reference.
Mean turns 12.54; mean wall clock 35415 ms.
Reference: n 24, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 16; recall 0.8542; precision 0.5918; cost 0.0064.

### clone-tools-git-history-prs (hidden)

Coverage clone-tools-git-history-prs: 16/16 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history-prs: check_ancestry 4, compare_revisions 1, get_diff 8, get_provenance 10, get_pull_request 36, get_range_history 1, grep 44, list_commits 2, list_repos 9, read_file 27, search_commits 10, search_diffs 14, search_discussions 1.
New tool calls clone-tools-git-history-prs: search_commits 10, search_diffs 14, compare_revisions 1, list_refs 0, check_ancestry 4, get_range_history 1, list_contributors 0.
PR tool calls clone-tools-git-history-prs: get_pull_request 36, search_discussions 1, get_provenance 10.
Dropped spans clone-tools-git-history-prs: 0.
Kind why (n 6): recall 0.9444; precision 0.6622.
Kind what-when (n 5): recall 1.0000; precision 0.5727.
Kind ticket-to-code (n 5): recall 0.8333; precision 0.7076.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9271 | 0.8542 | 16 | 0.0729 [-0.0625, 0.2188] |
| precision | 0.6484 | 0.5918 | 16 | 0.0566 [-0.1107, 0.2346] |
| cost | 0.0076 | 0.0064 | 16 | 0.0012 [-0.0001, 0.0025] |

Recall wins 4, losses 2, ties 10 against the reference.
Mean turns 11.75; mean wall clock 30934 ms.
Reference: n 16, failed 0, malformed 0, leaks 0.

## Pooled verdict (dev and hidden)

### clone-tools-git-history-prs

Coverage clone-tools-git-history-prs: 40/40 paired; failed 0; malformed 0; leaks 0.
Denied tool attempts (research_codebase, list_commits, get_diff, list_branches): 0.
Tool calls clone-tools-git-history-prs: check_ancestry 4, compare_revisions 1, find_symbol_definitions 2, find_symbol_references 1, get_diff 22, get_provenance 25, get_pull_request 83, get_range_history 7, glob 1, grep 115, list_commits 5, list_repos 17, read_file 69, search_commits 42, search_diffs 31, search_discussions 9.
New tool calls clone-tools-git-history-prs: search_commits 42, search_diffs 31, compare_revisions 1, list_refs 0, check_ancestry 4, get_range_history 7, list_contributors 0.
PR tool calls clone-tools-git-history-prs: get_pull_request 83, search_discussions 9, get_provenance 25.
Dropped spans clone-tools-git-history-prs: 1.
Kind why (n 16): recall 0.8333; precision 0.5606.
Kind what-when (n 12): recall 1.0000; precision 0.7029.
Kind ticket-to-code (n 12): recall 0.8819; precision 0.6524.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8979 | 0.8250 | 40 | 0.0729 [-0.0063, 0.1542] |
| precision | 0.6308 | 0.5749 | 40 | 0.0560 [-0.0545, 0.1651] |
| cost | 0.0088 | 0.0085 | 40 | 0.0003 [-0.0009, 0.0013] |

Recall wins 9, losses 4, ties 27 against the reference.
Mean turns 12.22; mean wall clock 33623 ms.
Reference: n 40, failed 0, malformed 0, leaks 0.

clone-tools-git-history-prs: PASS. n 40; recall difference 0.0729 [-0.0063, 0.1542]; wins 9, losses 4, ties 27.
