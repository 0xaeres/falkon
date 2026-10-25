# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 App Router with React 19 and TypeScript (`@falkon/ui`, a workspace package). Tailwind CSS v4 with shadcn/ui components (Radix primitives) and AI Elements for chat, local Geist fonts, Lucide icons, and SWR support the interface. Same-origin Route Handlers under `src/app/api` forward to the Falkon engine's admin listener (`ENGINE_URL`) with an admin token that only the UI server reads; the browser never sees it. Without `ENGINE_URL` every route answers 503 "ENGINE_URL is not set". Mock data exists in `tests/` only.

## Users

The operator of one self-hosted Falkon install: an engineer who runs it with Docker Compose and shares it with a team. They use the UI to connect a code host, define Products, check that a Product's index is current, ask questions, and copy the connection command for a coding agent.

Coding agents (Claude Code, Codex, VS Code Copilot) are the other audience. They talk to the engine's MCP endpoint, not to the UI.

## Product Purpose

Falkon is a self-hosted code context engine. It indexes a Product's repositories, serves search and read tools over MCP, and answers questions with citations to exact source lines, abstaining when the evidence is not there.

The UI lets the operator:

1. Set up a Product: connect a GitHub or GitHub Enterprise host with a token, name the Product, choose repositories and branches.
2. See whether the Product is indexed and current, and sync now.
3. Ask questions in chat and read the cited evidence.
4. Connect an MCP client through the Connect page.

Success: the operator sees at a glance whether a Product is current, gets a cited answer to a question, and connects an agent in one copy and paste.

## Positioning

Every answer is scoped to one Product and cites source at a recorded revision. Falkon reports gaps and partial results instead of guessing. No model sits on the MCP serving path; the chat and knowledge base are an optional layer over it.

## Operating Context

- One install, one operator. There is no identity provider and no user accounts. The UI is reached by whoever can reach its port (compose binds it to 127.0.0.1), and its server holds the admin token. Exposing it beyond localhost needs a proxy that adds authentication.
- MCP access is separate: `AUTH_MODE=none` (default) or `apiKey` on `/mcp/<product>`. The Connect page reads `AUTH_MODE` and `FALKON_MCP_URL` from the UI server's environment to show the right command.
- Code hosts: GitHub, GitHub Enterprise Server, and generic git remotes defined in config. Other hosts and Jira or Confluence are out of scope.
- Domain terms are defined in [CONTEXT.md](../../CONTEXT.md) (Product, productId, Evidence, Coverage gap, Knowledge base, and others). The UI uses them. Architecture: [docs/adr/0001-falkon-architecture.md](../../docs/adr/0001-falkon-architecture.md).

## Capabilities and Constraints

- Surfaces: Product setup (`/setup`), Status, Chat, Connect, Settings, all scoped to one Product under `/<productId>/`.
- Status stays state, not telemetry. Generation ids (`g-…`) never appear in the UI; people see the index age instead. Status shows the verdict line with Sync now, six state facts (when the index was last published, indexed repositories, code host, sync, build, knowledge base), shortcuts to chat, search and connect, a repositories table, and gaps or errors only when present. No telemetry or charts.
- Chat centers on a grounded answer with citations; unresolved targets, gaps, partial reasons and abstentions show when present.
- Connect shows one command or config per client (Claude Code, Codex, VS Code Copilot), the tool list, and how to read an answer. It never shows a token: in apiKey mode the snippet refers to `FALKON_API_KEY` or a prompt.
- A repository the connector skipped shows state Skipped.
- Cross-product queries are outside the MVP.

## Brand Commitments

- The product name is **Falkon**.
- The Falkon logo is approved and locked (2026-10-11): three swept bars forming an F and a stooping wing, with a Geist Semibold wordmark. SVG assets are in `public/brand/`.
- Visual direction: the developer-tool category standard, executed at full craft. Quality bar: Vercel, Linear, Sourcegraph.
- GitHub appears with its proper logo.

## Product Principles

1. **Trust before polish.** Show what the index contains and how current it is; never imply an answer is stronger than its evidence.
2. **State, not telemetry.** Status answers "is this Product current?" and nothing more.
3. **Evidence stays attached.** Every answer carries its citations, revisions, and gaps.
4. **One Product at a time.** The Product is always the visible scope.
5. **Use the domain's words.** Labels follow `CONTEXT.md`, not generic search or chatbot language.
6. **Nothing synthetic.** No placeholder data, accounts or claims in the shipped UI.

## Accessibility & Inclusion

WCAG AA is the working floor: labeled state colors, visible focus, keyboard-operable tabs and menus, reduced-motion support.
