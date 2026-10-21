# Falkon UI

The Next.js app (`@sbc/ui`, a workspace package): Product setup, status, chat, Connect and settings for a self-hosted Falkon engine.

## Run

From the repository root, `docker compose up --build` serves it at http://127.0.0.1:3100. For local development:

```sh
pnpm install
ENGINE_URL=http://127.0.0.1:3002 pnpm --filter @sbc/ui dev --hostname 127.0.0.1 --port 4311
```

Environment (UI server):

| Variable             | Meaning                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `ENGINE_URL`         | The engine's admin listener. Unset, every `/api` route answers 503 "ENGINE_URL is not set".              |
| `ENGINE_ADMIN_TOKEN` | Admin bearer. Else read from `${DATA_DIR:-/data}/secrets/admin.token`. Server side only.                 |
| `FALKON_MCP_URL`     | Base URL of the engine's MCP listener shown on the Connect page. Default `http://127.0.0.1:3001`.        |
| `AUTH_MODE`          | `none` (default) or `apiKey`; must match the api service. Adds the API-key form to the Connect snippets. |

```sh
pnpm --filter @sbc/ui typecheck
pnpm --filter @sbc/ui test
pnpm --filter @sbc/ui build
```

## Structure

- `src/app`: pages (`/setup`, `/<productId>/status|chat|connect|settings`), root error and not-found, and the `/api` Route Handlers that forward to the engine.
- `src/features`: `setup` (wizard, repository picker), `status`, `connect`, `chat`.
- `src/components`: shared controls, brand marks, and the workspace shell.
- `src/lib`: HTTP client (`api`), server-side engine forwarding (`api/engine.ts`), `connect.ts` (MCP URL and client snippets), `tools.ts` (the Connect tool list).
- `tests`: route, rendering and unit tests. `tests/mock-fixtures.ts` holds the synthetic Products, statuses and answers the render tests use; nothing under `src` imports it.

Design authority: `DESIGN.md`, `PRODUCT.md`, `.impeccable/`.
