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
