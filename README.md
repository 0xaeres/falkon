# sourcebot-clone

Self-hosted code search + Ask agent + MCP server, modeled on Sourcebot v6.

```
config.json ──► backend (BullMQ worker) ──► bare git clones + zoekt shards (shared /data volume)
                  │ state                                   │
               Postgres (Prisma)                     zoekt-webserver :6070 (internal only)
                                                            │ gRPC
        MCP (stdio) ──HTTP──► web (Next.js) ◄──────────────┘
                              /api/search[/stream]  /api/tools/:name  /api/ask  UI
```

| Package | Role |
| --- | --- |
| `packages/db` | Prisma schema: `Repo`, `ChatSession` |
| `packages/shared` | config schema, query parser + IR, gRPC Zoekt client, git readers, access scopes, **tool registry** (one definition used by MCP and Ask) |
| `packages/backend` | resolves connections (git / local / github), clone/fetch (bare), `zoekt-git-index`, periodic resync, removes repos dropped from config |
| `packages/web` | search UI, repos page, Ask page, REST API |
| `packages/mcp` | stdio MCP server proxying every tool to the web API, plus `ask_codebase` |

## Run (Docker)

```bash
cp .env.example .env && cp config.example.json config.json   # edit both
docker compose up --build
```

UI: http://localhost:3000

## Run (local dev)

Needs Postgres, Redis, and `zoekt-webserver` + `zoekt-git-index` + git (+ universal-ctags for `sym:` / symbol tools) on PATH.

```bash
pnpm install && pnpm db:generate && pnpm db:push
pnpm dev:backend     # terminal 1
zoekt-webserver -index ./data/index -rpc -listen :6070   # terminal 2
pnpm dev:web         # terminal 3
```

## Engine

Same architecture as Sourcebot 5.x, written independently:

- **Zoekt fork.** Docker builds `sourcebot-dev/zoekt` at the commit Sourcebot pins (`ZOEKT_REF` in `docker/Dockerfile`). Upstream zoekt lacks the `-tenant_id`/`-repo_id` indexer flags. Go 1.26 is required.
- **Query path.** Search syntax string, then `queryParser.ts` (own recursive-descent parser) into a query IR (`ir.ts`, mirrors the `Q` proto), then a gRPC `Search`/`StreamSearch` call (`zoekt.ts`, protos in `packages/shared/proto`). User text only ever lands in IR leaves, so it cannot add an `or` or widen a repo scope.
- **Defaults.** Without `rev:` a search is AND-ed with `branch HEAD` (the indexed default branch). The request asks zoekt for `n+1` matches so `isSearchExhaustive` can tell a complete result from a cut one.
- **Indexing.** `zoekt-git-index -allow_missing_branches -max_trigram_count 20000 -file_limit 2MB -tenant_id 1 -repo_id <db id> -shard_prefix_override 1_<id>`, repo metadata (`zoekt.name`, `archived`, `fork`, `public`) via the bare repo's git config, revisions = default branch + `revisions.branches`/`tags` globs, capped at 64.
- **Zoekt has no auth.** It is `expose`d inside the compose network only. Never publish its port.

### Query syntax

`foo bar` (AND), `"exact phrase"`, `a or b`, `( )`, `-(group)`, `-file:x`; filters `file:`/`f:`, `repo:`/`r:`, `rev:` (`rev:*` = all branches), `lang:`, `sym:`, `content:`/`c:`, `reposet:a,b`, `archived:yes|no|only`, `fork:yes|no|only`, `visibility:public|private|any`. Terms are literal substrings; the regex toggle makes them RE2. `context:` is not supported.

### Licensing note

Sourcebot v5.1.16 (the last open source release) is under FSL-1.1-ALv2, not MIT: no "Competing Use" as a commercial product or service, with `ee/` under a separate license. v6 is closed source. None of its code was copied here: the parser, IR, gRPC client and indexer glue are original. The Zoekt `.proto` files come from the Apache-2.0 Zoekt lineage. I did read Sourcebot's source while building this, so this is not a formal clean-room.

## Knowledge base

Generated, citation-backed architecture docs per repo (`knowledgeBase` in `config.json`; off by default). A multi-stage LLM pipeline writes them:

| Stage | What it does |
| --- | --- |
| Territories | Splits the file tree into weight-bounded slices (deterministic, no LLM) |
| Scouts | One agent per territory finds load-bearing systems; a too-big territory is re-carved at half size |
| Reconciler | Merges duplicates into at most 24 canonical systems and assigns existing docs |
| Surveyors | One per system: dispositions for existing docs (keep/merge/delete) and up to 6 proposals, each with claims that name proving files |
| Merge agent | One validated work list (coverage, path rules, sources, absorb caps, at most 120 creates) |
| Doc agents | One per item, confined to its own path. `finish_doc` refuses frontmatter, stubs, over 20k chars, and any `@file:{repo::path}` that does not resolve at the scanned commit |
| README | Narrative from the LLM; the index and dependency list are composed by code |

- **Storage.** A bare git repo per source repo, named `<repo>::knowledge`, committed per document and indexed by Zoekt like any repo, so search, MCP tools and Ask find the docs with no new tools. They rank first in non-streaming results. A knowledge repo is visible exactly when its owner repo is.
- **Delta scans.** A citation index (doc to cited files and commits) selects only docs whose cited files changed or were renamed; changed files no doc cites go to surveyors. It escalates to a full scan when there was never one, the last is over 7 days old, over 500 files changed, or over half the cited files changed.
- **Cost control.** Hard `tokenBudget` per scan (cache hits are free); old tool output is elided from agent prompts; agents are warned, then forced to call their finishing tool near the step cap. A small repo costs about 50k tokens, a 144-file repo about 1.6M.
- **Safety.** Agents read only the repo being documented unless `citeRepos` lists others: repo text could steer an agent, and a knowledge base is readable by anyone who can read its owner.
- **Operate.** `/knowledge` page and `POST /api/knowledge {repo, action: scan|delete|include}` (unrestricted key only). Needs `LLM_*` env vars (OpenAI-compatible).

Design is from Sourcebot's public docs and my reading of its `ee/` code in the v6 image, implemented independently; that code is under a commercial license (see the licensing note above).

## MCP

```json
{ "mcpServers": { "sourcebot-clone": {
  "command": "pnpm", "args": ["--dir", "/path/to/sourcebot-clone", "mcp"],
  "env": { "SOURCEBOT_URL": "http://localhost:3000", "SOURCEBOT_API_KEY": "" } } } }
```

## Ask

OpenAI-compatible chat completions with tool calling: set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The agent loops (max 12 steps) over the same tools as MCP and must cite `[repo:path#Lx-Ly]`.

## Auth

Set `SOURCEBOT_API_KEY` to require `Authorization: Bearer <key>` on `/api/*`. The browser UI then also needs a cookie `sbc_key=<key>`. There is no user model, permission sync, or SSO.

## Not implemented (vs Sourcebot)

Users/orgs/SSO, permission syncing, GitLab/Bitbucket/Azure connectors, Knowledge Base, skills tools, `list_language_models`, streaming Ask, file viewer UI, symbol navigation UI.

## Verified vs not

Verified: 40 unit tests (parser, IR mapping, auth scope, glob); typecheck; `docker compose up --build` with the Zoekt fork; gRPC search, streaming (SSE), every tool and Ask against a real LLM; repo removal; zoekt port not published.
Not verified: GitHub connector, multi-branch/tag indexing against a large repo, ACCESS_FILE fail-closed path end to end (unit-tested only), search contexts (unsupported).
