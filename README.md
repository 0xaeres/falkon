# Falkon

Self-hosted code search + Ask agent + MCP server, modeled on an existing source-available code context engine. Version 0.1.0 (see [`RELEASE_NOTES.md`](RELEASE_NOTES.md)).

```
config.json ──► backend (BullMQ worker) ──► bare git clones + zoekt shards (shared /data volume)
                  │ state                                   │
               Postgres (Prisma)                     zoekt-webserver :6070 (internal only)
                                                            │ gRPC
        MCP clients ──HTTP──► web (Next.js) ◄──────────────┘
                              /api/search[/stream]  /api/mcp  /api/chat/blocking  /api/chat  UI
```

| Package | Role |
| --- | --- |
| `packages/db` | Prisma schema: `Repo`, `Chat` |
| `packages/shared` | config schema, query parser + IR, gRPC Zoekt client, git readers, access scopes, **tool registry** (one definition used by MCP and Ask) |
| `packages/backend` | syncs config `connections` (GitHub, generic git URL, `file://` in place), clone/fetch (bare), `zoekt-git-index`, reindex/resync on `settings` schedules and on config change, orphan cleanup, search contexts |
| `packages/web` | search UI, repos page, Ask page, REST API |
| `packages/contracts` | Zod 4 schemas shared by the engine and the Falkon UI |
| `packages/ui` | Falkon UI (Next 16): Products, status, Connect and Ask chat, served by the engine's admin API |

## Run (Docker)

```bash
cp .env.example .env && cp config.example.json config.json   # edit both
docker compose up --build
```

UI: http://localhost:3000

Falkon UI (compose service `ui`, host loopback only): http://127.0.0.1:3100. Locally: `pnpm --filter @falkon/ui dev --hostname 127.0.0.1 --port 3100`.

## Run (local dev)

Needs Postgres, Redis, and `zoekt-webserver` + `zoekt-git-index` + git (+ universal-ctags for `sym:` / symbol tools) on PATH.

```bash
pnpm install && pnpm db:generate && pnpm db:push
pnpm dev:backend     # terminal 1
zoekt-webserver -index ./data/index -rpc -listen :6070   # terminal 2
pnpm dev:web         # terminal 3
```

## Engine

Zoekt-based architecture, written independently:

- **Zoekt.** Docker builds upstream `sourcegraph/zoekt` (Apache-2.0) at the commit pinned by `ZOEKT_REF` in `docker/Dockerfile`; the license text ships in the image under `/usr/share/licenses/zoekt/`. The repository name goes to the indexer through a `-meta` file containing `{"Name":"<repository name>"}`. Go 1.26 is required. **Upgrading from the fork build:** existing shards load under upstream Zoekt unchanged, and each repository reindexes once on its next sync because the indexer options changed; `repository_id` and `tenant_id` now read as 0 in results, and nothing in the engine uses them.
- **Query path.** Search syntax string, then `queryParser.ts` (own recursive-descent parser) into a query IR (`ir.ts`, mirrors the `Q` proto), then a gRPC `Search`/`StreamSearch` call (`zoekt.ts`, protos in `packages/shared/proto`). User text only ever lands in IR leaves, so it cannot add an `or` or widen a repo scope.
- **Defaults.** Without `rev:` a search is AND-ed with `branch HEAD` (the indexed default branch). The request asks zoekt for `n+1` matches so `isSearchExhaustive` can tell a complete result from a cut one.
- **Indexing.** `zoekt-git-index -allow_missing_branches -max_trigram_count 20000 -file_limit 2MB -meta <metadata.json> -shard_prefix_override 1_<id>`, repo metadata (`zoekt.name`, `archived`, `fork`, `public`) via the bare repo's git config, revisions = default branch + `revisions.branches`/`tags` globs, capped at 64.
- **Zoekt has no auth.** It is `expose`d inside the compose network only. Never publish its port.

### Query syntax

`foo bar` (AND), `"exact phrase"`, `a or b`, `( )`, `-(group)`, `-file:x`; filters `file:`/`f:`, `repo:`/`r:`, `rev:` (`rev:*` = all branches), `lang:`, `sym:`, `content:`/`c:`, `reposet:a,b`, `archived:yes|no|only`, `fork:yes|no|only`, `visibility:public|private|any`. Terms are literal substrings; the regex toggle makes them RE2. `context:` is not supported.

### Licensing note

The engine this project is modeled on is source-available under a license that forbids competing commercial use, and its newest release is closed source. None of its code was copied here: the parser, IR, gRPC client and indexer glue are original. The Zoekt `.proto` files come from the Apache-2.0 Zoekt lineage. I did read its source while building this, so this is not a formal clean-room.

## Knowledge base

Generated, citation-backed architecture docs per repo (`knowledgeBase` in `config.json`; on by default, set `enabled: false` to turn it off). It needs the `LLM_*` environment variables: without them scans are skipped, nothing is spent, the backend logs `knowledge base skipped: no model configured` once at start, and no scan is recorded. One scan spends at most `tokenBudget` tokens (default 2,000,000). A repository's first scan logs `kb <repo> first scan estimate ~N tokens (cap M)` before the first model call, where N is the total size of the files in the repo's tree at the head commit divided by 4, capped at `tokenBudget` (an upper bound: agents read part of the tree). A multi-stage LLM pipeline writes them:

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

Design is from the modeled engine's public docs and my reading of its enterprise-licensed code, implemented independently; that code is under a commercial license (see the licensing note above).

## MCP

Streamable HTTP at `/api/mcp`, stateful sessions owned by the caller, API key via `Authorization: Bearer`. No OAuth. Tools keep the reference engine's names, input schemas, descriptions, annotations, registration order and output text: `grep`, `glob`, `get_diff`, `list_commits`, `list_branches`, `list_repos`, `read_file`, `list_tree`, `find_symbol_definitions`, `find_symbol_references`, `list_language_models`, and `ask_codebase` when a model is configured (verified against v6.0.1 with a differential harness, since retired). Not implemented: the skills tools (`create_skill`, `update_skill`, `list_skills`).

```json
{ "mcpServers": { "falkon": { "type": "http", "url": "http://localhost:3000/api/mcp",
  "headers": { "Authorization": "Bearer <key>" } } } }
```

A second NestJS service (`packages/api`, compose service `api`) serves the same tools per Product at `POST|DELETE /mcp/<product>`; an unknown or malformed name (`^[a-z0-9][a-z0-9-]{0,62}$`) is a 404 with no fallback. It runs beside the routes above, which are unchanged. It listens on `API_HOST` (default `127.0.0.1`) and `API_PORT` (default `3001`), and compose publishes it on host loopback only. Compose runs the esbuild bundle (`pnpm --filter @falkon/api build`, then `node packages/api/dist/main.js`); locally, `pnpm --filter @falkon/api start` runs the source under tsx.

Products live in Postgres (`Product` rows). Config `contexts` are imported as read-only `source=config` Products on every sync (a context whose name is not a valid slug, or whose slug an API-created Product holds, is skipped with a log line). Products created through the admin API (`source=api`) are never touched by the import; their `definition` (the shape of a config context: `include`, `includeConnections`, `includeTopics` and the `exclude*` counterparts) is resolved to repositories when written and again on every sync. The admin API is a second listener in the same process on `API_ADMIN_HOST` (default `127.0.0.1`) and `API_ADMIN_PORT` (default `3002`), published on host loopback only. It is always on and needs the admin token (see "Admin token" below). Every request needs exactly one `Authorization: Bearer <admin token>` header (the scheme is case-sensitive); anything else is the same `401`, whatever the path. The token is read from that header only and is never logged. The admin API is for operators on the host and for the UI container (`api` is in `API_ALLOWED_HOSTS`): `GET|POST /products`, `GET|PUT|DELETE /products/<slug>`, `POST|GET /connections`, `DELETE /connections/<id>`, `PUT /connections/<id>/token`, `GET /connections/<id>/repositories`, and the UI-shaped Product routes `GET|POST /ui/products`, `GET|PATCH /ui/products/<slug>`, `GET /ui/products/<slug>/status`, `POST /ui/products/<slug>/sync`, and the chat routes `GET|POST /ui/products/<slug>/threads`, `GET /ui/products/<slug>/threads/<id>`, `POST /ui/products/<slug>/threads/<id>/messages` (the UI chat: body `{ text }` only, history is kept by the engine, the answer streams as an AI SDK UI message stream with `data-evidence` and `data-answer` parts; needs a configured language model and the Product's first generation) (JSON only, 64 KiB bodies; the slug is fixed at creation; config Products answer 409 to writes). Both listeners answer only `Host` names on loopback; add names behind a proxy with `API_ALLOWED_HOSTS` (comma-separated).

`AUTH_MODE` selects the access policy on `/mcp/<product>`: `none` (default) admits every caller to the Product's repositories; `apiKey` requires `Authorization: Bearer <key>` checked against `ACCESS_FILE` and serves the Product's repositories that the key also covers. With `apiKey`, a missing, unreadable, malformed or empty access file denies everyone; any other `AUTH_MODE` value stops the service at start. An MCP session is bound to the Product, the caller and the repository set it opened with: it is refused under another Product path, by another caller, or after the Product's membership or the key's scope changed.

### Stored credentials

Tokens entered in the UI are stored encrypted (AES-256-GCM) in Postgres and are never returned by any endpoint or written to logs. The key is `FALKON_SECRET_KEY` (base64 of 32 random bytes, e.g. `openssl rand -base64 32`) or the file named by `FALKON_SECRET_KEY_FILE`; with neither set, `api` and `backend` generate one into `/data/secrets/master.key` (mode 600) on first use.
Losing the key makes stored tokens unreadable (re-enter a token with `PUT /connections/<id>/token`); there is no key rotation yet. Hardening beyond this is out of scope for now (ADR 4.5, "Credential storage").

### Admin token

The first `api` start generates one admin token into `/data/secrets/admin.token` (64 hex characters, mode 600) and keeps it. The UI container reads the same file read-only from the data volume. Show or reset it from the repository root (needs Docker access to the host):

```
scripts/admin-token.sh show
scripts/admin-token.sh reset   # api and ui pick it up on the next request, no restart
```

Setting `ADMIN_TOKEN` (at least 32 characters) on `api` overrides the file; `reset` then refuses. In compose the `ui` service then needs `ENGINE_ADMIN_TOKEN` set to the same value. If the file is shorter than 32 characters the `api` refuses to start: delete the file on the data volume and restart to generate a new one.


## Upgrading from an earlier build

Earlier builds named the Postgres role, password and database `sbc`; they are now `falkon`. A fresh `docker compose up` needs nothing. An existing Postgres volume keeps the old names, so rename them once, from the repository root, before starting the new build. No data is lost. `sbc` is the only superuser and a role cannot be renamed while connected as it, so a temporary superuser does the rename:

```
docker compose stop backend web api ui
docker compose up -d postgres
docker compose exec postgres psql -U sbc -d postgres -c "CREATE ROLE falkon_tmp SUPERUSER LOGIN"
docker compose exec postgres psql -U falkon_tmp -d postgres -c "ALTER DATABASE sbc RENAME TO falkon" -c "ALTER ROLE sbc RENAME TO falkon" -c "ALTER ROLE falkon PASSWORD 'falkon'"
docker compose exec postgres psql -U falkon -d postgres -c "DROP ROLE falkon_tmp"
docker compose up -d
```

Renaming a role clears an MD5 password; Postgres 17 defaults to SCRAM, which keeps it, but the `PASSWORD` statement sets it again either way. The browser cookie is now `falkon_key`; sign in again if `FALKON_API_KEY` is set.

## Ask

MCP clients can research with their own model. Server instructions explain the tools, and `research_codebase` accepts `{ query, repos? }` and returns a short research brief without calling a server model. The `ask_codebase` MCP prompt returns the same brief, taking `query` and optional comma-separated `repos`. These are available even when no model is configured. Repository selections intersect the caller's access policy; unavailable names are reported and an empty selection stays empty. Follow the brief with the search, read, symbol and history tools, then answer in Markdown with `@file:{repo::path}` or `@file:{repo::path:start-end}` citations. The existing `ask_codebase` tool still runs the server model when configured.

The Ask agent runs on the AI SDK (`ai` 6): static and per-chat system prompts, the same ten tools in the same order as MCP (scoped to the chat's selected repos), up to `FALKON_CHAT_MAX_STEP_COUNT` steps (default 100), lowercase tool-name repair, an answer after the `<!--answer-->` tag with `@file:{repo::path:a-b}` citations, and a chat title from a naming prompt. Models come from config `models` (providers `openai-compatible`, `openai`, `anthropic`; `temperature` or `FALKON_CHAT_MODEL_TEMPERATURE`), else one openai-compatible model from `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Input capabilities are looked up on models.dev.

- `POST /api/chat/blocking` `{ query, repos?, languageModel?, visibility? }` → `{ answer, chatId, chatUrl, languageModel }`, the answer as portable markdown (citations become browse links with `highlightRange`). `/api/ask` is an alias.
- `POST /api/chat` streams one turn as an AI SDK UI message stream; `GET /api/chats` lists and reads stored chats.
- MCP `ask_codebase` and `list_language_models` return Falkon's own tool text.

The prompts and tool descriptions are Falkon's own wording; `ORIGINALITY_REF_DIR=<dir> pnpm originality` fails when any run of 8 or more words in them matches a reference text set. Not implemented: skills tools, external MCP servers inside Ask, attachments, prompt caching options.

## Auth

Set `FALKON_API_KEY` to require `Authorization: Bearer <key>` on `/api/*`. The browser UI then also needs a cookie `falkon_key=<key>`. There is no user model, permission sync, or SSO. Only `FALKON_*` variables and the `Authorization: Bearer` header have effect; the earlier product-prefixed variables and API-key header are ignored (clean break, no aliases).

## Config

`config.json` follows Falkon's own JSON Schema (`packages/shared/schemas/falkon/config.json`); `$schema` in the file is an editor hint and is ignored; a published URL comes later, until then point it at the schema file path (see `config.example.json`). Comments and trailing commas are allowed and `CONFIG_PATH` may be an http(s) URL. Keys: `connections`, `settings` (index limits, reindex/resync intervals, concurrency, timeouts), `contexts` (`context:` in queries), `environmentOverrides`, `models` (Ask language models; providers `openai-compatible`, `openai` and `anthropic`), `knowledgeBase`; tokens are `{ "env" }` or `{ "googleCloudSecret" }`. An unknown key is rejected and named in the error.

Connectors: `github` (cloud and Enterprise: `orgs`, `repos`, `users`, `topics`, `exclude.*`, `revisions`) and `git` (an http(s) remote, or a `file://` glob of local repos indexed in place and named after their origin). No other connection type is accepted.

To convert an older config file once (unsupported connection types and keys are dropped with a warning on stderr): `pnpm convert-config /absolute/path/old.json > new.json`.

## Not implemented (vs the reference engine)

Users/orgs/SSO, permission syncing, GitHub Apps, GitLab/Gitea/Gerrit/Bitbucket/Azure DevOps connectors, skills tools, Ask attachments and external MCP servers, file viewer UI, symbol navigation UI.

## Known limits

- Two turns running at once on the same Ask thread overwrite each other's messages; the last write wins.
- `Credential.lastError` is never written or read.
- A sync running while a Product is edited can briefly show a new member as Skipped.
- No automated browser test covers mermaid drawing, streaming or the failed-first-send flow.
- Memory is information only: the whole stack was about 665 MB at the last probe against a 654 MB reference, and 0.1.0 does not enforce it.

## Verified vs not

Verified: the unit and contract tests (`pnpm test`: parser, IR mapping, config, auth scope, tools, Ask answer formatting and errors); typecheck; `docker compose up --build` with upstream Zoekt; gRPC search, streaming (SSE), every tool and Ask against a real LLM; repo removal; zoekt port not published.
Not verified: GitHub connector, multi-branch/tag indexing against a large repo, ACCESS_FILE fail-closed path end to end (unit-tested only), search contexts (unsupported).
