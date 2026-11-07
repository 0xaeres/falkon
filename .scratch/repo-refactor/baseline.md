# Performance baseline (repo-refactor S3)

Measured on branch `loop/repo-refactor-s3` at commit `384cd30` (after S2), 2026-11-07. No code changed. Later slices (S4 image size, S5 first-load JavaScript, S7 optimizations) are judged against these numbers.

## Machine

| item | value | command |
|---|---|---|
| CPU | Apple M2, 8 cores | `sysctl -n machdep.cpu.brand_string`; `sysctl -n hw.ncpu` |
| Memory | 8589934592 bytes (8 GiB) | `sysctl -n hw.memsize` |
| Docker | 29.0.1, build eedd969 (Docker Desktop, containerd image store, Linux VM with 4109217792 bytes memory and 8 CPUs) | `docker --version`; `docker info --format 'dockermem={{.MemTotal}} ncpu={{.NCPU}}'` |
| Compose | 2.40.3-desktop.1 | `docker compose version --short` |
| Node / pnpm / Next | pnpm 10.28.0, Next.js 16.4.3 (Turbopack) | `pnpm install` output; `next build` banner |
| Other load | an unrelated `falkon-check` compose stack (6 containers, idle: CPU under 5%) was running throughout | `docker ps`, `docker stats --no-stream` |

The Docker build and the UI build ran at the same time; this affects build time only, not any number below.

## 1. Docker image size

Commands, run in the worktree root:

```
docker build -f docker/Dockerfile -t falkon-baseline .
docker image ls falkon-baseline --format '{{.Size}}'
docker image inspect falkon-baseline --format '{{.Size}}'
docker history falkon-baseline --human=false --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' | sort -rn | head -8
docker rmi falkon-baseline
```

| metric | value | command |
|---|---|---|
| Size shown by `docker image ls` | **2.82GB** | `docker image ls falkon-baseline --format '{{.Size}}'` |
| Exact bytes from `docker image inspect` | **699724995** | `docker image inspect falkon-baseline --format '{{.Size}}'` |

The two commands disagree because of the containerd image store: `image ls` `.Size` is on-disk (unpacked) usage, `image inspect` `.Size` is the content (compressed) size (`docker image ls falkon-baseline` shows both as DISK USAGE 2.82GB and CONTENT SIZE 700MB). S4 must compare with the same command on both sides; both figures are recorded so either can be used. The 20% target applies to the like-for-like figure.

Top 8 layers by size (`docker history`, exact bytes):

| bytes | layer |
|---|---|
| 1830694912 | `RUN pnpm install --frozen-lockfile=false && pnpm --filter @falkon/db generate && pnpm --filter @falkon/api build && pnpm --filter @falkon/ui build && cp -r apps/ui/.next/stat...` (all dependencies, dev included, plus built output) |
| 161071104 | base `node:24.22.0-alpine` (addgroup/adduser, libatomic, libstdc++) |
| 87953408 | `COPY /out/ /usr/local/bin/` (Zoekt binaries) |
| 17661952 | `RUN apk add --no-cache git ctags && corepack enable` |
| 10760192 | `COPY . .` (build context copied into `/app`) |
| 9314304 | `ADD alpine-minirootfs-3.24.2-aarch64.tar.gz /` |
| 5488640 | base image `apk add --virtual .build-deps-yarn ...` (yarn install) |
| 32768 | `COPY /src/LICENSE /usr/share/licenses/zoekt/LICENSE` |

Observation from the history, not a change: the install layer uses `--frozen-lockfile=false` and the image is single stage, so tests, `.scratch`, docs and dev dependencies all sit in the final image.

## 2. First-load JavaScript per route

Command: `pnpm --filter @falkon/ui build` (run after `pnpm install --frozen-lockfile` and `pnpm db:generate`). Next 16.4.3 prints no size column; the route table it prints is:

```
Route (app)
┌ ◐ /
├ ○ /_not-found
├   /[productId]/chat
│ └ ◐ /[productId]/chat
├   /[productId]/chat/[threadId]
│ └ ◐ /[productId]/chat/[threadId]
├   /[productId]/connect
│ └ ◐ /[productId]/connect
├   /[productId]/search
│ └ ◐ /[productId]/search
├   /[productId]/settings
│ └ ◐ /[productId]/settings
├   /[productId]/status
│ └ ◐ /[productId]/status
├ ƒ /api/* (14 route handlers, no client JavaScript)
└ ○ /setup
```

Method for sizes (a script in the scratchpad, not committed): for each page route, first-load JavaScript is the union of `polyfillFiles` and `rootMainFiles` from `.next/build-manifest.json`, plus the `entryJSFiles` chunks of the route's page and of its ancestor layouts from `.next/server/app/**/page_client-reference-manifest.js`. Each file is gzipped with zlib level 9 and the sizes summed. Lazy `import()` chunks are not included (they load on demand). Gzip sizes are bytes divided by 1024. Command: `node fljs.mjs apps/ui/.next` (script kept in `/private/tmp/claude-501/-Users-aeres--claude-spares-spare-LgsGeo/9ae4b753-ab21-45db-b4df-cc54e0b7f9f7/scratchpad/s3/fljs.mjs`; its logic is the paragraph above).

Shared by every route: 6 files (1 polyfill, 5 rootMain), 172029 bytes gzip (168.0 KB), 556868 bytes raw.

| route | JS files | raw KB | gzip KB (first load) |
|---|---|---|---|
| `/` | 6 | 543.8 | 168.0 |
| `/_not-found` | 6 | 543.8 | 168.0 |
| `/setup` | 15 | 922.0 | 288.6 |
| `/[productId]/chat` | 16 | 1677.8 | 511.2 |
| `/[productId]/chat/[threadId]` | 16 | 1677.8 | 511.2 |
| `/[productId]/connect` | 13 | 896.2 | 279.4 |
| `/[productId]/search` | 13 | 898.4 | 279.7 |
| `/[productId]/settings` | 13 | 887.7 | 276.8 |
| `/[productId]/status` | 13 | 899.7 | 280.6 |

Cross-check: `pnpm exec next experimental-analyze -o` (run in `apps/ui`) reports a larger client total per route because it includes lazy chunks (for example `/[productId]/chat` client 7314739 bytes raw, 2432623 compressed; `/[productId]/status` 1195008 raw, 518960 compressed). It runs its own build, so chunk file names differ from the first build; chunks below are matched between the two builds by raw size (within 1%).

### Three largest JavaScript chunks by gzip size (all chunks in `.next/static/chunks`, lazy ones included)

Command: gzip level 9 over every `.next/static/chunks/*.js` (one-line node script; sizes below are real gzip), module contents from `pnpm exec next experimental-analyze export > analyze.jsonl` (`part` records, grouped by package).

| chunk | gzip bytes | raw bytes | modules held | loaded |
|---|---|---|---|---|
| `38u5i4hnj9yoc.js` | 443517 | 1481577 | elkjs (1411 KB raw), mermaid (36 KB): the layout engine lazy-loaded with mermaid | lazy, `await import("mermaid")` in `src/features/chat/mermaid-block.tsx` |
| `3-hq1hmwcv5vh.js` | 219423 | 743820 | highlight.js (157 KB raw), motion-dom (112 KB), zod (52 KB), app source (44 KB), `ai` SDK (43 KB), react-resizable-panels (41 KB), @ai-sdk/gateway and @ai-sdk/provider-utils (28 KB, 27 KB) | first load of `/[productId]/chat` and `/[productId]/chat/[threadId]` only |
| `1vkgsez0kbg39.js` | 134327 | 430147 | cytoscape (420 KB), a mermaid dependency | lazy, with mermaid |

Next in line: `@mermaid-js/parser` (603 KB raw, about 126 KB gzip) and katex (258 KB raw, about 77 KB gzip), both lazy.

### Largest first-load chunks (chunks that actually ship on first load of some route)

| chunk | gzip bytes | raw bytes | modules | routes |
|---|---|---|---|---|
| `3-hq1hmwcv5vh.js` | 219423 | 743820 | see above (highlight.js, motion-dom, zod, ai SDK, app source) | chat, chat/[threadId] |
| `3bw_j8eeidk56.js` | 71845 | 229750 | Next.js client runtime | all page routes |
| `0yql161ggo2po.js` | 45314 | 164127 | Next.js client runtime | all page routes |
| `2ouzltbrtdp6c.js` | 41746 | 139512 | zod (114 KB raw), swr, app source | 7 routes |
| `0cz1d0mv5g_q7.js` | 39520 | 112594 | Next.js polyfills | all page routes |

## 3. Latency against the fixture stack

Stack: a throwaway copy of the `scripts/ops-smoke.sh` approach (not edited): builds the compose project from `tests/fixtures`, image built from `docker/Dockerfile`, ports 3301 (product listener) and 3302 (admin listener), random admin token kept in the environment and in a mode-600 header file, project `falkon-baseline-lat-84901`. The throwaway script (`lat.sh`, scratchpad) is the head of `ops-smoke.sh` (prerequisites, fixtures, cold-start, seed, indexing, api steps, unchanged except the repository root path, project name, and the golden-runner prerequisite check removed), followed by `measure.mjs`. All four fixture repos were searchable and `/mcp/fixtures` answered before measuring. Run command: `sh lat.sh` (scratchpad `/private/tmp/claude-501/-Users-aeres--claude-spares-spare-LgsGeo/9ae4b753-ab21-45db-b4df-cc54e0b7f9f7/scratchpad/s3/`).

Method: one Node process (`fetch`, keep-alive), 5 warm-up calls then 50 sequential timed calls per case, `performance.now()` around the request and full body read; percentiles are nearest-rank on the 50 sorted samples (so p99 and max are the same sample with n=50). Client and stack are on the same host, over the loopback interface, so these are server-side costs plus loopback, with no browser or Next.js proxy.

Requests, taken from the golden runner (`tests/golden/run.ts`, `tests/golden/queries.json`, query `plain`):
- search: `GET /ui/products/fixtures/search?q=fixture_marker&regex=0&case=0&limit=500` on the admin listener with the bearer token; 200, returns results.
- MCP: `POST /mcp/fixtures` `tools/call` `grep` with `{"pattern":"(?i)fixture_marker","limit":500}` on a session opened once with `initialize` (the golden `grep` argument set); `list_repos` with `{}` is measured as a second MCP tool.
- Status: `GET /ui/products/fixtures/status` on the admin listener. This is the route the UI status page reaches through its Next route handler `apps/ui/src/app/api/products/[productId]/status/route.ts` (`proxy("/ui/products/<id>/status")`). The UI container is not part of the ops-smoke stack, so the Next proxy hop is not included; this is the api service cost only.

| call | requests | warm-up | p50 ms | p95 ms | p99 ms | max ms | response bytes |
|---|---|---|---|---|---|---|---|
| search `GET /ui/products/fixtures/search?q=fixture_marker` (admin :3302) | 50 | 5 | 4.6 | 7.4 | 8.2 | 8.2 | 2275 |
| MCP `tools/call grep` `(?i)fixture_marker` limit 500 (`/mcp/fixtures` :3301) | 50 | 5 | 5.9 | 10.9 | 17.8 | 17.8 | 500 |
| MCP `tools/call list_repos` (`/mcp/fixtures` :3301) | 50 | 5 | 3.7 | 5.9 | 8.3 | 8.3 | 699 |
| status `GET /ui/products/fixtures/status` (admin :3302) | 50 | 5 | 3.4 | 4.5 | 4.9 | 4.9 | 271 |

Raw output of `measure.mjs` is the table above. Fixture data is four tiny repositories, so these are floor latencies for the request path, not scale numbers.

Teardown: the script's trap ran `docker compose -p falkon-baseline-lat-84901 -f compose.json down -v --remove-orphans` (printed `PASS teardown`). Check: `docker ps -a | grep -c baseline-lat`, `docker volume ls | grep -c baseline-lat`, `docker network ls | grep -c baseline-lat` all printed `0`. The `falkon-smoke-app` image the compose build created was removed with `docker rmi falkon-smoke-app`; `falkon-baseline` was removed with `docker rmi falkon-baseline`. BuildKit layer cache remains in Docker Desktop.

Not measured: the browser-visible UI route (Next proxy plus server render), because the fixture stack has no UI container and S3 may not change code or the compose file; a UI latency number would need a UI process started against the api, which is outside this slice's recipe.

## 4. Findings

Guesses are marked; none is a proposal and nothing was changed.

Three largest first-load JavaScript contributors:

1. Chunk `3-hq1hmwcv5vh.js`, 219423 bytes gzip, first load of `/[productId]/chat` and `/[productId]/chat/[threadId]` (files: `apps/ui/src/features/chat/markdown.tsx` imports `highlight.js/lib/common`; the `motion` package is imported in several components; `ai` SDK and zod on the chat client). Guess: highlight.js and motion are bundled statically into the chat route instead of loaded on demand.
2. Chunk `3bw_j8eeidk56.js`, 71845 bytes gzip, shared by every page route (Next.js client runtime, `rootMainFiles`). Guess: framework floor with React 19 and the App Router; not a Falkon file.
3. Chunk `0yql161ggo2po.js`, 45314 bytes gzip, shared by every page route (more Next.js client runtime in `rootMainFiles`). Guess: same framework floor. The largest application-owned chunk after the chat chunk is `2ouzltbrtdp6c.js` (41746 bytes gzip: zod 114 KB raw, swr, app source), guess: the shared zod schemas imported by the API client in `apps/ui/src/lib/api/client.ts`.

Three slowest request-path calls by p95 (of those measured):

1. MCP `grep`, p95 10.9 ms (`/mcp/fixtures`, MCP handler in `apps/api`). Guess: a regex scan through Zoekt plus result formatting for up to 500 matches.
2. Search, p95 7.4 ms (`GET /ui/products/:slug/search`, `apps/api/src/search.ts`). Guess: Zoekt query plus mapping files to the JSON response.
3. MCP `list_repos`, p95 5.9 ms (`/mcp/fixtures`). Guess: a Postgres read of the Product's repositories behind the MCP session handling.

The status route (p95 4.5 ms) is the fastest measured call.
