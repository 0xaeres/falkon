# Cycle 14 follow-up: why five questions got worse, and why "why" precision is low

Read-only analysis, no code or dataset changed. Sources: the stored Haiku runs in `eval-runs-c14/haiku/o3-history/raw/` for both arms (`clone-tools-git`, the git-only arm; `clone-tools-git-prs`, the arm with the pull request tools), the dataset `tests/eval/datasets/o3-history.json`, the scorer `tests/eval/score.ts`, the answer parser and prompt in `tests/eval/harness.ts`, and the tool code and text in `packages/shared/src/historyTools.ts` and `historyToolText.json`. Each cell is one run, so a single question can move by chance; where I say "noise" I mean the agent's own choices, not the tools. The numbers below were recomputed with the real scorer from the stored answers (they match the report: why precision 0.336 for the git arm and 0.276 for the new arm).

## Summary

- Of the five worse questions, three (hist-b-05, hist-c-01, hist-c-09) were lost by the **answer prompt and parser, not by the pull request tools**. Two prompt flaws did it: the prompt's format example uses the literal repository name `openmrs-core`, and the prompt tells the agent to give a "repo-relative path" while the parser silently drops any span path that lacks the repository prefix. These three account for 1.41 of the 2.05 recall points the five questions lost. Fixing them would be expected to lift the new arm and (for the same flaws) the git arm, so both arms need a rerun to measure.
- One (hist-a-09, 0.50 to 0.00) is a **real, if modest, tool usability problem plus bad luck**: `search_discussions` requires every query word to appear, the agent used five words, got zero hits, and never retried with fewer words. About 4 calls per run in both arms are also wasted on "repository not found" because the tools want `github.com/openmrs/<name>` while the prompt tells the agent to cite bare names.
- One (hist-b-09, 1.00 to 0.86) is **noise**: the agent missed one of seven pull requests by checking only one file of it.
- No gold answer is wrong. No tool returned a wrong result in any of the five.
- "Why" precision is low mainly because **the agent lists source-code spans, and no "why" gold contains a span**: 95 of the new arm's 173 listed items on the 16 "why" questions are spans, every one a guaranteed miss. Leaving spans out of "why" answers lifts precision from 0.276 to 0.616 (git arm 0.336 to 0.677). The remaining extras are real but secondary changes (earlier, companion or sibling pull requests and tickets) that the agent itself labelled "related" in prose and then also put in the machine-readable list. The gold is not too narrow; the prompt is too permissive.

## Part (a): the five questions that got worse

Recall per question, git arm to new arm. "Units" are scored gold units: a change unit (a commit with its pull request, counted once), a ticket, or a source span.

### hist-a-09 (0.50 to 0.00): service worker cost in patient search. Gold: change unit commit `e4aacbd5` with pull request 2638, and ticket O3-5832.

What happened. The git arm found the change (it called `list_commits` eight times on the patient-management repository and cited the commit and pull request, 1 of 2 units) but found no ticket, because the commit message carries none. The new arm never listed commits in that repository. It spent four of its twelve `grep` calls on bare repository names that the server rejects ("Repository ... not found"), found the framework's removal of the service worker, and built its answer on that. Its single `search_discussions` query was `service worker patient search slow`. The pull request is titled "(fix) Patient search should bypass service worker caching (#2638)"; the word "slow" is not in it, and the tool requires all words, so the result was `totalCount 0`. The agent did not retry with fewer words, and its second discussion search failed on a bare repository name; the final text then called this "timed out". Our own mining record says the ticket O3-5832 is in the body of pull request 2638, so a query such as `patient search service worker` would very likely have found both the pull request and the ticket.

Cause: partly a tool usability problem (all-words-required search returns nothing and says nothing helpful; the "not found" error does not name the right spelling), partly the agent's strategy (no retry, no commit listing). Not a tool bug: the tool did what its description says ("words that must all appear"). I did not run the tool against the data (the snapshot is not on this machine's accessible paths without reading `.env`), so the claim that the shorter query would hit rests on the title and the mining record, not on a replay. Confidence that this is mostly agent behaviour plus a usability gap rather than noise alone: medium. A single run cannot rule out a lucky git arm.

### hist-b-05 (0.75 to 0.00): `getExtensionConfig` in openmrs-esm-core. Gold: pull requests 1934, 1922, 1870, 1856.

What happened. The new arm found **all four** pull requests and all four commits, which is better than the git arm (it found three and ruled out 1856). But every item in its JSON array says `"repo": "openmrs-core"` instead of `"openmrs-esm-core"`, so the scorer matched nothing and scored 0. The cause is in the prompt: the format text in `historyCommon` (`tests/eval/harness.ts`) writes its examples as `{"repo": "openmrs-core", "commit": "<sha>"}` and `{"repo": "openmrs-core", "pr": 123}`. The agent copied the example literally; the paths in the same array correctly say `openmrs-esm-core/...`. The same slip appears once in the git arm (hist-c-06, one commit), the only two such cases in 80 runs. Without it the new arm scores 1.00 here.

Cause: prompt flaw (example uses a real, similarly named repository), amplified by chance. Confidence: high (the stored final text and array show it directly).

### hist-b-09 (1.00 to 0.86): `lineItems` in openmrs-esm-billing-app. Gold: seven pull requests.

What happened. The new arm found six of seven and missed pull request 831 (commit `6e4cdcd9`), which it explicitly "ruled out" after looking only at `bills-table.component.tsx`. The line that matched was in `src/billing.resource.test.ts`. A whole-range `get_diff` was too large for the reply, was saved to disk, and the agent's attempt to search that saved file was refused (the harness blocks that path); both arms hit this. The git arm worked file by file with 31 `get_diff` calls and happened to cover the test file; the new arm made 17 `get_pull_request` calls and 23 `get_diff` calls and checked 831 less completely. The pull request tool did not mislead: the agent did not use it to see 831's changed-file list, which would have shown the test file.

Cause: agent thoroughness (noise). Confidence: medium-high. A side finding for the harness: the refused read of the saved diff file appears in hist-b-05 and hist-b-09 in both arms and makes big diffs harder to search.

### hist-c-01 (1.00 to 0.67): TRUNK-6796 merge hash null check. Gold: commit `21ea98bd` with pull request 6537, ticket TRUNK-6796, and the span `PersonMergeLogData.java` line 445.

What happened. The new arm got the commit, pull request and ticket right and wrote the correct span in its prose, but its JSON array writes the span paths as `api/src/main/java/org/openmrs/person/PersonMergeLogData.java` without the repository prefix `openmrs-core/`. `parseAnswer` looks the path up in the corpus, finds nothing and silently drops the item, so the span unit was lost. The git arm wrote `openmrs-core/api/src/...` and scored 1.00. The prompt contradicts itself: the answer format says "repo-relative path", while the later product paragraph says to cite `<repository-name>/<path>`. Tool outputs (`get_diff`, `get_pull_request` file lists) show repo-relative paths, which the agent copied.

Cause: prompt conflict plus a parser that drops silently. Confidence: high.

### hist-c-09 (1.00 to 0.67): drug order toggle labels. Gold: commit `1c19126f` with pull request 3793, ticket O3-6097, span `drug-order-form.component.tsx` lines 981 to 982.

What happened. Identical to hist-c-01: the span is written as `packages/esm-patient-medications-app/...` without `openmrs-esm-patient-chart/`, so it is dropped. The new arm also listed a second commit `1a22cd15`, which it found in a code-review bot comment on the pull request (the pull request's head commit, not on the main line); it labelled it "secondary" in prose. That costs precision only, and it is a case of the tool text carrying a head-branch SHA to the agent: the importer does not store head SHAs as links (correct), but comment text can contain them.

Cause: prompt conflict plus parser (recall); comment-borne head SHA (precision). Confidence: high.

### Scale of the two prompt/parser flaws beyond these questions

- Span paths without a repository prefix (and so silently dropped) appear in 53 spans of the git arm's final answers and 60 of the new arm's, across 10 and 13 questions respectively. They hurt wherever gold has a span (kind "ticket to code" and some "what changed") and nowhere else. This is symmetric, so it did not bias the comparison much, but it deflates recall for both arms.
- The repository-name example slip is rare (two questions in 80 runs) but costs a whole question when it happens.

### Gold check

I found no wrong or ambiguous gold among the five. hist-b-05's gold of four pull requests is supported by the new arm's own evidence (all four appear in `list_commits` for `packages/framework` since 2026-04-11), and hist-b-09's seven are consistent with both arms' diffs. hist-a-09's gold ticket O3-5832 is only in the pull request body (the commit has none), which is exactly what the pull request tools should recover; this is the expected gain, missed here by usage, not a flaw in the question.

## Part (b): low precision on the 16 "why" questions

Precision means: of the items the agent lists, the share that match a gold unit. Per kind, the new arm and git arm:

| | git arm | new arm |
|---|---|---|
| "why" precision | 0.336 | 0.276 |
| "why" items listed per answer | 8.2 | 10.8 |
| "what changed and when" precision | 0.788 | 0.772 |
| "ticket to code" precision | 0.576 | 0.673 |

Items listed on the 16 "why" questions, and how many miss: git arm 131 items (73 spans, 33 commits, 17 pull requests, 8 tickets), 99 miss (73 spans, 17 commits, 3 pull requests, 6 tickets); new arm 173 items (95 spans, 31 commits, 30 pull requests, 17 tickets), 128 miss (95 spans, 15 commits, 14 pull requests, 4 tickets).

### Cause 1, the dominant one: spans in answers whose gold has no span

The gold of every "why" question (decision D88: the change and its ticket) has no span unit, so each source span the agent lists counts as wrong by construction: 73 of 131 git-arm items and 95 of 173 new-arm items. The question text invites them ("what do its requests now do", "which lines carry it") and the prompt tells the agent to "list every piece of evidence that answers it". Dropping spans from "why" answers lifts precision to 0.616 (new) and 0.677 (git). The git arm's higher raw precision comes mostly from its shorter answers; one question shows it clearly, hist-a-04, where the new arm listed 13 spans and the git arm none. The same happens on "what changed and when" (gold has only changes): precision there is 0.875 (new) and 0.948 (git) with spans left out, against 0.772 and 0.788.

Are the spans "legitimately related answers"? Often yes as engineering evidence, but the benchmark asks for the change and ticket, so they are not scored answers. This is the kind of mismatch between the question text and the gold unit definition, not noise from the tools.

Smallest fix: one sentence in the history answer prompt (`historyCommon`), for example "Put a source span in the array only when the question asks where in the code; for questions about why or when, list only the change (commit or pull request) and ticket that answer it, and describe related changes in prose." This changes the prompt for both arms equally. An alternative that leaves the prompt alone is a second reported precision that ignores span items when the gold has none; that is a reporting change, not a measurement change, and costs nothing to run.

### Cause 2: related but secondary changes listed in the array

Without spans, the new arm still lists 33 items that miss (15 commits, 14 pull requests, 4 tickets), on 11 of the 16 questions. I read the agent's own text for each: these are **real, correctly described related changes that are not the answer**, and the agent says so in prose before putting them in the array. Examples: hist-a-14 (pull requests 3402 closed without merge, 3496 and 3621 and tickets O3-5822 and O3-5823, all later or sibling work on the same area); hist-a-16 (pull request 3436 and ticket O3-5782, the "broader sweep" next to the gold fix); hist-a-07 (the companion changes in patient-chart 3353 and patient-management 2561); hist-a-11 (the earlier pull request 3345 and the open server-side pull request 751); hist-a-05 (pull request 3320, "the original feature"); hist-a-02 (an earlier redirect change); hist-a-01 (earlier preparatory commits and a later commit); hist-a-08 (earlier and later style changes). The new arm lists more pull requests than the git arm (14 versus 3 wrong ones) simply because it can see them now.

Is the gold or `accepted.json` too narrow? No. `accepted.json` has no entry for any history question today, and none of these items answers the question as posed ("which change and ticket"); adding them as accepted would make the benchmark reward listing everything nearby. Where a question has two true change units (hist-a-13, hist-a-14) the gold already holds both.

Smallest fix: the same prompt sentence as Cause 1 ("describe related changes in prose, list only the answering change and ticket"). If the human wants to credit context anyway, a separate "context hits" count would be a scoring change and a decision, not a quiet edit.

### Cause 3: the tools (minor, two items)

- Comments can carry head-branch or review-bot SHAs (hist-c-09). The importer correctly stores no head SHAs, so this is only text. No change recommended; the agent labelled it secondary.
- `search_discussions` zero-hit results and bare-name errors waste calls, which drives longer, less focused answers on some questions (hist-a-09, hist-a-14 "ran out of the ten search calls"). This is an efficiency problem rather than a precision one.

## Recommended fixes, smallest first

1. **Prompt: fix the repository example** in `historyCommon`: write `"repo": "<repository-name>"` and `"path": "<repository-name>/<path inside the repository>"`; remove the contradiction between "repo-relative path" and the product paragraph. Fixes the cause of hist-b-05, hist-c-01, hist-c-09.
2. **Parser: report, don't hide.** When `parseAnswer` drops a span whose path is not in the corpus, count it (the run record gets `droppedSpans`), and, if the first path segment is not a repository name but `<repo>/<path>` for exactly one repository in the Product matches, accept it. The count alone makes the next measurement honest. The accept-the-unique-match rule changes scoring of old runs, so keep it behind the rescoring of stored runs.
3. **Prompt: "list only the answering change and ticket" for why and when questions** (Causes 1 and 2).
4. **Tool: help the agent recover.** (a) `search_discussions` with more than two words and zero hits should say so in a `hint` field ("all words are required; try fewer or the title words") or, better, fall back to a ranked any-word search and flag it. (b) The "Repository not found" error from all tools could name the matching `github.com/openmrs/<name>` when the bare name matches exactly one repository, saving about four wasted calls per run (176 such errors in the new arm's 40 runs, 164 in the git arm's). The second part touches shipped core tools and needs a human decision (it changes behaviour with the flag off).
5. Do not widen `accepted.json` and do not edit the dataset.

A rerun of both arms after fixes 1 to 3 would measure the real effect; it needs a new spend approval (the Phase 2 cap of $5 has $3.69 used).

## Confidence and limits

- High: hist-b-05, hist-c-01, hist-c-09 causes (read from stored answers and parser behaviour); span share of the precision loss (recomputed with the real scorer).
- Medium: hist-a-09 (tool usability plus agent strategy; I did not replay the search against the data).
- Medium-high: hist-b-09 is noise.
- One run per cell and one model; a rerun could move any single question by about 0.5 or more.
