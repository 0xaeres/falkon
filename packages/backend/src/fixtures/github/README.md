# GitHub fixtures

Raw responses recorded on 2026-10-24 by `scripts/record-github-fixtures.sh`, read-only, with the operator's `gh` login. Public repositories only. Re-run the script to refresh them.

| File | Request | Date |
|---|---|---|
| `dataentrystatistics-issues.json` | `GET /repos/openmrs/openmrs-module-dataentrystatistics/issues?state=all&sort=updated&direction=asc&since=2017-01-01T00:00:00Z&per_page=100` | 2026-10-24 |
| `dataentrystatistics-probe.json` | `GET /repos/openmrs/openmrs-module-dataentrystatistics/pulls?per_page=1` | 2026-10-24 |
| `keycloak-smart-auth-issues.json` | `GET /repos/openmrs/openmrs-contrib-keycloak-smart-auth/issues?state=all&sort=updated&direction=asc&since=2017-01-01T00:00:00Z&per_page=100` | 2026-10-24 |
| `keycloak-smart-auth-probe.json` | `GET /repos/openmrs/openmrs-contrib-keycloak-smart-auth/pulls?per_page=1` | 2026-10-24 |
| `dataentrystatistics-pulls.json` | `POST /graphql (repo openmrs/openmrs-module-dataentrystatistics, detail query, see the script)` | 2026-10-24 |
| `keycloak-smart-auth-pulls.json` | `POST /graphql (repo openmrs/openmrs-contrib-keycloak-smart-auth, detail query, see the script)` | 2026-10-24 |
| `openmrs-core-pulls.json` | `POST /graphql (repo openmrs/openmrs-core, detail query, see the script)` | 2026-10-24 |
| `querystore-issues.json` | `GET /repos/openmrs/openmrs-module-querystore/issues?state=all&sort=updated&direction=asc&since=2017-01-01T00:00:00Z&per_page=100` | 2026-10-24 |
| `dataentrystatistics-commit-pulls.json` | `GET /repos/openmrs/openmrs-module-dataentrystatistics/commits/bd64dafb4351de34629e3d2d343a29196e168dae/pulls` | 2026-10-24 |
| `rate-limit.json` | `the x-ratelimit-* headers of each REST request above, and each GraphQL data.rateLimit` | 2026-10-24 |

## Cases

- `querystore-issues.json`: the issues listing page of another openmrs repository (the two fixture repositories have issues disabled, so every item there is a pull request), 99 items: 66 issues and 33 pull requests; items with a `pull_request` key are pull requests.
- `dataentrystatistics-issues.json`, `keycloak-smart-auth-issues.json`: the issues listing page of each fixture repository; every item is a pull request.
- `dataentrystatistics-probe.json`, `keycloak-smart-auth-probe.json`: the permission probe (`GET pulls?per_page=1`). The dataentrystatistics probe is `[]` because that repository has no open pull request, the default listing state.
- `dataentrystatistics-pulls.json`: pull requests 2, 3 and 10. 2 is rebase-merged (its merge commit has one parent and the headline of its last commit, no `(#N)`) and has no body (`""`). 3 is closed, unmerged, with no body. 10 is merged through a merge commit (two parents).
- `keycloak-smart-auth-pulls.json`: pull requests 2 and 14 (squash merges, `(#N)` in the subject; 14 has 11 reviews), 3 (closed, no body, no commits) and 21 (open).
- `openmrs-core-pulls.json`: pull request 2712 with more than 100 comments (106 on REST; the first page of 100 is kept, `hasNextPage` true), and 294 whose author is deleted (`author: null`, closed and unmerged).
- `dataentrystatistics-commit-pulls.json`: `commits/bd64dafb4351de34629e3d2d343a29196e168dae/pulls` for the rebase-merged pull request 2.
- `rate-limit.json`: `x-ratelimit-*` headers of each REST request and the GraphQL `rateLimit` block of each GraphQL response.

## Scrubbing

Every file is passed through a scrub that blanks email addresses (`[email removed]`), token-like strings (`[token removed]`) and the auth-header word in any case (`[word removed]`; one keycloak pull request body uses it in prose, so it is blanked to keep the S51 grep check clean). No allowlist. The README lists no exceptions because no noreply form remains. The S51 grep check (token prefixes, the auth-header word, email shape) over this directory finds nothing.

Not recorded: a pull request whose head repository was deleted (not searched for in this run).
