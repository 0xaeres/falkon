# sourcebot-clone

Self-hosted code search + Ask agent + MCP server, modeled on Sourcebot v6.

```
config.json ──► backend (BullMQ worker) ──► bare git clones + zoekt shards (shared /data volume)
                  │ state                                   │
               Postgres (Prisma)                     zoekt-webserver :6070
                                                            │
        MCP (stdio) ──HTTP──► web (Next.js) ◄──────────────┘
                              /api/search  /api/tools/:name  /api/ask  UI
```

| Package | Role |
| --- | --- |
| `packages/db` | Prisma schema: `Repo`, `ChatSession` |
| `packages/shared` | config schema, Sourcebot-query to Zoekt translator, Zoekt client, git readers, **tool registry** (one definition used by MCP and Ask) |
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

## Query syntax

`foo bar` (AND), `"exact phrase"`, `a or b`, `( )`, `-negate`, `file:` `repo:` `rev:` `lang:` `sym:`. Terms are literal; tick "regex" for regex. Only HEAD is indexed unless `revisions.branches` is set per connection.

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

Verified locally: query translator tests, typecheck, Zoekt search + every tool (except symbol tools, which need universal-ctags), `next build`, REST + API-key auth, MCP stdio `tools/list` and `tools/call`, backend clone/index with Postgres+Redis, Ask loop against a mock LLM.
Not verified: `docker compose up --build` (Dockerfile Go version, Zoekt `@latest` build), symbol tools, real LLM provider, GitHub connector.
