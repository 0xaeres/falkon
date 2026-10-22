# Falkon

Self-hosted code context engine: Zoekt search, bare git clones, MCP tools, and generated knowledge bases, served per Product.

## Commands

From the repository root (pnpm workspace):

- `pnpm install && pnpm db:generate` before the first build.
- `pnpm typecheck` and `pnpm test` must both pass before a change is reported done.
- `docker compose up --build` runs the full stack; local dev needs Postgres, Redis, Zoekt, git, and universal-ctags (see `README.md`).
- A change to dependencies needs its own `pnpm install` in its worktree. Never symlink `node_modules` from the main checkout into it, or the install rewrites the main checkout's dependencies.

## Domain and architecture

Read [`CONTEXT.md`](CONTEXT.md) and the sections of [`docs/adr/0001-falkon-architecture.md`](docs/adr/0001-falkon-architecture.md) a change touches before changing behaviour. That ADR is the project's only architecture record: amend it in place, and add no other ADR files. How to keep both current: [`docs/agents/domain.md`](docs/agents/domain.md).

## Naming

The product is spelled Falkon, with a k. The predecessor product's name, in any case or spelling, and the misspelling of Falkon that swaps the k for a c, stay out of every shipped file (everything tracked outside `.scratch/`); planning files under `.scratch/` may name them to give scrub instructions.

## Request-path code

Code that runs per HTTP poll or request must not do remote I/O or unbounded reads: cache config with a TTL and a load timeout, and bound queries to the latest row per key.

## Cycle workflow

The current delivery spec, with its decisions, regression gate, and slices, is `.scratch/falkon-enterprise/spec.md`. The MVP spec `.scratch/falkon-mvp/spec.md` (D1 to D81) is the record of release 0.1.0; its decisions hold unless the current spec amends them. Work one slice at a time against it. Neither the spec nor the ADR takes precedence: raise any conflict between them to the human, who resolves it explicitly.

Never read, print, or copy `.env`.
