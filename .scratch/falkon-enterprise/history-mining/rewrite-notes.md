# Round 1 rewrite of kinds (a) and (b) (D100)

Why: the cycle 12 Haiku pilot scored `clone-tools-git` at 0.861 (too easy). Confirmed against the shipped tools: `list_commits` takes `path`, `query` (a `--grep` over the whole message), `since`/`until`, and returns each commit's subject and body; `get_diff` takes `base`, `head` and an optional `path`. Every (a) question named the file or class, so `list_commits path=<file>` listed the target among a handful of commits, its subject carrying the ticket key; every (b) question's gold was exactly `list_commits path=<file> since=<date>`, so one call returned the answer.

Kind (c) (12 questions) is unchanged. Ids, kinds, splits (a 10/6, b 7/5), vocab tags, author and relations are unchanged.

## Kind (a): same target changes, new text

Each question now names only the symptom or rationale (from the same Jira or PR sentence as before, D98) and the repository or product area: no path, file extension, class, method, ticket, PR or SHA. `validate.mjs` now also rejects a `/`, a file-extension token, and any CamelCase token that occurs in the change's diff or its changed files at the pin. I also removed single content words that the question shared with the commit subject where a synonym kept the symptom clear (for example slash to path separator, garbage collection to the JVM reclaiming memory, height-for-age girls to stature against age for female children), so a `list_commits query=<word>` on the subject is less direct. No target change was swapped: each symptom is still distinctive enough to find the code by search.

| id | target (unchanged) | dropped from the old text |
|---|---|---|
| hist-a-01 | openmrs-core `2d32d209` #6680 TRUNK-6826 | `web.xml`, `/` |
| hist-a-02 | openmrs-core `085d24ca` #6673 TRUNK-6824 | `/openmrs//ws/rest/v1/session` |
| hist-a-03 | openmrs-core `83411b2f` #6654 TRUNK-6819 | `startBackgroundJobServer`, JobRunr |
| hist-a-04 | openmrs-core `b64e0729` #6651 TRUNK-6818 | `Context.closeSession()` |
| hist-a-05 | openmrs-core `b147e0dc` #6444 TRUNK-6684 | `childLocations`, `Location` |
| hist-a-06 | openmrs-core `6e77bfd0` #6494 TRUNK-6697 | `HandlerUtil`, `ConcurrentHashMap` |
| hist-a-07 | openmrs-core `e2056c9a` #6488 TRUNK-6784 | `LoggingAdvice.invoke()` |
| hist-a-08 | openmrs-core `0e0255b8` #6637 TRUNK-6827 | `ChainingInterceptor`, persist/remove callback names |
| hist-a-09 | openmrs-module-webservices.rest `ce758bc0` #768 RESTWS-1053 | `AuthorizationFilter`, `/ws/rest/v1/session`, the "Session timed out" message |
| hist-a-10 | openmrs-module-webservices.rest `66d284b5` #767 RESTWS-1056 | `BaseRestController` |
| hist-a-11 | openmrs-esm-core `57315b89` #1888 O3-5981 | esm-error-handling package name |
| hist-a-12 | openmrs-esm-patient-chart `50773fe3` #3626 O3-5957 | `getMuacColorCode`, MUAC |
| hist-a-13 | openmrs-esm-patient-chart `c7d6eb8d` #3657 O3-5976 | `FeWrapperComponent`, locale import wording |
| hist-a-14 | openmrs-esm-patient-management `b4b76423` #2780 O3-5916 | form manager, "retry" wording shared with the subject |
| hist-a-15 | openmrs-esm-form-engine-lib `129c1f7f` #834 O3-6045 | `hfa_girls_5_above.json`, WHO girls height-for-age wording |
| hist-a-16 | openmrs-esm-billing-app `3ecce2a5` #743 O3-5705 | invoice/balance wording shared with the subject |

## Kind (b): new anchors and criteria

Gold is now computed by a stated criterion over the window from the day after the pin's committer date minus six months (`mine_b.window`), recomputed by `validate.mjs`, with at least 4 change units, and the anchor has at least 2 more first-parent commits than the gold (most have many more), so listing the anchor's commits is not the answer: the agent has to read each candidate's diff. Two criteria (`mine_b.py` mined the candidates into `b-candidates.json`):

- pickaxe: the first-parent commits whose diff adds or removes a line containing an identifier under a directory (`git log --first-parent --since=S -G<identifier> PIN -- DIR`); 11 questions.
- decl: the first-parent commits that changed the lines of one function as it stands at the pin (`git log --first-parent -L<start>,<end>:<file>`); the question names the function and where it lives, not the file; 1 question (hist-b-07). Functions changed by 4 or more PRs in six months are rare in this corpus, so pickaxe carries the rest.

Repositories moved from dispensing to patient management for hist-b-11 (no dispensing directory had a criterion with 4 or more changes and enough noise); `openmrs-esm-dispensing-app` therefore left the dataset's corpus commit list.

| id | old anchor (gold) | new anchor and criterion | gold / anchor commits |
|---|---|---|---|
| hist-b-01 | openmrs-core `api/src/main/java/org/openmrs/api/db/hibernate/HibernateConceptDAO.java` (4) | openmrs-core `-GhasPrivilege` under `api/src/main/java/org/openmrs` since 2026-04-14 | 7 / 73 |
| hist-b-02 | openmrs-core `api/src/main/java/org/openmrs/Location.java` (3) | openmrs-core `-GThreadLocal` under `api/src/main/java/org/openmrs/api` since 2026-04-14 | 4 / 44 |
| hist-b-03 | openmrs-core `api/src/main/java/org/openmrs/api/context/ServiceContext.java` (4) | openmrs-core `-GCriteriaBuilder` under `api/src/main/java/org/openmrs/api/db/hibernate` since 2026-04-14 | 5 / 22 |
| hist-b-04 | openmrs-core `api/src/main/java/org/openmrs/api/cache/RolePrivilegeCache.java` (3) | openmrs-core `-GdoFilterInternal` under `web/src/main/java` since 2026-04-14 | 4 / 22 |
| hist-b-05 | openmrs-esm-core `packages/framework/esm-expression-evaluator/src/extractor.ts` (2) | openmrs-esm-core `-GgetExtensionConfig` under `packages/framework` since 2026-04-11 | 4 / 86 |
| hist-b-06 | openmrs-esm-core `packages/apps/esm-login-app/src/login.resource.ts` (2) | openmrs-esm-core `-GconfigUrls` under `packages/tooling/openmrs` since 2026-04-11 | 4 / 22 |
| hist-b-07 | openmrs-esm-patient-chart `packages/esm-patient-notes-app/src/notes/visit-notes.resource.ts` (3) | openmrs-esm-patient-chart `-L305,360` = `handleFormSubmission` in `packages/esm-patient-medications-app/src/add-drug-order/drug-order-form.component.tsx` since 2026-04-16 | 4 / 11 |
| hist-b-08 | openmrs-esm-form-engine-lib `src/utils/common-expression-helpers.ts` (3) | openmrs-esm-form-engine-lib `-GvoidedValue` under `src` since 2026-04-16 | 5 / 37 |
| hist-b-09 | openmrs-esm-billing-app `src/invoice/printable-invoice/printable-invoice.component.tsx` (3) | openmrs-esm-billing-app `-GlineItems` under `src` since 2026-04-16 | 7 / 28 |
| hist-b-10 | openmrs-esm-patient-management `packages/esm-patient-registration-app/src/patient-registration/field/address/address-field.component.tsx` (3) | openmrs-esm-patient-management `-GSavePatientTransactionManager` under `packages/esm-patient-registration-app/src` since 2026-04-16 | 5 / 24 |
| hist-b-11 | openmrs-esm-dispensing-app `src/forms/dispense-form.workspace.tsx` (2) | openmrs-esm-patient-management `-GencounterProviders` under `packages/esm-service-queues-app` since 2026-04-16 | 4 / 94 |
| hist-b-12 | openmrs-esm-stock-management-app `src/stock-reports/stock-reports.resource.ts` (2) | openmrs-esm-stock-management-app `-GrestBaseUrl` under `src` since 2026-04-14 | 6 / 16 |

## Records

`build.py` holds the new texts and the (b) rows; `questions.json` and `tests/eval/datasets/o3-history.json` are regenerated from it; `validate-output.txt` is the `--live` run. `spotcheck.md` is a new list (hist-a-10, hist-b-04, hist-b-09, hist-c-07). `pilot-ids.json` is unchanged in content: `pilotIds` hashes ids and relations, which the rewrite kept, so the re-pilot runs hist-a-03, hist-a-14, hist-b-01, hist-b-08 (all rewritten) and hist-c-03, hist-c-06 (unchanged).

## Round 2: retarget kind (a) (D100, option i)

Why: the round 1 re-pilot still scored `clone-tools-git` at 0.897. On both pilot (a) questions Haiku found the code by symptom, then one `list_commits path=...` returned the target commit, whose subject carried the ticket key and PR number, so every gold unit came from git. The human chose option i: retarget all 16 kind (a) questions at changes whose full commit message (subject and body) names no Jira key, so the ticket, and the rationale, live only in the PR or in Jira. Gold stays one ticket unit plus the change unit(s); the PR number stays findable from the squash subject's `(#N)`, as in real history.

Kinds (b) and (c) are unchanged (b keeps its round 1 texts, c its originals). Ids, splits, relation `history-why`, vocab `natural` and author are unchanged, so `pilotIds` selects the same six ids.

Mining (`mine_a2.py`, output `a2-candidates.json`): for each corpus repository except the docs site, every first-parent commit since the D96 window start (`mine_b.window`) whose subject ends in `(#N)` and matches that PR's merge commit (one `gh pr list --state merged --search merged:>=<window>` per repository, cached in `cache/prlist/`), whose message has no `[A-Z][A-Z0-9]+-\d+` match (nor a spaced key such as "O3 5921"), and whose subject is not a translation, bump or release. The key comes from the PR title, body or branch (one TRUNK, RESTWS or O3 key, or the one in the title or branch when the body names several) or, when the PR names none, from the single Jira issue whose description or comments name the PR's URL (anonymous Jira text search, cached in `cache/jiralink/`). A key that any commit reachable from any of the 42 pins names is dropped, since git would recover it. Counts: 3,239 first-parent commits in the windows; 29 passed the mechanical filters (core 2, esm-core 4, patient chart 9, admin tools 1, billing app 3, dispensing 1, form engine 1, patient management 3, stock management 2, billing module 1, patient documents 2; none in webservices.rest or the other modules). I read each and dropped the ones whose ticket is not the change's own: the PR says the ticket is a different fix (TRUNK-6645), a follow-up (O3-6103, O3-5966), prior art (O3-5631) or absent ("No Jira ticket", O3-5378); or the ticket is about another module (O3-5750), a different bug (O3-4422, O3-4115), or a second high-severity dependency patch with an empty ticket (O3-5779). Two tickets each cover two PRs that answer one question together (O3-5112, O3-5741), so those questions carry two change units. That leaves exactly 16, over 10 repositories.

`build.py` rows for kind (a) now carry the ticket explicitly; it asserts the message has no key, the source sentence is in the Jira description or a PR body, and the key is in the PR title, body or branch or in `cache/jiralink`. `validate.mjs` adds, for every (a) question: (i) `git log -1 --format=%B` of each gold commit has no Jira-key pattern; (ii) no commit reachable from any of the 42 corpus pins has a message naming the gold ticket (stricter than the first-parent window: all history, all repositories); (iii) the key is in the cached PR title or body, the PR's branch, or (with `--live`, re-read from Jira's description, comments and remote links; otherwise from `cache/jiralink`) a Jira issue naming the PR URL; (iv) all round 1 checks still run.

Texts follow the round 1 rules (no path, extension, class or method, PR, ticket, SHA, CamelCase token from the changed files, or 4-word run shared with any gold subject) and are phrased from the Jira or PR sentence recorded in `questions.json` (`source`, `sourceFrom`); each change in the record carries `commitMessageHasKey: false` and `keyIn`.

| id | round 1 target | round 2 target | key found in | source | note |
|---|---|---|---|---|---|
| hist-a-01 | openmrs-core `2d32d209` #6680 TRUNK-6826 | openmrs-core `8ec94d21` #6210 TRUNK-6670 | pr body, pr branch, pr title | jira | CI workflow; Jira states the fork-secret cause |
| hist-a-02 | openmrs-core `085d24ca` #6673 TRUNK-6824 | esm-core `e16e2d9e` #1754 O3-5629 | pr body | jira | test-only change; Jira states the two paths and why coverage was wanted |
| hist-a-03 | openmrs-core `83411b2f` #6654 TRUNK-6819 | esm-billing-app `db22701b` #717 O3-5414 | jira issue text names the PR URL | jira | subject says "delete", ticket says "void" bills for abandoned visits |
| hist-a-04 | openmrs-core `b64e0729` #6651 TRUNK-6818 | esm-core `04f538d1` #1853 O3-5873 | pr branch | jira | key only in the PR branch; see caveat on the changeset file |
| hist-a-05 | openmrs-core `b147e0dc` #6444 TRUNK-6684 | esm-patient-chart `6e8da1b1` #3412 O3-5652 | pr body | jira | PR names the ticket as its parent task; rationale from Jira |
| hist-a-06 | openmrs-core `6e77bfd0` #6494 TRUNK-6697 | esm-core `9f0c6aa8` #1815 O3-4671 | jira issue text names the PR URL | jira | key only in Jira (O3-4671 names the PR); subject wording differs from the ticket |
| hist-a-07 | openmrs-core `e2056c9a` #6488 TRUNK-6784 | esm-dispensing-app `120d22e9` #854 O3-5734 | pr body, pr title | jira | symptom from the Jira steps to reproduce |
| hist-a-08 | openmrs-core `0e0255b8` #6637 TRUNK-6827 | esm-admin-tools `fbda0303` #358 O3-5965 | pr body, pr title | jira | O3-5965 also covers stock management PR #636, which this question (reports app only) does not ask about |
| hist-a-09 | webservices.rest `ce758bc0` #768 RESTWS-1053 | esm-patient-management `e4aacbd5` #2638 O3-5832 | pr body | pr | PR body says the ticket was opened for the underlying service worker cost; this PR is the quick fix |
| hist-a-10 | webservices.rest `66d284b5` #767 RESTWS-1056 | esm-stock-management-app `3c071999` #567 O3-4518 | pr body, pr branch, pr title | jira | subject is the unrelated "(chore) Update OpenMRS dependencies (#566)"; see caveat on the code comment |
| hist-a-11 | esm-core `57315b89` #1888 O3-5981 | esm-patient-chart `d47d346c` #3374 RESTWS-1038 | jira issue text names the PR URL | jira | key only in Jira: RESTWS-1038 (REST side, open) names this PR as the frontend fix |
| hist-a-12 | esm-patient-chart `50773fe3` #3626 O3-5957 | esm-patient-chart `d4857fbf` #3238 O3-4585 | pr body | pr | PR names the ticket as the parent reference-range work |
| hist-a-13 | esm-patient-chart `c7d6eb8d` #3657 O3-5976 | esm-billing-app `6e4cdcd9` #831 + module-billing `c47f6d87` #193 O3-5112 | jira issue text names the PR URL | jira | two change units (frontend and backend), key only in Jira, which names both PRs |
| hist-a-14 | esm-patient-management `b4b76423` #2780 O3-5916 | esm-patient-chart `64d3c990` #3403 + esm-patient-chart `b147fb59` #3406 O3-5741 | jira issue text names the PR URL | pr | two change units; key only in Jira, whose comment explains the decision and names both PRs |
| hist-a-15 | esm-form-engine-lib `129c1f7f` #834 O3-6045 | module-patientdocuments `9fc46c2c` #31 O3-5667 | pr body | pr | O3-5667 is the parent ticket; sibling PR #32 changes section order and does not answer this question |
| hist-a-16 | esm-billing-app `3ecce2a5` #743 O3-5705 | esm-patient-chart `5ba5b70a` #3433 O3-5781 | pr body, pr title | pr | lockfile-only change; Jira has no description, rationale from the PR body (the commit body repeats it, without the key) |

Caveat, found after authoring: at the pin two gold keys are in the source tree, not in git history, so code search alone (either arm) can read them. hist-a-04: `openmrs-esm-core/.changeset/mf-runtime-shipped-once.md` names O3-5873. hist-a-10: a comment in the stock management app's user role scope workspace names O3-4518. No other (a) key occurs in any file at any pin (`git grep` over the 42 pins). Left in, flagged for the human: swap them out (the only remaining candidate with its own ticket is O3-5779, which I judged weak) or accept that these two questions test code search for the ticket.
