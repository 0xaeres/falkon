# S45 spot-check (D97): 4 hidden questions, 25% of the dataset

Round 2 rewrite (D100, option i): all 16 kind (a) targets were replaced, so the round 1 list is void for kind (a); hist-b-04 and hist-c-07 are unchanged and stay. Two kind (a), one kind (b), one kind (c), across five repositories. For each, open the sources and confirm the claim. Gold is what `tests/eval/datasets/o3-history.json` scores against; the mining record for every question is in `questions.json` next to this file.

## hist-a-13 (kind a, why it changed) - openmrs-esm-billing-app and openmrs-module-billing

Question: In O3 billing, the list of bills could only be narrowed by payment state, such as pending or paid, and not by when the bills were created. Which changes, one in the billing frontend and one in the billing backend module, made that possible, what does the frontend do when the chosen end comes before the chosen start, and which ticket asked for it?

Gold:
- change `openmrs-esm-billing-app` commit `6e4cdcd9db634a947b317df793d5b8170a9768e9`, PR #831
- change `openmrs-module-billing` commit `c47f6d87e0352dcfa5a51b5a743016e0a8c40be9`, PR #193
- ticket `O3-5112`

Sources:
- https://github.com/openmrs/openmrs-esm-billing-app/pull/831
- https://github.com/openmrs/openmrs-module-billing/pull/193
- https://openmrs.atlassian.net/browse/O3-5112

Claim to verify: O3-5112 says the billing list can only be filtered by status (pending, paid) and asks for start and end date filters; PR #193 (squash-merged as `c47f6d87`, 2026-09-03) adds the date bounds to the backend bill search and PR #831 (squash-merged as `6e4cdcd9`, 2026-09-17) adds the date range filter to the bills table and skips the fetch when the end date is before the start. Where the key appears: only in Jira; O3-5112's text names both PR URLs, and neither PR's title, body nor branch names it. Neither commit message names any Jira key (`git log -1 --format=%B` on each), and no commit reachable from any of the 42 corpus pins names O3-5112.

## hist-a-15 (kind a, why it changed) - openmrs-module-patientdocuments

Question: In the patient documents module, only superusers could produce the printable visit summary, even though the code checks a dedicated permission before generating it, because no role could ever be granted that permission. Why, and which change and ticket fixed it?

Gold:
- change `openmrs-module-patientdocuments` commit `9fc46c2cf8f6b7d3f2758379ac9b7af2d848b22a`, PR #31
- ticket `O3-5667`

Sources:
- https://github.com/openmrs/openmrs-module-patientdocuments/pull/31
- https://openmrs.atlassian.net/browse/O3-5667

Claim to verify: PR #31 (squash-merged as `9fc46c2c`, 2026-07-20) says the visit summary privilege was enforced in code but never declared in the module config, so no privilege row existed, it could not be granted, and visit summary PDFs were effectively superuser-only; it declares the privilege. Where the key appears: only in the PR body ("Part of https://openmrs.atlassian.net/browse/O3-5667"); the commit message (subject plus a co-author line) names no Jira key, and no commit reachable from any corpus pin names O3-5667. O3-5667 is the parent visit summary ticket; PR #32 in the same repository is also part of it but changes section ordering, so it does not answer this question.

## hist-b-04 (kind b, what changed and when) - openmrs-core

Question: In openmrs-core, which merged pull requests since 2026-04-14 added or removed a line containing `doFilterInternal` in any file under `web/src/main/java`, and when was each merged? Count only commits on the main line up to the pinned head.

Gold (change units):
- `2d32d20938e007f2f9bf8e3a3c946758d52d6bfe`, PR #6680, merged 2026-10-13 (TRUNK-6826: Request paths with a trailing slash find no handler on core 3.0)
- `085d24ca28913de746060914ba4c0305680c9321`, PR #6673, merged 2026-10-12 (TRUNK-6824: Request paths with a repeated slash fail with 500 on core 3.0)
- `a69b14a84bf925ff7cdf34e93ca1ffb4f257265f`, PR #6544, merged 2026-10-08 (TRUNK-6799 Introduce Spring Security with support for legacy authentication context)
- `1d0fb13892759020f6bc0824a097518d546024eb`, PR #6505, merged 2026-08-26 (TRUNK-6705: Reduce the overhead of the gzip filter)

Sources: https://github.com/openmrs/openmrs-core/pull/6680, https://github.com/openmrs/openmrs-core/pull/6673, https://github.com/openmrs/openmrs-core/pull/6544, https://github.com/openmrs/openmrs-core/pull/6505

Claim to verify: on the first-parent line up to the pin `5eb8cba2` (2026-10-13), `git log --first-parent --since=2026-04-14 -GdoFilterInternal 5eb8cba2 -- web/src/main/java` lists exactly these four squash-merged PRs (the two path-normalising filters, the Spring Security filter chain, and the gzip filter rework), out of 22 first-parent commits under that directory since 2026-04-14, and each PR's merge commit is the listed SHA.

## hist-c-07 (kind c, ticket to code) - openmrs-esm-core

Question: O3-6093: `extractVariableNames()` in the expression evaluator misses unbound variables used inside arrow-function bodies (for example `a.map(x => f(b))` yields only `a`). Which change fixed it, and which code in esm-core implements the fix?

Gold:
- change `openmrs-esm-core` commit `cd6cf1fcbdab85d05529d015dfb911dfef885b84`, PR #1943
- ticket `O3-6093`
- span `openmrs-esm-core/packages/framework/esm-expression-evaluator/src/extractor.ts` lines 92-119
- span `openmrs-esm-core/packages/framework/esm-expression-evaluator/src/extractor.ts` lines 151-173

Sources:
- https://github.com/openmrs/openmrs-esm-core/pull/1943
- https://openmrs.atlassian.net/browse/O3-6093
- https://github.com/openmrs/openmrs-esm-core/blob/7a172083f27035a8f20aa71fbc5e208ab07fa97a/packages/framework/esm-expression-evaluator/src/extractor.ts#L92-L173

Claim to verify: O3-6093 reports `extractVariableNames()` returning `["a"]` for `a.map(x => f(b))`; PR #1943 (merged 2026-10-10) fixes it in `extractor.ts`, and at the pin `7a172083` lines 92-119 and 151-173 are lines that PR wrote (git blame attributes them to `cd6cf1fc`) and that implement the arrow-function scope handling.
