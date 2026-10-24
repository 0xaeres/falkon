# Cycle 15 rerun analysis: two open questions (planning input for cycle 16)

Read-only analysis of the stored Haiku runs `eval-runs-c14/` and `eval-runs-c15/` (both arms, 40 questions each). The scorer `tests/eval/score.ts` was re-implemented line for line (the checkout has no `node_modules`; nothing was installed or run) and reproduces the printed reports exactly: recall and precision per kind, both cycles, both arms. No code, dataset or run file changed. One run per cell, one model.

## Question 1: why "what changed and when" precision fell (git arm 0.788 to 0.640, pull request arm 0.772 to 0.610)

Cause found: the S58 prompt line ("put only the answering change (its commit or pull request) and its ticket in the array"). The gold of all 12 "what changed and when" questions is pull requests only (59 units, no ticket, no span; the questions never mention a ticket). In cycle 15 the agents added a ticket item to nearly every answer.

| items listed on the 12 questions (hit) | git c14 | git c15 | prs c14 | prs c15 |
|---|---|---|---|---|
| pull requests | 50 (49) | 50 (49) | 55 (50) | 44 (44) |
| commits | 50 (47) | 2 (2) | 42 (38) | 0 |
| tickets | 0 | 25 (0) | 2 (0) | 28 (0) |
| spans | 26 (0) | 9 (0) | 20 (0) | 3 (0) |

Precision with ticket items removed: 0.886 (git c15) and 0.950 (prs c15), against 0.788 and 0.800 in cycle 14. So the line improved precision where it works (fewer spans, fewer duplicate commit items) and cost more through the ticket items. Not noise.

Same line on "why" questions: spans were not removed (73 spans listed in the git arm both cycles, 95 to 66 in the prs arm; none ever scores because no "why" gold has a span). "Why" precision without spans: git 0.677 to 0.740, prs 0.616 to 0.824.

Trap for the fix: the 12 "ticket to code" questions name the ticket in the question and their gold counts it (12 of 12 listed ticket items hit in both arms and both cycles), and 8 of the 12 ask "which lines"; their spans score (23 of 41 hit git arm, 19 of 47 prs arm in cycle 15). A rule that bans tickets or spans everywhere would cost recall there. All 16 "why" questions ask "which change and ticket"; none of the 12 "what changed" questions mentions a ticket.

## Question 2: why the pull request arm lost recall (lead +0.158 to +0.099)

| recall lead, prs minus git | cycle 14 | cycle 15 | cycle 15 without hist-a-14 and hist-c-03 |
|---|---|---|---|
| all 40 | +0.158 [0.057, 0.255] | +0.099 [0.010, 0.188] | +0.113 [0.025, 0.204] |
| why (16) | +0.323 | +0.312 | |
| what changed and when (12) | +0.005 | -0.079 | |
| ticket to code (12) | +0.090 | -0.007 | |

1. The "why" lead, which the pull request tools exist for, is unchanged. The shrink comes from the git arm gaining on "ticket to code" (+0.16, the S58 prefix and example fixes) and from "what changed and when", where both arms use the same `list_commits`/`get_diff` tools.
2. **Eval defect (real, fixable): two of the losses were runs that started before the pull request import finished.** In the stored tool results the history tools list `coverageGaps` "pull requests not ingested for <repository>". Every other run in both cycles lists the same 30 repositories (the 42 product repositories minus the 12 in `github-snapshot.manifest.json`). The cycle 15 runs for hist-a-14 (recall 0.67 to 0.00) and hist-c-03 (1.00 to 0.75) listed 33 to 41, including the snapshot repository `openmrs-esm-patient-chart`, and the count fell during the hist-a-14 run (41, 36, 34, 33). The agent concluded "patient-chart pull requests are not ingested" and answered from code only. The preflight (`tests/eval/preflight.ts`) checks the repository list and that gold files read, never that the import finished.
3. The rest are agent diligence, not tools. hist-a-07 (1.00 to 0.50): the agent found the right commit and pull request but never opened pull request 854, whose body holds the ticket. The scan questions hist-b-01, b-03, b-06, b-09, b-11, b-12 use the same tools in both arms; the git arm moved by as much in both directions (b-06 0.25 to 1.00, b-09 1.00 to 0.57, b-11 1.00 to 0.50) and the pull request arm's own b-12 answer says "I did not search every commit's full diff". Per-question change of the lead has a standard deviation of 0.38, so a +0.06 shift of the mean lead (a standard error of about 0.06) is not distinguishable from chance with one run per cell.
4. A smaller usability observation: `search_discussions` matches whole words only ("diagnosis" does not find "diagnoses"), which is what made the hist-a-14 query return nothing before the contamination mattered. The cycle 15 hint fired but offered other repositories' pull requests. A stemming or fuzzy match is a product search change; parked for its own cycle.

## What this means

Dropping the two contaminated questions moves the cycle 15 lead from +0.099 to +0.113; the rest is within noise; the precision drop on "what changed and when" has a one-line cause. Both are cheap to fix. Fixing them needs no product code: one eval runner change (wait for the import, flag contaminated runs) and one prompt edit, then one paid pass to confirm.
