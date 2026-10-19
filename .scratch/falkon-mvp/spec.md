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
3. **Ask quality.** The O3 stratum with v6.0.1's recorded numbers as the floor (dev 0.973, hidden 0.923); lower CI bound of (clone minus floor) at or above -0.05 after the prompt rewrite.
4. **Ops.** The compose stack comes up cold, indexes, resyncs on a push, and deletes a repo. Core memory stays at most +20% over 545 MB before new services.

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

