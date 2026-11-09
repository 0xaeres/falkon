# Choose any branch of a repository when setting up a Product

Goal: in /setup (create and edit), the branch dropdown for each chosen repository lists every branch of that repository on the code host, and the chosen branch is the one Falkon tracks for that repository: search, file reads, history, knowledge base and provenance all follow it. Today the UI sends a branch per repository, the API drops it, and the dropdown only offers the default branch.

Base: `main`. Cycle branch `loop/branch-select`.

## Decisions (grill, 2026-11-08)

- Z1. The chosen branch is the repository's one tracked branch, not an extra branch beside the default (human choice).
- Z2. One tracked branch per repository for the whole engine (human choice, after seeing that per-Product branches would touch search scope, git reads, the knowledge base, provenance and graph). A second Product on the same connection that picks a different branch for a repository an existing Product already holds is refused with 409 `BRANCH_CONFLICT` and a message naming the repository and the branch in use. A Product whose own edit changes the branch of a repository no other Product holds is allowed.
- Z3. Mechanism: the backend points the bare clone's `HEAD` at the chosen branch after every clone or fetch (today `cloneOrFetch` re-points it at the remote default each time). Everything that already reads `HEAD` (zoekt's `HEAD` branch, `headCommit`, git readers, knowledge-base scans, provenance's default-branch check, `Repo.defaultBranch` after indexing) then follows with no other change. No new column and no schema change.
- Z4. Storage: `Product.definition.branches` maps repository id (`host/org/repo`) to branch (only entries that differ from nothing are stored; absent means the code host's default). `writeUnion` writes the union into the connection config as `repoBranches` keyed by the exact repo name `org/repo`, the way it already writes `repos`. The backend reads `repoBranches`, and the GitHub record carries it in `Repo.metadata.trackedBranch`.
- Z5. Branch list comes from the code host live, one call per repository, only when the user opens that repository's dropdown (never for the whole listing: that would be up to 300 calls). Default branch first, then newest push first as GitHub returns them, at most 3 pages of 100 (300 branches); if more exist the dropdown says the list is cut.
- Z6. The API does not validate the chosen branch against the host on save (no per-save remote calls). If the branch no longer exists when the backend fetches, the repository is marked FAILED with a message naming the branch, `HEAD` is left where it was, and the existing index keeps serving.
- Z7. Only GitHub connections have a setup flow, so only the GitHub connector changes. The plain-git connector, `revisions` globs and the Repository contract's `branches` field (default branch only) stay as they are.
- Z8. Agents: Claude only. Sonnet builds and reviews. No slice is `hard`.

## Verify commands (all slices)

`pnpm typecheck` and `pnpm test` from the repository root, plus the slice's own focused tests. The opsSmoke tests in `packages/shared` time out under load: rerun once if only they fail.

## Slices

### B1. Backend tracks the chosen branch
- Goal: a repository whose GitHub record carries `metadata.trackedBranch` is indexed with `HEAD` pointing at that branch; the first zoekt revision, `headCommit` and `Repo.defaultBranch` are that branch. Connection config key `repoBranches` (`org/repo` to branch) flows into the record's metadata. A repo with no entry behaves exactly as today.
- Done: a test over a real temporary bare repo with branches `main` and `release` shows: with `trackedBranch = "release"`, after `cloneOrFetch` `HEAD` is `refs/heads/release` and stays so after a second fetch (today's code would reset it); changing the tracked branch re-points `HEAD`; with no entry `HEAD` is the remote default; a missing branch makes the index job record FAILED with a message containing the branch name and leaves `HEAD` unchanged. A `githubRecord` test shows `repoBranches` becoming `metadata.trackedBranch`. `pnpm test` green.
- Scope: `apps/backend/src/{git,index,sync}.ts`, `apps/backend/src/connectors/{github,types}.ts`, `packages/shared/src/config.ts` (the connection config type only), and their tests.
- Adversarial cases: branch name with a slash (`feature/x`); branch deleted upstream (fetch `--prune` removes it); empty repository (no branches); tracked branch equal to the default; entry for a repo the connection no longer lists; a branch name that starts with `-` (git option injection: refuse it, never pass it as an option).
- Blocked by: none. Tier: standard. Agent: claude.

### B2. API lists branches and saves the choice
- Goal: `GET /connections/:id/repositories/:org/:name/branches` returns the repository's branches (Z5). `POST /ui/products` and the edit route keep each chosen repository's branch in `Product.definition.branches`, write `repoBranches` into the connection config through `writeUnion`, and refuse a clash (Z2). `toUiProduct` reports the saved branch as `branch` even before the first index.
- Done: tests with a fake `CodeHost` show: the branches route returns default first, caps at 300 and reports a cut list, maps a host 401 or outage to the existing connection error codes, and 404s a repository the connection does not list; create stores and unions branches; a second Product choosing a different branch of the same repository gets 409 `BRANCH_CONFLICT`; the same Product re-saving, or two Products choosing the same branch, succeed; deleting a Product removes its branches from the union; `pnpm test` green.
- Scope: `apps/api/src/{connections,ui,uiProduct}.ts`, `apps/api/src/app.ts` or wherever routes are registered, `packages/contracts/src/index.ts` (request and branches response schemas), and their tests.
- Adversarial cases: branch string with control characters or over 100 characters (the existing schema bound applies and is tested); repository id not in the listing; request path does no host call for the products list or status routes (only the branches route calls the host, once per request); more than 3 pages of branches; concurrent saves keep the existing union caveat (comment already there).
- Blocked by: none (it and B1 meet only at the config key `repoBranches`, fixed in Z4). Tier: standard. Agent: claude.

### B3. UI dropdown and docs
- Goal: `BranchSelect` loads the repository's branches when opened (SWR, one request per repository, cached for the page), shows the current branch while loading and when the request fails (with a retry in the list), and notes a cut list. A branch conflict error from save appears in the wizard's error line in words. Edit mode shows the saved branch. ADR and `CONTEXT.md` (only if a definition names the default branch) get a dated amendment saying a Product's repository tracks one chosen branch, one per repository engine-wide.
- Done: component and wizard tests (mock fixtures updated) show: opening the dropdown calls the branches route once, lists default first, choosing a branch changes the payload sent by `api.setup` and `api.edit`; a failed load keeps the current value selectable; a 409 `BRANCH_CONFLICT` shows its message and keeps the user's choices; closed dropdowns make no branch request. `pnpm test` and `pnpm typecheck` green; ADR amended in place with the date, no new ADR file.
- Scope: `apps/ui/src/features/setup/**`, `apps/ui/src/lib/**` (api client and keys), `apps/ui/tests/mock-fixtures.ts` and ui tests, `docs/adr/0001-falkon-architecture.md`, `CONTEXT.md`.
- Blocked by: B2 (the contract and route). Tier: standard. Agent: claude.

## Autonomy limits

- The loop may decide alone: test structure, naming, copy wording, error message text, where the branches route is registered.
- It must stop for: any schema (Prisma) change, any new dependency, any change to eval data or scoring, a data-loss path, a change to the Repository contract's `branches` meaning, any push or pull request, any live run against GitHub.
- Budget: about 600,000 subagent tokens and 90 minutes wall-clock (three standard slices; the delete-flows cycle used about 800,000 for four).

## Analyze pass

Every slice has a scope, runnable verify commands and an observable done condition. Blocked-by edges: B1 and B2 free, B3 after B2. No cycle. Together they cover Z1 to Z7. B1 and B2 touch disjoint files (`apps/backend`, `packages/shared/src/config.ts` versus `apps/api`, `packages/contracts`), so they may run in parallel. The agent probe for Codex is skipped: earlier cycles recorded that the human dropped Codex for this project.

## Gate 1

Approved: 2026-11-08, all three slices, no changes.
