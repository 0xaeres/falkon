# Contributing to Falkon

Thank you for your interest in Falkon. This guide explains how to build the project, what a change must pass, and how to send it for review.

## Ways to contribute

- **Report a bug.** Include the Falkon version (`RELEASE_NOTES.md` lists it), how you ran it (Docker or local), the config shape with secrets removed, and the exact error text.
- **Suggest a feature.** Open an issue first and describe the question the feature answers. Falkon adds a capability only when it answers a question the existing tools answer worse, so explain what you could not do before.
- **Fix a bug or improve the docs.** Small, focused pull requests merge fastest.

## Before you start

For anything larger than a bug fix, open an issue or a draft pull request so the design can be agreed before you write much code. Changes to behavior need a test, and changes to the architecture need an update to the decision record (see [Architecture changes](#architecture-changes)).

## Set up a development environment

Follow [Local development](README.md#local-development) in the README. You need Node.js 24, pnpm 10.28.0, PostgreSQL 17, Redis 7, and Zoekt on your `PATH`. The README's [Requirements](README.md#requirements) section lists each one.

From the repository root:

```bash
pnpm install && pnpm db:generate
```

Run `pnpm db:generate` before your first build. Run `pnpm install` again in every new worktree. Do not symlink `node_modules` from another checkout, because an install in the worktree then rewrites the other checkout's dependencies.

## Checks a change must pass

Both of these must pass before you report a change as done:

```bash
pnpm typecheck
pnpm test
```

Run `docker compose up --build` when your change touches the image, compose services, the Zoekt build, or anything a running stack depends on. For a change that alters search results, also run the golden checks:

```bash
pnpm golden:diff
```

`pnpm golden:record` rewrites the recorded results. Run it only when a change to search output is intended, and explain the difference in your pull request.

### Originality check

Falkon's prompts, tool descriptions and config text are original. The originality check fails when a run of eight or more words matches a reference text set:

```bash
ORIGINALITY_REF_DIR=<dir> pnpm originality
```

Run it when you edit prompt or tool text and have the reference set.

## Architecture changes

The architecture decision record is [`docs/adr/0001-falkon-architecture.md`](docs/adr/0001-falkon-architecture.md). It is the project's only architecture record.

- Read the sections your change touches before you change behavior.
- Amend the record in place. Do not add another ADR file.
- Use the terms in [`CONTEXT.md`](CONTEXT.md) in code, tests, and docs. For example, say "Product", not "tenant" or "workspace".

## Code rules

- **Request-path code.** Code that runs for each HTTP request or poll must not do remote I/O or unbounded reads. Cache configuration with a time-to-live and a load timeout. Bound queries to the latest row per key.
- **User text.** Query text must only reach the query IR's leaves. It must never build a new query structure or widen a repository scope.
- **Tool contract.** Tool names and input schemas are the contract with MCP clients. Change them only with a version note in `RELEASE_NOTES.md`.
- **Match the surrounding code.** Follow the naming, comment density and idioms of the file you edit.

## Naming

The product is spelled **Falkon**, with a k. Do not use a misspelling, and do not name any other product in shipped files. Shipped files are everything tracked by Git.

## Pull requests

1. Branch from `main`. Keep each pull request to one change.
2. Include tests for behavior changes. Name the tests you ran, with their results.
3. Describe what changed and why in the pull request body. Link the issue it closes.
4. Keep unrelated formatting changes out of the diff.

A maintainer reviews every pull request. Expect questions about edge cases, especially around access scopes, index revisions, and coverage gaps.

## Reporting security issues

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting for this repository. Describe the class of problem, the affected version, and the steps to reproduce it. Do not post working exploit code in a public place.

Falkon is single-operator software. Its default `AUTH_MODE=none` trusts any process that can reach the loopback port. Reports that depend on exposing a listener beyond loopback without `AUTH_MODE=apiKey` describe a misconfiguration, and the maintainers will still review them.

## Licensing of contributions

Falkon is licensed under the Apache License 2.0 (see [`LICENSE`](LICENSE)). By submitting a contribution, you agree that it is licensed under the same terms. You keep your copyright.
