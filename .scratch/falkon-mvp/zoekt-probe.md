# S1: Zoekt upstream probe (D10)

Date: 2026-10-19. Branch `loop/s1`. Probe tree: a `git archive` copy of the tip plus `zoekt-probe.patch` (this worktree has no production edits).

## Recommendation: KEEP-UPSTREAM, with a 2-file patch

Upstream `sourcegraph/zoekt` at `0e68f41329d9c37f46942d4731495fa05b07882a` (2026-10-16) runs the whole engine. With `.scratch/falkon-mvp/zoekt-probe.patch` applied, `scripts/ops-smoke.sh` exits 0 and the golden diff against `tests/golden/expected.json` is empty (0 of 61 captured queries differ). Without the patch the probe fails, because upstream names an in-place clone after its directory (see Finding 3). Production code needs the patch before the Dockerfile switches. That is a gate 2 item.

## 1. Pins

| | Commit | Date | Go |
|---|---|---|---|
| Upstream (probe) | `0e68f41329d9c37f46942d4731495fa05b07882a` | 2026-10-16 | `go.mod`: `go 1.25.9`, `toolchain go1.26.5`; built with `golang:1.26-alpine` = go1.26.9 (digest `sha256:3082400e...87ade`, arm64) |
| Fork (today, `ZOEKT_REF`) | `b762b16dde4bee0eaae3faa56c7e195c8e2ad341` | 2026-10-08 | `go 1.26.0` |

The fork's merge base with upstream is `c3d4afa9` (2026-04-13). The fork is 31 commits ahead (mostly CVE bumps; the feature commits are `685a5d2f` tenant id in git-index, `cf456394` tenant header, `12a2f4ad` `-repo_id`) and 84 commits behind upstream. The fork's `index.go` lacks the upstream change "caller-supplied name wins over origin URL" and the `-meta` flag.

## 2. Feature diff (evidence)

| Question | Upstream `0e68f41` | Fork `b762b16` |
|---|---|---|
| `-shard_prefix_override` | Yes. `index/builder.go:189` `fs.StringVar(&o.ShardPrefixOverride, "shard_prefix_override", ...)`; prefix precedence at `builder.go:351`. Help output of the built binary lists it. | Yes, same line (`builder.go:187`). |
| `-tenant_id`, `-repo_id` | No. `cmd/zoekt-git-index/main.go` defines only `allow_missing_branches, submodules, branches, prefix, incremental, repo_cache, delta, delta_threshold, language_map, meta, cpu_profile` plus the shared builder flags. Built binary `-h` shows neither flag. | Yes. `cmd/zoekt-git-index/main.go:49-50`. |
| Other ways to set ids | `-meta file.json` (decodes into `RepositoryDescription`, so `ID`, `TenantID`, `Name`), or git config `zoekt.repoid` and `zoekt.tenantID` (`gitindex/index.go:322-325`). | Git config `zoekt.repoid` and `zoekt.tenantID` too (reviewer correction; the table previously listed only `zoekt.tenantID`). |
| gRPC `repository_id` and `tenant_id` | Present: `webserver.proto:227` `int64 tenant_id = 18;` and `:417` `uint32 repository_id = 8;`. `api_proto.go:46,76,440,483` map them. | Same fields. |
| gRPC `RepoIds` query | Present (`query_proto.go:31,81`; `query.go:248` `NewRepoIDs`). | Same. |
| Tenant enforcement | Off by default (`internal/tenant/enforcement.go`: only `"strict"` enforces), so ids 0 and tenant 0 are searchable. | Same code. |
| Proto in `packages/shared/proto` | `query.proto` is identical to upstream. `webserver.proto` differs from upstream HEAD by 35 diff lines, all additive on upstream's side: `SchedulingClass`/`scheduling_class = 17`, `files_skipped_due_to_cancellation = 21`, comment edits, and `trace = 13` becoming `reserved 13`. The repo's copy is byte-identical to the fork's file at the pin. | Identical. |

Wire compatibility of the proto difference: the engine's client is a subset (`packages/shared/src/zoekt.ts`, "wire shapes"). Proto3 ignores unknown response fields, and the client never sets `trace`. The golden run exercised the gRPC path end to end on upstream with no error.

## 3. How the engine uses the ids

| Place | Use | Needs the flag? |
|---|---|---|
| `packages/backend/src/zoekt.ts` `indexRepo` | Passes `-tenant_id 1 -repo_id <id>`, and `-shard_prefix_override 1_<id>` | The first two only; they are not read back anywhere (below) |
| `shardPrefix(repoId)` = `1_<id>`; `removeShards` deletes files starting `1_<id>_v` | Shard naming and deletion | No. This is the prefix override, which upstream supports. |
| `sync.ts` (`deleteKnowledge`, `removeOrphans`) and `index.ts` (post-index "row vanished" cleanup) | `removeShards(repo.id)` | No |
| `packages/shared/src/zoekt.ts`, `ir.ts`, `tools.ts`, `access.ts` | Search results are mapped to repos by the result's repository **name** (`f.repo`). Scope is a name filter: `qRepo(regex)` from `Scope.repoFilter` (`tools.ts:145`) and `qRepoSet(names)`. Nothing reads `repository_id` or `tenant_id` and nothing sends `RepoIds` (`grep -rniE 'repository_id\|repositoryId\|tenant_id\|RepoIds\|repo_ids'` over `packages/*/src` finds only the comment and the two flags). | No |

So the id flags only stamp ids into shard metadata that the engine never reads.

Finding 3 (the one real dependency). `connectors/genericGit.ts` `compileFile` says: "Read-only: no zoekt.* git config is written, so zoekt names the repo from origin itself". Local `file://` repos are indexed in place without `zoekt.name`. The fork derived the name from `remote.origin.url` (`fixtures.test/atlas`). Upstream (`gitindex/index.go:238-278`, "the caller-supplied name is a fallback for repos without zoekt.name") keeps the name `zoekt-git-index` computed from the directory, so the first probe run searched as repo `atlas`, not `fixtures.test/atlas`. The smoke `indexing` step could not pass (observed live: `/api/search` returned `"repo":"atlas"`). Fix (in the patch): pass the registry name through `-meta` JSON, which upstream keeps when the repo has no `zoekt.name`; repos with `zoekt.name` (connector-written) are unaffected.

## 4. Probe results

### 4.1 Smoke, on the probe image with the patch (`SMOKE_DOCKERFILE=docker/Dockerfile.zoekt-probe`)

```
PASS prerequisites / fixtures / cold-start
PASS searchable-atlas, -ledger, -worker, -archive / indexing / oversized-file
PASS golden-baseline        (diff against tests/golden/expected.json is empty)
PASS golden-stability / resync / delete-repo
falkon-smoke-88081-backend-1 261.2MiB   postgres 75.56MiB   redis 14.44MiB   web 141.3MiB   zoekt 61.39MiB
PASS memory: whole clone stack 580.80 MB; ceiling 654 MB (545 MB +20%)
PASS teardown   EXIT 0
```

Golden: 0 differing queries out of 61 (50 search queries and 11 equivalent MCP grep calls), so no differences to classify. The `visibility:private` and metadata-filter results match the recorded baseline too.

### 4.2 Control: fork stack, same script and same checkout

`PASS golden-baseline` (empty diff), all steps PASS, EXIT 0. Memory: backend 226.5, postgres 75.37, redis 14.66, web 150.2, zoekt 30.61 MiB; `PASS memory: whole clone stack 521.50 MB`.

### 4.3 Memory

| Stack | Total | vs 654 MB ceiling |
|---|---|---|
| Fork | 521.50 MB | 132 MB under |
| Upstream + patch | 580.80 MB | 73 MB under (+59 MB vs fork) |

The increase is mostly zoekt (61 vs 31 MiB) and the backend (261 vs 227 MiB). Each figure is one `docker stats` sample after the full flow. I did not rerun to measure noise, so whether the +59 MB is systematic is not established. Upstream is newer (84 commits, a different `cat-file` default), so a real small increase is plausible. Headroom is 73 MB, which is thin for the later slices (graph tables in Postgres, SCIP ingest). Treat memory as a watch item at S7.

### 4.4 Id-dependent behaviours (throwaway containers running the probe image's binaries and the fork binaries, same script `exp.sh`, 3 repos, 1 big repo for shard churn)

| Behaviour | Upstream + `-meta`, no id flags | Fork + id flags |
|---|---|---|
| Shard names with `-shard_prefix_override 1_<id>` | `1_1_v16.00000.zoekt`, `1_2_...`, `1_3_...` | identical |
| Resync (new commit, same prefix) replaces in place; no extra files; new text searchable | yes | yes |
| Shrinking repo (6 shards to 1): old shards of the same prefix removed by the indexer ("removing old shard file ...") | yes, `1_9_*` 6 files to 1 | yes |
| Delete: `rm 1_2_v*` makes the repo vanish from `/api/list` and from search within seconds, others unaffected | yes | yes |
| Two repos with the same basename (`h.test/a/atlas`, `h.test/b/atlas`): hits carry distinct full names; `r:^h.test/b/atlas$` selects only one | yes | yes |
| `RepositoryID` / `TenantID` in results and list | **0 / 0** (not stamped) | 1..n / 1 |
| `RepoIds` gRPC filter | cannot discriminate (all ids are 0), but the engine never sends it | works, unused |

Lost: only the stamping of `repository_id` and `tenant_id`. No engine behaviour depends on it, and the Product scope filter is enforceable by name: `Scope.repoFilter` becomes `qRepo` (anchored regex over exact names) and `repo_set` accepts exact names; the golden set's `repos` field becomes `reposet:` only and the smoke provisions no restricted key, so the golden set exercises name matching (the separate `repo:` queries) but NOT the server-injected `Scope.repoFilter` or Product isolation. Those are verified in S4, not here.

Recovery if a later slice wants ids anyway (not needed by D6, which is name-based):
- Repos without `zoekt.*` git config: add `"ID": <repoId>, "TenantID": 1` to the `-meta` JSON. Verified: `D meta with ids` returned `ID 7, Tenant 1`. **Caveat (reviewer, upstream `gitindex/index.go:322-325`):** after the origin URL is processed, upstream overwrites the ids from git config, so this only survives when origin processing fails early. The fixture's `h.test` origin hits the "unknown git hosting site" error before those assignments, which indexing logs and ignores; a repo with a recognised host would not keep JSON ids. The guarantee is therefore not general: recover ids through git config (`zoekt.repoid`, `zoekt.tenantID`) for every repo, and treat the `-meta` route as unreliable.
- Repos with `zoekt.name` (connector-written config): `-meta` ids are zeroed (verified `E`: ID 0), so also write `zoekt.repoid` and `zoekt.tenantID` git config, which is verified to work (`B`: ID 7, Tenant 1). That is a write into the clone's config, which `connectors` already do for cloned repos but never for read-only in-place paths, where `-meta` alone suffices.

## 5. The patch

`.scratch/falkon-mvp/zoekt-probe.patch`: 2 files, 24 lines changed.
- `packages/backend/src/zoekt.ts`: `indexRepo(repoId, name, gitDir, ...)` writes `{"Name": name}` to a temp `-meta` file (removed in `finally`); drops `-tenant_id` and `-repo_id`; comment on `TENANT_ID` updated (it stays: it is part of the shard prefix, so existing shard files keep their names).
- `packages/backend/src/index.ts`: the two callers pass `repo.name`.

`git apply --check` passes on this worktree. `pnpm --filter @sbc/backend exec tsc --noEmit` passes on the patched tree. `packages/backend` has no unit tests of `indexRepo`; add one at gate 2 (argument list contains `-meta`, not `-tenant_id`/`-repo_id`).

Not tested: loading shards written by the fork's binary with upstream's webserver (both are index format v16, so an in-place switch should read existing shards; the safe path is a full reindex, which the engine does on first start with an empty index anyway). The live ops flow did not exercise GitHub-connector repos (cloned, `zoekt.name` set); the container probe covered the `zoekt.name` path (`B`).

## 6. Licensing and reproducibility

- Upstream is Apache-2.0 (`LICENSE` at the repo root; there is no `NOTICE` file, so §4(d) has nothing to carry). Redistributing the binaries inside the image requires including a copy of the license and keeping upstream copyright notices. Add `COPY` of the Apache-2.0 text into the image (for example `/usr/share/licenses/zoekt/LICENSE`) and a "Zoekt" attribution line in the README at S13/S15. If we later fork, the same applies plus a modification notice.
- Reproducibility: pin the commit (`ZOEKT_REF` build arg in `docker/Dockerfile.zoekt-probe`) and pin the Go image by digest or exact tag (today `golang:1.26-alpine` floats; `go.mod` asks for toolchain go1.26.5 and the image supplied go1.26.9). `git clone` + `checkout <sha>` is content-addressed. Go module downloads go through the Go proxy and `go.sum`.
- Staying current: upstream moves quickly (84 commits since the fork's base). Re-run `ops-smoke.sh` with the probe Dockerfile on each bump.

## 7. Side findings in S0's smoke script (fixed, in scope)

`scripts/ops-smoke.sh` could not cold start under Docker Compose v2.40: `zoekt` and `web` reuse the backend's locally built image name, and `up --build` tried to pull it (`pull access denied for falkon-smoke-app`). The fix adds `pull_policy: 'never'` to the shared service template. Without it S0's script never passed on a real daemon. `SMOKE_DOCKERFILE` (default `docker/Dockerfile`) is the opt-in. The script's unit test (`opsSmoke.test.ts`, 4 tests) still passes.

## 8. Teardown

Removed: compose projects (by the script's own trap), images `falkon-smoke-app`, `zp-fork-zoekt`, `golang:1.26-alpine`, throwaway containers (all `--rm`). After: 3 containers (`falcon-sourcebot*`), 22 volumes, 11 images, networks bridge/host/none/`falcon-sourcebot_default`, the same as before. BuildKit layer cache from the builds remains (not pruned, by instruction).
