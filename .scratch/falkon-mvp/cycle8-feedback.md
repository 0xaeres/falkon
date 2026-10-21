# Cycle 8 feedback from the human's PAT end-to-end run (2026-10-21)

Input for `/agent-loop` planning. Setup used: main checkout, `docker compose up --build`, UI at http://127.0.0.1:3100, fine-grained PAT, one Product ("Agent Loop", one repo, indexed, Evidence Generation g-77c425 current).

## Verdict

The human confirmed the PAT path works end to end (wizard, connection, Product, first sync, current Evidence Generation, chat with sources). Findings below are fixes, not blockers.

## Fixed already this session (uncommitted; see worktree diff)

| # | Finding | Fix |
|---|---|---|
| F1 | Wizard showed mock repos and demo copy: `GET /api/repositories` and `GET /api/products` were prerendered at `next build` with the mock answer (`ENGINE_URL` unset at build). | `await atRequestTime()` (wraps `connection()`) at the top of both GETs; `tests/dynamic-routes.test.mts`; wizard copy neutral. |
| F2 | `docker compose up --build` failed: several services built the same tag in parallel, then compose tried to pull it. | Only `backend` builds; shared `x-image` with `pull_policy: never`; image `falkon-app`, project `name: falkon`. |

## Open findings (need fix slices)

| # | Finding | Evidence and hypothesis | Candidate fix |
|---|---|---|---|
| F3 | Repository step lists all of the user's repos although the fine-grained token was scoped to one. | `packages/api/src/connections.ts:21,59` lists `GET /user/repos?per_page=100&sort=pushed`. A fine-grained token always reads public resources, so the user's public repos appear beside the one selected private repo. Unverified: classic token or an "All repositories" token would show everything. | Reproduce with the engine (log count and `x-accepted-github-permissions`); consider `affiliation`/`visibility` filters, and show token scope in the step ("N repositories visible to this token"). Do not claim a hard limit. |
| F4 | "Ingestion queued" toast stays on screen; no toast when ingestion completes. | `packages/ui/src/features/status/status-view.tsx:83,186`: toast state starts from `?queued=1`, only the close button clears it; nothing watches the status transition. | Auto-dismiss (about 5 s); a "Evidence Generation g-... is current" toast on the transition from building to current; one live region. |
| F5 | Chat: "Hey" gets an "Abstained / Not enough evidence to answer" card containing a friendly model text. | Screenshot 3: the abstain path wraps a greeting in an evidence-failure frame. | Small talk and meta questions ("hey", "what can you do") answered normally with a hint of what to ask, no abstain card; reserve "not enough evidence" for questions that retrieval could not support. Decide where the router lives (agent prompt vs. pre-check). |
| F6 | Chat answers render raw Markdown (`**bold**`, `## heading`, lists) and would render no diagrams. | Screenshot 3. `packages/ui` has no Markdown or mermaid dependency (grep: none). | See below. New dependencies need gate 2. |

## F6 design notes (what chat products do)

- Render assistant text as Markdown with GFM (tables, task lists, strikethrough), streaming-safe (unterminated bold/code fence must not flicker); Vercel's AI SDK UI apps usually use `react-markdown` + `remark-gfm` or the streaming-tolerant `streamdown`.
- Fenced code: syntax highlighting (shiki or highlight.js), language label, copy button, horizontal scroll, no wrap.
- Mermaid: only for a fenced ```mermaid block; load the library lazily on the client, render after the stream completes (or debounce while streaming), show source on parse error, offer "view source" and "copy", fall back to a plain code block, strict security level.
- Safety: no raw HTML, sanitise links (`rel="noopener noreferrer"`), keep Falkon's `@file:{repo::path:a-b}` citation chips as a custom inline element, not a link.
- Prompt side: the Ask prompt should say what Markdown and mermaid the UI renders.
- Tests: fixture answers with heading, list, table, code fence, mermaid block, bad mermaid, citation.

## Carried items (unchanged, still not ranked above F3 to F6)

Connector-skipped repos stay "Building"; concurrent turns on one thread overwrite each other; failed first message leaves an empty thread; dead `Credential.lastError`; literal `[n]` in code needs a zero-width space.

## Still stale (S13 copy scrub)

`packages/ui/README.md:40`, `/docs` page demo-token text, mock connection error, chat empty state ("mock dataset"), UI layout description "Local mock UI".

## Not yet confirmed

The "random product name" seen on the repository step (probably a side effect of F1; ask the human if it recurs). Knowledge status shows "waiting for first scan": check it reaches ready (needs the model env).
