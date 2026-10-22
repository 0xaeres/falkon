# Falkon 0.1.0

First release. Falkon is a self-hosted code context engine: Zoekt search over bare git clones, served to MCP clients per Product.

## What is in 0.1.0

- Zoekt code search and bare git clones kept in sync from GitHub or generic git connections.
- The 11 MCP tools, served per Product at `/mcp/<product>`.
- Change and impact questions served by the existing symbol and reference tools, driven by an opt-in impact recipe (`MCP_IMPACT_RECIPE=on` for MCP clients; the Ask UI applies it to impact-style questions).
- A knowledge base, on by default.
- The Ask chat UI with a Connect page for MCP clients, and a status page.
- No Falkon-side LLM on the serving path: the tools return evidence and the calling client reasons over it. Ask uses a language model only when you configure one.

## Running it

See `README.md` (Run (Docker) and Run (local dev)).

## Upgrading an existing Postgres volume

An existing volume keeps the old role and database names and needs a one-time rename. Follow "Upgrading from an earlier build" in `README.md` before starting this release.

## Memory

The whole stack used about 665 MB at the last probe, against a 654 MB reference. This is information only and is not enforced for 0.1.0.

## Known limits

- The code graph (relate, trace, potential impact over compiler-resolved edges) and the deterministic overview Map are not built; they are deferred past 0.1.0.
- Concurrent turns on one Ask thread overwrite each other; the last write wins.
- The `Credential.lastError` column is unused.
- A sync running while a Product is edited can briefly show a new member as Skipped.
- No automated browser test covers mermaid drawing, streaming or the failed-first-send flow.

## Before any public push

`.scratch/` (more than 500 tracked files that name the predecessor product, plus evaluation gold) moves to a private branch or repository before any public push.
