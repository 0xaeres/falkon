# Cycle 5 prep: UI to testers (S19, S20, S21, S25)

Status: PREP ONLY, written 2026-10-20 on top of `loop/falkon-mvp-c4` (tip 088675f, merged clean into this worktree). Nothing here is built or approved. Inputs: the handover note, `AGENTS.md`, `CONTEXT.md`, ADR 4.5, 4.6 and 7, spec D1 to D28 and the revised cycle map, the UI at `../falkon-ui` (read-only), and the engine code on this branch. Everything about the engine below was read in source; everything about the UI was read in `falkon-ui/src`.

Sections: 1 contract map, 2 S20 design plus credential storage (SECURITY-SENSITIVE), 3 S21 chat transport and evidence adapter, 4 UI authentication and compose, 5 impact-and-change recipe and questions, 6 slice proposal, 7 open questions for the grill.

Conventions used: "UI" is `falkon-ui`; "admin listener" is the Nest app on :3002 behind `ADMIN_TOKEN` (D27); "product listener" is :3001 (`/mcp/:product` only); "web" is the Next app on :3000 (`/api/ee/chat`, `/api/ee/chats`, `/api/repos`, `/api/search`).

## Headline findings (read these first)

1. **Nothing the UI calls exists on the engine today**, except by analogy: the registry (`/products` on the admin listener) and a chat stream (`/api/ee/chat` on web). All eight UI endpoints need work; two need schema or backend changes that touch the sync path (connections, sync trigger).
2. **The sync path currently deletes UI-created connections.** `syncConnectionRows` (`packages/backend/src/sync.ts`) mirrors config `connections` and runs `deleteMany({ name: { notIn: names } })` on every sync. A connection created through the API would be removed at the next config-triggered sync. A `source` column (`config|api`) like `Product.source` is required, and the backend must be changed (D7 says the sync path is untouched; this is a named exception that needs the human's approval).
3. **The UI's data model is richer than the engine's.** `generation`, `overlay`, `scenario`, `structural`, `gaps` and per-repository `branch` have no engine source (the graph was cut in D28; Evidence Generations are not built). S20 needs an explicit adapter that derives them, plus a small UI change set (section 1.3). This is the biggest hidden cost.
4. **Providers.** The UI offers five providers and a GitHub App method. D5 and the connector-scope memory say GitHub plus generic git only. The wizard must be restricted (UI change) or the engine returns 422 for the rest.
5. **The browser must never hold `ADMIN_TOKEN`.** The UI's own Next server becomes a thin proxy (BFF); the token lives in the UI container's environment. Real testers imply the UI is reachable beyond localhost, and the UI then becomes the only exposed surface and needs its own gate (section 4). This is a decision for the human, not a detail.
6. **Host-controlled token exfiltration (SSRF-class) is the top credential risk.** The connection request carries a caller-chosen `host`; the engine would send the stored token to it. Host allowlisting is mandatory (section 2.2, T1).
7. **Existing chat route trusts client history.** `/api/ee/chat` accepts the full `messages` array from the client, including assistant messages. The UI route must accept only the new user text and load history server side.
8. **The UI package carries stale naming in `PRODUCT.md`** (links to the old repo path and the old ADR file, and says the docs "still say Falcon"). Under the AGENTS.md naming rule it must be scrubbed in S19 before it is tracked here.
9. **Two Next majors in one workspace.** `@sbc/web` is Next ^15 / React ^19.0; the UI is Next 16.4 / React 19.3 (D13 keeps both). pnpm can hold both, but the Docker build, hoisting and `pnpm.overrides` need a check in S19. The UI uses npm (`package-lock.json`); it moves to pnpm on import.

---

## 1. Contract map: what the UI calls versus the engine

### 1.1 HTTP calls

UI base path is `/api` (`NEXT_PUBLIC_API_BASE_URL`, `lib/api/client.ts`), served today by Next route handlers over a JSON file mock (`lib/mock/store.ts`). "Engine today" is what exists on this branch.

| # | UI call (client.ts) | Request / response (contracts.ts) | Engine today | Missing | Adapter / work |
|---|---|---|---|---|---|
| 1 | `GET /products` (`api.products`) | `Product[]` | Admin `GET /products` returns registry rows (`ProductView`: slug, name, description, source, definition, repoNames). | Initials, provider, host, repository objects, `activeGeneration`, `scenario`, `queuedAt`, `dismissed`. | New UI-facing mapper `toUiProduct(row, repos, status)`; see 1.2. Lives in S20. |
| 2 | `GET /products/{id}` (`api.product`) | `Product` | Admin `GET /products/:slug`. | Same as row 1. | Same mapper. `id` = `slug`; slug regex is stricter in the engine (`^[a-z0-9][a-z0-9-]{0,62}$`) than the UI's (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 64): engine pattern is a subset except for max length 63 vs 64 and a leading digit rule (same). Align `productIdSchema` to the engine's in `packages/contracts` (one source of truth). |
| 3 | `POST /products` (`api.setup`) | `SetupRequest {id, name, provider, host, repositories[{id, branch}]}` returns `Product` | Admin `POST /products` takes `{slug, name, description, definition}` with a config-context `definition` (include globs etc.). | A way to say "these repositories from this connection"; the request has no `connectionId` (only `host` and `provider`). The engine must not guess which stored token to use. | Contract change in S19: add `connectionId` to `setupRequestSchema`. Engine creates an `api` Connection row (links the credential), then a Product whose `definition.include` lists the exact repo names (no globs from user text; names are escaped, see 2.4). 409 on duplicate slug maps from the registry's `conflict`. |
| 4 | `PATCH /products/{id}` (edit) | same body | Admin `PUT /products/:slug` replaces `name/description/definition`. | Method differs (PATCH vs PUT); connection change. | UI proxy maps PATCH to PUT. Reject `provider/host/connectionId` changes (the mock already rejects an identity change). Membership change re-resolves `repoNames` at write time (exists). |
| 5 | `GET /repositories` (`api.repositories`) | `Repository[]` (id, name, organization, language, structural, revision, updated, branches[], branch) | `GET /api/repos` on web lists already-synced repos; no code-host search. | Searching the code host through a stored token; the request has no connection id. | New `GET /connections/{id}/repositories?q=&page=` (S20). Calls GitHub `GET /user/repos` (and `/orgs/{o}/repos` only if an org is requested) with the stored token; maps to `Repository`. UI client adds the connection id (UI change). `revision`/`updated` come from `pushed_at` and the default-branch head when known; `structural` is always `false` (D28); `branches` is `[defaultBranch]` for the MVP (open question Q6). |
| 6 | `POST /connections` (`api.connect`) | `{provider, method:"app"|"token", host(https), token?}` returns `{id, host, provider}` | Nothing. Tokens exist only as config `{env}` or `{googleCloudSecret}` references. | Credential storage, token check, `source=api` connections. | Section 2. `method:"app"` is rejected with 422 for the MVP (no GitHub App); UI hides it. |
| 7 | `GET /products/{id}/status` (`keys.status`, SWR) | `Status` (verdict, sentence, generation, generationAge, nextGeneration, build, stage 0..4, progress, sync, overlay, overlayPercent, gaps[], scenario) | Raw facts only: `Repo.status/error/lastIndexedAt/headCommit/pushedAt`, `Connection.syncedAt/syncError`. | A product-level rollup and the whole generation/overlay vocabulary. | `ProductStatusService` (S20), pure function over rows (table in 2.5). `overlay`: constant `"unavailable"`, `overlayPercent: 0`; UI hides the overlay layer (UI change). |
| 8 | `POST /products/{id}/sync` (`api.sync`) | `{action:"retry"|"dismiss"|"scenario", scenario?}` returns `Status` | Nothing on Nest. Backend ticks every 30 s and watches `config.json`; queues `connection-sync` and `repo-index` exist in Redis. | A way for the API to ask the backend to resync; `dismiss`; the demo-only `scenario` action. | `retry` writes a request marker the backend tick claims (same pattern as `Repo.kbRequest`); `dismiss` is UI-local (localStorage), removed from the contract; `scenario` is a mock-only action used by `settings-view.tsx` and is removed (UI change). |
| 9 | `GET /products/{id}/threads` | `ThreadSummary[]` | `GET /api/ee/chats` on web lists chats by `createdBy`. | `productId` on `Chat`; Nest route. | S21: `Chat.productId` column, Nest `GET /products/:slug/threads`. |
| 10 | `POST /products/{id}/threads` | returns empty `Thread` | Chats are created lazily on first turn (`/api/ee/chat`). | Explicit create. | S21: creates an empty `Chat` row with `productId`, returns `Thread` with `answers: []`. |
| 11 | `GET /products/{id}/threads/{threadId}` | `Thread` with `answers[]` (paragraphs, evidence[]) | `GET /api/ee/chats?id=` returns raw `Chat` incl. UIMessage JSON. | Mapping stored UIMessages to `Answer[]`. | S21 adapter (section 3.4); 404 when `Chat.productId` differs from the path (no cross-Product read). |
| 12 | `POST /products/{id}/query` (`api.stream`, NDJSON `start/delta/done/error`) | `{threadId, question}` | `POST /api/ee/chat` streams the AI SDK UI message stream (web only; not on Nest). | Retire NDJSON; Nest route; Product scoping (ADR 7 P9). | S21: `useChat` against `POST /products/:slug/threads/:threadId/messages` (section 3). `streamEventSchema` and `api.stream` are deleted. |

### 1.2 Data shapes: `Product`, `Repository`, `Status`

| UI field | Engine source | Adapter rule |
|---|---|---|
| `Product.id` | `Product.slug` | identity |
| `Product.name` | `Product.name` | identity |
| `Product.initials` | none | first letters of the words in `name`, max 2, upper-case (the mock's rule) |
| `Product.provider`, `host` | `Connection.connectionType` + `config.url` | stored on the `api` Connection row; for config Products: first linked connection, else generic |
| `Product.repositories[]` | `Product.repoNames` joined to `Repo` | per row below |
| `Product.activeGeneration` | none | derived id (2.5): short hash of the sorted `repoName@headCommit` for INDEXED repos |
| `Product.scenario` | none | derived enum (2.5) |
| `Product.queuedAt` | none | `max(Connection/Repo request marker)` or `null` |
| `Product.dismissed` | none | removed from the server contract (UI-local) |
| `Repository.id` | `Repo.name` (e.g. `github.com/org/repo`) | the stable engine key; UI never sees numeric ids |
| `Repository.name`, `organization` | `Repo.displayName`, org part of `Repo.name` | split on `/` |
| `Repository.language` | none on `Repo` | from GitHub `language` at search time; for synced repos, `metadata.codeHostMetadata` if present, else `""` (UI change: allow empty) |
| `Repository.structural` | none | constant `false` (D28) |
| `Repository.revision` | `Repo.headCommit` | 7-char short sha, `""` before first sync (contract: make it `string` allowing empty) |
| `Repository.updated` | `Repo.pushedAt` / `lastIndexedAt` | server returns an ISO timestamp; UI formats relative time (contract change from a pre-formatted string; the mock uses strings like "12 min ago") |
| `Repository.branches`, `branch` | `Repo.branches`, `defaultBranch` | MVP: `[defaultBranch]` and `branch = defaultBranch` (Q6) |

### 1.3 UI changes the engine design forces (collected, for the S19/S20 briefs)

1. `setupRequestSchema` gains `connectionId`; `connectionRequestSchema.method` allows only `"token"`; providers limited to `github` and `github-enterprise` plus a generic `git` entry (Q3).
2. `Status.overlay`, `overlayPercent` and `scenario` stay in the schema (no UI rewrite) but the engine returns constants; the overlay layer and the mock "scenario" switcher in `settings-view.tsx` are hidden or removed. `gaps[]` is filled from sync errors only (no coverage gaps without the graph).
3. `Repository.updated` becomes an ISO string; `revision` and `language` may be empty.
4. `dismiss` becomes client-state; `sync` body becomes `{action:"retry"}` only.
5. Mock routes, `lib/mock/*`, `streamEventSchema`, `api.stream`, and `app/api/products/[id]/query` are retired (S21); the `app/api/*` route handlers become thin proxies to the engine (section 4).
6. `PRODUCT.md` scrub (naming rule).

---

## 2. S20 design: engine endpoints for the UI, and credential storage

### 2.1 Where the routes live

Recommendation: **one more Nest module, `UiApiModule`, mounted on the admin listener** (:3002, behind `ADMIN_TOKEN`), not a third listener. Reasons: the admin listener already has the loopback bind, the `Host` allowlist, the constant-time bearer check and its tests; a third listener doubles the surface to review. The UI's Next server is the only client. Consequence: the ADR 4.5 allowlist ("exactly `GET|POST /products` and `GET|PUT|DELETE /products/:slug`") is extended, in place, to an explicit list:

```
GET    /products                      POST   /products
GET    /products/:slug                PUT    /products/:slug       DELETE /products/:slug
GET    /products/:slug/status         POST   /products/:slug/sync
GET    /products/:slug/threads        POST   /products/:slug/threads
GET    /products/:slug/threads/:id    POST   /products/:slug/threads/:id/messages   (S21)
POST   /connections                   GET    /connections           DELETE /connections/:id
PUT    /connections/:id/token         GET    /connections/:id/repositories
```

Everything else stays 404. A test enumerates the router and fails if a route outside this list exists (copy the S4/S22 pattern). Request bodies keep the 64 KiB cap, JSON only, strict Zod objects. `GET /products` returns `source=config` Products too, read-only (409 on write, as today).

The `Host` allowlist must admit the compose service name (`api:3002`) for the UI container: add it to `API_ALLOWED_HOSTS` in compose (DNS-rebinding protection otherwise returns the existing rejection).

### 2.2 Credential storage: SECURITY-SENSITIVE (stops for human review before build)

> **Marked security-sensitive.** Per D17 and D22 this design stops at a human gate before any code is written, and the built slice stops again at gate 2. The brief for the implementer is this section as written; deviations are not the implementer's call. An Opus review and an attack pass are recommended for the built result (the one place this cycle where Opus is justified, see section 6).

**Assets.** (A1) code-host tokens (read access to private source of the operator's organisation); (A2) the master key; (A3) the Product boundary, since a token plus a Product widens what the engine can read; (A4) the host `ADMIN_TOKEN`.

**Actors.** Tester via UI (authenticated at the UI gate, section 4); anyone who can reach the UI port; a malicious or compromised code host or repository (clone URLs, redirects); a local user on the host; whoever obtains a Postgres dump or backup; whoever obtains the `data` volume; a compromised dependency in the api process.

**Threats and required mitigations (each is a test or a stated residual):**

| # | Threat | Mitigation (allowlist) | Test |
|---|---|---|---|
| T1 | Caller-chosen `host` makes the engine send the token to an attacker (token exfiltration, SSRF) | `host` must be `https`, no userinfo, no port other than 443 unless listed, and its hostname must be in `CODE_HOST_ALLOWLIST` (default `github.com`; GitHub Enterprise hosts are added by the operator in env, never by a UI call). After DNS resolution the address must not be loopback, link-local, private, or the compose network, unless the operator listed the host with `allowPrivate` (GHE on a corporate network). Redirects are not followed with credentials (Octokit `request.redirect: "manual"` or a fetch wrapper that strips `Authorization` on any cross-origin hop). | unit: each rejected shape; rebinding stub (name resolves to 127.0.0.1 after the check) |
| T2 | Token sent to a host other than the one it was issued for via a crafted `cloneUrl` from the code-host API | credentials are attached to a git operation only when the clone URL's host equals the credential's stored host (comparison on the parsed hostname). Extends `credentialsFor` in `packages/backend/src/credentials.ts`. | unit with a mismatched clone URL |
| T3 | Token read back through the API, logs, errors or the DB admin tooling | Response DTOs are strict allowlists (`id, host, provider, createdAt, lastCheckedAt, status, scopes[]`); a canary-token test serialises every response of every route and fails if the canary string or its base64 appears. Prisma `select` allowlist everywhere except one function `openCredential(id)`. Nest logger stays `["error","warn"]`; no request-body logging; Octokit and Prisma errors are wrapped into fixed messages (the original is not logged). The token field appears in exactly one Zod schema. | canary test over all routes and over thrown errors |
| T4 | DB dump or backup reveals tokens | AES-256-GCM, random 96-bit nonce per write, additional authenticated data = `credentialId|host|keyId` (a ciphertext cannot be moved to another row or host). Master key is not in Postgres. | round-trip, tamper, wrong-AAD tests |
| T5 | Master key mishandled in a self-hosted compose install | Key supplied as `FALKON_SECRET_KEY` (32 random bytes, base64) or `FALKON_SECRET_KEY_FILE` (path, preferred; mounted read-only, mode 600). The service **refuses to store a credential** if neither is set (credentials feature off, clear message; the rest of the engine runs). `scripts/gen-secret-key.sh` writes a fresh key to a file with `umask 077` and prints no key. The key is never logged, never in `docker inspect` output when the file form is used. Q2 asks whether to auto-generate a key into the `data` volume for zero-config testers; default recommendation is **no** (a key next to the DB volume weakens T4 for volume snapshots), with the script making the explicit path one command. | start-up test: missing key with credentials present, wrong-length key |
| T6 | Key rotation and token rotation | `keyId` is stored per row (first 8 hex of sha256 of the key). `FALKON_SECRET_KEY_PREVIOUS` (optional) is tried for decrypt; an admin-only `rekey` job re-encrypts all rows with the current key and reports a count. Token rotation: `PUT /connections/:id/token` validates the new token (same checks as create) and overwrites the ciphertext in one transaction; old ciphertext is not retained; `rotatedAt` is set. Deleting a connection hard-deletes the credential row. | rotation and rekey tests; delete test checks the row is gone |
| T7 | Over-privileged token | The wizard tells the tester to use a fine-grained read-only token (Contents: read, Metadata: read; classic: `repo` read is the only option, noted as broader). The check endpoint records the observed scope header and returns it in `scopes[]` so the UI can warn on write scopes. The engine only ever issues `GET` API calls: `GET /user`, `GET /user/repos`, `GET /orgs/{org}/repos`, plus git smart-HTTP fetch. The Octokit client is wrapped so any other verb or path throws. | unit: wrapper rejects `POST`/`DELETE` and unlisted paths |
| T8 | Any UI user uses any stored token (shared install, no user model, D5) | **Accepted residual, disclosed.** A connection is an operator-owned shared credential: every holder of the UI gate can list connections and browse that token's repositories, and can put them into a Product. Mitigation is organisational: the operator creates the connections; the token's reach is the Product boundary the operator accepts. `GET /connections` returns metadata only. Q4 asks whether connection creation should be operator-only (admin listener direct, not via the UI). | n/a |
| T9 | Brute force or enumeration of connection ids | ids are 128-bit random (`crypto.randomBytes`, base64url), never sequential; unknown id and id-of-another-kind answer the same 404. | unit |
| T10 | Token in process memory, env or argv | Decrypted only inside `openCredential`, held for the duration of one outbound call, never cached on a module-level variable. Git already receives credentials via an env-injected `http.extraheader`, not argv or `.git/config` (`packages/backend/src/git.ts`); that path is reused unchanged. | existing git tests plus a check that `ps`-visible args carry no secret |
| T11 | Config mirror deletes API connections (finding 2) | `Connection.source` enum `config|api`; `syncConnectionRows` deletes only `source=config` rows; config import never overwrites an `api` row with the same name (api wins, logged, as for Products). The backend resolves an `api` connection's token through `{ "stored": "<credentialId>" }` in `Connection.config.token`; the parser accepts that variant only for `api` rows (a config file containing it is rejected). | sync tests (idempotent, api rows survive) |
| T12 | SQL/regex/glob injection through the repository names the UI submits | Repository names are never put in a glob unescaped: `definition.include` entries are built by escaping `* ? [ ] { } ( ) ! \` and rejecting names that fail `^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$` plus the code host's canonical prefix. Membership is re-verified against the connection's synced `Repo` rows at write time (an unknown repo is a 400). | unit with hostile names |

**Data model (additive, applied with `db push` as today):**

```
model Credential {
  id           String   @id            // 22-char base64url of 16 random bytes
  kind         String                  // "github-token" (only value in the MVP)
  host         String                  // lower-case hostname; part of the AAD
  keyId        String
  nonce        Bytes
  ciphertext   Bytes                   // AES-256-GCM, tag appended
  scopes       String[]                // observed at check time, informational
  createdAt    DateTime @default(now())
  rotatedAt    DateTime?
  lastCheckedAt DateTime?
  lastError    String?                 // fixed vocabulary, never provider text
  connections  Connection[]
}
Connection  += source ConnectionSource @default(config)   // config | api
            += credentialId String?    @unique
```

New code goes in `packages/shared/src/credentialStore.ts` (crypto and the single `openCredential`), consumed by api (check, search) and backend (sync). It has no network code. `packages/api` adds `connections.ts` (controller, DTOs, host policy, GitHub client wrapper).

**Who can read:** the `api` and `backend` processes (they hold the key and the DB credentials). Postgres operators see ciphertext only. UI and testers see metadata. Nobody can read a token back; the recovery path for a lost token is to rotate it.

**Allowlist spec for the brief (exact):**
- Routes: only the `/connections` set in 2.1; bodies strict; unknown keys 400.
- Create body: `{ provider: "github"|"github-enterprise", method: "token", host, token }`; `token` 1..200 chars, no control characters, trimmed; fixed-vocabulary error codes (`INVALID_HOST`, `HOST_NOT_ALLOWED`, `TOKEN_REJECTED`, `TOKEN_TOO_BROAD`, `UPSTREAM_UNAVAILABLE`) with fixed messages.
- Create flow order: validate shape, host policy (T1), call `GET /user` with the token, store only on success, respond with the DTO.
- Outbound: methods and paths per T7; timeout 10 s; response size cap 5 MB; at most 30 pages per repository search.
- Output: DTO allowlist; canary test.
- Nothing else in the codebase reads `Credential.ciphertext` (a grep test enforces the single reader).

### 2.3 Repository search and connection check

`GET /connections/:id/repositories?q=&page=` opens the credential, lists with `GET /user/repos?per_page=100&sort=pushed` (cap 300 results, 3 pages), filters by `q` on the server (substring on `full_name`), maps to `Repository`. No branch listing in the MVP (Q6). Results are not cached to disk. Rate limits: one concurrent search per connection, 429 mapped to `UPSTREAM_UNAVAILABLE`.

### 2.4 Product creation and sync trigger

`POST /products` (UI body) in one transaction: verify every `repositories[].id` appears in the connection's search results or synced `Repo` rows, create the `api` `Connection` (name `ui-<slug>`, type `github`, config `{type:"github", url, repos:[exact names], token:{stored:<id>}}`; `repos` is the existing exact-name list in the GitHub connector, so no glob is needed), create the `Product` (`source=api`, `definition.include=[names]`, `repoNames` resolved after the first sync), set `Connection.syncRequestedAt = now()`. The backend tick (30 s) claims `syncRequestedAt`, calls `syncConnection(name)`, indexes new repos (existing behaviour), then clears the marker. First status is `building` until repos are INDEXED.

Backend changes required (sync path exception, needs approval): (a) `Connection.source` filter in `syncConnectionRows`; (b) tick claims `syncRequestedAt` on `api` connections and on `Repo.indexRequestedAt` for retry; (c) `credentialsFor` and `listGithubRepos` resolve `{stored}`; (d) `syncSearchContexts` already imports Products; an `api` Product's `repoNames` is already re-resolved on every sync (exists). No change to indexing, Zoekt or `git.ts`.

Alternative considered and rejected: the API adds BullMQ jobs directly. That puts `bullmq`/`ioredis` into the api process (memory, a new dependency, a second writer to the queues) for a 30-second saving.

### 2.5 Status derivation (pure function, unit-tested over fixtures)

Inputs: the Product's `Repo` rows (status, error, headCommit, lastIndexedAt, pushedAt), the linked `Connection` (syncedAt, syncError, syncRequestedAt).

| Condition | `scenario` | `build` | `sync` | `verdict` / `sentence` |
|---|---|---|---|---|
| no repo INDEXED yet | `building` | `building` (`failed` if all FAILED) | `current` | "Building" / "Indexing N of M repositories." |
| some INDEXED, some PENDING/SYNCING | `updating` | `building` | `current` | "Updating" |
| any repo FAILED or connection `syncError` | `failed` | `failed` (or `idle` if others indexed) | `failed` | names the repo (repo name only; provider error text is truncated to a fixed vocabulary) |
| every repo INDEXED, none behind | `current` | `idle` | `current` | "Current" |
| INDEXED but `pushedAt > lastIndexedAt` for some | `partly-behind` | `idle` | `current` | "N repositories are behind" |
| `syncRequestedAt` set | keeps the above, `queuedAt` = request time | | | |

`generation` = `"g-" + first 6 hex of sha256(sorted "repoName@headCommit" of INDEXED repos)`; `null` before the first INDEXED repo; `generationAge` from the max `lastIndexedAt`; `stage` 0..4 maps to {connect, clone, index, ready-check, ready} from counts; `progress` = indexed/total; `gaps[]` = one entry per FAILED repo. `overlay` constants as in 1.3.

---

## 3. S21 design: chat transport, evidence, threads

### 3.1 Transport

Server: one new route on the admin/UI module, `POST /products/:slug/threads/:threadId/messages`, body `{ text: string (1..4000), languageModel?: LanguageModelInfo }`. It returns `createUIMessageStreamResponse` (AI SDK 6, the same `ai@6.0.167` used by `createMessageStream`). It does **not** accept a message history: it loads the stored `Chat` (`id = threadId`, `productId = slug` must match, else 404), appends the new user message, and calls the existing `createMessageStream` with `selectedRepos = Product.repoNames`, `scope` = the Product's scope (P9: the agent's tools are already scope-checked by `repoOrThrow`; selected repos are intersected with the effective set before the loop). History authority is the server, closing finding 7.

Client: `useChat({ id: threadId, transport: new DefaultChatTransport({ api: <proxy>/products/${id}/threads/${threadId}/messages, prepareSendMessagesRequest: ({ messages }) => ({ body: { text: lastUserText(messages) } }) }) })`, with `messages` seeded from `GET .../threads/:id` mapped to UIMessages. The UI proxy route streams the engine response through unchanged (no buffering) and adds the bearer.

Persistence: `onFinish` (exists) writes the full `UIMessage[]` into `Chat.messages`; the first answer names the thread (`chatName` exists; costs one extra model call, D3-compatible since this is the server-LLM Ask path). Stop (abort) leaves the user message stored without an assistant message; the next turn retries (UI shows "kept; try again").

Errors: pre-stream failures use the existing `askErrorResponse` JSON shape, mapped by the proxy to the UI's `{error: string}` so `ApiError` keeps working. In-stream provider errors arrive as an `error` chunk (`useChat.error`).

Retired: `app/api/products/[productId]/query/route.ts`, `streamEventSchema`, `api.stream`, the mock `/query` and `makeAnswer` streaming. The existing web routes stay (D16).

Schema (additive): `Chat.productId String?` with `@@index([productId, updatedAt])`; `createdBy` for UI chats = `"ui"` (single shared principal under AUTH_MODE none; Q5 on per-tester separation). Old chats (null `productId`) never appear in Product threads.

### 3.2 Message parts

Existing parts stay: `text`, tool parts, `reasoning`, `data-source` (`ToolSource`: repo, path, name, revision). New parts, all validated by Zod 4 schemas in `packages/contracts` on write (engine) and read (UI):

```
data-evidence  { id: int>0, productId, generation, repository, path, revision,
                 startLine, sourceUrl?, code: string[], highlightedLines: number[] }   // = evidenceSchema today
data-answer    { kind: "grounded"|"partial"|"abstention", generation,
                 paragraphs: [{ text, citations: int[] }], gaps: string[],
                 partialReasons: string[], abstention: string|null, suggestions: string[] }
```

`data-answer` is written once, after the model stream ends and the adapter has run, before `finish`. Both parts are **not transient** so they persist in `Chat.messages`, and `GET thread` is a pure mapping of stored parts (no re-reading of source at read time, which keeps old answers stable after a resync and gives the UI the revision that was actually read, per the Evidence definition in CONTEXT.md). During streaming the UI renders `text` deltas as a preview (it applies the same marker rewrite client-side from a shared pure helper in `packages/contracts`) and shows "Read N declaration units" from the count of `data-source` parts (copy tweak: "files" until declaration units exist; UI change).

### 3.3 Mapping UI threads to stored chats

| UI | Engine |
|---|---|
| `Thread.id` | `Chat.id` |
| `Thread.productId` | `Chat.productId` (new) |
| `Thread.title` | `Chat.name`, else `"New thread"` |
| `Thread.updatedAt` | `Chat.updatedAt` (epoch ms) |
| `Thread.answers[]` | consecutive (user message, assistant message) pairs: `Answer.id` = assistant message id; `question` = user text; `kind/paragraphs/gaps/...` from the message's `data-answer`; `evidence` from its `data-evidence` parts; `generation` from `data-answer`. A user message with no assistant reply is omitted from `answers` (UI shows it as pending) |
| `GET threads` | `Chat` where `productId = slug`, ordered by `updatedAt desc` (UI chats only, `createdBy = "ui"`) |

Validation on read: each mapped answer passes `answerSchema`; one that fails (a corrupt row) is returned as an `abstention` answer with a fixed message, not a 500.

### 3.4 Evidence-span adapter (from Ask's `@file` markdown)

Ask output today: text after `ANSWER_TAG`, with references `@file:{repo::path:a-b}` (`FILE_REFERENCE_REGEX`, `prompt.ts`); the tools' `data-source` parts record which files were actually read (`ToolSource`). The adapter is a pure function plus an injected file reader, in `packages/web/src/lib/ask/evidence.ts` (beside `answer.ts`), and runs in the Nest route after the stream ends:

1. `answer = answerPart(assistant).text` with the tag removed.
2. Extract references in order. For each: **resolve** against the message's `data-source` list (same rule as `toPortableMarkdown`: repo suffix match and path suffix match; require exactly one match) and check `scope.allows(repo)`. Unresolved references are dropped from the evidence list and counted (`partialReasons`: "N references could not be verified").
3. **Dedupe** by `(repo, path, start, end)`; assign `id` 1..N by first appearance; cap at 12 evidence items (further references keep their text, lose their marker, `partialReasons` notes it).
4. **Read** each span at the recorded `revision` with `gitRead.readFile(repo, path, revision)`: slice `[start-3 .. end+3]` clipped to the file, at most 60 lines (a longer range is truncated, `highlightedLines` covers the cited range inside it); a reference without a range gets the first 30 lines of the file's best match, or no evidence if the file is empty. `sourceUrl` is filled only if the repo has an `https` `webUrl`.
5. **Rewrite** each resolved reference in the text to `[id]`; unresolved ones to the plain path (as `toPortableMarkdown` does). Split into paragraphs on blank lines; `citations` = the ids whose markers occur in that paragraph. This satisfies `paragraphSchema`'s rule that every inline marker is declared. Mermaid fences and code blocks are not split.
6. **Kind** (deterministic): `grounded` if at least one evidence item and no dropped reference and the loop did not stop on the step cap; `partial` if some references were dropped or the step cap fired (reasons listed); `abstention` if there is no resolved evidence at all (the text is stored in `abstention` and `paragraphs` is empty, matching the UI's "Not enough evidence" view).
7. `gaps[]` and `suggestions[]`: `gaps` carries tool errors seen in the loop (repository unreadable); `suggestions` is empty in the MVP (the UI renders none).

Tests: golden fixtures of real Ask outputs (from the stored eval runs, text only) through the adapter; property: every marker has a declared citation, every `citations` id has evidence, every evidence span is inside its file; hostile inputs (reference to an out-of-scope repo, `..` paths, a range past the end of file, thousands of references).

### 3.5 Why not change the model prompt

The prompt, `@file` format and the Ask quality gate (D25) stay untouched in this cycle. The adapter converts after the fact, so S21 cannot move Ask quality. The only prompt-adjacent change is the impact recipe (S25), measured separately.

---

## 4. UI authentication and where it runs in compose

**Engine-side auth.** Under `AUTH_MODE=none` the product listener needs no credential and the admin listener needs `ADMIN_TOKEN` (D27). The UI uses the admin listener (2.1). The UI's Next **server** holds `ENGINE_URL=http://api:3002` and `ENGINE_ADMIN_TOKEN` (same value as `ADMIN_TOKEN`) in its environment. Browsers call only `/api/*` on the UI origin; those route handlers (today the mock) become thin proxies that add `Authorization: Bearer` and stream responses back. The token never reaches client code (`server-only` import, the UI already uses this guard). A test greps the client bundle output for the token env name.

**Why not give the UI an `apiKey`.** The `apiKey` adapter scopes `/mcp` access by key and repository; it has no concept of registry writes or credentials, and D6 deliberately issues no Falkon access keys. Using the admin bearer keeps one secret and one reviewed code path.

**UI gate (needed for real testers).** If testers reach the UI over a network, the UI becomes the exposed surface and holds, indirectly, admin power over Products and stored tokens. Options:

| Option | Effort | Notes |
|---|---|---|
| A. Bind the UI to loopback; testers use a tunnel or reverse proxy the operator already trusts (SSO proxy, Tailscale) | none in code | Fits D5 ("no user model"). Operator owns auth. |
| B. Built-in single shared passphrase (`UI_ACCESS_PASSPHRASE`): Next middleware, signed HttpOnly cookie, constant-time compare, rate limit | Sonnet-small (about 1 unit), security-sensitive | Gives a usable gate for a pilot. No identities. |
| C. Per-tester accounts | cut (D5) | Needs a user model. |

Recommendation: **B on top of A's defaults** (UI published on loopback unless the operator opts in), so the default install is safe and testers have a minimum gate when the operator exposes it. This is Q1.

**Compose.** New service `ui` from the same single image (the Dockerfile already builds web and api; add `pnpm --filter @sbc/ui build` with Next `output: "standalone"` to cap runtime memory), `command: node packages/ui/.next/standalone/server.js` (exact path set by the S19 build), `ports: ["127.0.0.1:3100:3000"]`, `depends_on: [api]`, environment `ENGINE_URL`, `ENGINE_ADMIN_TOKEN`, `UI_ACCESS_PASSPHRASE`. `api` gets `API_ALLOWED_HOSTS: api:3002` and no new published ports. `ADMIN_TOKEN` becomes mandatory for the UI profile (compose refuses `ui` without it via a `${ADMIN_TOKEN:?}` interpolation on the ui service). Memory: Next 16 standalone adds roughly 100 to 150 MB (estimate; to be measured; the memory ceiling is deferred by the human and recorded as information only).

---

## 5. "Impact and change" recipe (S25) and candidate questions

### 5.1 Recipe draft (for `packages/web/src/lib/ask/brief.ts` and the UI Ask system prompt)

Placement: a conditional block appended to the research steps when the question concerns changing, removing, renaming or breaking something ("what breaks if", "what would need to change", "who uses", "which callers", "impact of"). In the client brief it is part of `buildResearchBrief` (step 6); in the UI Ask it is an addition to `dynamicPrompt`/`STATIC_PROMPT`. Original wording (D9); no phrase copied from the reference prompts (the existing grep test for distinctive phrases covers it). The draft, for review:

```
When the question is about what a change would affect:
6. Name the exact declaration that changes. Locate it with find_symbol_definitions (or grep sym:Name),
   and read it. If several declarations share the name, list them and say which one you analysed.
7. Find uses across every repository in scope with find_symbol_references, then grep the bare name and
   its string forms (configuration keys, route paths, serialized field names, SQL columns, i18n keys).
   Uses of a name that belong to a different declaration are name clashes: read them and exclude them.
8. For each real use, read the surrounding code and say how it depends on the changed behaviour
   (called, overridden, implemented, subclassed, deserialized, rendered). Follow one hop outward from
   every public or exported use: who calls that function?
9. Check tests, generated code and other languages in the scope (a Java service's REST contract is
   consumed by TypeScript; search the path or field name there too).
10. Report: the confirmed affected locations, each cited; the likely-but-unverified ones, marked as such;
    and what you could not check (repositories out of scope, dynamic dispatch, reflection, code outside
    the selected repositories). Never present an empty search as "no effect".
```

Measurement: a new dataset `o3-impact` (new file under `tests/eval/datasets/`, same schema as `openmrs-xrepo.json`; the frozen datasets `o3.json`, `openmrs-xrepo*.json` and `accepted.json` are not edited). Arms: `clone-tools` (instructions on, no recipe), `clone-tools-recipe` (recipe in the client instructions), and for the UI path the server Ask with and without the recipe. Haiku first (D26), Sonnet confirm only if worthwhile. Rule: D25 against `clone-tools` on the impact set (n = 12 to 15 is too small for a bootstrap bound; report effect sizes and wins/losses, no pass/fail claim; the pass criterion for the regression gate remains the pooled O3 set, re-run once at the end with the recipe on to prove no loss there). Cost estimate: cycle 4 spent $2.28 on 320 Haiku runs (about $0.007 per run, `baseline.md`), so 15 questions x 2 arms plus the 80-question control for the recipe arm is about 110 runs, under $1.

### 5.2 Candidate questions (O3 corpus; drafts, gold not yet derived)

All symbols below were checked by grep to exist in the checkouts at `EVAL_O3_DIR` (hit counts in brackets are files per repository family). Gold spans must be derived by the question author and a second reader from source, as the existing sets were; none is final.

| # | Question (draft) | Why it fits | Grep evidence |
|---|---|---|---|
| I1 | If `PatientService.getPatientByUuid` in openmrs-core changed its null-handling, which other repositories call it and could break? | core service, several modules | `getPatientByUuid`: core api (9), webservices.rest (18), emrapi (8), queue (5), stockmanagement (4), billing (3) |
| I2 | If the `GlobalProperty` lookup `AdministrationService.getGlobalProperty` started throwing on a missing key, which modules depend on a silent default? | cross-module blast radius | `getGlobalProperty`: core (78), legacyui (33), fhir2 (23), emrapi (17), billing (17) |
| I3 | Which classes in the FHIR2 module implement or wrap `FhirPatientService`, and what would a signature change there touch? | interface fan-out within one module | `FhirPatientService`: fhir2 (12 files) |
| I4 | If the `useVisit` hook in the patient-chart or core ESM package changed its return shape, which O3 apps consume it? | TS cross-repo | `useVisit(`: patient-management (9), patient-chart (8), esm-core (4), billing-app (3), laboratory-app (1) |
| I5 | If `usePatient` stopped returning `isLoading`, which apps render a loading state from it? | TS cross-repo, name clash risk with `usePatient` variants | `usePatient(`: patient-management (8), esm-core (5), dispensing-app (3), billing-app (2) |
| I6 | We want to rename the `queueEntry` field in the queue module's REST representation; which front-end code reads it? | Java REST to TS consumer (cross-language) | `queueEntry`: patient-management (97), module-queue (43) |
| I7 | If `ObsService` dropped a method used by the attachments module, which other modules use that same method? | shared service, method-level | `ObsService`: core (32), legacyui (30), webservices.rest (12), emrapi (11), attachments (11) |
| I8 | Changing the `Encounter` TypeScript interface in the patient-chart package: which apps and files would fail to compile? | type-level impact | `interface Encounter`: patient-chart (15), patient-management (7), dispensing-app (3) |
| I9 | The `AdministrationService` is injected in several modules; which modules call `saveGlobalProperty` and would be affected if it became asynchronous? | write-path subset of I2 | to verify |
| I10 | If the REST resource for patient identifiers changed its JSON field names, which OpenMRS ESM apps would need updating? | REST contract to UI | to verify (webservices.rest -> esm-*) |
| I11 | Which modules extend or implement the core `Order` or `OrderService` types and would need review if order status semantics changed? | inheritance fan-out | to verify |
| I12 | If the form-engine library changed the signature of its `OpenmrsForm` renderer, which apps embed it? | TS library to apps | to verify (form-engine-lib consumers) |
| I13 | What reads the `bedmanagement` module's bed-tag or admission endpoints from the front-end repositories? | Java module to ESM | to verify |
| I14 | If the `emrapi` module's visit-location lookup were removed, which modules rely on it? | module-level removal | to verify |
| I15 | A global property key used by billing is renamed; list every place in the Product that reads or documents it. | string-key search, docs repo included | to verify (`openmrs-contrib-o3-docs`) |

Selection rule proposed: take I1 to I8 first (grep-confirmed), add three of I9 to I15 after a grep confirms a non-trivial answer. Hidden/dev split 50/50 with a seeded shuffle, mirroring the existing sets. A donor exists in the old repository (`.local/eval/impact/openmrs-questions.json`, 56 graph-era impact questions on openmrs-core); reuse is possible only for wording style because their gold depends on SCIP edges. Reading it is not required for the slice.

---

## 6. Slice proposal for cycle 5

Budget unit: **SU** = one Sonnet implementer run plus one Sonnet review round, assumed about 0.25M subagent tokens (cycle 4 spent about 1.0M for three standard slices plus eval). Haiku verification is counted inside the slice. Quota is the binding limit, so Opus is used once (S20 security design review/attack) and nowhere else.

Order: S19 first (everything imports from it). S20 and S21 both edit `packages/contracts` and `packages/api`, so they run **one after the other** (S20 then S21); S25 only needs `brief.ts`, `prompt.ts`, `tests/eval/**` and can run beside S20. Cycle branch `loop/falkon-mvp-c5`. Docker steps are serialised by the main session; long commands in the background under `perl alarm`.

### S19. `packages/contracts` and `packages/ui` import
- Tier: standard (Sonnet). Blocked by: cycle 4 merged to main (this prep is built on its branch).
- Goal: the UI lives in the repo and engine and UI share one Zod 4 contract package, with no behaviour change.
- Scope: `packages/contracts` (new, `@sbc/contracts`: move `contracts.ts` schemas; add `connectionId` and the 1.3 schema edits behind tests; `evidencePartSchema`, `answerPartSchema`, `markerRewrite` helper), `packages/ui` (`git subtree add --prefix=packages/ui` from `../falkon-ui` with history; `package.json` name `@sbc/ui`; npm lock removed; pnpm workspace entry; imports point at `@sbc/contracts`), `PRODUCT.md` scrub, `Dockerfile` and `docker-compose.yml` `ui` service (standalone build; mock mode still on, proxies come in S20), root scripts (`typecheck`, `test` include ui), ADR 4.x short amendment (UI and contracts packages).
- Done: `pnpm install && pnpm typecheck && pnpm test` green at the root including the UI's own tests (`tests/*.test.mts`, `tests/*.test.tsx`); one Zod major; both Next majors build (`pnpm --filter @sbc/web build`, `pnpm --filter @sbc/ui build`); contract and golden files byte-identical; `git ls-files | grep -iE 'sourcebot|falcon'` outside `.scratch/` empty; `docker compose up --build` brings the UI up on `127.0.0.1:3100` against the mock; the UI test suite's mock tests still pass unchanged.
- Verify: the commands above plus `git diff --stat -- tests/contract tests/golden/expected.json` empty; `pnpm ls next react zod -r`.
- Budget: 2 SU. Risk: dual Next/React versions and the Docker build; mitigated by building both in the S19 gate. New dependency approvals needed at the gate: `@ai-sdk/react` (UI), `swr`, `@radix-ui/*`, `lucide-react`, `geist` and the UI's other dependencies (all arrive with the import).

### S20. Engine endpoints for the UI and credential storage — SECURITY-SENSITIVE
- Tier: **hard for the credential store only**: Sonnet implements, **one Opus review plus one Sonnet attack pass** (the single Opus use this cycle). Everything else standard. Blocked by: S19, and by the human's approval of section 2.2 at gate 1 (design review) and again at gate 2 (built).
- Goal: the UI runs against the real engine for products, repositories, connections, status and sync, with no mock and no token in the browser.
- Scope: `packages/shared/src/credentialStore.ts` and tests; `packages/db/prisma/schema.prisma` (`Credential`, `Connection.source`, `Connection.credentialId`, `Connection.syncRequestedAt`, `Repo.indexRequestedAt`); `packages/api/src/{ui,connections,status,github}.ts` and the route allowlist test; `packages/backend/src/{sync,credentials,index}.ts` (the three named changes in 2.4: `source` filter, request markers, `{stored}` token variant plus host check); `packages/ui/src/app/api/**` as thin proxies (products, repositories, connections, status, sync; threads and query stay on the mock until S21); the UI changes in 1.3 for these endpoints; compose (`ui` env, `API_ALLOWED_HOSTS`, `FALKON_SECRET_KEY_FILE` mount), `scripts/gen-secret-key.sh`, README, ADR 4.5, 7 status text and the new credentials subsection.
- Allowlist spec: 2.1 route list, 2.2 table and exact-body list. Brief repeats them verbatim; tests named in the table fail on drift.
- Done: all T1 to T12 tests pass; the canary test passes over every route; sync tests show `api` connections survive a config sync and a config file containing `{stored}` is rejected; a full manual run against GitHub with a read-only token through the UI wizard creates a Product, shows `building` then `current` status, and a repo search never exposes the token (evidence saved under `.scratch/falkon-mvp/`); `retry` recovers a deliberately failed sync; existing contract/golden/ops-smoke checks unchanged and green; `AUTH_MODE=apiKey` product listener behaviour unchanged.
- Verify: `pnpm typecheck && pnpm test`; `git diff --stat -- tests/contract tests/golden/expected.json` empty; `sh scripts/ops-smoke.sh` once (the Product registry step now also covers a stored-credential round trip with a local fake code host); the canary and route-enumeration tests by name.
- Budget: 5 SU (3 build, 1 UI proxy and changes, 1 review and attack) plus one Opus review (about 2 SU-equivalents of quota). Largest slice; if it must be cut, split S20a (credentials, connections, repo search, check) from S20b (status, sync, product create/edit) and run them in that order.

### S21. Chat transport
- Tier: standard (Sonnet). Blocked by: S20 (shares `contracts`, `api` and the UI proxy layer) and S19.
- Goal: the UI chats over the AI SDK UI message stream, with evidence the UI can render, stored per Product.
- Scope: `packages/db` (`Chat.productId`, index); `packages/web/src/lib/ask/evidence.ts` (+ tests; no change to `prompt.ts`, `agent.ts` behaviour except emitting the two data parts after the loop and persisting them); `packages/api/src/threads.ts` (list, create, get, messages route with Product scope, history from DB); `packages/contracts` (parts, request schema); `packages/ui` (`useChat` with `DefaultChatTransport`, proxy streaming route, delete NDJSON route/mock query/`streamEventSchema`, thread GET mapping); ADR 7 P9 status (chat routes on the Product path).
- Done: adapter tests (section 3.4 properties and hostile inputs) green; route tests prove P9 (selected repos outside the Product are never searched; a thread of Product A is 404 under Product B); the client cannot supply history (a body with `messages` is a 400); a live run asks one question through the UI against a real model (Haiku) on the fixture Product and the evidence panel shows the cited lines at the right revision; reload shows the stored answer identical; Ask quality gate not re-run (prompt untouched), but a 10-question smoke on the adapter over stored eval outputs shows ≥ 95% of references resolved; contract and golden unchanged.
- Verify: `pnpm typecheck && pnpm test`; contract/golden diff empty; adapter fixture suite; manual streaming run recorded in `.scratch/falkon-mvp/`.
- Budget: 3 SU.

### S25. Impact-and-change recipe and question set
- Tier: standard (Sonnet; wording reviewed by a second Sonnet; no Opus). Blocked by: S18 on main (done). Independent of S19 to S21 for the client path; the UI-Ask half of the recipe lands after S21.
- Goal: the recipe exists in the `research_codebase` brief and in the UI Ask prompt, with a measured effect on a small impact set.
- Scope: `packages/web/src/lib/ask/brief.ts` (recipe step block, bounded length, brief tests), `packages/web/src/lib/ask/prompt.ts` (UI Ask addition, gated so non-impact questions are unchanged: a test pins the prompt bytes for a non-impact query), `tests/eval/datasets/o3-impact.json` (new), `tests/eval/**` (arm `clone-tools-recipe` and loader wiring; no change to existing arms, gold or `accepted.json`), `.scratch/falkon-mvp/baseline.md` (results), spec and ADR text for D28 (the recipe is the impact capability).
- Done: unit tests pin the recipe text and the distinctive-phrase grep still returns nothing; `pnpm eval -- pilot --list` prints the new set offline; a 6-run Haiku pilot per arm passes the stop rules (plain recall ≥ 0.70 on Haiku, no leaks); full Haiku runs of both arms on 12 to 15 questions plus the pooled O3 80-question control for the recipe arm (to show no regression); report gives per-arm recall, wins and losses and the effect size. A miss (recipe no better or worse) is reported, not retuned; the human decides whether the recipe ships on by default.
- Verify: `pnpm typecheck && pnpm test`; `pnpm eval -- report --model haiku`; `git diff -- tests/contract` empty or additive only; naming grep over `tests/eval` returns nothing.
- Budget: 2 SU plus eval spend (estimate under $1 on Haiku from the cycle 4 rate; a Sonnet confirmation about $5; a new cap is Q9).

### Totals
About 12 SU of Sonnet work (≈ 3M subagent tokens by the unit above, larger than cycle 4's 1.0M because it contains the UI integration), one Opus review, Haiku for verifiers and pilots. Wall clock estimate 8 to 10 hours with the S19 to S20 to S21 chain serial. If quota is tight, the cut order is: S25 half for UI Ask (keep the client brief), then S20b polish, never the S20 security review.

### Autonomy limits proposed
The loop may decide alone: test layout, module layout inside `packages/api`/`packages/ui`, UI copy that follows 1.3, adapter thresholds within the stated caps, one fix round per slice. It must stop for: any contract snapshot or golden change that is not additive, any dependency not named above, any change to the credential design in 2.2, any backend sync-path change beyond the named four, any dataset/gold change to existing sets, spend over the cap, S20 at gate 1 (design) and gate 2 (built), and any outward action (push, PR, publish).

---

## 7. Open questions for the human (grill)

1. **UI gate.** Is the UI reachable by testers over a network (Option B shared passphrase, 1 SU, security-sensitive) or via an operator-controlled tunnel/proxy (Option A, no code)? What is the tester count and how are they invited?
2. **Master key handling.** Required explicit `FALKON_SECRET_KEY_FILE` (recommended) or auto-generate into the `data` volume for zero-config? (T5)
3. **Providers.** GitHub and GitHub Enterprise only in the wizard, with generic git as a separate "Git URL" entry, or hide generic git for testers? Confirm the GitHub App method is dropped for the MVP.
4. **Who creates connections?** Any UI user (T8 residual: shared tokens visible by reference to all testers) or operator-only through the admin API/CLI with testers choosing from existing connections?
5. **Tester separation.** Single shared principal (`"ui"`; every tester sees every thread of a Product) acceptable for the pilot, or a minimal per-tester name in the passphrase gate to scope threads?
6. **Branches.** MVP indexes the default branch only and the picker shows it, or must per-repository branch selection work in this cycle (adds a branches endpoint, per-repo `revisions` in the connection config and a sync-path change)?
7. **Approval of the sync-path exception.** The backend edits in 2.4 (source filter, request markers, `{stored}` token, host check) depart from D7's "sync path untouched". Approve as scoped?
8. **Overlay/generation vocabulary.** Keep "Evidence Generation" and the status layers in the UI with derived values (as designed), or simplify the status screen now that the graph overlay is cut (a UI design change the human owns)?
9. **Eval spend cap** for S25 (estimate under $1 on Haiku) and whether S25 may run a Sonnet confirmation.
10. **Order.** Run S25 beside S20 (separate worktrees, Docker serialised) or after S21 to protect quota? Recommended: beside S20.
11. **Dev/hidden split of the new impact set.** 50/50 seeded split as in the existing sets, or all dev (no hidden) since n is too small for a decision rule?
12. **Naming/ADR.** Confirm the ADR 4.5 allowlist is amended in place to the 2.1 list (the spec says amend in place; S22's allowlist wording is replaced, not appended).

---

## How to start the cycle

In this session, run `/agent-loop` and point it at `.scratch/falkon-mvp/cycle5-prep.md` (this file) as the plan input; the loop's grill should walk section 7, then slice per section 6. The skill is user-invoked only; it cannot be started by an agent.
