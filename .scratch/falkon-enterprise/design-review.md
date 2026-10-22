# Enterprise context engine: design review and phased plan

**Date:** 2026-10-22. **Input:** the "three planes" design (lexical Zoekt plane, SCIP + FalkorDB graph plane, Qdrant hybrid unstructured plane, MCP orchestrator, defense-in-depth ACLs). **Baseline:** Falkon 0.1.0 (`v0.1.0`), ADR-0001, spec `.scratch/falkon-mvp/spec.md` (D1 to D80).

Status: review complete; plan proposed; nothing decided. Every decision below is the human's.

---

## 1. Verdict

The design is a sound generic reference architecture for enterprise RAG, but it is not a plan for Falkon. Measured against what Falkon already is and already learned:

- **Plane 1 is already shipped.** Zoekt, ctags symbol boosting, positional trigrams, and the MCP tools are Falkon 0.1.0. The proposed upgrades to it (sparse n-grams, dirty working-tree overlay) are either not available upstream or explicit non-goals.
- **Plane 2 is already designed** in ADR-0001 sections 5 and 6 (`GraphStore` port over Postgres, SCIP ingestion, per-build head switch, coverage gaps), and deliberately deferred by D28 until testers show impact questions the lexical loop misses. The design swaps Postgres for FalkorDB on the strength of a vendor benchmark, and adds CFG/DDG/CDG layers nobody can produce across languages.
- **Plane 3 and the orchestrator re-introduce the stack Falkon measured and dropped.** ADR 2.2: on 80 paired questions, the earlier semantic stack (embeddings, reranker, vector DB) did not beat lexical access plus an agent loop on code (dev recall -0.057, hidden -0.094 against this engine). D2 dropped it; D3 keeps models off the MCP serving path; D8 says nothing ships without beating the engine on its own stratum.

What the design gets right, and what is genuinely new for Falkon:

1. **Non-code sources** (pull requests, reviews, issues, Jira, ADRs, design docs). Falkon ingests none of them. This is ADR capability 5, "Why and history", listed as *Later: needs sources the engine does not ingest yet*.
2. **Provenance links** (commit to PR to ticket to declaration). Cheap, deterministic, and the backbone of "why did this change".
3. **An enterprise permission model** (principals stamped at index time, group closure resolved at query time, never expand users into documents). Falkon today has Products, `auth.mode: none|apiKey`, and lists SSO and permission sync as non-goals.

So the path to "enterprise" is: add sources and provenance first, lexically, inside the current stack; add identity when a deployment needs it; add vectors and a graph store only when an eval stratum proves the lexical version misses.

---

## 2. Claim check

Facts checked against primary sources on 2026-10-22.

| Claim in the design | Finding | Consequence |
|---|---|---|
| Zoekt: positional trigrams, pick two trigrams and check distance, rune offsets every 100 runes, ASCII short-circuit, ~3x index (3.5x shard), 1.2x RAM | Accurate per Zoekt `doc/design.md`. Nuance: the doc says any pair "for which the number of matches is minimal", not strictly first and last. | Nothing to do; this is Falkon today. |
| "Upgrade to sparse n-grams" | Upstream Zoekt has no sparse n-gram support. Sparse grams exist in GitHub Blackbird (Rust, `rust-gems` crate) and ClickHouse `sparseGrams()`. | Would mean forking the Zoekt indexer, against D10 (upstream probe passed). Latency is not Falkon's bottleneck; recall is. **Drop.** |
| Commit-anchored dirty working-tree overlay | Explicit non-goal (ADR 10, "uncommitted or workspace edits"). The client agent already has the local checkout and its own grep. | **Drop.** |
| SCIP schema (`metadata` first for streaming, `typed_range` oneof with `SingleLineRange`/`MultiLineRange`, role bits 0x1 to 0x20) | Accurate per current `scip.proto`; the old `repeated int32 range` is deprecated. Role list omits `ForwardDefinition = 0x40`. | ADR 5.1 should read `typed_range` and `typed_enclosing_range` when the graph returns. |
| Monikers resolve definitions across repositories deterministically | Only when both repos are indexed and package name and version match. Earlier cycle 14: Java core-to-REST joined 2,733 `CALLS` edges correctly; TypeScript cross-repo imports stayed unresolved (3,135 gaps). | Keep ADR open decision 2 as written; do not promise it. |
| Tree-sitter diff hunk to enclosing declaration | Sound and cheap. Falkon already extracts declaration spans with universal-ctags. | Keep, using ctags spans first; tree-sitter only if ctags spans prove too coarse. |
| Code Context Graphs (CFG, DDG, CDG) | No off-the-shelf multi-language producer; each needs per-language program analysis. GraphCoder is a code-completion paper, not agent retrieval. | **Drop.** |
| Two-phase Merkle sync | Git is already a Merkle DAG: equal commit SHA is phase 1, `git diff --name-only A..B` is phase 2. Falkon is server-side and has no client index to sync. | **Drop.** |
| FalkorDB over Neo4j (2,500 vs 220 q/s, p99 83 ms vs 41,157 ms, 95 MB vs 600 MB) | Vendor benchmark, inconsistent with itself (homepage p99 83 ms, blog p99 136.2 ms), run on a social graph (SNAP Pokec), not a code graph. Neo4j is not the alternative anyway: ADR 4.1 chose Postgres. FalkorDB is **SSPLv1**: offering Falkon as a hosted service would oblige releasing the whole service's source, or buying a commercial licence. In-memory, against a stack already at 665 MB. | Keep Postgres behind `GraphStore`; FalkorDB only if the Postgres size and latency probe fails *and* the licence is acceptable. |
| Qdrant 1.19 `query_points_groups`, `search()` gone | Accurate: 1.19.0 shipped 2026-08-05 (1.19.2 on 2026-10-05) and removed the legacy search endpoints. 1.19 also adds per-tenant IDF for BM25. | Fine if Qdrant is ever used. |
| `models.Document(text, model="voyage-code-3")` in the prefetch | Server-side inference with a third-party model is a Qdrant Cloud inference feature; a self-hosted Qdrant does not call Voyage. Self-hosted, the client embeds the query itself. | Code as written likely does not run on Falkon's `docker compose` shape. |
| Embedding table (CoQuIR, MTEB numbers) | CoQuIR is real (ACL 2026, 23 retrievers; MRS is "Margin-based Ranking Score"). The per-model numbers could not be confirmed from the paper in this review. Matryoshka 1024 to 256 dimensions is 4x on raw vectors, not "nearly 6x". | Treat as unverified. Falkon's own eval is the arbiter (D8). |
| "Voyage rerank-3" | No such model. Current: `rerank-2.5` and `rerank-2.5-lite`, 32K combined per pair with at most 8K for the query. Cohere Rerank 4 (Dec 2025, Fast and Pro) is 32K. `Qwen3-Reranker-0.6B` is 32K. | Fix names if reranking is ever used. |
| Orchestrator: query decomposition, intent router, five-stage pipeline | A model on the serving path, against D3. In Falkon the MCP client's model is the orchestrator; `research_codebase` already hands it a recipe. | Encode stages as a research recipe for the client, not a server pipeline. |
| Four orthogonal tools replace the surface | Breaks regression gate check 1 (11 tool names, schemas and outputs frozen). | New tools are additive only. |
| Fail-closed late ACL check against the source API on top-20 per query | Remote I/O per request, against AGENTS.md "Request-path code". | Replace with permission sync on a schedule, a TTL'd cache, and a staleness bound that fails closed. |
| Principals stamped at index time, user closure at query time, payload-only updates on permission change | Correct, standard pattern. | Keep for Phase 6. For GitHub PRs and issues, visibility equals repository visibility, so no per-document ACL is needed until Jira or Confluence. |

---

## 3. What the design leaves out

- **Evaluation.** No stratum exists for "why" or "history" questions, so nothing in Planes 2 or 3 could pass D8 today. This must come first.
- **Ingestion mechanics for external sources:** polling versus webhooks, rate limits (GitHub REST 5,000 per hour per installation), backfill depth, edits and deletions, retention.
- **Identity:** the design names Entra and SCIM but has no plan for users, SSO, or how a user maps to a code-host account for permission sync.
- **Footprint:** the stack is six services at 665 MB. The design adds FalkorDB, Qdrant, and a GPU reranker, with no budget.
- **Tenancy:** how `tenant_id` relates to Product (a Product is a question boundary, not a tenant).
- **Audit:** who asked what, which enterprise buyers will require.

---

## 4. Phased plan

Each phase runs as one or more cycles of the existing loop (grill, slices, gate 1, build, gate 2). Each new capability ships behind a flag until it passes D8 on its own stratum. The regression gate (four checks) holds throughout.

### Phase 0: frame (no product code)

- Decide what "enterprise" means first: sources and history, or identity and permissions (open decision E1).
- Author a **why-and-history stratum**: about 40 questions, dev and hidden split, gold citations that include commits, PRs and tickets. Candidate corpus: the OpenMRS repositories already in `tests/eval/datasets` (`openmrs-xrepo.json`, `o3-impact.json`), which have public GitHub PRs and a public Jira whose ticket keys appear in commit messages (to verify in this phase).
- Extend the eval scorer so evidence can be a commit, PR, or ticket, not only a file span.
- Amend ADR-0001 in place: capability 5 moves from "Later" to the target; record this review's drops; amend CONTEXT.md terms (provenance, discussion, principal) as they land.

### Phase 1: history from git alone (no new sources, no new services)

- Additive tools over the bare clones: history of a file range or declaration (`git log -L` on the ctags span), and commit-to-declaration mapping (diff hunks to enclosing ctags declarations).
- Extract ticket keys and PR numbers from commit messages by pattern; return them as references.
- Measure on the stratum. Commit messages alone may answer a useful share of "why" questions.

### Phase 2: GitHub pull requests and issues

- Ingest PRs, review comments, and issues for each Product repository through the existing connection (GitHub App needs read on Pull requests and Issues in addition to Contents and Metadata). Commit-to-PR links from `GET /repos/{owner}/{repo}/commits/{sha}/pulls`.
- Store in Postgres; materialize as Markdown in a companion git repository per owner repository, indexed by Zoekt, the same way the knowledge base is. This gives lexical search over discussions with zero new search infrastructure, and exact-token hits on error codes and IDs.
- Visibility equals the owner repository's visibility, so Product scoping (P3 to P5) covers it unchanged.
- A provenance tool: from a commit, PR, issue, or declaration to the linked others. Links live in Postgres behind a `ProvenanceStore` port until ArcadeDB enters (E6).

### Phase 3: Jira (and other ticket systems)

- Same pattern: ingest, link by ticket key, materialize, index lexically.
- First source whose visibility is not a repository's. Interim rule: a Jira project is attached to a Product explicitly by the operator. Per-document ACLs wait for Phase 6.

### Phase 4: semantic retrieval for prose, only if earned

- Enter only if Phases 2 and 3 show paraphrase misses on their strata.
- First candidate: `pgvector` plus `tsvector` with RRF (k=60) inside the existing Postgres; embeddings for discussions and tickets only, never code (ADR 2.2). Qdrant only if Postgres fails a size or latency probe.
- Embedding the query at request time puts a model on the serving path; that needs an explicit amendment of D3 (open decision E3).

### Phase 5: structural graph, only if earned

- ADR-0001 sections 5 and 6 (SCIP for TypeScript and Java, per-build head switch, coverage gaps), entered under the D28 condition: impact questions the lexical recipe misses. Store is ArcadeDB (E4, E6), so ADR 4.1 and spec D2 are amended in place at entry; the `GraphStore` port, build and head semantics, coverage records, and the P7 isolation rule carry over unchanged.
- First slice of the phase: ArcadeDB acceptance gates (capacity on O3, restart, backup, restore) before any tool reads from it.
- Provenance links from Phases 1 to 3 move from Postgres into ArcadeDB and attach to declaration units by key.

### Phase 6: enterprise identity and permissions

- OIDC sign-in; users and groups; an `oidc` `AccessPolicy` adapter producing a per-user effective set.
- Code-host permission sync on a schedule (which repositories a user can read), cached with a TTL and a staleness bound that fails closed; no per-request calls to the source.
- Principals stamped on ingested documents; group closure cached per user; audit log of requests.
- Can move earlier if a deployment needs it before new sources; it is orthogonal to Phases 1 to 5.

### Dropped

Sparse n-grams, dirty working-tree overlay, CFG/DDG/CDG, Merkle sync, a server-side orchestrator, replacing the tool surface, and per-request live ACL checks against source systems.

---

## 5. Decisions

### Made (human, 2026-10-22)

| # | Decision |
|---|---|
| E1 | First target is sources and history (Phases 1 to 3). Identity and permissions (Phase 6) come later. |
| E2 | The why-and-history stratum is built on OpenMRS. |
| E4 | **ArcadeDB, not FalkorDB or Qdrant, is the store for the new planes.** This conflicts with spec D2 ("No ArcadeDB") and ADR-0001 4.1 (graph in Postgres behind `GraphStore`); the human has chosen ArcadeDB, so both are amended in place when ArcadeDB first enters the stack. Scope and entry point: open item E6. |

ArcadeDB facts relevant to E4: Apache 2.0 (removes the SSPL question of E5); one JVM process holding graph (Cypher and Gremlin), documents, an LSM vector index on JVector with INT8 encoding since 26.5.1, and Lucene full-text with native BM25 scoring since 26.7.1, so one store can cover both the graph plane and the hybrid plane. The earlier design validated ArcadeDB 26.9.1 over its HTTP/JSON API for Product-scoped exact lookup, bounded one-hop traversal, idempotent upsert and Product isolation on a fixture; capacity, restart, backup, restore and recovery were never passed and stay acceptance gates. Costs: a JVM service on a stack reported at 665 MB, and a second store beside Postgres, so registry joins cross stores (ADR 4.1 option A).

### Open

| # | Decision | Recommendation |
|---|---|---|
| E3 | Is D3 (no model on the MCP serving path) still binding for query-time embeddings? | Keep binding until Phase 4 is entered with evidence. |
| E5 | Is a hosted offering planned? | Moot for ArcadeDB (Apache 2.0); still answer before any SSPL or BSL dependency. |
| E6 | Closed (human, 2026-10-22): see below. | |

**E6 (human, 2026-10-22).** Postgres serves every new table until SCIP is introduced. ArcadeDB enters with SCIP (Phase 5) and from then holds the structural graph; the provenance links built in Phases 1 to 3 move into it at that point. Consequence: Phases 1 to 3 put provenance behind a port (a `ProvenanceStore` beside the deferred `GraphStore`), so the move is an adapter change plus a one-time copy, not a rewrite. Where vectors live if Phase 4 runs before Phase 5 (pgvector, then a later move, or ArcadeDB early) is decided at Phase 4 entry.

## Sources

- Zoekt design: https://github.com/sourcegraph/zoekt/blob/main/doc/design.md
- SCIP schema: https://github.com/sourcegraph/scip/blob/main/scip.proto
- GitHub code search (Blackbird, sparse grams): https://github.blog/2023-02-06-the-technology-behind-githubs-new-code-search/
- FalkorDB licence: https://docs.falkordb.com/license.html
- FalkorDB benchmark: https://www.falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j/
- Qdrant 1.19: https://qdrant.tech/blog/qdrant-1.19.x/
- CoQuIR: https://arxiv.org/abs/2506.11066
- Voyage rerank-2.5: https://mongodb.com/company/blog/product-release-announcements/rerank-2-5-and-rerank-2-5-lite-instruction-following-rerankers
- Cohere Rerank 4: https://venturebeat.com/ai/coheres-rerank-4-quadruples-the-context-window-to-cut-agent-errors-and-boost
- GitHub commits-to-pulls endpoint: https://docs.github.com/rest/commits
