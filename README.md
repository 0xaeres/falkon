# Falkon UI

A separate Next.js app implementing the approved Falkon Product setup, status dashboard, and evidence-backed chat. Everything served by the local API is synthetic. No real code host, identity provider, or backend is connected.

## Run

```sh
npm install
npm run dev -- --hostname 127.0.0.1 --port 4311
```

Open http://127.0.0.1:4311. The default page is the Payments Platform status view. Open Chat and select “Refund write path” to see the approved grounded-answer composition. “New thread” starts an empty conversation. `/setup` starts the five-step wizard.

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm start -- --hostname 127.0.0.1 --port 4311
```

Tests run against a temporary store, never the app's demo data. `.data/mock.json` holds the local mock Products and threads and is ignored by Git. `MOCK_DATA_DIR` overrides its directory. It uses atomic file replacement and process-local write serialization; replace it with a transactional store before running multiple server processes. Deleting this app's local demo store resets it to the supplied fixtures.

## Structure

- `src/app`: App Router pages, metadata, shared layout, route loading/error states, and API handlers.
- `src/features/setup`: five-step wizard and independently loaded repository picker.
- `src/features/status`: section navigation, shared detail workspace, and preview settings.
- `src/features/chat`: conversation, stream handling, and independently loaded evidence panel.
- `src/components/ui`: shared controls and approved brand assets.
- `src/components/layout`: persistent workspace shell, navigation, Product context, and mobile drawer.
- `src/lib/contracts.ts`: runtime Zod contracts and inferred TypeScript types.
- `src/lib/api/client.ts`: endpoint paths, typed HTTP client, timeout/error handling, and NDJSON stream decoder.
- `src/lib/mock`: server-only persistent store and deterministic source/answer fixtures.
- `tests`: runnable checks for request validation, Product isolation, citation provenance, publication state, concurrent writes, and streamed-answer persistence.

## Mock behavior

Setup connects to the simulated host only. The demo personal access token is `demo-readonly`; other values show the rejected-token state. Never enter real credentials. Tokens are not persisted. Repository search, selection, select-all, and branch choice work. `productId` is immutable and duplicate IDs are rejected. Jira and Confluence stay unavailable.

New Product ingestion publishes `g-0001` after 15 seconds. Repository edits preserve the current generation while a replacement builds; they publish the next generation after 15 seconds. Settings provides fixed previews of all freshness, build, and overlay states. Retry resolves the mock failure; dismiss removes the failure highlight while keeping the behind verdict.

The supplied Payments Platform supports refund/ledger-path answers, support-console payload partial answers, and settlement-schedule abstention. Unknown questions and questions in other Products abstain. Answers retain their own generation when context changes between turns. Each source records Product, repository, path, line range, revision, and highlighted lines. These synthetic files are not hosted on GitHub; real responses can supply `sourceUrl` for the code-host link.

Append `[network-error]` or `[access-error]` to a question to preview those error states. A question is kept for retry. Streaming uses a real NDJSON HTTP response, supports Stop, and saves only completed answers. Follow-ups persist on the server and reload by Product/thread URL.

## Replace the mock API

Set `NEXT_PUBLIC_API_BASE_URL` to a compatible gateway, or replace `src/app/api` handlers with adapters to real services. UI components do not import mock fixtures or storage. All endpoint paths are centralized in `src/lib/api/client.ts`; contract mapping belongs there or in the gateway handlers.

| Endpoint                                         | Behavior                                            |
| ------------------------------------------------ | --------------------------------------------------- |
| `GET /api/products`                              | Product switcher and ID availability                |
| `POST /api/connections`                          | Validate simulated host connection                  |
| `GET /api/repositories`                          | Available repository catalog and branches           |
| `POST /api/products`                             | Create Product and queue first ingestion            |
| `GET, PATCH /api/products/:productId`            | Product details / queue repository replacement      |
| `GET /api/products/:productId/status`            | Freshness, generation, sync, overlay, coverage gaps |
| `POST /api/products/:productId/sync`             | Retry, dismiss, or mock scenario selection          |
| `GET, POST /api/products/:productId/threads`     | Product-scoped thread list / create                 |
| `GET /api/products/:productId/threads/:threadId` | Saved thread with its answers                       |
| `POST /api/products/:productId/query`            | NDJSON `start`, `delta`, `done`, or `error` events  |

The current NestJS `/v1/query` contract requires a principal and an HTTP-route target. It is not a drop-in replacement for free-form chat. Real setup/status/thread endpoints and answer streaming still need integration. Add real authentication and server-side credential handling at that integration boundary. The public preview-scenario action is a local mock feature and must not be forwarded into production.

Answer paragraphs carry plain `text` with inline `[N]` citation markers and a `citations` array of permitted source IDs. Runtime validation rejects undeclared markers. Place markers after the supported claim; paragraphs without inline markers display their citations at the end.

## Performance and accessibility

Static route shells and documents are prerendered. Interactive code stays in feature components; the repository picker and evidence panel load on demand. Geist fonts are self-hosted with `next/font`; the monospace font is not preloaded. Lucide imports are named and tree-shaken. SWR shares requests across the shell and views; only first builds poll every two seconds, while status otherwise refreshes every 30 seconds. No chart, editor, syntax-highlighter, animation, or general state-management library is shipped.

The layout preserves the approved 240px sidebar / 56px rail, chat evidence pane, and five-step setup. Status adds a 232px section rail beside the global navigation, narrowing to 212px at tablet widths, with selected details in the main workspace. Under 768px global navigation is a focus-managed Radix drawer, citations open a focus-managed evidence sheet, a native 44px status section picker keeps details visible, and setup actions remain pinned below a scrollable form. Native form controls, skip link, visible focus, error/loading/disabled states, and reduced-motion support are included.

`npm audit --omit=dev` reports no runtime advisories as of this build. The current upstream Next.js ESLint dependency chain reports five high-severity development-tool advisories through `braces`; the registry offers no patched `braces` release. Do not downgrade Next.js to the unrelated major version suggested by automatic audit fixing.

## Design authority

Original approved galleries and generator: `/Users/aeres/Desktop/projects/falkon/.impeccable/mocks/`. The locked surface briefs are copied under `.impeccable/surfaces/`. Implementation tokens are in `src/app/globals.css`; system documentation is in `DESIGN.md`.

Tracked in https://github.com/0xaeres/nexus-v2/issues/24.
