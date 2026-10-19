# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 App Router with React 19 and TypeScript, in the separate `falkon-ui` app. Shared CSS, local Geist fonts, Radix UI menus and dialogs, Lucide icons, and SWR support the interface. The implemented UI calls same-origin Next.js Route Handlers backed by a local synthetic store. Real Falkon API integration, hosting, deploy target, and company identity-provider authentication are pending.

## Users

Product owners, who are engineers. They own a Product in Falkon and use the UI to set it up, check whether its context is current, and ask questions about its code. Access is granted through Active Directory group membership for that Product.

Other audiences in the architecture record (approved coding agents, operators, reviewers) use the API or are not the UI's design center.

## Product Purpose

Falkon is a product-scoped enterprise context engine. It gives authorized engineers and approved coding agents verifiable evidence about one Product's source code, and abstains when evidence is insufficient.

The UI lets a product owner:

1. Set up a Product: create it and map its repositories.
2. See whether the Product's context is current (sync and generation status).
3. Chat with the Product's context and get grounded answers.

Success: an owner can tell at a glance whether the Product's context is current and trustworthy, and can ask a question and get an answer whose claims cite the source evidence behind them.

## Positioning

Every answer is scoped to one Product and backed by citations to exact source excerpts at a recorded revision. Falkon publishes only coherent, validated Evidence Generations and reports coverage gaps and partial results instead of guessing. A general chat tool over code could not truthfully claim this.

## Operating Context

- Company-internal tool behind Active Directory group access. A request targets one `productId`; the product registry, not the caller, decides which repositories belong to it.
- Ingestion covers repository-resident material at pinned revisions. Git history, pull-request metadata, and reviewer suggestions are deferred.
- The architecture record makes the evidence packet (no Falkon-generated prose) the core contract; prose is an optional human-facing layer. The UI's chat is that human layer.
- Domain terms are defined in [CONTEXT.md](../../CONTEXT.md) (Product, Evidence Generation, Revision Manifest, Grounded answer, Abstention, Evidence packet, Semantic prediction, and others). The UI uses them.

## Capabilities and Constraints

- Three UI surfaces are confirmed: Product setup, sync/generation status, and chat.
- Product setup is where a Product and its repositories are registered in Falkon: connect a code host (personal access token), name the Product, select repositories with a branch per repository (default `main`), optionally see other sources, then queue ingestion and land on the status view. Supported code hosts: GitHub.com and GitHub Enterprise Server.
- Jira and Confluence appear in setup as not yet available. Ingesting them is outside the MVP; the UI must not imply it works.
- Product Access through AD groups is handled at the service-account level in a separate system; the UI does not bind groups.
- Chat centers on a grounded prose answer with citations up front; the supporting evidence is reachable from each answer. Answers also show unresolved targets, coverage gaps, partial-result reasons, and abstentions when present.
- The status view is minimal by the user's requirement: it answers "is this Product's context current?" (active generation, freshness, in-flight sync, coverage gaps) and nothing more. No per-repository telemetry or sync-intent history.
- The user wants the UI to look and feel like a real product, not an internal admin page.
- Semantic predictions are labeled hints, never evidence; if shown, they must not read as verified.
- Backend today exposes the query endpoint and a repository-change webhook. Endpoints for creating a Product, mapping repositories, and reporting index status do not exist yet.
- Open: authentication flow for the UI; live AD and product-registry integrations depend on external owners.
- Cross-product queries are outside the MVP.

## Brand Commitments

- The product name is **Falkon**.
- The Falkon logo is approved and locked (2026-10-11): three swept bars forming an F and a stooping wing, with a Geist Semibold wordmark. Shipping SVG assets are in `public/brand/`.
- Standing visual preference (user choice, 2026-10-11): every Falkon surface, including the logo, follows the developer-tool category standard, executed at full craft without irony. Quality bar: Vercel, Linear, and Sourcegraph/Greptile.
- Third-party sources (GitHub, GitHub Enterprise) appear with their proper brand logos.

## Evidence on Hand

- Architecture: [single architecture record](../../docs/adr/0001-falkon-architecture.md). Delivery spec: [MVP spec](../../.scratch/falkon-mvp/spec.md).
- Glossary: [CONTEXT.md](../../CONTEXT.md).
- Local synthetic UI exists in this app. Setup, status, chat, and settings are implemented under `src/features/`; routes are under `src/app/`. Synthetic fixtures and state live in `src/lib/mock/`; local HTTP handlers are under `src/app/api/`. No real code host, identity provider, or Falkon backend is connected.
- Copied direction contracts are in `.impeccable/surfaces/`; implementation review evidence is in `.impeccable/review/`.
- No customer research or usage data has been established. Synthetic demo data is not customer evidence.

## Product Principles

1. **Trust before polish.** Show what the context contains and how current it is; never imply an answer is stronger than its evidence.
2. **State, not telemetry.** The status view answers "is this Product's context current?" and nothing more.
3. **Evidence stays attached.** Every answer carries its citations, revisions, and gaps.
4. **One Product at a time.** The Product is always the visible scope.
5. **Use the domain's words.** UI labels follow `CONTEXT.md`, not generic search or chatbot language.

## Accessibility & Inclusion

No product-specific requirement established. WCAG AA is the working floor for an internal tool.
