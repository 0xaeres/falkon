# Falkon MVP: the clone becomes the Falkon core engine

Status: cycle 1 built and verified, waiting at gate 2 (2026-10-19). Base branch: `main` (equal to `parity-harness` at 64b045c).

## Goal

This repository becomes **Falkon**: a self-hosted code context engine that any MCP client can use without a Falkon-side LLM. The engine keeps what the clone already does (Zoekt search, bare git clones, resync, the MCP tools, Ask, the LLM-built knowledge base) and adds the capabilities in Falkon's specification (old repository `../falkon`, ADR-001, tag `falcon-pre-migration`): relate and trace, potential impact, and a deterministic overview map. Falkon's stack is adopted where it does not put the core at risk.

The old Falkon repository is a read-only donor for the ADR, glossary, SCIP and graph code, and the eval harness. Ported pieces keep their tests.

## Decisions (from the grill, 2026-10-18)

| # | Decision |
|---|---|
| D1 | The clone repository is the product, spelled **Falkon** everywhere. The old repository is archived as a donor. |
| D2 | Stack: keep Postgres, Prisma, Redis, BullMQ, Zoekt. Adopt NestJS (HTTP and MCP boundary only), Zod 4, ports and adapters, SCIP indexers (TypeScript and Java). Drop Chroma, embeddings, reranker, MiniSearch. No ArcadeDB: units, edges and coverage live in Postgres behind a `GraphStore` port. Next.js remains only as the UI. |
| D3 | Serving is LLM-free. The only LLM feature is knowledge base generation, **on by default**, using the operator's `LLM_*` environment. Without a model it is skipped with a visible status, never an error. A default `tokenBudget` caps each scan and the first scan logs its cost estimate. |
| D4 | MVP capabilities: locate and read (existing tools), relate, trace and potential impact over SCIP edges (TS and Java), overview as a deterministic map plus the existing KB docs. Deferred: why and history, effort, the semantic overlay, cross-repository HTTP links. |
| D5 | Delivery: self-hosted `docker compose`, GitHub and generic git connectors only, no SSO and no user model. |
| D6 | **No Falkon access keys.** Access control sits behind an `AccessPolicy` port: `auth.mode: none` is the default; the existing API key adapter stays in the tree behind `auth.mode: apiKey`, with its tests green, so keys can return. A Product is a named repo set in config; MCP is served at `/mcp/<product>` and the engine injects the repo filter server side. The engine binds to `127.0.0.1` by default; admin operations (KB scan, resync) run on a separate localhost-only listener. The GitHub token and `LLM_*` stay. |
| D7 | Core protection is behavioral and by design: contract tests first, new capabilities in new packages and additive tools, NestJS as the new boundary that delegates to the existing tool runners, the sync and Zoekt path untouched. |
| D8 | Every new capability must beat clone-only on its own question stratum before it ships (Falkon rule 3: recall CI lower bound of the difference at or above -0.05 and cost CI upper bound below 0, or recall lower bound above 0). A capability that fails stays behind a flag. Eval harness and datasets are ported to `tests/eval`. |
| D9 | No mention of "Sourcebot" anywhere. Scrub names, env (`SOURCEBOT_*`), the `X-Sourcebot-Api-Key` header, `/api/ee/*` paths, schema `$id`; give the config its own Falkon schema, with a one-time converter script for old files (no compatibility mode, no aliases). Rewrite all verbatim v6 text (Ask prompts, tool descriptions, KB prompts) originally; tool names and input schemas stay. Rename `@sbc/*` and DB names last, mechanically. |
| D10 | Zoekt: probe upstream `sourcegraph/zoekt` without the tenant and repo id flags first. If it passes, use upstream; otherwise fork under the owner's organisation. The Apache-2.0 attribution to the Zoekt lineage stays. |
| D11 | **No regression against v6.** A slice lands only if all four checks pass (see Regression gate). |

Planning files under `.scratch/` must name the old product to give scrub instructions. They are untracked from the shipped tree: S13 verifies `git ls-files` outside `.scratch/` has zero matches, and `.scratch/` is excluded from release artifacts.

## Regression gate (Q15)

1. **Tool contract.** The 11 MCP tools keep names, input schemas and output structure. Contract tests are recorded from the current clone (verified against v6.0.1 in the parity phase). Wording may change only for the descriptions the rewrite slice lists, reviewed by hand.
2. **Search behavior.** A golden query set over a fixture repo set (query syntax, `rev:`, `sym:`, `lang:`, pagination, `isSearchExhaustive`) returns identical results before and after.
3. **Ask quality.** Rule D25: the O3 stratum, dev and hidden pooled (n=80, paired per question id, seed 20261017), with v6.0.1 run on the same client model as the reference (the recorded Sonnet runs, dev 0.973 and hidden 0.923, for Sonnet). Passes when the lower 95% bootstrap bound of (arm minus reference) recall is at or above -0.10, losses are at most twice wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.
4. **Ops.** The compose stack comes up cold, indexes, resyncs on a push, and deletes a repo. Core memory is reported, not enforced, for 0.1.0 (D76, D78): `scripts/ops-smoke.sh` prints it as `INFO` against the reference of 545 MB +20% (654 MB) and fails only if it cannot measure all six services.

Anything v6 does that these checks do not cover is a named non-goal in this spec, not silent.

## Roles

Opus is architect and coordinator for the whole cycle (the main session stays on Opus; this is an exception to the usual switch to Sonnet at gate 1): it owns design, slicing, keep, fix and revert decisions. Codex `gpt-6.1-sol` at high reasoning effort (`-c model_reasoning_effort="high"`; human instruction 2026-10-18) implements all major work and `agent: codex` slices and reviews Claude-built ones read-only. Sonnet implements slices needing live Docker, API or LLM access (Codex's sandbox cannot). A Haiku verifier runs checks. The reviewer is always the other model family from the builder; Opus makes the final call.

## Operating rules learned from earlier cycles

- Probe real data and run the baseline arm on a small sample before any build or long run, even after gate 1.
- Fixtures miss real corpora: each slice that touches indexes or graphs gets a real-data review on the O3 or a fixture of comparable shape before paid runs.
- Security-sensitive wrappers are specified as allowlists of exact argument shapes from the first brief.
- Where a spec says "exactly", the brief names a test that fails when the text drifts.
- Wait on background commands by notification, never by `pgrep -f` on the command text.

## Cycle map

The loop stops after three kept slices, so the work spans cycles. Cycle 1 is the foundation and the two risk probes. Later cycles are sequenced here and re-confirmed at their own gate 1.

### Cycle 1 (this plan): foundation

**S0. Regression baseline and contract freeze.** Tier standard. Agent: codex for the unit contract tests; the live parts (golden queries, ops smoke) run by the verifier or the main session because they need Docker.
- Goal: record today's behavior so every later slice has something to fail against.
- Scope: new `tests/contract/` and `tests/golden/`, per-package `*.test.ts` additions, a fixture repo set under `tests/fixtures/`, `scripts/ops-smoke.sh`, `.scratch/falkon-mvp/baseline.md`. No production code changes.
- Done: contract tests pin the 11 tools' names, schemas, annotations, registration order and output text; the query translator and config loader have tests for every documented branch; the golden query set (at least 40 queries covering each filter, `or`, negation, regex toggle, pagination, exhaustiveness) is recorded as expected output from the running stack; `ops-smoke.sh` brings the stack up cold, indexes fixtures, pushes a commit, sees resync, deletes a repo and records memory; `baseline.md` records the v6.0.1 numbers (dev 0.973, hidden 0.923) and the pre-existing failures.
- Verify: `pnpm typecheck && pnpm test` green; `sh scripts/ops-smoke.sh` exits 0 and prints the golden diff as empty on a second run (stable).
- Blocked by: none.

**S1. Zoekt upstream probe.** Tier standard. Agent: claude (Docker).
- Goal: decide upstream versus own fork (D10) with evidence.
- Scope: `docker/` (a probe Dockerfile or build arg only), `.scratch/falkon-mvp/zoekt-probe.md`. No production indexing flags change unless the probe passes and the human is told at gate 2.
- Done: upstream Zoekt at a pinned commit indexes the fixture set without `-tenant_id`/`-repo_id` and the S0 golden set returns identical results (or the diff is listed and explained); shard naming and resync delete/replace behave; the report states keep-upstream or fork and why.
- Verify: the S0 golden runner against the probe stack, empty diff; `ops-smoke.sh` passes on it.
- Blocked by: S0 (needs the golden set).

**S2. Domain language and the single architecture record.** Tier hard (Opus). Agent: claude.
- Goal: carry Falkon's domain language and architecture into this repository so later slices share vocabulary and constraints.
- Scope: new `CONTEXT.md`, `docs/adr/0001-falkon-architecture.md` (single ADR, amended in place), `docs/agents/` stubs, `AGENTS.md`. Docs only, and the words "Sourcebot" and "Falcon" do not appear.
- Done: CONTEXT.md defines Product, productId, Repository, Declaration unit, Structural operation, Evidence packet, Potential impact, Access policy, Knowledge base, Map; the ADR records D2 to D11 with the rationale and the cycle 17/18 evidence summary, the `GraphStore` and `AccessPolicy` ports, the Postgres graph schema sketch, the SCIP freshness model (per-revision, replace on resync), non-goals, and risks. Every claim about the old repository points to a file there.
- Verify: `grep -ri 'sourcebot\|falcon'` over the new files returns nothing; Opus architecture review of the ADR against the old ADR sections 4.3, 4.4, 4.9, 4.10, 4.11.
- Blocked by: none.

Autonomy: the loop may decide alone test layout, fixture contents, probe parameters, doc wording. It must stop (gate 2) for: any change to production behavior, new dependency, any change to evaluation data or decision rules, ADR content that departs from D1 to D11, security-sensitive code, and any outward action (push, PR, publish).

Budget, cycle 1: 1.5M subagent tokens and 5 hours wall clock (recent cycles ran 0.4M to 1.7M tokens for three slices; S2 is Opus and doubled).

### Cycle 2: the new boundary and Product scoping

- S3. NestJS boundary, strangler: a Nest app serves `/mcp/<product>`; every S0 contract and golden test passes against it; old Next routes remain. Tier standard, agent codex, blocked by S0.
- S4. `AccessPolicy` port: `none` default, `apiKey` adapter kept and tested; Product config and server-side repo filter; localhost bind and the admin listener. Security-sensitive: allowlist-style specification, agent claude, blocked by S3. Tests prove a Product path cannot read, search, list or diff outside its repo set.
- S5. Eval harness port to `tests/eval` plus a clone-only arm and the v6 floor rerun (spend about $4). Agent claude, blocked by S0.

### Cycle 3: graph

- S6. `GraphStore` port, Postgres schema and migrations, structural operations (callers, callees, references, implementations, trace, impact) over fixture edges. Tier hard, blocked by S2 and S3.
- S7. SCIP ingestion job (BullMQ): scip-typescript and scip-java, declaration units, edges, coverage records, per-revision replace on resync. Agent claude, blocked by S6. Real-data probe on O3 before paid runs.
- S8. Additive MCP tools for relate, trace, impact with coverage-gap disclosure, behind a flag. Agent codex, blocked by S3, S6, S7.
- S9. Gate: relate and impact against clone-only on the ported strata (about $8). Blocked by S5, S8.

### Cycle 4: overview and knowledge base

- S10. Deterministic map tool from the registry, tree and graph; gate: map does not hurt. Blocked by S4, S6, S5.
- S11. KB default-on semantics (D3): auto-skip without a model, default token cap, cost estimate log. Agent codex.
- S12. KB write-back tools (`propose_doc`, `update_doc`) reusing `finish_doc` validators, with provenance. Blocked by S3, S11.

### Cycle 5: de-Sourcebot and finish

- S13. Rewrite verbatim v6 text originally (Ask prompts, tool descriptions, KB prompts) under the Ask-quality gate (check 3). Config schema and converter script; remove `SOURCEBOT_*`, the header, `/api/ee/*`; Dockerfile and README scrub. Blocked by S5.
- S14. Mechanical rename of `@sbc/*`, DB names, package metadata. Blocked by everything else.
- S15. Final regression gate (all four checks), README, release notes. Blocked by all.

## Gate 1 approval

Cycle 1 (S0, S1, S2) approved by the human on 2026-10-18. Main session stays on Opus for the cycle. Cycles 2 to 5 are sequenced but need their own gate 1.

## Cycle 1 results (2026-10-19)

| Slice | Outcome | Evidence |
|---|---|---|
| S2 domain docs and ADR | kept (`2595cef`) | Name scrub clean; Codex cross-review found 5 blocking and 11 smaller items; one fix round applied, 2 items recorded as open decisions, 1 rejected. |
| S0 regression baseline | kept (`0d90e30`) | 77 shared and 13 web tests; 50-query golden baseline recorded live, three cold runs with an empty diff; resync and delete steps pass; memory 465 to 564 MB against the 654 MB ceiling. |
| S1 Zoekt upstream probe | kept (`ff6ae81`) | Upstream at 0e68f41 plus a small patch gives an empty golden diff (0 of 61 queries differ); memory 581 MB. Patch is NOT applied; it changes production code and waits for gate 2. |

Named limitations recorded in `baseline.md`: archived, fork and visibility filters are inert for the git connector (frozen as returned); search pagination is not covered; cross-file ranking order is not pinned because Zoekt returns tied files in varying order.

## Amendments after gate 2 (2026-10-19)

- **D3 amended and D12 added** (human decision): two Ask paths. The server-LLM Ask stays unchanged for the Falkon UI. A new client-LLM path is added for MCP clients: server `instructions`, an MCP prompt, and a model-free research tool under a new name; `ask_codebase` keeps its current contract. Quality is measured with the ported eval's agent-plus-tools arm (the arm already scored 0.967 dev and 0.948 hidden). The ADR's open decision 1 is resolved by this.
- **Falkon UI integration** (new, cycle 2 or 3). The UI is the separate app `../falkon-ui` (Next.js 16, React 19, Zod 4, mock API today). Its HTTP surface to implement or adapt in the engine: `products` (create, read), `repositories` (search a code host), `connections` (token check), `products/{id}/status`, `products/{id}/sync`, `products/{id}/threads[/{threadId}]`, `products/{id}/query` (NDJSON stream of answers with paragraphs and evidence). Contracts live in `falkon-ui/src/lib/contracts.ts`. The UI stays a separate app talking to the engine over HTTP; it does not move into this repository.
- **Open design questions raised by the UI** (to grill before its slices): (1) the UI creates Products through a setup wizard (Product registry managed through the API), while D6 says a Product is a named repo set in `config.json` — the registry must become API-managed in Postgres, with config as an import path; (2) the UI's evidence-backed answer shape (paragraphs with evidence spans) differs from Ask's `@file:{repo::path:a-b}` markdown, so an adapter or a shared answer contract is needed; (3) the UI streams NDJSON while Ask streams the AI SDK UI message stream; (4) the wizard collects a code-host token, which collides with "no secrets stored through the UI" unless the engine stores connection credentials server-side (security-sensitive, stops for review); (5) per-Product `sync` and `status` need engine endpoints backed by the existing sync state.
- **Cycle 2 plan change:** add S3b "Ask via the client" (instructions, prompt, model-free tool, eval check) beside S3 to S5; Falkon UI integration becomes its own slices after S4 (Product scoping), because it depends on the Product registry design.

## Decisions added 2026-10-19 (human)

| # | Decision |
|---|---|
| D13 | Monorepo. `falkon-ui` is imported into this repository as `packages/ui` (git subtree, history kept), with a new `packages/contracts` (Zod 4) imported by the engine and the UI. The UI keeps its own Next 16 and React 19.3. |
| D14 | The engine moves to Zod 4 in its own early slice. Gate: the 11 tools' pinned JSON schemas and outputs stay byte-identical (any diff gets hand review); `zod-to-json-schema` is dropped for the native conversion. |
| D15 | Chat transport is the Vercel AI SDK on both sides: the UI uses `useChat` against the engine's UI message stream; UI evidence travels as a Zod-validated `data-evidence` part beside `data-source` parts; the UI's NDJSON route and mock `/query` are retired. UI threads map onto the engine's stored chats, which gain a `productId`. |
| D16 | The engine's own web pages (search, repos, Ask) stay until the Falkon UI reaches parity, then are retired. The API routes stay until the NestJS boundary replaces them. Nothing is deleted before parity. |
| D17 | The Product registry is API-managed in Postgres (config is an import path). Connection credentials are stored server-side; that design is security-sensitive and stops for human review before it is built. |

## Revised cycle map (supersedes the cycle map above for cycles 2 onward; slice ids keep their old meaning, new work gets new ids)

- **Cycle 2 (this plan): S16, S17, S18.**
- Cycle 3: S5 eval harness port and the floor rerun (also measures the client-LLM Ask), S3 NestJS boundary, S4 `AccessPolicy` plus the API-managed Product registry (stops for review).
- Cycle 4: S19 `packages/contracts` plus the `packages/ui` import, S20 engine endpoints for the UI (products, repositories, connections, status, sync, threads), S21 chat transport (`useChat`, `data-evidence`, `productId` on chats).
- Cycle 5 to 7: graph (S6 to S9), overview and knowledge base (S10 to S12), de-reference rewrite, rename and final gate (S13 to S15) as before.

## Cycle 2 plan (gate 1 approved 2026-10-19)

Approved by the human on 2026-10-19; main session on Opus. S17 is owned by a separate session (worktree `.loop/worktrees/zoekt-upstream`, branch `loop/zoekt-upstream`); this cycle verifies its result against the S17 done condition before merging and does not build it.

Base: `main` at the current tip. Agent defaults: Codex `gpt-6.1-sol` at high effort; Claude where Docker or live access is needed. Main session stays on Opus where the human switches it; otherwise the Opus-grade review runs in `opus` agents.

**S16. Zod 4 migration.** Tier standard. Agent: codex.
- Goal: the engine, the tool definitions and the Ask agent run on Zod 4 with no change to any pinned contract.
- Scope: `packages/*/package.json`, `pnpm-lock.yaml`, every `z.` use under `packages/*/src` (config schemas, tool input schemas, the config JSON schema generation), `packages/shared/src/tools.ts`, `packages/web/src/lib/mcp.ts`, `packages/web/src/lib/ask/*`. No behavior changes.
- Done: `pnpm typecheck && pnpm test` green with `UPDATE_SNAPSHOTS` unset and every file under `tests/contract/` byte-identical (a needed schema diff is listed and hand-reviewed instead of regenerated); `zod-to-json-schema` is gone from the dependency tree of the workspace packages; a lockfile check shows one Zod major for workspace dependencies; the Ask agent still builds its tool schemas.
- Verify: `pnpm typecheck && pnpm test`; `git diff --stat -- tests/contract` empty; `pnpm ls zod -r`.
- Blocked by: none.

**S17. Adopt upstream Zoekt.** Tier standard. Agent: claude (Docker). This is a production change the human approves at this gate.
- Goal: build on upstream Zoekt at a pinned commit and drop the fork.
- Scope: `packages/backend/src/zoekt.ts` and its two callers in `index.ts` (apply `.scratch/falkon-mvp/zoekt-probe.patch`), `docker/Dockerfile`, delete `docker/Dockerfile.zoekt-probe` and the `SMOKE_DOCKERFILE` opt-in, README note on the Zoekt license and a migration note (existing fork shards need a full reindex).
- Done: `scripts/ops-smoke.sh` passes on the default Dockerfile with an empty golden diff against `tests/golden/expected.json`; resync, delete and memory (at most 654 MB) pass; the image ships the Zoekt license text; Go and Node base images are digest-pinned; the string for the old fork's owner appears nowhere in shipped files.
- Verify: the smoke run, twice from cold; `pnpm typecheck && pnpm test`; `grep -rniE 'sourcebot' docker packages/backend`.
- Blocked by: none.

**S18. Ask via the client.** Tier standard (wording reviewed by an `opus` agent). Agent: codex.
- Goal: MCP clients can run the Ask workflow on their own LLM, with no server model, alongside the unchanged server-LLM Ask (D12).
- Scope: `packages/web/src/lib/mcp.ts`, a new `packages/web/src/lib/ask/brief.ts`, `packages/shared/src/toolText.json` (new entry only), `tests/contract/**` (new snapshot entries only, existing entries untouched), docs.
- Done: the MCP initialize result carries server `instructions`; an MCP prompt `ask_codebase` takes `query` and optional `repos`; a model-free tool `research_codebase` returns the research workflow, the citation format and the repository context for the client to execute with the existing tools; all three are present with or without a configured model; `ask_codebase` (the tool) keeps its pinned contract unchanged; the guidance text is original wording (not copied from the reference v6 prompts), checked by a grep for the old prompt's distinctive phrases; unit tests pin the new surface.
- Verify: `pnpm typecheck && pnpm test`; `git diff -- tests/contract` shows only added entries; connect a real MCP client (the Claude Code CLI via `claude mcp add`) to a running stack and run one research question end to end, with the transcript saved in `.scratch/falkon-mvp/`.
- Blocked by: S16 (avoids snapshot churn).
- The eval check (regression gate item 3) for the client-LLM path runs in S5, cycle 3.

Autonomy limits, cycle 2: the loop may decide alone test layout, wording within the stated constraints, and fix rounds (one per slice). It must stop for: any contract snapshot change other than the S18 additions, a new dependency other than Zod 4 and its types, and any outward action. Budget: 1.2M Claude subagent tokens and 4 hours of wall clock, Codex runs under a `perl alarm` cap of 25 minutes each.

## Cycle 2 results (2026-10-19)

| Slice | Outcome | Evidence |
|---|---|---|
| S16 Zod 4 migration | kept (`3b6f9cf`) | One Zod major (4.6.5); every `tests/contract` file byte-identical; the Ask agent's model-facing schemas byte-identical to an independent Zod 3 dump from main; one fix round. Accepted change: Zod 4 wording in config errors, HTTP 400 `message` bodies and the KB `invalid_input` tool result, now pinned by tests. |
| S17 upstream Zoekt | kept (`91ea88e`, built by a side session) | Coordinator's own cold smoke: every step passes, empty golden diff, memory 462.55 MB of 654 MB. Remaining `sourcebot-dev` strings in shipped files are config-format references (`config.example.json`, config JSON schema), left to S13. |
| S18 Ask via the client | kept (`e4bfb5b`) | Contract additions only; live run with the Claude Code CLI and no server model: `research_codebase` first, scoped calls, two exact verified citations. Brief bounded (50 names per list, sanitized). |

## Roles from cycle 3 on (human, 2026-10-19)

No Codex: the human no longer has a Codex plan. Every implementer and reviewer is a Claude agent: Sonnet by default, Opus for a slice marked `hard` and for architecture and wording review, Haiku for mechanical verification. Cross-family review is no longer possible; instead the reviewer is always a different agent instance from the builder, and an Opus review is required for security-sensitive or design-heavy slices. The main session stays on Opus as architect and coordinator.


## Cycle 3 plan (grilled 2026-10-19; gate 1 pending)

Base: `main` at 2ea50f2. Roles per "Roles from cycle 3 on": every implementer and reviewer is a Claude agent, Sonnet by default, Opus for S4 (`hard`) and for security, wording and architecture review, Haiku for mechanical verification. The reviewer is a different agent instance from the builder. Main session: the human switched it to Sonnet via `/model` at the start of this cycle; the architect decisions below were made before that switch and any later architecture call escalates to an `opus` agent or the human.

### Decisions from the cycle 3 grill (human, 2026-10-19)

| # | Decision |
|---|---|
| D18 | S5 measures two arms on the O3 Product (42 repositories, 80 paired dev and hidden questions): the clone's plain tools, and the client-LLM path (agent calls `research_codebase` first). Both are compared per question against the recorded reference v6 runs (the floor). The real v6 image is not rerun. Spend cap $15 (expected $9.5). |
| D19 | S3: NestJS app in a new `packages/api`. It imports the Next-free runners in `packages/web/src/lib` in place (`mcp.ts`, `tools.ts`, `repos.ts`, `ask/*`); no file moves, existing tests untouched. Extraction into a shared package waits for the contracts import (cycle 4). |
| D20 | Coexistence: Nest runs as its own compose service on its own port (3001, published on host loopback only). `/api/mcp` and `/api/ee/mcp` stay untouched (D16). Unknown Product is 404 with no fallback. |
| D21 | Registry (D17): new Prisma model `Product{slug, name, description, source config\|api, definition Json, repoNames String[]}`. Config `contexts` are imported as `source=config` Products by the existing sync step (`syncSearchContexts` also upserts Products; `SearchContext` stays, used by the search UI). `source=api` Products are never touched by config import. Membership is the resolved `repoNames` (include globs, connections, topics, excludes), recomputed on sync, read at request time. Schema is applied with `db push` as today (no migration files exist). |
| D22 | Connection credentials are not stored this cycle. The registry holds no secrets; the GitHub token and `LLM_*` stay operator environment. Credential storage is a security slice of cycle 4 (S20) with its own review gate. |
| D23 | Registry writes this cycle: a `ProductRegistry` port, a Prisma adapter, config import, and create, list, update, delete on the admin listener only (localhost, separate Nest app). No public write route. |
| D24 | `AUTH_MODE=none\|apiKey` environment variable, default `none`; it moves into the Falkon config schema in S13. `apiKey` reuses `authenticate` and `loadAccessKeys` unchanged. Order on `/mcp/<product>`: authenticate (401), then resolve Product (404), then effective set = Product repos filtered by `key.allows` (P2). |

### Slices

**S5. Eval harness port, floor comparison, client-LLM measurement.** Tier standard. Agent: claude (Sonnet implementer; paid runs executed by the main session through the verifier, not by the implementer). Blocked by: none.
- Goal: the O3 Ask-quality check (regression gate item 3) exists in this repository and has been run for both arms.
- Scope: new `tests/eval/**` (harness, runner, scorer, paired bootstrap compare, preflight, reports, datasets `openmrs-xrepo` and `openmrs-xrepo-unnamed`, the O3 Product repository list, stack launcher scripts), `.scratch/falkon-mvp/eval-floor/**` (the recorded v6 run reports copied from the old repository, allowed to name the old product), `.scratch/falkon-mvp/baseline.md` (results), root `package.json` scripts. Port only the O3 plain-arm path; leave the old design's graph, map, reach and relate code behind. Every tracked file outside `.scratch/` must be free of the predecessor product's name and of `falcon` (arm ids become `clone-tools` and `clone-research`); a test greps for it. Corpus checkouts stay outside the repository (`EVAL_O3_DIR`, defaulting to the old repository's `.local/products/o3` checkouts). The clone stack for the eval indexes the 42 checkouts as generic git connections (`file://`), not the removed `local` type.
- Done: ported unit tests pass; `pnpm eval -- pilot --list` prints the selection without spending; the stack preflight confirms all 42 repositories and 104 of 104 gold paths readable; a 10-run pilot (about $0.4) shows both arms use their tools (research arm calls `research_codebase` before other tools in every run) and is reviewed by me before the full runs; full dev and hidden runs for both arms complete with zero failed, malformed or leaked runs; the report gives, per arm and split, recall, precision, cost, and the paired difference with 95% bootstrap CI (seed 20261017) against the floor. Regression gate item 3 passes when the lower CI bound of (arm minus floor) is at or above -0.05 on dev and hidden. A miss is reported, not hidden, and goes to the human at gate 2.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- report --split dev` and `--split hidden` (read-only, regenerate the numbers from stored run files); `grep -rniE 'sourcebot|falcon' tests/eval package.json` returns nothing; ops-smoke is not affected.
- Decision rule for paid runs: pilot first; stop and ask if the plain clone arm's pilot recall is below 0.80 (the recorded arm ran 0.967) or if any run leaks; total spend capped at $15 by the ledger.

**S3. NestJS boundary (strangler).** Tier standard. Agent: claude (Sonnet). Blocked by: none (can run beside S5; Docker steps are serialized by the main session).
- Goal: a Nest service serves `/mcp/<product>` with the unchanged tool contract, beside the untouched Next routes.
- Scope: new `packages/api` (Nest app, a `ProductResolver` port with a first adapter over today's `SearchContext` names via `loadContexts`, MCP controller delegating to `handleMcpPost` and `handleMcpDelete` with a `Scope` built from the Product's repos), `docker-compose.yml` and `docker/Dockerfile` (new `api` service, loopback publish `127.0.0.1:3001`, bind via `API_HOST`, code default `127.0.0.1`), `tests/golden/run.ts` (additive `MCP_PATH` env, default `/api/mcp`), `scripts/ops-smoke.sh` (starts and measures the `api` service, golden pass through `/mcp/<product>`), `tests/fixtures/config.json` (additive context covering all fixture repositories), pnpm workspace files, README note. This slice adds the NestJS dependencies (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`), approved at this gate, and needs its own `pnpm install` in its worktree. No edit to `mcp.ts`, `tools.ts`, the sync path or the Zoekt path.
- Done: every file under `tests/contract/` byte-identical and the existing contract tests pass unchanged; `tests/golden/expected.json` byte-identical and the golden run through `/mcp/<product>` has an empty diff; an unknown Product returns 404 with no data; `/api/mcp` and `/api/ee/mcp` still pass the same golden run; Nest-level tests cover Product resolution, 404, DELETE session ownership and the request path; ops-smoke passes with the `api` service included and total memory at most 654 MB (462.55 MB today). If memory fails, the fallback is running Nest inside the web container; record the measurement either way.
- Verify: `pnpm typecheck && pnpm test`; `git diff --stat -- tests/contract tests/golden/expected.json` empty; `sh scripts/ops-smoke.sh` twice from cold.

**S4. `AccessPolicy` port and API-managed Product registry.** Tier hard (Opus implementer). Agent: claude. Security-sensitive: stops at gate 2 for human review; an `opus` agent reviews it and a second `opus` agent attacks it (isolation P1 to P5, P10, P11 and the registry). Blocked by: S3.
- Goal: Product scoping and access control behind ports; the registry is the source of Products.
- Scope: `packages/shared/src/access.ts` (additive port types, existing exports and tests unchanged), `packages/api/**` (`AccessPolicy` port with `none` and `apiKey` adapters; `ProductRegistry` port with the Prisma adapter replacing S3's resolver adapter; guards; admin listener as a second Nest app in the same process; session binding), `packages/db/prisma/schema.prisma` (`Product` model, additive), `packages/backend/src/sync.ts` (add the Product upsert beside `syncSearchContexts`; no other change to the sync path), tests, ADR amendment in place (section 4.5 as built, section 7 table status, section 11 open questions 1 and 2 answered).
- Specified as allowlists, from the brief: the admin listener serves exactly the registry routes `GET/POST /products`, `GET/PUT/DELETE /products/:slug` and nothing else; the product listener serves exactly `POST, DELETE, GET /mcp/:product` and nothing else (every other path 404 on both listeners); `:product` must match `^[a-z0-9][a-z0-9-]{0,62}$` before any lookup; a Product slug is immutable after creation.
- Done: tests prove, per ADR section 7, P1 (unknown or malformed Product, no fallback), P2 (`none` yields the Product set; `apiKey` yields Product ∩ key; narrow never widens), P3 and P4 (an out-of-set repo returns the same error as a missing one for `read_file`, `list_tree`, `list_commits`, `list_branches`, `get_diff` and every other repo-named argument; `search_code` and `find_symbol_*` cannot return an out-of-set hit even with a crafted `repo:` or regex query), P5 (path and ref traversal and option injection still rejected), P10 (admin routes unreachable on the product listener and the reverse, binding to loopback by default), P11 (a session id presented under another Product path, or after the Product's membership changed, is rejected without starting a new session; the binding is the `productId` plus a fingerprint of the effective set at creation). `AUTH_MODE=apiKey` with a missing or unreadable access file denies everyone. All existing `access.ts` tests, the contract snapshots and the golden set unchanged and green; `config.json` import is idempotent and never touches `source=api` Products.
- Verify: `pnpm typecheck && pnpm test`; the isolation test suite; contract and golden diffs empty; ops-smoke once.
- Out of scope, recorded: P6 (knowledge base citation visibility and generation limits, ADR 7.1), P7 to P9 (no graph or map exists yet; P9 for the Ask routes waits for S20 and S21), moving KB scan and resync to the admin listener, any credential storage. Product-path knowledge repositories behave as today (visible when their owner is); this is a known gap until the knowledge base cycle, and the ADR amendment says so.

### Order, limits, budget

Order: S5 and S3 start together in separate worktrees; S4 starts after S3 is kept. The S5 paid runs and S3's ops-smoke are serialized on Docker. Cycle branch: `loop/falkon-mvp-c3`.

The loop may decide alone: test layout, fixture contents, module layout inside `packages/api`, pilot parameters within the S5 cap, one fix round per slice. It must stop for: any contract or golden expected-file change, any dependency beyond the NestJS set named in S3, any eval-data or decision-rule change, ADR changes beyond the S4 amendment, S4 itself (gate 2), spend over $15, and any outward action (push, PR, publish).

Budget: 1.6M Claude subagent tokens (S4 on Opus doubled), 6 hours wall clock, $15 agent spend for S5. Long commands run in the background under `perl -e 'alarm N; exec @ARGV'` and are awaited by their exit notification.

Gate 1 decision for the human beyond the plan itself: P6 and the other items listed under "Out of scope" for S4 deviate from the ADR section 13 delivery plan, which lists P1 to P6 and P9 to P11 for this stage.

Gate 1 approved by the human on 2026-10-19: plan as written, P6 deferred past S4.

## Cycle 3 results (2026-10-19, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S5 eval harness, floor comparison | harness kept (`3263aee`), gate item 3 NOT met (`34465ac`) | Floor reproduces (dev 0.9726, hidden 0.9229). 160 runs, 0 failed, 0 leaked, $7.54. clone-tools: dev -0.023 [-0.076, 0.021], hidden +0.003 [-0.094, 0.093]. clone-research: dev -0.068 [-0.122, -0.019], hidden +0.020 [-0.062, 0.103]. All four lower bounds are below -0.05. Details in `baseline.md`. |
| S3 Nest boundary | kept (`29ef449`) | Contract and golden files untouched; golden through `/mcp/fixtures` has an empty diff; one fix round (api memory 218 MB under tsx, 79 MB as an esbuild bundle). |
| S4 AccessPolicy and registry | built, held for human review (`3b2f6cc`) | Opus review and Sonnet attack pass found no isolation break; one fix round (sync lost-update, NUL 400). Open items for the human in `.loop/REVIEW.md`. |

Ops memory at each slice (ceiling 654 MB, 462.55 MB before the cycle): S3 635.99 MB, S4 646.99 MB (651.33 MB on the first S4 run).

## Gate 2 decision, cycle 3 (human, 2026-10-19: approve with notes)

Landed on `main`. The parity-verified clone is preserved at tag `reference/v6-parity-clone` (2ea50f2, local, not pushed). Notes carried to cycle 4, in this order:

1. **Admin token.** Admin listener requires `Authorization` with `ADMIN_TOKEN` (service refuses to start if unset while the admin listener is enabled); smoke registry step sends it. Small S4 follow-up, Sonnet with a review of that route.
2. **Ask-quality rule.** Replace the gate-3 rule with a non-inferiority margin passable at the real sample size (pooled dev plus hidden, n=80), drafted for the human's approval before any rerun. `--model` option in the harness; Haiku floor from the real v6 image and our engine, paired per question, for fast iteration; one confirming Sonnet run. Ablation: plain tools with the server `instructions` suppressed, to see whether S18 instructions cost recall. `research_codebase` stays out of the advertised `instructions` until its brief is tuned and re-measured (it lost 0.068 recall on dev).
3. **Memory.** Lazy-load the `ai` SDK and heavy `@sbc/shared` imports (edits `mcp.ts`/`shared`, gated by contract, golden and ops-smoke). Ceiling stays 654 MB.
4. **Absorb the clone.** Rename `@sbc/*` to `@falkon/*` and fold `shared`, `db` and `backend` into one `packages/core`; `api` and `web` stay the HTTP surfaces, `contracts` and `ui` follow. This moves the rename forward from S14 and precedes the UI import (S19). Import-only, no behaviour change, gated by the contract snapshots, the golden set and ops-smoke.
5. Accepted as is: esbuild, `@prisma/client` and `zod` in `@sbc/api`; the sync refactor; P6 deferred to the knowledge-base cycle.

## Cycle 4 plan (grilled 2026-10-19; gate 1 pending)

Base: `main` at dca8d4a. Roles: Sonnet builds, reviews and attacks; Haiku verifies; no Opus this cycle (human, quota). The main session is Sonnet; design calls beyond these slices escalate to the human. Slice ids continue the numbering (S22 to S24). The core merge is cycle 5 (own gate 1 and Opus design pass), after S24, because the lazy-loads edit the same shared and `mcp.ts` files the merge moves.

### Decisions from the cycle 4 grill (human, 2026-10-19)

| # | Decision |
|---|---|
| D25 | Regression gate item 3 is replaced. A client-LLM or tools arm passes when, pooled over dev and hidden (n=80, paired per question id, seed 20261017): the lower 95% bootstrap bound of (arm minus reference) recall is at or above -0.10, and the number of questions where the arm is worse is not more than twice the number where it is better, with zero failed, malformed or leaked runs. Reason: at n=32 to 48 the old -0.05 bound is unpassable even for an exact tie (pooled n=80 on the cycle 3 runs: tools -0.012 [-0.062, 0.032], 7 better and 8 worse; research -0.033 [-0.079, 0.013], 7 better and 12 worse). The spec's Regression gate item 3 and ADR section 9 are amended to match. |
| D26 | Reference floor for comparisons made on a given client model is the real v6.0.1 engine run on that same model, paired per question. The recorded Sonnet floor (dev 0.973, hidden 0.923) stays the reference for Sonnet. Iteration runs use Haiku; a Sonnet run confirms only if the Haiku result shows a difference worth confirming. Eval spend cap this cycle: $6. |
| D27 | The admin listener is off unless `ADMIN_TOKEN` is set (at least 32 characters, else the service refuses to start); when on, every admin request needs `Authorization: Bearer <token>`. This refines the "refuse to start if unset" wording from gate 2: an unset token disables admin, which is a safer default than a hard failure. |

### Slices

**S22. Admin token.** Tier standard. Agent: claude (Sonnet). Security-sensitive: stops at gate 2. Blocked by: none.
- Goal: the admin listener (registry CRUD) cannot be used without a secret, including by other containers on the compose network.
- Scope: `packages/api/src/{admin,http,main}.ts` and tests, `docker-compose.yml`, `scripts/ops-smoke.sh` (+ its test), README, ADR section 4.5 and 7 status text. No other code.
- Allowlist spec: admin routes unchanged (`GET/POST /products`, `GET/PUT/DELETE /products/:slug`); the credential is `Authorization: Bearer <ADMIN_TOKEN>` only; compare as sha256 digests with `timingSafeEqual`; missing, malformed, empty or wrong credential gives the identical 401 body before any body is read or route matched beyond method and path allowlist; unmatched paths stay 404 (no auth oracle on path existence is acceptable, but no credential check result may differ by path); the token is never logged, echoed or placed in an error.
- Done: tests prove 401 for no header, `bearer` casing, empty, whitespace, wrong, multiple headers, and token in query or body; correct token reaches the routes; `ADMIN_TOKEN` unset means the admin port is not listening (checked over a real socket); token shorter than 32 characters refuses to start; the product listener is unaffected (token on `/mcp` is ignored, not required); compose passes the token through and publishes the admin port only when set; ops-smoke generates a random token for its registry step and asserts a tokenless admin call is 401; contract and golden files untouched; memory step still at most 654 MB.
- Verify: `pnpm typecheck && pnpm test`; `git diff --stat -- tests/contract tests/golden/expected.json` empty; `sh scripts/ops-smoke.sh` once.

**S23. Eval rule, model option, v6 reference, ablation.** Tier standard. Agent: claude (Sonnet); paid runs executed by the main session. Blocked by: none.
- Goal: the Ask-quality check is passable and measures our engine against v6 on the same client model, cheaply, and answers whether the server `instructions` cost recall.
- Scope: `tests/eval/**` (add `--model` default `claude-sonnet-5-5`, a `v6-tools` arm that talks to a running v6 instance via `EVAL_V6_URL` and a mode-600 key file, a `clone-tools-noinstr` arm, the D25 report rule with wins and losses, per-model run directories), `packages/web/src/lib/mcp.ts` (read `MCP_INSTRUCTIONS`: `default` keeps today's behavior byte for byte, `off` omits the server `instructions`; new test; `tests/contract` snapshots unchanged), `docker-compose.yml` is untouched (the eval stack sets the env itself), spec Regression gate item 3 and ADR section 9 text. The tracked-file name rule applies to `tests/eval` as before (the `v6-tools` arm and its URL variable are named without the predecessor's name; the instance's key file path is read from an env var).
- Done: unit tests for the rule (passes a synthetic tie at n=80, fails a synthetic 0.15 drop, fails on 3x losses over wins, withholds on any failed run); `MCP_INSTRUCTIONS=off` test shows no `instructions` in the initialize result and `default` is byte-identical to today; offline `pilot --list` works for every arm; a 10-run Haiku pilot per arm passes the stop rules (plain recall at least 0.70 on Haiku, no leaks, research tool first) and is reviewed by me before the full runs; full Haiku runs of `v6-tools`, `clone-tools`, `clone-tools-noinstr`, `clone-research` on all 80 questions with zero failed or leaked; the report applies D25 and prints per-arm wins and losses against the Haiku v6 reference; results recorded in `baseline.md`. A miss is reported, not retuned.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- report --model haiku`; contract diff empty; grep rule for forbidden words in `tests/eval`.
- Decision rule: pilot first; stop and ask if the v6 Haiku pilot recall is below 0.50 (a floor near zero cannot show anything), any leak occurs, or spend would pass $6.

**S24. Memory lazy-loads.** Tier standard. Agent: claude (Sonnet). Blocked by: S23 (both edit `mcp.ts`).
- Goal: restore headroom under the 654 MB ceiling without behavior change.
- Scope: `packages/web/src/lib/mcp.ts`, `packages/web/src/lib/ask/*` (dynamic `import()` of the `ai` SDK and `@ai-sdk/*` providers on first `ask_codebase` or model-listing use), `packages/api/build.mjs` if needed for the chunking, measurement notes in `baseline.md`. Heavy `@sbc/shared` imports (grpc, secret manager, ajv, simple-git, about 73 MB) are measured and reported with the import chain, not changed: restructuring `shared` belongs to the cycle 5 core merge.
- Done: all contract snapshots and the golden set byte-identical; `ask_codebase`, `list_language_models` and the `ask_codebase` prompt behave as before in the existing tests and in a new test that drives them through the lazy path with a fake model; api idle RSS measured before and after in `baseline.md`; ops-smoke memory at most 625 MB (about 29 MB headroom; 646.99 MB before); no new dependency.
- Verify: `pnpm typecheck && pnpm test`; contract and golden diff empty; `sh scripts/ops-smoke.sh` twice from cold, memory line recorded.

### Order, limits, budget

S22 and S23 run in parallel in separate worktrees (each with its own `pnpm install`); Docker steps are serialized by the main session. S24 starts after S23 is kept. Cycle branch: `loop/falkon-mvp-c4`.

The loop may decide alone: test layout, module layout, pilot parameters within the cap, one fix round per slice. It must stop for: a contract snapshot change other than additive, any new dependency, any change to datasets or gold, any rule change beyond D25, spend over $6, S22 (gate 2), and any outward action. Long Docker steps run as tracked background commands in the main session, never inside a verifier agent.

Budget: 1.0M Claude subagent tokens (no Opus), 4 hours wall clock, $6 eval spend.

Gate 1 approved by the human on 2026-10-19: cycle 4 plan as written.

## Scope reduction and revised cycle map (human, 2026-10-19)

| # | Decision |
|---|---|
| D28 | The MVP does not build the graph. Slices S6 to S9 (GraphStore, SCIP ingestion, relate, trace and impact tools, their gate) and S10 (deterministic map) and S12 (knowledge base write-back tools) move out of the MVP. Change and impact questions are served by the existing ctags-backed tools (`sym:` search, `find_symbol_definitions`, `find_symbol_references`, search and read across the Product) driven by an "impact and change" recipe in the `research_codebase` brief and in the UI's Ask: find the definition, find references across repositories, separate real uses from name clashes, read the callers, and state what could not be checked. D4 is amended accordingly. The graph returns only if testers show impact questions this loop misses and it then beats plain search under D8. Principle: port what works into Falkon's shape; do not over-engineer. |

Revised map for the remaining MVP (supersedes the earlier "Revised cycle map" from cycle 5 on):

- Cycle 5: UI to testers. S19 `packages/contracts` plus the `packages/ui` import; S20 engine endpoints for the UI (products, repositories, connections, status, sync, threads) including server-side credential storage (security-sensitive, stops for human review); S21 chat transport (`useChat`, `data-evidence`, `productId` on chats); the impact and change recipe (brief plus UI Ask) with a small impact question set to measure it. Imports use the current `@sbc/*` names.
- Cycle 6: core merge and rename (`@sbc/*` to `@falkon/*`, `shared`, `db` and `backend` folded into `packages/core`), then S11 knowledge base default-on semantics.
- Cycle 7: S13 original rewrite of inherited text and the Falkon config schema with converter, then S14 package and database rename if any remains, S15 final regression gate, README and release notes.
- Memory size (654 MB ceiling) is deferred by the human; recorded as information, not a keep condition, until the final gate.

## Cycle 5 plan (grilled 2026-10-20; gate 1 pending)

Base: `loop/falkon-mvp-c4` merged into this worktree's branch (cycle 4 waits at its own gate 2). Detail, tables and drafts: `.scratch/falkon-mvp/cycle5-prep.md` (sections referenced below). Roles: Sonnet builds, reviews and verifies; Haiku for mechanical checks and eval runs; no Opus, no Codex. Cycle branch: `loop/falkon-mvp-c5`.

### Decisions from the cycle 5 grill (human, 2026-10-20)

| # | Decision |
|---|---|
| D29 | The product is tested internally first. Security hardening is a separate later effort and is out of scope for this cycle. Credential storage keeps only: AES-256-GCM at rest, tokens never returned by any response and never logged (canary test). Dropped from the prep design: host allowlist and SSRF rules, key rotation and `rekey`, outbound-call wrapper, UI passphrase gate, Opus review and attack pass, the "stops at gate 2 for security" rule of D17. The UI binds to loopback; the admin listener stays behind `ADMIN_TOKEN`. |
| D30 | The master key is `FALKON_SECRET_KEY` (base64, 32 bytes) or `FALKON_SECRET_KEY_FILE`; if neither is set the engine generates one into `/data/secrets/master.key` (mode 600) on first use. Any UI user may create connections; one shared principal `"ui"` for threads. |
| D31 | Missing engine data is removed from the contract, not stubbed: `overlay`, `overlayPercent` and `structural` leave `packages/contracts` and the UI hides the overlay layer. Derived fields (`generation`, `scenario`, `gaps`, `progress`, `revision`, `updated`) are computed from real sync and index state. `dismiss` and the `scenario` mock action leave the server contract. |
| D32 | Providers in the wizard: `github` and `github-enterprise`, token method only. Branches: default branch only. |
| D33 | Approved sync-path exception (D7): `Connection.source` filter in `syncConnectionRows`, request markers claimed by the 30 s tick, `{stored}` token variant. No change to indexing, Zoekt or `git.ts`. |
| D34 | S25 runs beside S20 in its own worktree, Docker serialised; eval cap $3 on Haiku, no Sonnet confirmation unless the human asks. |

### Slices

Common: Tier standard (Sonnet), Agent claude. Verify always includes `pnpm typecheck && pnpm test` and `git diff --stat -- tests/contract tests/golden/expected.json` empty (additive only). Naming rule: no predecessor name in tracked files outside `.scratch/`.

**S19. `packages/contracts` and `packages/ui` import.** Blocked by: cycle 4 on this branch (done).
- Goal: one Zod 4 contract package shared by engine and UI; UI in the repo; no behaviour change.
- Scope: new `packages/contracts` (`@sbc/contracts`: moved `contracts.ts`, the D31 removals, `connectionId` on `setupRequestSchema`, `method: "token"` only, ISO `updated`, empty-allowed `revision`/`language`, `productIdSchema` aligned to the engine slug regex, `evidencePartSchema`, `answerPartSchema`; the marker-rewrite helper moves to S21 where its adapter lives); `packages/ui` via `git subtree add --prefix=packages/ui` from `../falkon-ui` (history kept; name `@sbc/ui`; npm lock removed; pnpm workspace); UI edits for D31/D32 against the still-running mock; `PRODUCT.md` scrub; Dockerfile and compose `ui` service (Next standalone, `127.0.0.1:3100`); root scripts; ADR amendment (packages).
- Done: root typecheck and test green including UI tests; `pnpm ls zod -r` one major; both Next majors build; `docker compose up --build` serves the UI on 3100 against the mock; contract and golden diff empty; naming grep clean.
- Budget: 2 units.

**S20. Engine endpoints for the UI and credential storage.** Blocked by: S19.
- Goal: the UI runs against the real engine for products, repositories, connections, status and sync, with no mock and no token in the browser.
- Scope: `packages/shared/src/credentialStore.ts` (+tests); `packages/db/prisma/schema.prisma` (`Credential`, `Connection.source/credentialId/syncRequestedAt`, `Repo.indexRequestedAt`); `packages/api/src/**` (UI module on the admin listener with the explicit route list of prep 2.1, status derivation of 2.5, repo search of 2.3, product create/edit of 2.4, route-enumeration test); `packages/backend/src/{sync,credentials,index}.ts` (D33 only); `packages/ui/src/app/api/**` thin proxies for products, repositories, connections, status, sync (threads and query stay on the mock until S21); compose (`ui` env, `API_ALLOWED_HOSTS`), README, ADR 4.5 allowlist and 7 status text.
- Allowlist (kept): admin routes exactly the prep 2.1 list; strict bodies, JSON only, 64 KiB; fixed-vocabulary error messages for code-host failures; `Credential` read only inside `openCredential` (grep test).
- Done: crypto round-trip and tamper tests; canary token never appears in any route response or thrown error; `api` connections survive a config sync and a `{stored}` token in a config file is rejected; status derivation tests over fixtures (table in prep 2.5); a manual run through the UI wizard with a read-only GitHub token creates a Product, status goes building to current, `retry` recovers a failed sync (notes saved under `.scratch/falkon-mvp/`); ops-smoke passes with a stored-credential round trip against a local fake host.
- Verify: root commands; `sh scripts/ops-smoke.sh` once.
- Budget: 4 units. Fallback split: S20a credentials, connections, repo search; S20b status, sync, product create and edit.

**S21. Chat transport.** Blocked by: S20.
- Goal: the UI chats over the AI SDK UI message stream with renderable evidence, stored per Product.
- Scope: `Chat.productId` + index; `packages/web/src/lib/ask/evidence.ts` (+tests, adapter per prep 3.4); `packages/api/src/threads.ts` (list, create, get, messages route; history from DB, client text only); `packages/contracts` parts; `packages/ui` (`useChat` + `DefaultChatTransport`, streaming proxy route, delete NDJSON route, mock query and `streamEventSchema`, thread mapping); ADR 7 P9 status.
- Done: adapter property and hostile-input tests green; thread of Product A is 404 under B; a body with `messages` is 400; a live Haiku run through the UI shows cited lines at the recorded revision and reload reproduces the answer; adapter resolves at least 95% of references on stored eval outputs; contract and golden unchanged.
- Budget: 3 units.

**S25. Impact-and-change recipe and question set.** Blocked by: none (UI half after S21).
- Goal: the recipe is in the `research_codebase` brief and the UI Ask prompt with a measured effect on a small impact set.
- Scope: `packages/web/src/lib/ask/{brief,prompt}.ts` (recipe gated on impact-style questions; prompt bytes for other queries pinned by a test); new `tests/eval/datasets/o3-impact.json` (existing datasets and `accepted.json` untouched); `tests/eval/**` arm `clone-tools-recipe`; `baseline.md` results; D28 text in spec and ADR.
- Done: recipe text pinned, distinctive-phrase grep clean; offline `pilot --list` works; 6-run Haiku pilot per arm passes the stop rules (plain recall at least 0.70, no leaks); full Haiku runs of both arms on the impact set plus the 80-question control for the recipe arm; report with recall, wins and losses, effect size. A miss is reported, not retuned.
- Budget: 2 units, eval spend cap $3.

Units: 1 unit is about 0.25M subagent tokens. Cycle budget: 11 units (about 2.75M subagent tokens) and 10 hours wall clock.

### Delta sync (human note, 2026-10-20)

The engine already syncs incrementally: `cloneOrFetch` does `git fetch --prune` into the existing bare clone (full clone only the first time), Zoekt indexes per revision, and knowledge scans are pinned to `kbScannedCommit`. S20 reuses that path for `retry` and for UI-triggered sync: no new sync mechanism, only the request marker. The status rule `pushedAt > lastIndexedAt` (partly-behind) is the delta signal. Never full-reclone on retry.

### Autonomy limits

The loop may decide alone: test layout, module layout in `packages/api` and `packages/ui`, UI copy following D31/D32, adapter thresholds within the prep caps, one fix round per slice. It must stop (gate 2) for: a non-additive contract or golden change, a dependency not named in S19 or beyond the AI SDK React package, any change to existing datasets or gold, sync-path edits beyond D33, spend over $3, and any outward action (push, PR, publish). Gate 2 also fires after three kept slices, so the cycle is expected to need two gate-2 stops.
Gate 1 approved by the human on 2026-10-20: cycle 5 plan as written, human asleep, loop runs autonomously to gate 2.

**S20 brief addition (from S19 review):** the wizard's edit mode sends `connectionId: "existing"` (placeholder, ponytail comment in `setup-wizard.tsx`). S20 must either make `connectionId` optional on edit or define what an edit sends; the engine ignores a placeholder id.

## Cycle 5 results (2026-10-20, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S19 contracts + UI import | kept (`b1d57bd`) | Subtree import with history; one fix round (stale UI copy, typed cast); both Next majors build; one Zod major; contract/golden diff empty. Marker helper moved to S21. |
| S25 recipe + impact set | code half kept (`e371ceb`); paid runs NOT done | 11-question `o3-impact` set, `clone-tools-recipe` arm, recipe gated on impact-style queries (UI Ask) / `MCP_IMPACT_RECIPE=on` (MCP). Non-impact bytes hash-pinned. Eval image could not be built (Docker base-image pull hangs). |
| S20a credentials, connections, repo search | kept (`37b2395`) | AES-256-GCM store, canary test, route allowlist test, D33 sync-path edits (api connections survive config sync). |
| S20b products, status, sync | kept (`57e6bef`) | `/ui/products` routes, derived status, retry markers, union of repos per connection, UI proxies. |
| S21 chat transport | kept (`ce97ee4`) | `useChat` over the AI SDK stream, `data-evidence`/`data-answer` parts, per-Product threads, NDJSON retired; 103/104 refs resolved on 10 real answers; one fix round (orphan user turn). |

Tip verification (install, typecheck, all tests, contract and golden diff empty) green at `ce97ee4`. Not verified anywhere: Docker builds of the image and `ui` service, ops-smoke, `db push` on a real Postgres, a live GitHub token run through the wizard, a live model turn, a browser run of the chat UI.

## Gate 2 decision, cycle 5 (human, 2026-10-20: approve with notes)

Approved. Notes carried to the next cycle (cycle 5b), in this order: (1) get Docker green (image build, `ui` service), (2) run `scripts/ops-smoke.sh` and a real wizard-to-chat pass with a read-only GitHub token against a live model, (3) run the S25 Haiku pilot and full runs (cap $3) and record the results in `baseline.md`, (4) ADR amended to match D28 (done in this landing, `docs/adr/0001-falkon-architecture.md` 4.3 and summary). Carried non-blocking items: connector-skipped repos stay at "Building"; literal `[n]` in code gets a zero-width space; concurrent turns on one thread overwrite each other; a failed first message leaves an empty thread; `Credential.lastError` is a dead column.

## Cycle 5b results (2026-10-20, branch `loop/falkon-mvp-c5b` from `loop/falkon-mvp-c5`)

| Item | Outcome |
|---|---|
| Docker green | Image builds with the UI; both eval stacks and the smoke stack come up. The overnight `golang` pull hang did not recur. |
| `scripts/ops-smoke.sh` | PASS on every step incl. golden, resync, delete, registry; memory 639.5 MB (ceiling 654 MB, not a gate). The new schema (Credential, Chat.productId, Connection and Product columns) pushed cleanly to a real Postgres. |
| S25 Haiku pilot and runs | Recorded in `baseline.md` (cycle 5b section): impact set recipe recall 0.955 vs plain 0.780, D25 PASS (n=11); O3 control recall 0.915 vs 0.907, no loss; verdict on the 80-question control withheld only by the open leak false positive. Spend about $0.3. |
| Live UI-to-engine pass (no GitHub token, no model key) | Products, status, threads, no-model error and bad-token rejection verified over the real stack and in the browser. Three bugs found and fixed with tests: products list 500 for config Products over generic-git repos (bare host), engine-backed product pages 404 (server layout read the mock store), home redirect under `cacheComponents` (runtime ENGINE_URL). |
| ADR matches D28 | Done at cycle 5 landing. |

Not verified, needs the human's credentials: wizard to a real product with a read-only GitHub token (connection create, repo search, product create, first sync, status building to current), and a real model answer with evidence in chat (needs `models` config and a provider key). Cosmetic leftovers for S13: the no-model error carries a docs link naming the old product; the chat empty state says "mock dataset"; a config Product over generic git shows provider "github-enterprise".

## Cycle 6 plan: GitHub App, admin token (grilled 2026-10-20; gate 1 approved 2026-10-20)

Detail, facts, rejected DeepSeek idea, question log: `.scratch/falkon-mvp/cycle6-auth-models.md`. The earlier "Cycle 6 = core merge and rename, then S11" in the revised map is renumbered to cycle 7 (core merge, S11) and cycle 8 (S13 to S15). Branch `loop/falkon-mvp-c6` from `claude/cycle6-auth-models-29b452` (base main 05fe517). Roles: Claude only; Sonnet builds, reviews, verifies; Haiku mechanical checks; Opus only if a slice is marked hard.

### Decisions from the cycle 6 grill (human, 2026-10-20)

| # | Decision |
|---|---|
| D35 | The chat model stays DeepInfra via the human's existing `.env` `LLM_*`. No model code or config change this cycle; only a live UI chat turn in the final check. |
| D36 | GitHub App auth, operator pre-creates the App (read-only Contents and Metadata). Wizard takes host, App ID and the PEM, lists the App's installations (`GET /app/installations`, stateless: key not stored at that step), the user picks one; one connection = one installation. App ID, PEM, installation id and host are sealed as one JSON string in the credential store (new `Credential.kind` `github-app`; never returned or logged; canary test extended). Installation tokens (RS256 JWT with `node:crypto`, no new dependency, then `POST /app/installations/{id}/access_tokens`) are cached in memory about 50 minutes and refreshed on a rejected token. The one backend hook is the credential resolver (`setCredentialResolver`): `{stored}` resolves to a plain token for `github-token` rows and to a minted installation token for `github-app` rows, so the connector listing and git fetch (`credentialsFor`) need no change. Repo search for an App connection uses `GET /installation/repositories`. GitHub and GitHub Enterprise (`https://host/api/v3`) only (D32). No webhooks. Token connections stay beside App connections. No manifest flow. `connectionRequestSchema.method` becomes `z.enum(["token","app"])` with the App fields; the S19 test that rejects `method: "app"` changes. |
| D37 | Admin token: one per install, generated once on first api start (`crypto.randomBytes(32)`, hex) into `${DATA_DIR}/secrets/admin.token` (mode 600, dir 700, same race-safe write as `master.key`). Env `ADMIN_TOKEN` (>= 32 chars) overrides the file. The admin listener is now always on (a token always exists). Compared in constant time (existing sha256 + `timingSafeEqual`); api and ui re-read the file per request with an mtime cache, so a reset needs no restart. Never logged or printed by the api; `scripts/admin-token.sh show|reset` is the only way to see or change it, so only someone with host or volume access can change it ("admin cannot be changed" through the app; the human chose reset by host owner only). `reset` refuses when `ADMIN_TOKEN` env is set. The `ui` service reads the same file from a read-only mount of the `data` volume; `ENGINE_ADMIN_TOKEN` env stays an override. |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S27 | Admin token per D37. Done: first start creates a mode-600 64-hex file; second start reuses it; env overrides; short env still throws; reset replaces it and the next request with the new token succeeds while the old one is 401, without restart (api and ui reader); no-`ADMIN_TOKEN` api now serves the admin listener; token never in logs or responses (canary). | `packages/shared` (new `adminToken.ts` + test, export), `packages/api/src/{admin,main,adminAuth.test}.ts`, `packages/ui/src/lib/api/engine.ts` (+ test), `docker-compose.yml` (ui mounts `data:/data:ro`, drop the ADMIN_TOKEN-default coupling), `scripts/admin-token.sh` | `pnpm typecheck && pnpm test`; new tests above; `bash -n scripts/admin-token.sh` | none | standard / claude |
| S28a | GitHub App core per D36 (engine side, no UI). Done: unit tests with injected fetch prove JWT claims/RS256 signature, installation token mint and cache hit within 50 min and refresh after expiry or 401, `listInstallations`, `/installation/repositories` paging, GHE base; `POST /connections` with `method: "app"` creates a sealed `github-app` Credential and a Connection whose config token is `{stored}`; backend resolver returns an installation token for it; private key and installation token absent from every response and log (canary); a token connection still works unchanged; `connectionDtoSchema.provider/status` unchanged. New admin route `POST /connections/app-installations` `{host, appId, privateKey}` returns `[{id, account}]` and stores nothing. | `packages/shared` (new `githubApp.ts` + test, export), `packages/api/src/connections.ts` (+ test), `packages/contracts/src/index.ts` (+ test), `packages/backend/src/index.ts` (resolver), `packages/db/prisma/schema.prisma` only if a column is needed (prefer none: `kind` is a free string), `packages/api/src/admin.ts` route registration only if a controller is added | `pnpm typecheck && pnpm test`; contract and golden diff empty | none (parallel with S27; both touch `packages/shared/src/index.ts`, merge by hand) | standard / claude; mark hard only if the token cache or JWT fails one fix round |
| S28b | Wizard App method. Done: wizard offers Token or GitHub App; App path asks host, App ID, private key (textarea or file read in the browser, never persisted client-side), lists installations, user picks one, then continues to the existing repo search and Product steps; no key or token in any UI log or error; UI tests cover the step and failure copy; UI proxy route for `app-installations`. | `packages/ui/src/features/setup/*`, `packages/ui/src/app/api/connections/**` (routes), UI tests | `pnpm typecheck && pnpm test` | S28a | standard / claude |
| S29 | Docs and live checks. Done: ADR amended in place (4.5 admin token and credential paragraph, 4.6 if listeners text changes, section 7 P10 row, summary) and README (admin token, scripts, App setup incl. required permissions, GHE); `scripts/ops-smoke.sh` passes with no `ADMIN_TOKEN` set; Docker `docker compose up --build` live pass: admin token generated, UI works with the generated token, `scripts/admin-token.sh reset` rotates it with the UI still working, live chat turn on the human's DeepInfra `.env` (do not read `.env`; compose loads it); naming scrub (`git ls-files` outside `.scratch/`); GitHub App wizard to first sync is NOT run (needs the human's App) and is listed as a not-verified item. | `docs/adr/0001-falkon-architecture.md`, `README.md`, `.env.example` (only if comments change), no code beyond fixes found | `pnpm typecheck && pnpm test`; `scripts/ops-smoke.sh`; scripted live pass | S27, S28a, S28b | standard / claude; Haiku runs the Docker checks |

Order: S27 and S28a in parallel (own worktrees), then S28b, then S29. Docker commands serialised (only S29 uses Docker).

### Autonomy limits (cycle 6)

May decide alone: file and module layout inside the scopes above, UI copy, JWT/cache internals, the reset script's mechanism, one fix round per slice. Must stop at gate 2 (the cycle is expected to stop there anyway because S27 and S28a are security-sensitive code the human asked for): a non-additive contract or golden change, any change to `tests/contract` or `tests/golden/expected.json`, a new dependency, a sync-path change beyond the resolver hook, a Prisma column or migration, spend, and any push or PR. Budget: 1.5M subagent tokens and 8 hours wall-clock for the cycle (S28a double-weighted); quota is the binding limit.

Gate 1 approved by the human on 2026-10-20: cycle 6 plan as written. Loop runs autonomously to gate 2.

## Cycle 6 results (2026-10-20, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S27 admin token | kept (`8e71e0b`) | Generated once into `${DATA_DIR}/secrets/admin.token`, env override, always-on admin listener, per-request re-read (api and ui), `scripts/admin-token.sh show|reset`. One fix round: an empty or short token file opened the admin API (review blocking); now fails closed. Live: reset swaps token, old 401 / new 200, ui keeps working with no restart. |
| S28a GitHub App core | kept (`6b90e44`) | RS256 JWT with node:crypto, installation tokens (api cache ~50 min, backend resolver max 5 min), `github-app` Credential, `POST /connections` method app, `POST /connections/app-installations`, resolver hook only, no sync-path or schema change. One fix round: backend never refreshed a rejected token. |
| S28b wizard App method | kept (`c53a258`) | Token / GitHub App toggle, installation picker, key only in React state, route proxy with strict body. One fix round (clear key on method switch, stale response guard, file size cap). |
| S29 docs and live | kept (`9f24d2e`) | ADR 4.5 and P10, README Admin token and GitHub App subsections. Live stack: ops-smoke with no ADMIN_TOKEN passes every functional step; one real chat turn on the `.env` model, 200, grounded answer with evidence and 5 sources, 17,880 tokens. |

Cycle tip: typecheck and all tests green; `tests/contract` and `tests/golden/expected.json` diff empty; no new dependency; no Prisma change.

Not verified (needs the human): wizard to a real product through the GitHub App method on a real App (create connection, pick installation, first sync); wizard behaviour in a browser (disable-while-busy, file input, radio list); no wizard render test exists. Memory: ops-smoke whole stack 661.5 MB vs 654 MB ceiling (deferred, informational; D28 note). Known gaps: `sed`/scripts untested against a bad token file in a live container; `admin-token.sh reset` cannot run if the api refuses to start (documented recovery: delete the file).

## Cycle 6b dropped (human, 2026-10-20)

D40: "Sign in with GitHub" (device flow, D38/D39) is cancelled before any code landed: the personal access token stays the one connection path for testing, as the simplest. Nothing from 6b was merged; the half-built S30a worktree and branches were discarded. The GitHub App method from cycle 6 (S28a, S28b) stays merged but is unverified against a real App and is not the recommended path; remove it only if the human asks. The D38/D39 design (GitHub App user tokens, device flow, `GITHUB_CLIENT_ID`) is kept here as a record if Sign in returns.

D41 (human, 2026-10-20): the GitHub App method is removed to focus on the MVP; PAT is the only connection path. S28a and S28b were reverted on `main` (revert commits of their merges); D36 is superseded and the docs were edited to match. The admin token (S27, D37) stays. The App design remains in D36 above as a record.

## Cycle 7 plan: knowledge base default-on (S11) (grilled 2026-10-21; gate 1 approved 2026-10-21)

Base `main` at `9f3cc54`. Roles: Claude only; Sonnet builds and reviews, Haiku verifies, no Opus. Cycle branch `loop/falkon-mvp-c7`. Map change (human, 2026-10-21, "focus on MVP"): the mechanical `@sbc/*` to `@falkon/*` rename moves to the last cycle with S13 to S15; the fold of `shared`, `db` and `backend` into `packages/core` (the old "absorb the clone" note) is dropped (no MVP benefit, large diff). Revised remaining map: cycle 7 = S11; cycle 8 = S13 (original rewrite, Falkon config schema and converter), rename, S15 final gate, README and release notes. Tester feedback from the PAT end-to-end run (not yet sent) gets its own fix slices when it arrives; the carried non-blocking items (connector-skipped repos stay "Building", concurrent turns overwrite, empty thread after a failed first message, dead `Credential.lastError`, literal `[n]` in code) wait for feedback to rank them.

### Decisions from the cycle 7 grill (human, 2026-10-21)

| # | Decision |
|---|---|
| D42 | Knowledge base is on by default (`knowledgeBase.enabled` default `true`), D3 unchanged otherwise. Without a model (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` not all set) nothing is spent and nothing throws: no scan row is created, the backend logs one line per process start ("knowledge base skipped: no model configured"), and the Product status says so. The per-scan token cap stays 2,000,000 (`tokenBudget`). The first scan of a repository logs an estimate before spending (estimate = bytes of the files the scan would read / 4, capped by `tokenBudget`; the exact method is the implementer's, stated in the log line and README). Scans keep today's trigger: only when the repo is indexed and its commit changed, at most every `refreshIntervalHours` (24). |
| D43 | Visibility: Product status gains an additive optional `knowledge` object `{state: "off"|"no-model"|"pending"|"scanning"|"ready"|"budget-exhausted"|"failed", detail?}` derived by the api from config (`enabled`, model env) and the latest `KnowledgeScan` per member repo (precedence: scanning > failed > budget-exhausted > pending > ready); the UI shows one line next to the sync state. Contracts change is additive and optional; no Prisma change. |
| D44 | P6 (ADR 7.1 knowledge isolation by citation rule) stays deferred: `citeRepos` default is none, so default-on cannot cross Products; a knowledge repo is visible exactly where its owner is. Recorded as a known gap again, not built this cycle. |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S11a backend and config | Default-on, no-model skip, first-scan estimate. Done: `knowledgeBaseSchema.enabled` defaults true (update `config.test.ts` and `config.example.json`, README knowledge paragraph); `runKnowledgeScan` with no model env returns without throwing, creates no `KnowledgeScan` row and does not enqueue repeated attempts every tick; the skip is logged once per process; with a model, the first scan of a repo logs `estimate ~N tokens (cap M)` before the first model call (a unit test with a fake LLM proves the log precedes the first call and that a repeat scan does not log it); a scan error never affects code indexing or sync; existing KB tests stay green. | `packages/shared/src/config.ts` (+ test), `packages/shared/src/kb/llm.ts` (a `llmConfigured(env)` helper), `packages/backend/src/kb/scan.ts`, `packages/backend/src/index.ts` (`kbTick` skip), `config.example.json`, README knowledge paragraph | `pnpm typecheck && pnpm test`; contract and golden diff empty | none | standard / claude |
| S11b status field | `knowledge` status per D43. Done: api tests with the fake DB prove each state and the precedence; the status route returns it for config and api Products; contracts `statusSchema` gains optional `knowledge` (existing payloads and the UI mock still parse); the UI Product status shows one plain line per state (no model: "Knowledge base skipped: no model configured"); UI tests cover the mapping helper. | `packages/api/src/ui.ts` (+ tests, `fakeEngineDb.ts`), `packages/contracts/src/index.ts` (+ test), `packages/ui/src/**` status component and mock data, UI tests | `pnpm typecheck && pnpm test`, UI build | none (parallel with S11a; disjoint files) | standard / claude |
| S11c docs and live | ADR 4.2 amended in place ("S11 changes this" becomes as-built; known gap P6 restated), README. Live Docker: with no model env a config Product reaches status with knowledge "no-model" and zero scans; with the human's `.env` (path only, never read) the first scan logs its estimate, runs to a terminal state, a knowledge repo appears and is searchable through the Product; budget behaviour is shown with a temporarily tiny `tokenBudget` (status `budget-exhausted`). Spend note: one scan of a small fixture repo only. | `docs/adr/0001-falkon-architecture.md`, `README.md`; no code unless a bug, then minimal with test | `pnpm typecheck && pnpm test`; live pass script | S11a, S11b | standard / claude; Haiku runs the Docker steps |

Order: S11a and S11b in parallel (own worktrees, merge by hand), then S11c. Docker serialised (S11c only).

### Autonomy limits (cycle 7)

May decide alone: the estimate method, status copy, file layout inside the scopes, one fix round per slice. Must stop at gate 2 for: a non-additive contract change, any change to `tests/contract` or `tests/golden/expected.json`, a Prisma change, a new dependency, a sync-path change, spend beyond one fixture-repo scan, and any push or PR. Budget: 700k subagent tokens, 3 hours wall-clock.

Gate 1 approved by the human on 2026-10-21: cycle 7 plan as written. Loop runs autonomously to gate 2.

## Cycle 7 results (2026-10-21, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S11a backend and config | kept (`825e609`) | `knowledgeBase.enabled` defaults true; no model: no scan row, no throw, one log line per process, `kbTick` schedules nothing; first scan logs `estimate ~N tokens (cap M)` before the first model call. Review clean (notes fixed: no-model log only when enabled). |
| S11b status field | kept (`3cfd9b6`) | Additive optional `knowledge` on Product status, derived in the api (precedence scanning > failed > budget-exhausted > pending > ready; fixed failure text), one UI line per state. One fix round: config read cached 30 s with a 2 s load bound, latest-scan-per-repo in two bounded queries, `pending` only when not scanned at head, `knowledgeBase.repos` filter mirrored. |
| S11c docs and live | kept (`ca214f7`) | ADR 4.2, 4.5, P6 as built. Live Docker: no-model run shows one skip log line, zero scans, status `no-model` and the UI line; with the `.env` model: estimate ~567 tokens logged first, status pending, scanning, ready, scan SUCCEEDED (17,416 tokens), knowledge repo indexed and searchable through the Product; cap 2000 run ends BUDGET_EXHAUSTED (2,405 tokens) with status `budget-exhausted`; ops-smoke passes every step, memory 525.7 MB (ceiling 654 MB). Total live spend 19,821 tokens. |

Cycle tip: typecheck and all tests green; `tests/contract` and `tests/golden/expected.json` diff empty; no dependency or Prisma change. Not verified: knowledge `ready` for an api-created Product on a real stack (config Product only); browser look of the new line beyond the browser pane; the PAT wizard to real GitHub (needs the human's token); one timing-sensitive test (`opsSmoke.test.ts`) timed out once under parallel load and passed on rerun.

## Cycle 8 plan: PAT run fixes (grilled 2026-10-21; gate 1 approved 2026-10-21)

Base `main` at `0a3f594`. Roles: Claude only; Sonnet builds and reviews, Haiku verifies, no Opus. Cycle branch `loop/falkon-mvp-c8`. Input: `.scratch/falkon-mvp/cycle8-feedback.md` (the human's PAT end-to-end run: the PAT path works; F1 and F2 already fixed in `0a3f594`). The loop stops after three kept slices, so the remaining MVP spans cycles: cycle 8 = S31 to S33 below (user-facing fixes F3 to F6); cycle 9 = S13 (original rewrite of inherited text, Falkon config schema and one-time converter, removal of `SOURCEBOT_*`, the old header and `/api/ee/*`, Dockerfile and README scrub, under the Ask-quality gate); cycle 10 = mechanical `@sbc/*` to `@falkon/*` and DB rename, then S15 final regression gate (all four checks), README, release notes.

### Decisions from the cycle 8 grill (human, 2026-10-21)

| # | Decision |
|---|---|
| D45 | Cycle 8 is the user-facing fixes only: S31 chat answer rendering (F6), S32 chat behaviour (F5 plus the empty thread after a failed first message), S33 wizard and status UX (F3, F4). Other carried items (connector-skipped repos stay "Building", concurrent turns on one thread overwrite each other, dead `Credential.lastError`) wait. The literal `[n]`-in-code item rides with S31 because it is a rendering rule. |
| D46 | New dependencies approved at this gate so the cycle does not stop for them: `react-markdown`, `remark-gfm` and `mermaid` (lazy client import, `securityLevel: "strict"`) in `packages/ui` only. No syntax-highlighter library: fenced code is a plain `pre` with a copy button. Any other new dependency stops for gate 2. |
| D47 | Small talk (F5): a greeting or a meta question ("hey", "what can you do") gets a short conversational reply with a hint of what to ask, never the "Not enough evidence" card; the abstain card stays for code questions retrieval could not support. Done in the Ask prompt (a Falkon-owned addendum, like `impact.ts`) plus the answer `kind` and UI card logic, no separate classifier. The Ask-quality gate (check 3) runs only at S15; S32 runs a smoke of about 10 real questions on the human's model (about 200k model tokens at most). |
| D48 | Repository list (F3): GitHub shows a fine-grained token's reachable public repos beside the selected private ones, and Falkon cannot hide them. The picker labels each repository Private or Public, offers a "Private only" filter and shows "N repositories visible to this token". No claim that the token is scoped. |
| D49 | Toasts (F4): "Ingestion queued" dismisses itself after about 5 s; one "Evidence Generation <id> is current" toast shows when the status page sees a build finish while it is open. No cross-page notification system. |
| D50 | Verification: a Haiku verifier runs the Docker steps after the slices merge; the main session holds any long Docker step; the human retests with the PAT at gate 2. |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S31 chat answer rendering | Assistant answers render as GFM Markdown (headings, lists, tables, task lists, inline code, links), fenced code as a `pre` with language label, copy button and horizontal scroll, and a ```` ```mermaid ```` block as a diagram rendered lazily after the answer finishes, with "view source" and "copy source", falling back to the plain code block on a parse error or oversize source. Citations stay clickable inside rendered Markdown; literal `[n]` inside code and mermaid stays literal. Raw HTML is never rendered; links are `http(s)` or `mailto` only with `rel="noopener noreferrer"`. A partial (streaming) answer with an unterminated bold, list or fence must not throw or flicker. The Ask prompt addendum tells the model that GFM and mermaid render. Done: component tests with fixture answers (heading, nested list, table, code fence, mermaid, bad mermaid, `javascript:` link, raw `<script>`, citation beside bold, `[1]` in code, unterminated fence); a built UI shows the sample. | `packages/ui/src/features/chat/**` (a `markdown.tsx` and a lazy `mermaid-block.tsx`), `packages/ui/package.json` and lockfile, `packages/ui/src/app/globals.css`, `packages/web/src/lib/ask/prompt.ts` addendum only, UI tests. `paragraphs()` in `packages/web/src/lib/ask/evidence.ts` already keeps fences whole; change it only if a table or list needs it, with a test. | `pnpm typecheck && pnpm test`; UI build; `tests/contract` and `tests/golden/expected.json` diff empty | none | standard / claude |
| S32 chat behaviour | Greeting and meta messages get a conversational reply with no abstain card (D47); a failed first message leaves no empty thread. Done: contracts `kind` gains an additive `"reply"` value (existing payloads and the UI mock still parse); `evidence.ts` maps an answer with no evidence and the model's conversational marker to `reply`, anything else with no evidence stays `abstention`; the UI shows `reply` as plain prose with a "Try asking" line from `suggestions`; tests for "hey", "what can you do", a real unsupported question (still abstains) and a failed first send (thread removed or never created); the smoke of about 10 real questions (5 code questions that must stay grounded or partial, 3 greetings or meta, 2 unsupported) is run once and its result recorded in the report. ADR chat answer text amended in place. | `packages/contracts/src/index.ts` (+ test), `packages/web/src/lib/ask/prompt.ts` and `evidence.ts` (+ tests), `packages/api/src/ui.ts` thread create path, `packages/ui/src/features/chat/chat-view.tsx`, `docs/adr/0001-falkon-architecture.md` | `pnpm typecheck && pnpm test`; smoke run on the human's model (path only, never read `.env`) | S31 (shares `chat-view.tsx` and `prompt.ts`) | standard / claude |
| S33 wizard and status UX | D48 and D49. Done: repository rows show a Private or Public chip, a "Private only" toggle and a count line (the engine route returns `private` per repo, additive field); the queued toast clears after about 5 s and on unmount (no timer leak); a completion toast shows once when status moves from building to current while the page is open, never on first load of an already-current Product; tests for the picker filter and count, toast timing with fake timers, the transition rule. | `packages/api/src/connections.ts` (+ test), `packages/contracts/src/index.ts` repository schema (additive field), `packages/ui/src/features/setup/**`, `packages/ui/src/features/status/status-view.tsx`, UI tests | `pnpm typecheck && pnpm test`; UI build | none (parallel with S31; disjoint files, except `packages/contracts/src/index.ts`, where S32 and S33 edit different schemas: merge by hand) | standard / claude |

Order: S31 and S33 in parallel (own worktrees cut from the cycle branch), then S32. After merging, a Haiku verifier rebuilds the stack (`docker compose up --build`), checks `/api/repositories` is answered by the engine, and records the result.

Adversarial cases the reviewer checks: S31 model output is untrusted (HTML, `javascript:` and `data:` links, huge tables, a mermaid source of 100 KB, mermaid code that tries `click` callbacks), streaming partials, citations inside bold or table cells. S32 a greeting that also contains a code question ("hey, where is auth?") must be grounded; an empty message; a model reply that omits the marker (falls back to abstention). S33 zero repositories, 300 repositories (the connector cap), every repository public, a status poll that errors mid-build, a Product that is current at first load.

### Autonomy limits (cycle 8)

May decide alone: component structure, copy, the marker text for `reply`, the smoke question list, one fix round per slice. Must stop at gate 2 for: a dependency beyond D46, any change to `tests/contract` or `tests/golden/expected.json`, a non-additive contract change, a Prisma change, a sync-path change, spend beyond the S32 smoke, and any push or PR. Budget: 800k subagent tokens, 3 hours wall-clock.

Gate 1 approved by the human on 2026-10-21: cycle 8 plan as written. Loop runs autonomously to gate 2.

## Cycle 8 results (2026-10-21, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S33 wizard and status UX | kept (`6b0f211`) | Private/Public chips, "Private only" toggle, "N repositories visible to this token" over the visible rows, additive optional `private` on the repository contract; queued toast clears after about 5 s; one completion toast per building to current transition, never on first load, error, failure or another Product (compares `productId`). One fix round (count line over visible rows; product guard). |
| S31 chat rendering | kept (`c92f0d2`, merged `d517ca5`) | GFM Markdown (react-markdown, remark-gfm), plain `pre` with copy button, lazy mermaid (strict, 20,000-character cap, plain-code fallback, drawn only after the answer finishes), http/https/mailto links only, images and raw HTML not rendered, citations stay buttons, literal `[n]` in code stays literal; Ask prompt rendering addendum. One fix round (components module-level so nothing remounts; mermaid loader injected so tests tell parse failure from a missing DOM). D46 dependencies added. |
| S32 chat behaviour | kept (`19b24bb`) | Additive answer kind `reply` (marker `<!--reply-->` as the first line after the answer tag; evidence always wins; ignored when any tool read a file or the step cap hit; missing or misplaced marker keeps abstention); a failed first message deletes the thread the view just created. New admin route `DELETE ui/products/:slug/threads/:id` (204 empty, 409 once answered, 404 wrong Product, 401 no token: verified live). One fix round (marker position, evidence guard, atomic delete, abort cleanup, no partial alert on a reply). ADR chat transport amended in place. |

Cycle tip `19b24bb`: typecheck green; 430 tests pass, 0 fail across 8 packages on the S32 tree; UI build green with the API routes dynamic; `tests/contract` and `tests/golden/expected.json` diff empty; no Prisma or sync-path change; dependencies only `react-markdown`, `remark-gfm`, `mermaid` (D46). Each slice: independent Haiku verify green, Sonnet review with 0 blocking after one fix round.

Live smoke (disposable `falkon-c8` stack from the cycle tip, this repository indexed as one Product, the human's model through an absolute-path env file; about 1.5 minutes of model time): 8 of 10 as expected. Code questions 1 to 5 partial with 1 to 12 cited sources (16 to 59 s); "hey", "what can you do?", "thanks!" gave `reply` with 3 suggestions (3 to 7 s); "hey, where is auth?" stayed grounded-or-partial (12 sources). Two misses against the list's expectation of abstention: the swallow question got a polite `reply` (arguably better than the abstain card; the expectation was wrong) and the Kubernetes-operator question was `partial` with 4 sources and an answer that says none exists (the indexed clone contained the smoke list itself, so the model quoted the test case; not a reliable abstention test). Known gaps: a tagged reply after a search that finds nothing can still be a `reply` with code claims (needs a tool-call count from `agent.ts`); `onAccepted`'s update can throw not-found if a thread is deleted before it runs (practically unreachable); mermaid drawing, streaming flicker, the toast wiring and the failed-first-send flow were not exercised in a real browser (no DOM test library).

## Gate 2 decision, cycle 8 (human, 2026-10-21: approve)

| # | Decision |
|---|---|
| D51 | The admin route `DELETE ui/products/:slug/threads/:id` stays (the failed-first-message fix uses it; 409 once the thread has an answer). |
| D52 | For an off-topic question with no code evidence, a plain friendly `reply` is accepted (it replaces the abstain card there); abstention stays for code questions retrieval could not support. |
| D53 | The reply-guard gap (a tagged reply after a search that finds nothing can still carry code claims) is left for S13, where the tool-call count from `agent.ts` is added under the Ask-quality gate. |
| D54 | Smoke fixtures stay out of the indexed corpus: a live smoke clones from a commit that predates the question list, or excludes `.scratch/`. |

Carry-forward to cycle 9 (S13): the three items above, the prune pass for the loop skill (SKILL.md over its word budget, on the human's yes), and the carried non-blocking items (connector-skipped repos stay "Building", concurrent turns on one thread overwrite each other, dead `Credential.lastError`). Cycle 10: `@sbc/*` to `@falkon/*` and DB names, then S15.

## Cycle 9 plan: de-reference and Falkon config (S13 split into S34 to S36; grilled 2026-10-21; gate 1 approved 2026-10-21)

Base `main` at `626a856`. Roles: Claude only; Sonnet builds and reviews, Haiku verifies, Opus only if S36 misses its gate after one fix round. Cycle branch `loop/falkon-mvp-c9`. Input: `.scratch/falkon-mvp/cycle9-handover.md`. Inventory at the base: 118 predecessor-name hits in 36 tracked files outside `.scratch/` (env vars, header, `/api/ee/*`, verbatim Ask and KB prompts, 11 tool descriptions, the v3 config schema, README, comments). Cycle 10 = mechanical `@sbc/*` to `@falkon/*` and DB names, then S15 final gate, README, release notes.

### Decisions from the cycle 9 grill (human, 2026-10-21)

| # | Decision |
|---|---|
| D55 | S13 is cut into S34 (de-name plumbing), S35 (Falkon config schema and converter) and S36 (original rewrite of all verbatim text plus the reply-guard tool-call count, D53). Cycle 9 = S34, S35, S36; cycle 10 = rename and S15. |
| D56 | Originality is checked mechanically: a script reads the extracted text of the reference engine from a directory named by `ORIGINALITY_REF_DIR` and fails on any run of 8 or more consecutive words shared with Falkon's shipped prompt, tool-description and KB-prompt text. Zero hits is a done condition of S36. The script and its tests name no predecessor; the extraction recipe lives only in `.scratch/falkon-mvp/originality.md`. Tool names and input schemas stay (D9). |
| D57 | Measurement for S36: gate 3 once on Haiku (our plain-tools arm against the recorded v6 Haiku runs, rule D25, n=80) for tool descriptions and MCP instructions, plus a UI-Ask smoke of about 15 real questions on the human's model through a disposable stack before and after the rewrite (live recipe: memory note `live-smoke-with-human-env`; corpus is a clone from a commit that predates the question list, D54). Pass rule for the smoke: grounded or partial rate not lower than before, citation resolution (no dropped references) not worse, zero failed turns. No new harness arm for the server Ask. Total model spend cap $6 (Haiku only; no Sonnet confirmation unless Haiku shows a difference worth confirming). |
| D58 | The eval leak detector stops flagging reads of Claude Code's own tool-result spill files. The D25 pass rule and the data and gold do not change. The stored cycle 4 runs are re-scored offline to show zero real leaks, so the 80-question verdict is no longer withheld. |
| D59 | Clean break, no aliases: `SOURCEBOT_API_KEY` becomes `FALKON_API_KEY`, `SOURCEBOT_CHAT_MAX_STEP_COUNT` becomes `FALKON_CHAT_MAX_STEP_COUNT`, `SOURCEBOT_CHAT_MODEL_TEMPERATURE` becomes `FALKON_CHAT_MODEL_TEMPERATURE`, `SOURCEBOT_CLONE_VERSION` is dropped (the MCP server version stays `0.0.1`). The `X-Sourcebot-Api-Key` header is removed (only `Authorization: Bearer` is read). The old web app's `/api/ee/chat` and `/api/ee/chats` move to `/api/chat` and `/api/chats`; `/api/ee/mcp` is deleted (`/api/mcp` stays). |
| D60 | Config: every key stays; the schema is Falkon's own at `packages/shared/schemas/falkon/config.json` with a Falkon `$id`, describing only the supported subset (`github` and `git` connections, `settings`, `contexts`, `environmentOverrides`, `knowledgeBase`); the loader ignores the `$schema` value (an editor hint). `scripts/convert-config.ts old.json > new.json` drops unsupported connection types with a printed warning and sets the new `$schema`. An old file that uses only supported keys already validates. No compatibility mode. |
| D61 | `packages/web` (the old search, repos and Ask pages) is not retired; only its text and route names change. Retirement is post-MVP (D16). |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S34 de-name plumbing | D59 applied and every predecessor mention removed outside the prompt, tool-text, KB-prompt and config-schema files that S35 and S36 own. Done: the four env names replaced or dropped everywhere (code, tests, `.env.example`, README, compose); `x-sourcebot-api-key` no longer read (a request with only that header gets 401 with an access file or key set); `/api/ee/*` routes moved or deleted and the old web client and tests updated; `docker/Dockerfile`, README (except the config section S35 owns), `packages/web/src/app/layout.tsx`, `serviceError.ts`, comments in shared, backend and web, and a comment-only line in `packages/db/prisma/schema.prisma` (no migration, no generated-client change) scrubbed; leftovers in UI copy (docs page demo-token text, UI README line, mock connection error, chat empty state "mock dataset", config generic-git Product showing provider `github-enterprise`) fixed; ADR 4.8 and README amended in place for the clean break; `git grep -i -E "sourcebot|falcon" -- . ':!.scratch' ':!pnpm-lock.yaml'` has no match outside the files S35 and S36 own. | `packages/web/src/app/**`, `packages/web/src/lib/{auth,mcp,serviceError}.ts`, `packages/web/src/lib/ask/{agent,models,chat,http,answer}.ts` and tests (env names, route paths, comments only; no prompt text), `packages/shared/src/{access,zoekt,queryParser,query/tokens}.ts` comments and tests, `packages/backend/src/**` comments, `packages/ui/**` copy, `docker/Dockerfile`, `.env.example`, `docker-compose.yml`, README, ADR. Not: `prompt.ts`, `toolText.json`, `tools.ts`, `shared/src/kb/**`, `config.ts`, `schemas/**`, `tests/contract/**`. | `pnpm typecheck && pnpm test`; `tests/contract` and `tests/golden/expected.json` diff empty; the grep above; a request test per removed name | none | standard / claude |
| S35 Falkon config schema and converter | D60. Done: `packages/shared/schemas/falkon/config.json` (own `$id`, supported subset only, no predecessor name) replaces `schemas/v3/index.json`; `config.ts` loads it and ignores the `$schema` value; `config.example.json` and the README config section describe Falkon's format; `scripts/convert-config.ts` converts an old file (JSONC with comments, dropped unsupported connection types with a printed warning, new `$schema`, idempotent); every existing config test and the example parse unchanged. | `packages/shared/schemas/**`, `packages/shared/src/config.ts` (+ test), `scripts/convert-config.ts` (+ test), `config.example.json`, README config section, ADR 4.8 config sentence | `pnpm typecheck && pnpm test`; the converter run on the example and on a fixture with a gitlab connection; grep clean for the files in scope | none (parallel with S34; README is the only shared file, merge by hand) | standard / claude |
| S36 original rewrite and reply guard | D56 to D58. Done: the Ask static and per-chat prompts, the chat-naming prompt, the 11 tool descriptions (`toolText.json`, `tools.ts` and the pinned snapshots), the MCP server instructions and the KB prompts are rewritten in Falkon's own words with the same behaviour contract (the `<!--answer-->` tag, the `@file:{repo::path:a-b}` citation syntax, the reply marker, the render and impact addenda, `finish_doc` validators all unchanged); only `description` fields change in `tests/contract/registration*.json` (input schemas, names, annotations, order and `outputs.json` diff empty), hand-reviewed at gate 2; the originality script (D56) reports zero shared 8-word runs against the reference text; the reply guard also requires that no tool ran (tool-call count passed from `agent.ts`, test: a search that returns nothing plus the marker abstains); the leak detector fix and offline re-score (D58); gate 3 on Haiku and the before and after UI-Ask smoke (D57) recorded in `baseline.md`. | `packages/web/src/lib/ask/{prompt,impact,evidence,agent}.ts` and tests, `packages/shared/src/{toolText.json,tools.ts}` and tests, `packages/shared/src/kb/**` prompt text only, `packages/web/src/lib/mcp.ts` instructions text, `tests/contract/registration*.json` description fields, `tests/originality/**` (new), `tests/eval/**` leak detector and test only, `.scratch/falkon-mvp/{originality,baseline}.md`, ADR 4.8 as built | `pnpm typecheck && pnpm test`; originality script clean; `git grep` rule clean repo-wide; contract diff limited to description fields; paid runs by the main session (Docker), cap $6 | S34 (shares `agent.ts`) | standard / claude; Opus only if the gate misses after one fix round |

Order: S34 and S35 in parallel (own worktrees cut from the cycle branch, merge by hand), then S36. Docker serialised, main session only: the before smoke runs on the base stack before S36 builds, the after smoke and gate 3 run after S36 merges.

Adversarial cases the reviewer checks: S34 the old header alone is 401, `/api/ee/*` is 404, old env names have no effect (documented), an empty `FALKON_API_KEY` leaves the API open as today, route moves leave no dead client call; S35 empty object, JSONC comments, every unsupported connection type (gitlab, gitea, bitbucket, azuredevops, gerrit), token forms `{env}` and `{googleCloudSecret}`, an unknown key names itself in the error, converter idempotent, a 5 MB file, invalid JSON; S36 a citation-syntax drift breaks `evidence.ts` so a test asserts the exact tag and syntax in the prompt, 8-word shingles across lines and markdown punctuation, tool descriptions still mention every parameter, no prompt text promises a tool that is not registered, KB prompts keep the `finish_doc` contract, the rewritten prompt does not leak the smoke question list.

### Autonomy limits (cycle 9)

May decide alone: prompt and description wording, the converter's CLI shape and messages, the 15 smoke questions (not committed into the corpus), the originality tool's internals, one fix round per slice. Must stop at gate 2 for: a dependency, a Prisma change beyond one comment line, any change to `tests/golden/expected.json`, a contract snapshot change beyond `description` fields, a change to eval data, gold or the D25 rule, model spend beyond $6, any push or PR. Budget: 1.2M subagent tokens, 4 hours wall-clock (S36 is the large slice).

Gate 1 approved by the human on 2026-10-21: cycle 9 plan as written. The human asked for the build to run in a fresh session on Opus (main session; builders and reviewers stay Sonnet, verifiers Haiku, passed explicitly). Loop runs autonomously to gate 2.

## Cycle 9 results (2026-10-21, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S34 de-name plumbing | kept (`154a70c`) | D59 applied: `FALKON_API_KEY`, `FALKON_CHAT_MAX_STEP_COUNT`, `FALKON_CHAT_MODEL_TEMPERATURE`; version env dropped; old header no longer read (only-old-header request is 401 with a key or access file set; empty key stays open: `auth.test.ts`); `/api/ee/chat(s)` moved to `/api/chat(s)`, `/api/ee/mcp` deleted, no client call left; MCP server name `falkon-mcp-server`; a config Product over plain git remotes reports provider `git` (additive `productProviderSchema` in contracts; connections still reject `git`); KB sentinel `falkon://knowledge` (never matched on); UI copy leftovers, comments, README, ADR 4.8. One fix round: the web test glob was unquoted, so nested tests (the new `auth.test.ts`) never ran; now quoted. |
| S35 Falkon config schema and converter | kept (`5c7a0bf`, merged `08c33ed`) | D60: `packages/shared/schemas/falkon/config.json` (`$id` `urn:falkon:config`, 693 lines, own descriptions: 0 shared 8-word runs with the old schema) replaces the 10k-line v3 schema; loader strips `$schema`, rejects a non-object top level, names an unsupported connection type or model provider and points to `pnpm convert-config`; `scripts/convert-config.ts` drops unsupported connections, model providers and the unused `apps`/`identityProviders` keys with a warning each, sets `$schema`, is idempotent, exits non-zero on invalid JSON. `models` kept (the Ask reads it), limited to the three wired providers. One fix round: the first schema kept 12 model providers (9 unwired) and 373 of 389 descriptions verbatim, and the unsupported-type error was oneOf noise. |
| S36 original rewrite and reply guard | kept (`cf57cc2`) | Ask prompts, 10 shared tool descriptions, MCP instructions and the two web-only tool descriptions, KB prompts and validator messages rewritten; tag, marker, citation syntax, addenda and `finish_doc` unchanged (prompt test pins them); contract and `toolSchemas.v3.json` diffs differ only in `description` values (checked by masking). `tests/originality` (`pnpm originality`, reads `ORIGINALITY_REF_DIR`): 127 hits before, 2 after; the 2 are the grep/glob "results truncated" hints that `tests/contract/outputs.json` pins (gate 2). Reply guard also requires zero tool calls. Leak rule exempts only the client's own spill-file path shape; stored cycle 4 runs re-score to 0 leaks. One fix round: restored the prompt's emphasis on the answer tag, no partial answers and concision; tightened the spill rule; parameter check for the web-only tools. |

Cycle tip `cf57cc2`: typecheck green; 461 tests pass, 0 fail across 8 packages (S36 tree); `tests/golden/expected.json` and `tests/contract/outputs.json` unchanged; one comment line in `schema.prisma`, no migration; no dependency change; `git grep -i -E "sourcebot|falcon" -- . ':!.scratch' ':!pnpm-lock.yaml'` empty.

Gate 3 on Haiku (D57, rule D25, n=80 against the recorded v6 Haiku runs): **PASS**, recall +0.090 [0.040, 0.149], wins 17, losses 2; precision +0.012; spend $0.62. One dev run was first flagged by the traversal rule (a `Read` of its own work dir through `..`) and rerun; with the original restored the verdict is identical. Details in `baseline.md`.

UI-Ask smoke (D57), after the human topped up the model provider: before (image from `bca8673`) and after (cycle tip) on the same corpus, 15 questions. Grounded or partial 10/10 both; failed turns 0 both; dropped references 0 before, 1 after (question 2, a `README.md` reference the agent never read). Diagnostic reruns of that question show the same unread-README drops on the base image too, so the miss is run-to-run variation, not the rewrite; strictly the citation part of the rule is worse by one reference, for the human to accept or not. Details in `baseline.md`.

## Gate 2 decision, cycle 9 (human, 2026-10-21: approve)

Approved as built: S34, S35 and S36 kept; the UI-Ask smoke's one-reference miss (question 2) accepted as run-to-run variation. Open for cycle 10 (from the digest, not decided): rewording the two contract-pinned truncation hints (originality hits), trimming unused schema keys, a published schema URL, and the unread-file citation drop seen on both images. The loop edit and project lesson were not accepted (no `+loop`, no `+project`). Cycle 10: `@sbc/*` to `@falkon/*` and DB names, then S15.

## Cycle 10 plan: fixes, UI distill and Connect page, rename (grilled 2026-10-21; gate 1 approved 2026-10-21)

Base `main` at `c788fbf`. Roles: Claude only; Sonnet builds and reviews, Haiku verifies, Opus plans and decides (main session), Opus builders only if a slice misses after one fix round. Cycle branch `loop/falkon-mvp-c10`. The memory-ceiling decision and all live gates move to cycle 11 (S15), with the ops-smoke probe of `c788fbf` as input.

### Decisions from the cycle 10 grill (human, 2026-10-21)

| # | Decision |
|---|---|
| D62 | Postgres user, password and database `sbc` become `falkon`. README carries a one-time upgrade note for existing volumes (`ALTER ROLE sbc RENAME TO falkon; ALTER DATABASE sbc RENAME TO falkon;` plus a password reset), no data loss. No `sbc` left outside `.scratch` (asserted by a test or the verify grep). |
| D63 | `@sbc/*` packages become `@falkon/*`; cookie `sbc_key` becomes `falkon_key`; `SBC_TEST_*` becomes `FALKON_TEST_*`. Clean break, no aliases. |
| D64 | `.dockerignore` excludes `.scratch`, `.loop` and eval datasets (and anything else nothing in the image reads); S15 asserts the built image holds no `.scratch` and no predecessor name. |
| D65 | `.scratch/` stays tracked for MVP; the release notes say it must move to a private branch or repository before any public push. |
| D66 | S15's Ask check is gate 3 rerun on Haiku on the final tip (about $0.6); no Sonnet run unless Haiku shows a drop. |
| D67 | The grep and glob "results truncated" hints are reworded in `tools.ts` and in their 3 lines of `tests/contract/outputs.json` (approved tool-output text change); originality goes to 0. |
| D68 | The unread-file citation drop is fixed in the Ask prompt (cite only lines a tool showed; read a file before citing it), with a test; `evidence.ts` verification is not loosened. Measured by question 2 of the cycle 9 smoke rerun 3 times on the tip. |
| D69 | Connector-skipped repositories show state Skipped (with the reason when one is already recorded), are excluded from "Indexing N of M", and a Product with only skipped repositories reads "No repositories could be indexed". No schema change. Unused schema keys (permission sync, `enablePublicAccess`, `enforcePermissions`) are dropped from the Falkon schema; the converter drops them with a warning. `Credential.lastError` stays (no migration; nothing reads it). Concurrent turns on one thread stay a documented known limit. |
| D70 | Status page shows only: one verdict line with generation and age, a Sync now button, the repositories table (name, branch, state, last indexed), one knowledge-base line, gaps and errors only when present, a progress line only while building. Section nav, layer cards, the stage bar, scenario prose and duplicate counts go. |
| D71 | A per-Product Connect page (`/<product>/connect`, in the shell nav) with tabs Claude Code (`claude mcp add --transport http falkon-<p> <url>`, `-H "Authorization: Bearer …"` in apiKey mode), Codex (`codex mcp add falkon-<p> --url <url>`, `--bearer-token-env-var` in apiKey mode) and VS Code Copilot (`.vscode/mcp.json`, `"type": "http"`, headers in apiKey mode), each with a copy button; URL = optional `FALKON_MCP_URL` (default `http://127.0.0.1:3001`) + `/mcp/<product>`; a short tool list and a short "reading an answer" help block. No live connection test. `/docs` is deleted. |
| D72 | Mock data is test-only: production and dev UI routes without `ENGINE_URL` return 503 with "ENGINE_URL is not set"; no synthetic data outside tests. |
| D73 | UI design: the builder loads the `impeccable` skill, follows `packages/ui/DESIGN.md` and `.impeccable/design.json`, runs a critique and distill pass over every page (setup, status, chat, settings, Connect), applies removals and clarity fixes only (copy, empty, loading and error states, nav trim), and rewrites the stale `PRODUCT.md`. Anything bigger is listed for later. Visual approval at gate 2 from screenshots (1280 and 375 px). |
| D74 | Cycle 10 = S38 and S39 in parallel, then S37 (rename last, so it covers new code). Cycle 11 = S15: the four regression checks (memory ceiling decided there), image content check, real-browser UI check on the human's model, gate 3 on Haiku, release `0.1.0` (`RELEASE_NOTES.md`, README pass, local tag `v0.1.0` after gate 2; no push). |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S38 fixes | D67, D68, D69. Done: the two hints reworded, `outputs.json` changed only on those 3 lines, `pnpm originality` (with `ORIGINALITY_REF_DIR`) exits 0; Ask prompt has the read-before-cite rule and a test pins it; skipped repositories show Skipped and are excluded from the build count, with tests for all-skipped, mixed, and none-skipped Products; the three unused schema keys removed and the converter drops them with a warning (tested); known limits listed in README. | `packages/shared/src/tools.ts` (hint text), `tests/contract/outputs.json` (3 lines), `packages/web/src/lib/ask/prompt.ts` + tests (and the `impact.test.ts` hash pin), `packages/api/src/{uiProduct,ui}.ts` + tests, `packages/contracts` (only if a Skipped state needs adding to the repository state enum), `packages/shared/schemas/falkon/config.json`, `packages/shared/src/config.ts` + tests, `scripts/convert-config.ts` + test, README known-limits lines. Not `packages/ui` (S39 renders the state). | `pnpm typecheck && pnpm test`; `git diff --stat -- tests/contract` shows only `outputs.json`, and only the hint lines; originality 0; main session reruns cycle 9 smoke question 2 three times on a tip stack (unresolved references reported) | none | standard / claude |
| S39 UI distill and Connect page | D70 to D73. Done: status page reduced as D70 (tests updated); Connect page with three snippets built from one function, unit-tested for URL, Product slug and the apiKey variants; `/docs` gone and no link to it remains; UI routes without `ENGINE_URL` return 503 and no production import of the mock store remains (test); critique pass applied with a short list of what was removed or clarified per page; `PRODUCT.md` current; UI tests and `next build` green; every shell link resolves. | `packages/ui/**` (including `PRODUCT.md`, `DESIGN.md` only if the design system changes), and the `ui` service environment in `docker-compose.yml` (pass `FALKON_MCP_URL` and `AUTH_MODE`; the Connect page reads them from the UI server env). Not `packages/api` or `packages/contracts` (S38 owns them). | `pnpm typecheck && pnpm test`; `rm -f packages/ui/.next/lock && pnpm --filter @sbc/ui build`; a grep that no non-test file imports the mock store; main session screenshots at 1280 and 375 px on a disposable stack | none (parallel with S38; if both need the repository state enum, S38 owns `packages/contracts` and S39 renders whatever state it sends) | standard / claude |
| S37 rename | D62 to D65. Done: `@sbc/*` → `@falkon/*` in every package name, import, filter and script; Postgres user, password and db `falkon` in compose, the ops-smoke script, eval stack and tests; cookie `falkon_key`; `FALKON_TEST_*`; README upgrade note; `.dockerignore` excludes `.scratch`, `.loop` and eval datasets; `pnpm-lock.yaml` regenerated by `pnpm install` (no dependency version change); `git grep -i -w -E "sbc|sbc_key" -- . ':!.scratch' ':!pnpm-lock.yaml'` and `git grep "@sbc/"` empty; ADR mentions updated. | Repository-wide mechanical rename outside `.scratch`; `pnpm-lock.yaml`. No behaviour change. | `pnpm install && pnpm db:generate && pnpm typecheck && pnpm test`; the two greps above; `tests/contract` and `tests/golden/expected.json` diff empty; the UI build; main session builds the image and checks `docker run --rm <img> sh -c 'ls -a /app; ls /app/.scratch'` shows no `.scratch` | S38, S39 | standard / claude |

Adversarial cases the reviewer checks: S38 a Product whose repositories are all skipped, one skipped plus one indexed, a skip reason missing, the converter on a file with each dropped key, the prompt rule does not forbid citing a file read through `read_file` after a `grep`; S39 an apiKey-mode snippet never contains a real token (placeholder or env var only), a Product slug with dashes, `FALKON_MCP_URL` with and without a trailing slash, a 375 px viewport, no `ENGINE_URL` gives 503 not mock data, nothing links to `/docs`; S37 no `sbc` survives in compose, Dockerfile, scripts, CI-like scripts or tests, an existing volume upgrade note that works (the main session runs the SQL against a scratch Postgres with an `sbc` database), lockfile has no version change (`git diff pnpm-lock.yaml` touches only workspace names).

### Autonomy limits (cycle 10)

May decide alone: UI copy and layout within `DESIGN.md`, what the critique removes, prompt wording for D68, hint wording for D67, the converter's warning text, one fix round per slice. Must stop at gate 2 for: a new dependency, a Prisma schema change, any contract snapshot change beyond the 3 `outputs.json` hint lines, any change to `tests/golden/expected.json`, a change to eval data, gold or the D25 rule, a new feature beyond the Connect page, model spend beyond the question-2 reruns, any push or PR. Budget: 1.5M subagent tokens, 4 hours wall clock.

Probe for cycle 11 (ops-smoke on `c788fbf`, 2026-10-21): every functional step passes (cold start, indexing, api, registry, oversized file, golden baseline, stability and api, resync, delete, teardown); memory FAIL at 665.67 MB against the 654 MB ceiling (545 MB +20%), 11.7 MB over. The memory decision for S15 starts from this number.

Gate 1 approved by the human on 2026-10-21: cycle 10 plan as written. Main session stays on Opus (planner and decider); builders and reviewers Sonnet, verifiers Haiku.

## Cycle 10 results (2026-10-22, waiting at gate 2)

| Slice | Outcome | Evidence |
|---|---|---|
| S38 fixes | kept (`25eac92`, fix `eb1db5e`) | Truncation hints reworded (3 `outputs.json` lines); originality 0. Read-before-cite prompt rule. Skipped repositories: inferred as a member with no repository row after a clean connection sync (connector skips are only logged, so no reason is shown; a sync already running when the Product is edited can briefly mark a new member Skipped, noted in code); excluded from the build count; all-skipped reads "No repositories could be indexed". Optional typed `state` on the repository contract. `enforcePermissions*` dropped from the schema; the converter drops the old permission keys with a warning. README known limits. Fix round (main session, test-first): live reruns showed the prompt rule did not help: the agent had read `README.md`, but `glob` and `list_tree` also recorded deeper `README.md` files as sources, so every `README.md` citation was ambiguous and dropped; an exact path now wins when exactly one candidate has it. Question 2 of the cycle 9 smoke, 3 reruns on the tip: 3 grounded, 2 of 2 references resolved each (before the fix on the same tip: 2 abstentions, 1 partial). |
| S39 UI distill and Connect | kept (`da110e3`, fix `f2aa55b`) | Status page: verdict and generation line, Sync now, repositories table (name, branch, typed state), knowledge-base line, gaps and progress only when present. Connect page: three stacked snippets (Claude Code, Codex, Copilot in VS Code) from one tested function, apiKey variants without a real token, accessible copy button, a default-address note, tool names only. `/docs` deleted; mock data test-only (UI routes without `ENGINE_URL` return 503); critique pass removed demo copy, the Jira/Confluence step, the fake account menu and about 600 lines of dead CSS; `PRODUCT.md` rewritten. Reviews: code (2 blocking: `indexing` rendered as Skipped, "Last indexed" showed the pushed time) and design (7 blocking, all removals or accessibility); one fix round amended D70 and D71 toward "only what is necessary" (no Last indexed column, no scenario sentence, no "reading an answer" block, no tool descriptions, stacked snippets instead of tabs). Main-session screenshots at 1280 and 375 px in `.scratch/falkon-mvp/screens-c10/` (taken before `f2aa55b`, which removes a per-line border inside snippets seen at 375 px). |
| S37 rename | kept (`e0381a0`, merged `2da6655`) | `@sbc/*` to `@falkon/*`, Postgres `falkon`, cookie `falkon_key`, `FALKON_TEST_*`; lockfile changes only workspace entries (no external version change); README upgrade note run by the main session against a scratch `postgres:17-alpine` with an `sbc` role and database (data kept, password login over TCP works, temp role dropped). `.dockerignore` excludes `**/.scratch`, `**/.loop`, `**/.claude` and the eval datasets (review caught that root-only patterns would ship `packages/ui/.scratch`); the built image holds no `.scratch`, no datasets and no predecessor name outside `node_modules` and `.next`. |

Cycle tip `f2aa55b`: typecheck green; 471 tests pass, 0 fail across 8 packages; UI build green; originality 0; contract diff since `c788fbf` only the 3 `outputs.json` hint lines; `tests/golden/expected.json` unchanged; no Prisma change, no dependency change; name greps clean (`sbc` only in the README upgrade note).

Open for S15 (cycle 11): `tests/golden/expected.json` line 2811 still holds the old grep truncation hint, so the live golden diff in ops-smoke will differ on that one line until the baseline is re-recorded (needs the human's OK); memory 665.67 MB against the 654 MB ceiling (probe of `c788fbf`); the status page showed a loading spinner for 3 to 5 seconds at first load on the disposable stack (not investigated).

## Gate 2 decision, cycle 10 (human, 2026-10-22: approve)

Approved as built: S38, S39 and S37 kept, including the D70 and D71 amendments made at review. Open for cycle 11 (S15), decided at its grill: re-recording the golden baseline line that holds the old grep hint, the memory ceiling (665.67 MB against 654 MB), the 3 to 5 s status first-load spinner. The loop edit and project lesson were not accepted (no `+loop`, no `+project`).

## Cycle 11 plan: final gate (S15) and release 0.1.0 (grilled 2026-10-22; gate 1 pending)

Base `main` at `ba4b94f`. Cycle branch `loop/falkon-mvp-c11` (this worktree). Handover: `.scratch/falkon-mvp/cycle11-handover.md`. Roles: Claude only; Sonnet builds and reviews, Haiku verifies, Opus plans and decides (main session). Live work (Docker, the human's model, the browser) stays in the main session. The codebase-memory server timed out at session start; discovery falls back to `git grep` and direct reads, and the cycle worktree is indexed as its own project if the server comes up.

### Decisions (human, 2026-10-22, and consequences)

| # | Decision |
|---|---|
| D75 | S15 may re-record the one line of `tests/golden/expected.json` (line 2811) that holds the old grep "Results truncated" hint, which S38 reworded. That line only; the diff goes in the digest. |
| D76 | The memory ceiling is left alone at this stage. ops-smoke must pass every functional step; the memory figure (665.67 MB against 654 MB at the probe of `c788fbf`) is information in the digest and `baseline.md`, not a keep condition. No memory work this cycle; size and optimisation are post-MVP. |
| D77 | A bounded look (one hour of effort at most, no refactor) at the 3 to 5 s first-load spinner on the status page. Fix it only if the cause is small and local; otherwise record it as a known limit. |
| D78 | Consequence of D76: `scripts/ops-smoke.sh` prints the memory figure as `INFO memory: ...` and no longer exits non-zero when it is over 654 MB. Measurement integrity still fails the step (missing container, unreadable usage, not six services). Spec "Regression gate" item 4 and ADR section 9 item 4 are amended in place to say the memory figure is reported, not enforced, for 0.1.0. |
| D79 | Consequence of D75: the line 2811 edit is made offline (replace the old hint text with the exact reworded text in `packages/shared/src/tools.ts`, one line changed, JSON still valid). S41's live ops-smoke is the confirmation: its golden diff must be empty. Any other differing line stops the cycle at gate 2. |
| D80 | Version policy: every workspace `package.json` goes to `0.1.0` (the UI already is), the MCP server `version` literal in `packages/web/src/lib/mcp.ts` becomes `0.1.0`, and a test fails when that literal differs from `packages/web/package.json`. The root `package.json` has no version and stays so. The tag `v0.1.0` is made in step 8 only, on the merge commit, after the human's approval at gate 2. No push. |
| D81 | Live order, one stack at a time (ops-smoke is timing-sensitive under load): prelude probes and a baseline image build, then ops-smoke, image content check, the browser stack, gate 3 on the eval stack. Disposable compose project names and ports only; the human's project `falkon` and the `falcon-sourcebot-*` containers are not touched. |

### Slices

| # | Goal and done condition | Scope | Verify | Blocked by | Tier / agent |
|---|---|---|---|---|---|
| S40 ops info and golden line | D75, D78, D79. Done: ops-smoke memory step prints `INFO memory: whole clone stack N MB (reference ceiling 654 MB)` and exits 0 for any N; the integrity checks still fail the step (tested); `tests/golden/expected.json` differs from `main` by exactly one line (2811), now holding the reworded hint, valid JSON; spec Regression gate item 4 and ADR section 9 item 4 amended; `baseline.md` records the probe figure as information. | `scripts/ops-smoke.sh`, `packages/shared/src/opsSmoke.test.ts`, `tests/golden/expected.json` (line 2811 only), `.scratch/falkon-mvp/{spec,baseline}.md`, `docs/adr/0001-falkon-architecture.md` (section 9 item 4 only). | `pnpm typecheck && pnpm test` (rerun `@falkon/shared` alone once if `opsSmoke.test.ts` times out under load); `git diff --stat main -- tests/golden tests/contract` shows `expected.json` with 1 insertion and 1 deletion and nothing in `tests/contract`; `node -e` parse of `expected.json`; the new line equals the hint text in `tools.ts` | none | standard / claude |
| S42 release 0.1.0 | D80. Done: all workspace versions `0.1.0`; MCP server version `0.1.0` with the equality test; `RELEASE_NOTES.md` (what 0.1.0 holds, upgrade pointer to the README note, known limits carried from the handover, the memory figure as information, and the sentence that `.scratch/` (529 tracked files naming the predecessor product, plus eval gold) moves to a private branch or repository before any public push, D65); README pass for MVP (no stale claims, "Not implemented" and "Known limits" current, version stated); ADR line that says the MCP server reports `0.0.1` updated; `packages/ui/.data/` ignored (runtime file); name rule holds (the notes say "the predecessor product", never its name). | Every `packages/*/package.json` and `tests/eval/package.json`, `packages/web/src/lib/mcp.ts` and a test beside it, `RELEASE_NOTES.md`, `README.md`, `.gitignore`, `docs/adr/0001-falkon-architecture.md` (the version sentence only). | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`; `git grep -n '"version": "0.0.1"' -- 'packages/*' 'tests/*'` empty; `git diff main -- pnpm-lock.yaml` empty; name greps from `AGENTS.md` clean (tracked files outside `.scratch/`); `tests/contract` diff empty | S40 (both amend the ADR and the spec, so they run in sequence) | standard / claude |
| S41 final live gate on the release tip | D74, D76, D77. Done, each with evidence in a "Cycle 11 results" table: (a) tool contract tests green (`pnpm test`); (b) ops-smoke PASS on every functional step including an empty golden diff, memory printed as INFO; (c) image content check prints nothing; (d) real-browser check on the human's model through the built-in browser on a disposable stack: status page, Connect page, a chat turn with Markdown, a mermaid diagram, toasts (Sync now, copy), and the failed-first-send flow, with screenshots at 1280 and 375 px in `.scratch/falkon-mvp/screens-c11/` and a pass or defect line per item; (e) the D77 finding recorded (small fix applied, or a known limit with the measured cause); (f) gate 3 on Haiku rule D25 (cycle 9 recipe; model spend cap $6, Haiku only) PASS; (g) disposable stacks and eval stack torn down. Defects from (d) are fixed only when small (one fix round by a `loop-implementer`, UI copy, CSS or toast code, tests kept green), else listed for later. | Main session runs all live steps. A builder may touch `packages/ui/**` and at most one `packages/api` status route for (d) and (e). No other code. Screenshots and the results table under `.scratch/falkon-mvp/`. | The seven items above; `pnpm typecheck && pnpm test` again if a fix lands | S40, S42 | main session (live); `standard` builder only for the fix round |

Prelude (before S40, main session): one cheap provider probe (a single `reply` turn on a throwaway stack, the provider once returned HTTP 402), `docker info`, and a baseline image build from the branch tip in the background. The D77 look runs on that baseline stack while S40 builds; a small fix lands in S41's fix round and rebuilds the `ui` image only.

Adversarial cases the reviewer checks: S40 memory over 654 MB exits 0 and still prints the figure; an unreadable `MemUsage`, a missing container or five instead of six services still fails; the edit to `expected.json` leaves every other byte equal (`git diff -U0` shows one hunk) and the JSON parses; no reference to "enforced" memory remains in the spec or ADR. S42 no `0.0.1` left in a shipped file except where history is stated; the equality test fails when either side drifts; the release notes carry the `.scratch/` warning, the upgrade pointer and no predecessor name; `.gitignore` entry does not hide a tracked file. S41 the 402 case (stop, ask the human), a failed first send recovers on retry, no horizontal scroll at 375 px, toasts announce themselves, no real token or `.env` content in any screenshot, teardown leaves only the human's own containers.

### Autonomy limits (cycle 11)

May decide alone: release notes and README wording, the INFO line wording, small UI fixes found by the browser check and the D77 fix when local and small (about 30 lines, no refactor), one fix round per slice, the order of live steps. Must stop at gate 2 (early) for: a golden diff beyond line 2811; any `tests/contract` change; gate 3 not PASS (report with the sensitivity row, never relax D25); a functional ops-smoke step failing after one fix; the image content check printing anything after one fix; a defect that needs more than a small fix; a provider 402 or other outside failure; a new dependency; a Prisma schema change; spend beyond the caps (Haiku gate 3 $6 total, the human's model UI check about $2); any push, PR, merge to `main` or tag before the human replies at gate 2; touching the human's compose project `falkon` or the `falcon-sourcebot-*` containers. Budget: 800k subagent tokens (recent cycles used 630k to 825k with three builder slices; this cycle has two small builder slices, one possible fix round and mostly main-session live work), 5 hours wall clock (the cold image build and ops-smoke take 10 to 25 and about 15 minutes; gate 3 about 40 minutes).

Gate 1 approved by the human on 2026-10-22: cycle 11 plan as written (S40, S42, S41; D75 to D81). Main session stays on its current model for the cycle (Sonnet); builders and reviewers Sonnet, verifiers Haiku.

## Cycle 11 results (2026-10-22, waiting at gate 2)

Cycle tip: see the digest. Typecheck green; 473 tests pass, 0 fail across 8 packages.

| Slice | Outcome | Evidence |
|---|---|---|
| S40 ops info and golden line | kept (`8257db1`, merged `9bcd9dc`) | ops-smoke memory step prints `INFO memory` and exits 0 for any figure; integrity failures (unreadable usage, five services) still fail and are tested; `tests/golden/expected.json` differs from `main` by line 2811 only (one hunk), the old grep hint replaced by the exact text in `tools.ts`; spec Regression gate item 4, ADR section 9 item 4 and `baseline.md` amended (D76, D78, D79). Review: no blocking findings. |
| S42 release 0.1.0 | kept (`ebd744b`, merged `afd6275`) | All workspace versions 0.1.0, MCP server version 0.1.0 with an equality test, `RELEASE_NOTES.md`, README pass, ADR version sentence, `.gitignore` for `packages/ui/.data/`. Review found one blocking defect: the notes (and my brief) listed the code graph and the overview Map as shipped, but D28 deferred both. Fixed by the main session: the notes now describe the opt-in impact recipe and list the graph and Map under known limits; "529" became "more than 500" (535 tracked files now). |
| S41 final live gate | done, one item needs the human | Table below. |

### S41 evidence (release tip, `afd6275`)

| Check | Result |
|---|---|
| (a) Tool contract | `pnpm test` green; `git diff main -- tests/contract` empty. |
| (b) ops-smoke, cold | Exit 0. PASS cold-start, searchable x4, indexing, api, registry, oversized-file, golden-baseline (empty diff after the line 2811 edit), golden-stability, golden-api, resync, delete-repo, teardown. `INFO memory: whole clone stack 665.17 MB (reference ceiling 654 MB)` (api 72.6, backend 266.6, postgres 80.0, redis 16.4, web 135.5, zoekt 63.4 MiB). Information only (D76). |
| (c) Image content | Built image: no `.scratch` and no match for the predecessor name or the c-misspelling outside `node_modules` and `.next`. The image's busybox `grep` lacks `-I` and `--exclude-dir`, so the equivalent `find ... -prune ... | xargs grep -l` ran instead. |
| (d) Browser check | Human's model (DeepInfra), disposable stack on the release image, built-in browser; screenshots in `.scratch/falkon-mvp/screens-c11/` (1280 px: status, connect, engine-down, failed first send, chat answer, mermaid; 375 px: status, connect, chat). Status and Sync now (busy state, then refreshed) pass; Connect snippets correct, copy shows "Copied", no page overflow at 375 px; a chat turn with citations, an evidence panel, Markdown lists, inline code, a table and a mermaid diagram (drawn, one SVG) passes; failed first send (engine stopped while streaming) shows "The answer didn't arrive" with Retry, and Retry produced the answer. Toasts no longer exist (removed by the D70 distill); the Sync now busy state and the Copy confirmation are the feedback that remains. |
| (e) D77 spinner | Not an app defect. Server render 0.14 s, status route 0.04 s; with the browser pane hidden the page's fetches started 5 to 8 s after the scripts loaded (the same on the Connect page, so not status specific), with the pane shown they start at 0.4 s. Recorded as a hidden-pane artifact; no fix. |
| (f) Gate 3 on Haiku | See below. |
| (g) Teardown | Disposable stacks (`falkon-c11`, smoke project, `falkon-eval`) and the images `falkon-c11-app`, `falkon-smoke-app` removed; the human's project `falkon` and the `falcon-sourcebot-*` containers untouched. |

Non-blocking findings from (d), not fixed (listed for later): after the engine goes down with a page open, recovery from the error view takes two "Try again" clicks; the model's answer began with a stray backtick (model output, stored that way); with the evidence panel open the mermaid diagram renders narrow and tall.

### Gate 3 on Haiku (D66, rule D25)

Client model claude-haiku-5-5, arm `clone-tools` on an eval stack built from the release tip; reference: the recorded v6 Haiku runs (80), the one `xrepo-framework-to-chart-25` reference run re-flagged as not leaked (D58). Pilot: 5 runs, recall 0.950, 0 leaks. Spend $0.59 (cap $6). Reports: `.scratch/falkon-mvp/gate3-c11-report-rerun.md` and `...-as-recorded.md`; the two set-aside runs are in `.scratch/falkon-mvp/eval-runs-c11-malformed/`.

Two runs ended with prose instead of the required JSON answer (counted as malformed): `xrepo-framework-to-chart-24` (dev) and `xrepo-framework-to-chart-6` (hidden), both Haiku formatting failures on first try. As in cycle 9, each was set aside and its one question rerun; both reruns were well formed.

| View | n | Recall diff vs reference [95% CI] | Wins / losses | Failed / malformed / leaked | D25 |
|---|---:|---|---|---|---|
| Reruns in place (dev) | 48 | +0.0885 [0.0156, 0.1771] | 7 / 1 | 0 / 0 / 0 | |
| Reruns in place (hidden) | 32 | +0.1234 [0.0547, 0.2016] | 9 / 0 | 0 / 0 / 0 | |
| Reruns in place, pooled | 80 | +0.1025 [0.0479, 0.1640] | 16 / 1 | 0 / 0 / 0 | PASS |
| As recorded, pooled | 80 | +0.0837 [0.0208, 0.1515] | 16 / 3 | 0 / 2 / 0 | withheld (2 malformed runs) |

Cycle 9 for comparison: +0.090 [0.040, 0.149], 17 / 2, no malformed. Both views clear the numeric thresholds (lower bound above -0.10, losses at most twice wins); only the "no malformed run" clause holds in the rerun view alone. Recall 0.960 against 0.857 for v6.

### Open for the human at gate 2

1. Gate 3 read: PASS with the two malformed reruns, "withheld" as recorded (numbers pass; two Haiku formatting failures out of 80). Accept the rerun view, as cycle 9 did for a harness-rule artifact, or not. A malformed run is a model failure, not a harness artifact, so this is a stricter reading of the precedent.
2. `CONTEXT.md` still defines Map and Potential impact as domain terms although D28 deferred both; leave as the target language or trim.
3. The README tagline calls Falkon "modeled on an existing source-available code context engine" (untouched, pre-existing text).
