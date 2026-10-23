# S45 spot-check (D97): 4 hidden questions, 25% of the dataset

Round 1 rewrite (D100): the previous list is void for the rewritten kinds; this list replaces it. One per repository, covering all three kinds (hist-c-07 is unchanged and stays on the list). For each, open the sources and confirm the claim. Gold is what `tests/eval/datasets/o3-history.json` scores against; the mining record for every question is in `questions.json` next to this file.

## hist-a-10 (kind a, why it changed) - openmrs-module-webservices.rest

Question: In the REST web services module, once core moved to Spring Security, requests refused for missing authentication or a missing privilege started coming back as HTTP 500 instead of 401 or 403. Why, and which change and ticket restored the expected status codes?

Gold:
- change `openmrs-module-webservices.rest` commit `66d284b5105a13d5221e103e0243711b69f2dac0`, PR #767
- ticket `RESTWS-1056`

Sources:
- https://github.com/openmrs/openmrs-module-webservices.rest/pull/767
- https://github.com/openmrs/openmrs-module-webservices.rest/commit/66d284b5105a13d5221e103e0243711b69f2dac0
- https://openmrs.atlassian.net/browse/RESTWS-1056

Claim to verify: RESTWS-1056 says that since TRUNK-6799 core denies a call lacking a privilege with Spring Security's access-denied exception, which the REST module's controller exception handling did not match, so such requests returned 500 instead of 401 or 403; PR #767 (squash-merged as `66d284b5`, 2026-10-14) handles it like the older authentication exception, and no other commit at the pin names RESTWS-1056. The question names no file, class, PR or ticket, so the agent has to find the exception handling first.

## hist-b-04 (kind b, what changed and when) - openmrs-core

Question: In openmrs-core, which merged pull requests since 2026-04-14 added or removed a line containing `doFilterInternal` in any file under `web/src/main/java`, and when was each merged? Count only commits on the main line up to the pinned head.

Gold (change units):
- `2d32d20938e007f2f9bf8e3a3c946758d52d6bfe`, PR #6680, merged 2026-10-13 (TRUNK-6826: Request paths with a trailing slash find no handler on core 3.0)
- `085d24ca28913de746060914ba4c0305680c9321`, PR #6673, merged 2026-10-12 (TRUNK-6824: Request paths with a repeated slash fail with 500 on core 3.0)
- `a69b14a84bf925ff7cdf34e93ca1ffb4f257265f`, PR #6544, merged 2026-10-08 (TRUNK-6799 Introduce Spring Security with support for legacy authentication context)
- `1d0fb13892759020f6bc0824a097518d546024eb`, PR #6505, merged 2026-08-26 (TRUNK-6705: Reduce the overhead of the gzip filter)

Sources: https://github.com/openmrs/openmrs-core/pull/6680, https://github.com/openmrs/openmrs-core/pull/6673, https://github.com/openmrs/openmrs-core/pull/6544, https://github.com/openmrs/openmrs-core/pull/6505

Claim to verify: on the first-parent line up to the pin `5eb8cba2` (2026-10-13), `git log --first-parent --since=2026-04-14 -GdoFilterInternal 5eb8cba2 -- web/src/main/java` lists exactly these four squash-merged PRs (the two path-normalising filters, the Spring Security filter chain, and the gzip filter rework), out of 22 first-parent commits under that directory since 2026-04-14, and each PR's merge commit is the listed SHA.

## hist-b-09 (kind b, what changed and when) - openmrs-esm-billing-app

Question: In openmrs-esm-billing-app, which merged pull requests since 2026-04-16 added or removed a line containing `lineItems` in any file under `src`, and when was each merged? Count only commits on the main line up to the pinned head.

Gold (change units):
- `c770afca8921295dd87d8e7c185a8a4fef231376`, PR #885, merged 2026-10-15 ((feat) O3-6112: Create bill / Add bill items workspace should show which patient is being billed in tablet mode)
- `6e4cdcd9db634a947b317df793d5b8170a9768e9`, PR #831, merged 2026-09-17 ((feat) Add date range filter to bills table)
- `e8126b39dc10bcdc719250b004afe86f7782f36a`, PR #738, merged 2026-06-04 ((feat) O3-5413: Add bill refunds)
- `4aa8e4c993d5fe06147c9561c949a6da36aea47e`, PR #741, merged 2026-06-02 ((feat) O3-5421: Add visit-bills panel showing visit-scoped bills in visit summary)
- `e5b80768f3166c82b2db7c710e166adf01ce3f70`, PR #744, merged 2026-05-25 ((fix) O3-5708: Keep discount review modal open after approve/reject/delete actions)
- `8ba8b18ae423df842acd93584f85cafa44577a02`, PR #733, merged 2026-05-20 ((chore) Update BillLineItem type)
- `5127b0c031addf584cc49f6252272121d50c5cad`, PR #732, merged 2026-05-18 ((feat) O3-5417: Add bill discounts feature)

Sources: https://github.com/openmrs/openmrs-esm-billing-app/pull/885, https://github.com/openmrs/openmrs-esm-billing-app/pull/831, https://github.com/openmrs/openmrs-esm-billing-app/pull/738, https://github.com/openmrs/openmrs-esm-billing-app/pull/741, https://github.com/openmrs/openmrs-esm-billing-app/pull/744, https://github.com/openmrs/openmrs-esm-billing-app/pull/733, https://github.com/openmrs/openmrs-esm-billing-app/pull/732

Claim to verify: on the first-parent line up to the pin `c770afca` (2026-10-15), `git log --first-parent --since=2026-04-16 -GlineItems c770afca -- src` lists exactly these seven squash-merged PRs, out of 28 first-parent commits under `src` since 2026-04-16, and each PR's merge commit is the listed SHA (the pin itself, PR #885, is one of them).

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
