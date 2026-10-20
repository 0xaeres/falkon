# Cycle 6 (auth + models): GitHub App, DeepSeek chat model, self-managed admin token

Status: prep, 2026-10-20. Nothing built. The human starts `/agent-loop` in this session; grill first. Spec/ADR conflict rule applies (AGENTS.md): raise conflicts, do not pick.

Human asks (2026-10-20): (1) GitHub App instead of a personal token; (2) chat model = DeepSeek's latest flash; (3) admin token "generated once for a given credential, good security mechanism, reset options".

Spec context: D29 keeps hardening out of scope except what the human now asks for (admin token generation/reset, App auth). D32 narrowed wizard providers to `github`/`github-enterprise` token-only; the App method must be re-added (contracts `method` is `z.literal("token")` at `packages/contracts/src/index.ts:114`; test at `contracts.test.ts:82` asserts `method: "app"` is rejected, so that test changes). Contract snapshots `tests/contract`, `tests/golden/expected.json` untouched (these are the MCP tool contracts, not UI contracts).

## Facts checked in code

- Credential store: `packages/shared/src/credentialStore.ts`, `{stored: id}` token variant, resolver registered in `packages/backend/src/index.ts`.
- Token consumers to extend: `packages/api/src/connections.ts` (GitHub client, plain fetch, `apiBase(host)` already handles GHE; `/user` and `/user/repos`), `packages/backend/src/connectors/github.ts` (listing), `packages/backend/src/credentials.ts:credentialsFor` (git `x-access-token` basic auth).
- Model: `packages/web/src/lib/ask/models.ts` `configuredLanguageModels()`: config `models` first, else one `openai-compatible` model from `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. `.env.example` has those three (DeepInfra defaults). `docker-compose.yml`: `api` has `env_file: [.env]`, so LLM_* already reaches api; `ui` does not need it. So chat needs only `.env` values, no code, unless the human wants the model visible in config / `.env.example`.
- Admin token: `packages/api/src/admin.ts:78-84` reads `env.ADMIN_TOKEN`, off if unset, throws if < 32 chars. UI reads `process.env.ENGINE_ADMIN_TOKEN` per request (`packages/ui/src/lib/api/engine.ts:20`). compose `ui` defaults it to `ADMIN_TOKEN`.

## DeepSeek (official docs, api-docs.deepseek.com/quick_start/pricing, fetched 2026-10-20)

- Model id: `deepseek-flash` (current Flash, served by DeepSeek-V4.1-Flash-1017). `deepseek-v4-flash` is retired but still accepted (routed to the same model). Pro is `deepseek-v4-pro`.
- Base URL (OpenAI-compatible): `https://api.deepseek.com`.
- Env for the engine: `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-flash`, `LLM_API_KEY` (already in the human's `.env`; the loop must never read it, only check the compose/engine gets it via `docker compose config` with values masked, or by the live chat turn itself).
- Risk to check live: `extractReasoningMiddleware` (`<think>` tag) vs DeepSeek's `reasoning_content` field; tool-calling in thinking mode; context length is not on the page (pricing/models page).

## Proposed slices (draft, grill may change)

- **S26 DeepSeek chat.** `.env.example` + README switch to DeepSeek defaults; fix no-model error text if cheap (link names the predecessor: leave to S13 unless trivial); prove a live UI chat turn with evidence. Likely config-only plus docs. Sonnet; Haiku verifies.
- **S27 Admin token.** New `packages/shared` helper `resolveAdminToken()`: `ADMIN_TOKEN` env wins; else read `${DATA_DIR}/secrets/admin.token` (mode 600), generating 32 random bytes (hex or base64url, `crypto.randomBytes`) on first start. api and ui both resolve it from the shared `data` volume (ui container needs the volume mounted read-only; drop the `ENGINE_ADMIN_TOKEN` default or keep as override). Constant-time compare (`crypto.timingSafeEqual` over equal-length digests) in `admin.ts`. Reset: `falkon admin-token reset` style script (`scripts/admin-token.sh` or a node CLI in `packages/api`) that rewrites the file; compose way documented: `docker compose exec api node packages/api/dist/cli.js reset-admin-token` or delete the file and restart. UI pickup: re-read file per request with short mtime cache so rotation needs no UI restart. Tests: generation idempotent, env override, file perms, rotation, wrong/short token, compare is constant-time helper, canary (token never logged/returned).
- **S28 GitHub App auth.** Store App credentials (App ID, private key PEM, installation id, host/api base) as one sealed `Credential` blob via the credential store (never returned/logged; canary test extended). Token variant `{app: <credentialId>}` or a new `Connection.config.auth` shape; short-lived installation token via RS256 JWT (`node:crypto`, no new dependency) -> `POST {api}/app/installations/{id}/access_tokens`, in-memory cache about 50 min, refreshed on 401. Consumers: connections.ts listing (`GET /installation/repositories` instead of `/user/repos`), backend connector listing, `credentialsFor` for git fetch. Wizard (`setup-wizard.tsx`) regains an App method; contracts `method` becomes `z.enum(["token","app"])` with the matching fields. GitHub and GHE only (D32).
- **Order.** S27 first (smallest, unblocks a clean first run), S26 (needs the human's key; live proof), S28 last (largest, touches contracts, backend sync path, UI). S26/S27 can run in parallel worktrees; S28 touches the credential and sync path, so serialise it after S27. Docker commands serialised.
- **Gates.** `pnpm typecheck && pnpm test` green; contract/golden diff empty; ADR amended in place (4.5 admin token and auth, 4.6, section 7 P10; 4.2 default model note) and README updated; naming rule scrub; live passes: UI chat turn on DeepSeek, admin rotation with the UI still working, GitHub App wizard to first sync (needs the human's App).
- **Roles.** Sonnet builds and reviews, Haiku verifies, Opus only if S28's JWT/token cache turns out hard. No Codex. No push or PR without the human.
- **Spec edits.** On approval add D35-D37 and a "Cycle 6 (auth and models)" section to `.scratch/falkon-mvp/spec.md`; note the earlier "Cycle 6 = core merge and rename" in the revised map is renumbered (core merge and S11 become cycle 7+). Raise this renumbering with the human.

## Open questions for the grill

GitHub App
1. Operator pre-creates the App (wizard asks App ID, PEM, installation id) or the manifest flow (UI redirects to GitHub, engine gets App credentials from the code exchange)? Manifest needs a reachable callback URL and a redirect to github.com; the UI is on loopback, which works for the browser redirect but not for the optional webhook. Recommended: operator pre-creates; manifest later.
2. Installation choice: one installation per connection (user pastes id, or the engine lists `GET /app/installations` with the App JWT and the wizard picks)? Recommended: list and pick; one connection = one installation.
3. Where does the private key live: sealed in the `Credential` table like tokens (recommended), or a mounted file path (`GITHUB_APP_PRIVATE_KEY_FILE`) for operators who want it off the DB? Can the wizard take a PEM upload/paste at all?
4. GHE: same flow with `host` -> `https://host/api/v3`; confirm App JWT works there with same code (yes by docs; confirm scope).
5. Webhooks: none (existing 30 s tick and resync), confirm.
6. Do token connections stay (coexist) or does the App replace them? Recommended: coexist.
7. Permissions the App needs: read-only Contents and Metadata. Confirm; repo list is limited to what the installation was granted (that is the "access" the human wants).

DeepSeek
8. Confirm `deepseek-flash`, base `https://api.deepseek.com`, env-driven via `LLM_*` (no config.json `models` change). Should the same model feed the knowledge base (`LLM_*`)? Spend cap and `tokenBudget` implications.
9. Thinking mode: accept DeepSeek default, or force non-thinking for tool turns if the live test shows tool-call or reasoning-field breakage? Is a different default model needed for Ask quality?

Admin token
10. "For a given credential" means: (a) one token per installation/database (generated once, stored in the data volume), (b) one token per credential/connection, or (c) the admin token is only a credential of the UI-to-engine hop? Recommended reading: (a).
11. Store: `${DATA_DIR}/secrets/admin.token` plaintext mode 600 (like `master.key`) or only a hash on the api side with the UI holding the plaintext? Hashing does not help because the UI container must present the token; recommend plaintext file in the volume, compared in constant time.
12. Printed once at first start in api logs, or never printed (read via `docker compose exec api cat`/CLI `show`)? Recommended: never in logs (README: tokens are never logged); a CLI `show` command instead.
13. Reset: CLI (`reset`), delete-file-and-restart, both? Does reset also need to invalidate anything besides the file? Does an env `ADMIN_TOKEN` always win, and what does reset do when env is set (refuse with a message)?
14. UI pickup after rotation: re-read per request (recommended) vs restart.
15. Admin listener now always on (token always exists): confirm this change from "off unless set". Port still loopback-published.

Process
16. Renumber cycle 6/7 in the spec map; new decision ids D35+.
17. Budget/quota: live DeepSeek spend cap for the chat proof (suggest a few cents, about 5 turns).
18. Which of S26-S28 to run in parallel worktrees vs sequential.
