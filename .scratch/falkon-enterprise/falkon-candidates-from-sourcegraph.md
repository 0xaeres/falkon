# Falkon enhancement candidates from the Sourcegraph 8.1.1335 study

Written 2026-10-29, revised the same day after the human's two-tier decisions (section "Two tool tiers" below). Source of every Sourcegraph fact: `sourcegraph-8.1.1335-study.md` in this folder (pass numbers given as "P" plus the number). Falkon facts come from `CONTEXT.md`, ADR-0001 and `.scratch/falkon-enterprise/spec.md` as of commit 2abfdd7. Nothing here changes the Falkon repository; apart from the four tier decisions recorded below, these are candidates for the human to choose from, not decisions.

## Two tool tiers (decided by the human, 2026-10-29)

| # | Decision |
|---|---|
| T1 | D3 is amended: Falkon offers two classes of MCP tools. **Vanilla tools** need no server model and stay the default. **Agent tools** run a server model and give Falkon agentic capabilities. The vanilla tools stay model-free forever. |
| T2 | Both tiers are served on the same endpoint, `/mcp/<product>`, switched by a flag, not on a second path. |
| T3 | The first agent tool is `find_code`, under a bar that covers the whole offering: the combined tool list must reach parity with or exceed both Sourcegraph's tool list and today's Falkon, and the overall answer output must be at least as good as both. |
| T4 | `ask_codebase` moves to the agent tier. It is no longer in the vanilla tool list. |

Still to do outside this file: amend ADR-0001 4.2 (D3) and 12 item 1 in place with T1 to T4, and add the decisions to the current spec when a cycle is planned. The repository was not edited here.

### What the flag means (proposed defaults, for the human to confirm)
- **Operator config key `agentTools`** in the Falkon config: `enabled` (default `false`), plus caps (below). With it off, or with no model configured (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` not all set), `/mcp/<product>` lists only the vanilla tools; the knowledge base's existing "skipped: no model configured" pattern is reused for the log line.
- **Per-Product override** (`agentTools: false` on a Product) so one install can keep a vanilla-only Product beside agent-enabled ones. Because both tiers share one endpoint, this is the only way a client can be guaranteed vanilla tools on an install where the operator enabled agent tools; a per-request opt-out (for example an MCP initialise option) is a possible later addition.
- **Tool annotations.** Every agent tool's description and MCP annotations say it runs a server model, its cost cap and its typical latency, so a client model can choose a vanilla path when it prefers.
- **Contract effect.** The vanilla list changes once, deliberately: `ask_codebase` and `list_language_models` (only meaningful with a model) leave it (T4). The golden and MCP-registration snapshots are re-recorded in that slice, and the change is named in release notes, since tool names were a contract (D9, D11). With the flag off afterwards, the list must stay byte-identical from release to release.
- **Caps.** Per call: token cap and wall-clock cap. Per Product: a daily token budget. Every agent call is metered (tokens in, out, cost estimate) and shown on the Product status, the same way the knowledge base shows `budget-exhausted`.
- **Output contract, the part that keeps Falkon ahead.** Every agent tool returns, besides any prose, a structured evidence list (repository, path, line range, index revision) that the server has checked against reads its own tools made (the `buildEvidence` rule), and marks the result `generated: true`. A claim without checked evidence is labelled as unverified. Sourcegraph's model-backed tools return text only (P12: CodeFinder returns a text with links), so this is a betterment, not just parity.
- **Safety.** Agent tools read untrusted repository text with a server model, so they get read-only tools only, no network, no write, and the Product scope injected server side exactly as the vanilla tools do.
- **Measurement.** D8 still applies per agent tool, but the comparison is at equal total cost: server tokens plus the client's tokens for the agent arm, against a vanilla-only client answering the same question. An agent tool that does not win stays available but is not advertised by default.

## How to read this

Each candidate says what Sourcegraph does (observed in its binaries), what Falkon has today, what the gap is, a proposed shape that fits Falkon's existing rules, how it would be measured, and a rough size (S = one slice, M = two or three slices, L = a cycle or more).

Falkon's rules that every candidate respects:
- **D3 as amended by T1.** Vanilla tools never use a server model. Agent tools may, behind the flag, with caps, metering and checked evidence. Each candidate below says which tier it belongs to.
- **D8, capabilities earn their place.** A capability is on by default only after it beats the engine without it on its own question stratum (lower 95% confidence bound of the recall difference at or above -0.05 with lower cost, or a recall gain whose lower bound is above zero).
- **D11, no regression.** The four-check regression gate holds for every slice; tool names and input schemas are a contract.
- **D2, no embeddings.** Cycles 17 and 18 showed lexical access with an agent loop matches retrieval-augmented access. A useful confirmation from the study: Sourcegraph's own "natural-language search" is also lexical (tokenising, stemming, stop words, OR-ing terms and letting Zoekt rank), not embeddings (P11). So Falkon's lexical direction is the same bet Sourcegraph made.

## Where Falkon already matches or beats Sourcegraph

- Search, file reads, ctags symbol definitions and references, and an MCP surface for any client (the Sourcebot feature set Falkon started from).
- **A guaranteed model-free tier.** Sourcegraph mixes model-backed tools (the CodeFinder sub-agent, Deep Search) into one tool list. Falkon's vanilla tier never runs a hidden model, and its agent tier is opt-in per install and per Product, so an operator chooses.
- **Checked citations.** Falkon's Ask turns citations into evidence only when the cited file was read by a tool, the repository is in scope and the span is inside the file (`buildEvidence`). The knowledge base rejects documents whose citations do not check out. Sourcegraph's prompt only asks the model to mark verified versus inferred claims (P8, Recreation notes 6); no equivalent post-check was found.
- **Coverage gaps** are disclosed so an empty result does not read as "no effect". No Sourcegraph equivalent was found.
- **Provenance**: pull requests stored and linked to commits and tickets, with `get_pull_request`, `search_discussions` and `get_provenance`. Sourcegraph's history tools stop at git (commit search, diff search, compare revisions, list refs).
- **Product scoping in the path**, resumable chat streams, a server-sent Product event stream, rendered architecture diagrams in answers.
- A much smaller footprint (about 545 MB for the stack in cycle 18).

The gaps are mostly in search ranking for loose queries, history tooling breadth, precise navigation, agentic tools, and the agent loop's long-run behaviour.

## Tool-list parity map (T3)

Sourcegraph's tool set comes from P6 and P13 (model-facing names carry an `sg_` prefix there). "Vanilla" and "Agent" are Falkon's two tiers after T1 to T4. Status: **parity** (Falkon covers it today), **better** (Falkon covers more), **gap** (a candidate below closes it), **n/a** (not meaningful for an MCP server).

| Sourcegraph tool | Falkon today | Tier after the plan | Status and candidate |
|---|---|---|---|
| Keyword search (RE2, `repo:`/`file:`/`rev:`, default timeout) | `grep` | Vanilla | Parity; C5 adds the timeout hint, C9 adds search at any revision |
| Natural-language search (tokenise, stem, stop words, OR, repo boost) | none | Vanilla `search_keywords` | Gap, C1 |
| CodeFinder sub-agent (4 tools, file and range list) | none | Agent `find_code` | Gap, C7 (first agent tool, T3); better with checked evidence |
| Deep Search start and read (async research) | `ask_codebase` (synchronous) | Agent `research` + `get_research`; `ask_codebase` moves here (T4) | Gap, C17 |
| Commit search (authors, message, content, files, natural dates, ref globs) | `list_commits` (partial) | Vanilla `search_commits` | Gap, C2 |
| Diff search (added or removed lines) | `get_diff` (partial) | Vanilla `search_diffs` | Gap, C2 |
| Compare revisions (paged file diffs) | `get_diff` (partial) | Vanilla (extend `get_diff` additively or a new `compare_revisions`) | Gap, C2 |
| List refs with `containsCommit`, heads or tags only | `list_branches` (no tags, no containment) | Vanilla `list_refs` | Gap, C2 |
| Check ancestry | none | Vanilla `check_ancestry` | Gap, C2 |
| Go to definition (precise first) | `find_symbol_definitions` (ctags) | Vanilla | Parity for lexical; precise tier is C8 |
| Find references (precise, syntactic, search tiers) | `find_symbol_references` (ctags and search) | Vanilla | Parity for lexical; ladder is C8 |
| List files | `list_tree`, `glob` | Vanilla | Better (glob patterns) |
| List repositories | `list_repos` | Vanilla | Parity |
| Read file (numbered lines, range) | `read_file` | Vanilla | Parity; C4 adds middle truncation |
| Contributor repositories (repos an author commits to) | none | Vanilla `list_contributors` | Gap, C18 |
| Evaluator (sandboxed scripts with search) | none | Vanilla (the client writes the script, no server model) | Gap, C10 |
| Ask the user (pauses the agent for a question) | n/a on MCP (the client asks) | Agent `research` may return "needs input" | n/a for vanilla; C17 covers it |
| Mermaid and chart output | archify diagrams in the UI chat | Agent `research` returns diagram source | Better in the UI; C17 adds it to MCP |
| none | `get_pull_request`, `search_discussions`, `get_provenance` | Vanilla | Better: Sourcegraph has no pull request or ticket tools |
| none | `research_codebase` (a model-free brief for the client's model) | Vanilla | Better |
| none | Knowledge base repositories searchable by Zoekt | Vanilla (through `grep`) | Better |
| none | Coverage gaps in results | Both | Better |
| none | `explain_change` (why did this change: commits, pull requests, tickets) | Agent | Better than Sourcegraph, C19 |
| none | `impact` (agentic potential impact) | Agent | Better than Sourcegraph, C20 |

Counting rows: after C1, C2, C7, C10, C17 and C18, every Sourcegraph tool that is meaningful on an MCP server has a Falkon equivalent, and Falkon keeps seven offerings Sourcegraph lacks. Precise navigation (C8) is the one area where Falkon reaches parity only when SCIP returns.

### "Overall output" parity, and how to measure it honestly
Sourcegraph cannot be run here (licence and no Deep Search runner, study P15), so output cannot be compared head to head. The proposed bar instead:
1. **Against today's Falkon:** the existing D8 strata (dev, hidden, impact, history) with the agent tier on versus off, at equal total cost.
2. **Against Sourcegraph's design:** a capability checklist taken from the study (the parameters, limits and behaviours listed per tool in P11 to P13 and P17), each item met or beaten, plus Falkon-only properties (checked evidence, coverage gaps, provenance).
3. If a licensed Sourcegraph instance ever becomes available, run the same O3 questions through its Deep Search and score them with Falkon's scorer.

---

## Tier 1: high value, fits the rules now

### C1. Keyword search for natural-language questions (model-free)
- **Sourcegraph (P11, P13).** A tool the model sends a few keywords to (its description says to extract keywords, not to pass a sentence; boolean operators are rejected). The tool, not the model, does the work: quoted phrases stay whole; terms split on whitespace and on `[:#]|->`; leading and trailing punctuation trimmed; identifier-like terms (containing a dot, an underscore, or a lower-to-upper case change) kept as symbols; English Snowball stemming; a 222-word stop list; terms OR-ed together; a `type` switch chooses names and contents, names only, code only (excluding 18 documentation-like extensions) or documentation only; each sub-search asks Zoekt for up to 5000 matches; repository-restricted variants run first, then the unrestricted query; results merged in that order, de-duplicated by key and cut at the limit.
- **Falkon today.** `grep` takes Zoekt query syntax. A loose question has to be turned into a good query by the client model, and a multi-word query is AND-ed.
- **Gap.** Recall on vaguely worded questions depends on the client model's query skill; Haiku-class clients are weakest here.
- **Proposed shape.** A new additive tool (name to choose, for example `search_keywords`) beside `grep`, with the tokenising and stemming in `packages/shared/src/query`, building an OR query in the existing IR so user text still lands only in IR leaves. No model involved, so D3 holds. Repository boosting maps to "repositories the caller named first, then the whole Product".
- **Measure.** The existing dev and hidden strata on Haiku (the client most likely to benefit), with the tool added versus not. Also the history stratum, whose questions are phrased from symptoms (D98) and are exactly the vocabulary-mismatch case.
- **Size.** M. **Risk.** Low; additive tool.

### C2. Git history tools at Sourcegraph's breadth (Phase 1, already next)
- **Sourcegraph (P13).** Commit search with `repos`, `revisions` (including ref globs such as `*refs/heads/*` for backports), `authors` (up to 5, case-insensitive partial, OR), `messageTerms` (OR), `contentTerms` (terms in the changed lines, OR), `files` (OR), `after` and `before` accepting natural phrases such as "1 month ago", `count` (default 50, 100 with date filters, maximum 100). Diff search with `pattern`, `added` and `removed` flags, dates, files, authors. Compare revisions with paged file diffs (default 50, maximum 100). List refs with `headsOnly`, `tagsOnly` and `containsCommit` ("which releases include this commit?"). An ancestry check between two commits. Prompt recipes: release-containing-a-commit, and vulnerable versions (find the introducing and fixing commits, then compare tag sets).
- **Falkon today.** `list_commits`, `get_diff`, `list_branches`, plus the pull request and provenance tools. The spec's "Next" is Phase 1: history tools beyond these, measured against the cycle 13 floor.
- **Gap.** No content (pickaxe) search, no added-versus-removed diff search, no tag membership, no ancestry, no multi-file compare.
- **Proposed shape.** Use the Sourcegraph parameter set as the checklist for Phase 1, implemented on Falkon's bare clones with `git log -G/-S`, `git tag --contains`, `git merge-base --is-ancestor`, `git diff --stat` with paging. Add the two recipes to the history prompt.
- **Measure.** The why-and-history stratum against the `clone-tools-git` floor (D99), as the spec already plans.
- **Size.** M to L. **Risk.** Low; this is the planned next phase.

### C3. Ask loop: compaction, recovery and forced final answer
- **Sourcegraph (P8, P12, P17, P19).** Per turn: stop check; proactive compaction when the estimate passes a threshold (at most once per turn); a forced final-summarisation turn when the budget is spent; on a "prompt too long" error, compact once and retry; stop reasons mapped to short notes the user sees (turn limit, refusal, output truncation) or to errors. The prompt size is estimated as characters of tool schemas plus messages divided by 3.5. Compaction is stored append-only with the highest covered turn id, the summary, the statistics of the covered turns and the cost of the summary call; the loader replays one user-role summary turn followed by every later turn verbatim; each summary folds in the previous one; appends are guarded by optimistic checks; the stream announces compaction start and end, and the transcript shows a display-only marker turn. The `pi` agent shipped in the same image uses the rule "compact when context tokens exceed the window minus a 16,384-token reserve", keeps the newest 20,000 tokens verbatim, cuts only at turn boundaries, cuts tool results to 2,000 characters for the summariser, and treats a summary that stops for length or tries to call a tool as a failure.
- **Falkon today.** One `streamText` run with at most `FALKON_CHAT_MAX_STEP_COUNT` steps (default 100); no compaction; history is the stored `Chat`. A long thread or a tool-heavy turn eventually overflows the model window, and hitting the step cap ends without a forced answer.
- **Gap.** Long threads and deep investigations fail instead of degrading gracefully.
- **Proposed shape.** In `packages/api/src/engine/ask/agent.ts`: (1) estimate tokens before each step; (2) compact when over window minus reserve, using a structured cumulative summary. Falkon-specific improvement over both Sourcegraph and `pi`: carry an **evidence ledger** across compactions (every file and span a tool read, with its index revision), the same way `pi` carries read and modified file lists, so `buildEvidence` can still validate citations made after a compaction. (3) On a context-overflow error, compact and retry once. (4) At the step cap, run one tool-free turn that must answer with what it has. (5) Store compactions append-only per thread (latest row per thread, per the request-path rule in AGENTS.md) and send `compaction_started` and `compaction_complete` on the thread stream.
- **Measure.** A long-thread stratum (multi-question threads on O3) for survival and recall; the existing strata must not move (gate check 3).
- **Size.** M. **Risk.** Medium; touches the Ask core, so the Ask-quality gate applies.

### C4. Middle truncation and size limits for large tool results
- **Sourcegraph (P12, P19).** Long text keeps the first 75 percent and the last 25 percent of the allowed length, cut at character boundaries, with a marker stating how many characters were removed. The `pi` sub-agent output is capped at 50 KiB with a marker.
- **Falkon today.** Not checked in detail; tool outputs have their own limits per tool.
- **Proposed shape.** One shared helper used by `read_file`, `get_diff` and search results when a limit is hit, so the end of a file or diff (often the interesting part) is never silently lost.
- **Measure.** Contract tests; no recall change expected, so it rides the regression gate only.
- **Size.** S. **Risk.** Low, but output shape changes count against the golden tests.

### C5. Search timeouts the model can act on
- **Sourcegraph (P13).** Every search gets a default `timeout:` token when none is present. A slow search returns a hint with the time left until the request deadline minus 5 seconds (never below 1 second) so the model retries with a sensible timeout or a narrower query.
- **Falkon today.** Not seen.
- **Proposed shape.** Add the default and the hint text to `grep` and the new keyword tool.
- **Size.** S. **Risk.** Low.

### C6. Read-only fetch hardening
- **Sourcegraph (P10).** Only allow-listed git sub-commands, arguments and `-c` keys may run; fetch runs with no tags (unless asked), no FETCH_HEAD write, protocol version 2, credential helper cleared, LFS smudge skipped, a thread cap, optional fsck, URL redaction in logs, and a separate error class for network failures.
- **Falkon today.** ADR 4.5 lists credential storage as "not hardened, by decision (internal testing first)". Fetch flags were not checked.
- **Proposed shape.** A hardening slice on the sync path's git invocations plus a redaction test like the existing token canary. This touches the sync path, which the MVP slices left untouched, so it needs the human's go-ahead.
- **Size.** S to M. **Risk.** Low behaviour risk; must not change shard or clone layout.

---

## Tier 2: high value, needs more design or a model

### C7. `find_code`: the first agent tool (Agent tier, T3), also used inside Ask
- **Sourcegraph (P12, P19).** CodeFinder: a separate agent on a cheaper model with exactly four tools (natural-language search, keyword search, list files, read file), a required turn limit (probably 18), a 120-second timeout, and an output contract of "a list of files with line ranges, not an essay". The main prompt tells the model to call it once per known repository, then read the returned ranges and use keyword search for callers. The `pi` setup has the same split: finder and oracle are read-only, worker may edit; one sub-agent at a time; 10-minute kill; 50 KiB output cap; 20,000-character task cap; no further delegation.
- **Falkon today.** One model does everything in Ask.
- **Gap.** Cost: the strong model spends many steps on discovery.
- **Proposed shape.** An agent-tier MCP tool, and the same function called by Ask and `research`. Input: `task` (up to 20,000 characters, with the paths, symbols and prior findings the caller already has), optional `repos` and `revision`. It runs the cheap model configured in `models` (a `finder` role) with only vanilla read tools (`grep`, `search_keywords` once C1 exists, `glob`, `list_tree`, `read_file`, `find_symbol_definitions`, `find_symbol_references`); turn cap 18 and wall clock 120 s as defaults (Sourcegraph's values, P12); one call at a time per session. Output: a one- or two-line summary plus a list of `{repo, path, startLine, endLine, revision, why}` items, each checked by the evidence rule against reads the sub-agent actually made (items that fail are dropped and counted), plus the stop reason in plain words (turn limit, timeout, refusal) the way Sourcegraph maps them (P12). The caller then reads the ranges itself.
- **Betterment over Sourcegraph.** CodeFinder returns text with links; `find_code` returns machine-checked ranges with revisions, discloses coverage gaps it hit, and reports how many claimed ranges failed the check.
- **Measure.** D8 at equal total cost: a client using `find_code` plus vanilla tools against a client using vanilla tools only, on the dev, hidden and impact strata. The likely win is cost and steps on large Products (O3 has 42 repositories).
- **Size.** M. **Risk.** Medium (latency, a second model setting, prompt injection, mitigated by read-only tools).

### C8. Usages as one paged ladder: precise, then syntactic, then search-based
- **Sourcegraph (P2 to P5, Recreation notes 1 and 2).** One references request runs precise (SCIP) results first, then syntactic, then search-based, in the same page when a tier runs out, with an opaque cursor holding the current phase and that tier's own cursor, so a client pages through one continuous stream. Precise uploads are found with a nearest-indexed-commit graph (two tables: direct coverage per commit with upload distances, and per-commit links to the nearest ancestor with data), so a slightly stale index still answers. Uploads are grouped by indexer root and indexer name (an LSIF and a SCIP upload from the same tool count as one).
- **Falkon today.** `find_symbol_definitions` and `find_symbol_references` are ctags and search based. SCIP ingestion and the graph are designed but deferred (D28), and the graph moves to ArcadeDB when SCIP arrives (D85, D87).
- **Proposed shape.** When Phase 5 brings SCIP back, put the ladder behind the existing tool names (results carry which tier produced them, as evidence origin), use the cursor-with-phase pattern, and adopt the nearest-indexed-commit tables so a newer commit is answered from the nearest older index with the distance disclosed as a coverage note.
- **Measure.** The relate-and-trace and impact strata, where cycle 12 and 13 showed lexical tools fall short only across repositories.
- **Size.** L. **Risk.** High; it is the deferred graph work.

### C9. Search at a commit the index does not hold
- **Sourcegraph (P10).** Hybrid search: find the commit Zoekt indexed for the branch, list the paths that differ between it and the requested commit with git diff, search Zoekt while ignoring those paths, scan the changed files directly, and retry if the index moved meanwhile.
- **Falkon today.** Zoekt serves the indexed head; `read_file` can read any revision from the bare clone.
- **Gap.** A question about a pull request head, an older release or a feature branch cannot be searched, only read.
- **Proposed shape.** Accept a revision on `grep` (or the new keyword tool) and run the hybrid recipe with a bounded set of changed files (a cap, with a coverage gap when exceeded). Results name the requested revision as their index revision.
- **Measure.** A small stratum of release and branch questions (the history stratum has some).
- **Size.** M. **Risk.** Medium (unbounded diffs must be capped).

### C10. An aggregation sandbox for counting questions
- **Sourcegraph (P13, Recreation notes 7).** An evaluator tool: Lua 5.1 with only search, file, format, source-reading and path modules; no filesystem, network or system access; 120-second timeout; at most 100 searches per script; return value cut to 100 KB; the model is told to narrow a query when `limitHit` is set rather than raise caps.
- **Falkon today.** None. Questions such as "how many services call X" or "list every repository that pins version Y" take many tool steps.
- **Proposed shape.** A model-free MCP tool (the client writes the script, so D3 holds) running in a locked-down interpreter in a child process, with the same caps, reusing Falkon's Product scope for every inner search.
- **Measure.** A counting and listing stratum (new); cost per question is the expected win.
- **Size.** M to L. **Risk.** High (code execution); needs a security review before default-on.

### C11. Product-level exclusions for agent context
- **Sourcegraph (P15).** Deep Search has an exclude matcher (`deepsearch/excludematcher`, 211 functions) and a "context filter" that, if invalid, blocks all repository access (fail closed, P5).
- **Falkon today.** Access policy narrows repositories; no path-level exclusion was seen.
- **Proposed shape.** Per-Product exclude globs (vendored code, generated files, secrets folders) applied inside every tool runner, failing closed on an invalid pattern.
- **Size.** S to M. **Risk.** Low.

---

### C17. `research`: deep research as an agent tool (Agent tier), with `ask_codebase` moved beside it (T4)
- **Sourcegraph (P15, P17, Recreation notes 5).** Deep Search: a question is queued, a separate runner drives the model loop, events (turn and thinking deltas, tool call pending, progress and complete, title, compaction start and end, done, error) go through a Redis broker, a reconnecting client gets a snapshot first, follow-ups and forks are new questions on the same conversation, and a per-user quota counts questions. Its MCP tools take `question`, `followup_to` and `identifier` and return `title`, `answer`, `link`.
- **Falkon today.** `ask_codebase` runs Ask synchronously and saves a Product thread with a link to the UI. The UI chat already has resumable streams (S71) and the Product event stream (S74).
- **Proposed shape.** `research` starts a question on a Product thread and returns at once with the thread id and link; MCP progress notifications carry turn and tool progress when the client supports them, and `get_research(thread, after?)` returns the current state, the answer and its checked evidence when done. `followup_to` continues a thread. The loop is the Ask loop with C3 (compaction, overflow recovery, forced final answer) and may call `find_code` (C7) and, once built, `explain_change` (C19). Output: answer prose, a checked evidence list, coverage gaps, optional diagram source, and a "needs input" state instead of Sourcegraph's ask-user tool. `ask_codebase` moves to this tier with its current behaviour, as the synchronous form of `research` for clients that cannot wait.
- **Betterment over Sourcegraph.** Checked evidence on every answer, coverage gaps, provenance tools inside the loop, and the same thread visible in the Falkon UI.
- **Measure.** D8 at equal total cost against a vanilla-only client on all strata; the long-thread stratum from C3.
- **Size.** L. **Risk.** Medium to high (cost; caps and metering from the tier section are a precondition).

### C18. `list_contributors` (Vanilla)
- **Sourcegraph (P13).** Contributor repositories: given authors (and a minimum commit count, default 1, and a limit), the repositories they commit to.
- **Falkon today.** None, though the bare clones hold the data.
- **Proposed shape.** Both directions over the Product's clones: repositories an author works on, and the top authors of a path or repository in a time window (useful for "who owns this?"). Model-free.
- **Size.** S. **Risk.** Low.

### C19. `explain_change` (Agent tier)
- **Sourcegraph.** No equivalent: its history tools are raw git (P13).
- **Proposed shape.** Given a file, symbol, commit or ticket key, the agent walks commits, pull requests, discussions and tickets with the vanilla history tools (C2 plus `get_pull_request`, `search_discussions`, `get_provenance`) and returns the change units, their pull requests and tickets, and the source spans, all checked, in the four evidence kinds of D90.
- **Measure.** The why-and-history stratum against the `clone-tools-git` floor and against C2's vanilla tools.
- **Size.** M. **Risk.** Medium. Depends on C2.

### C20. `impact` (Agent tier)
- **Sourcegraph.** No equivalent found.
- **Proposed shape.** Turns today's impact-and-change recipe (S25) into an agent tool that returns the potential-impact set with evidence and coverage gaps, labelled as inferred from static dependencies (CONTEXT.md "Potential impact"). Uses C8's precise tier once SCIP returns.
- **Measure.** The impact stratum.
- **Size.** M. **Risk.** Medium.

## Tier 3: parity polish and later items

- **C12. Answer recipes in the prompt (P8).** Falkon's brief already has the impact-and-change recipe. Add Sourcegraph's other recipes in Falkon's own words: feature location, architecture overview, history, release-containing-a-commit, vulnerable versions; plus "never claim absence without evidence". Size S; measured by the Ask-quality gate. Must pass the originality check (D9).
- **C13. Conversation features of Deep Search (P15, P17).** Forks of a thread from a given answer, shareable read-only links (read tokens that can be rotated), starring, per-user question quotas, a `title` event. Falkon has threads and resumable streams but no forks, sharing or quotas. Size M; product work, no recall effect.
- **C14. Follow-up history repair (P17).** Before replaying a thread, check that every stored tool call has a result and repair dangling ones, so a stopped turn never breaks the next question. Size S.
- **C15. Per-commit symbol index (P14, Rockskip).** Symbols per commit stored as name and path rows with "added at" and "deleted at" commit references over a skip-list of ancestry, so symbol search works at any commit incrementally. Only worth it if C9 and C2 show demand for symbol questions at old revisions. Size L.
- **C16. Ranking checks on Falkon's Zoekt (P9).** Zoekt's scoring rewards exact symbol hits (+7000), word boundaries and file-name hits, and has an optional BM25 mode (`UseBm25Scoring`) whose default in Sourcegraph was not read. Check which options Falkon's Zoekt call sets; try BM25 for the keyword tool of C1 only. Size S; measured with C1.

## Not recommended

- **The batch-change coding agent (P16, P19).** Sourcegraph runs the external `pi` agent on executors to edit code across repositories. Falkon is a read-only context engine; editing is a non-goal and would widen the security surface. The useful ideas from it (compaction rules, sub-agent caps) are already folded into C3 and C7.
- **Embeddings or a vector store for code.** Neither Falkon's own cycles nor Sourcegraph's design support it for code (D2, P11). Prose sources stay open under D84.

## Suggested order (revised for T1 to T4)

1. **Tier foundation, with `find_code`.** The `agentTools` flag and per-Product override, moving `ask_codebase` and `list_language_models` to the agent tier (snapshots re-recorded once), caps and metering, the checked-evidence output contract, the `finder` model role, then C7 `find_code`. Measured at equal total cost.
2. **Vanilla history parity.** C2 with C12's history recipes and C18 (this is also the spec's planned Phase 1).
3. **Vanilla search parity.** C1 with C16 and C5.
4. **Loop robustness and research.** C3 with C4 and C14, then C17 `research` on top of it.
5. **Agent history and impact.** C19 `explain_change`, C20 `impact`.
6. C11 and C6; then C9 and C10 if strata show demand.
7. C8 and C15 with Phase 5 (SCIP and ArcadeDB).

After steps 1 to 4 the tool-list map above has no "gap" rows except precise navigation.

## Open questions for the human

1. Should C1 be a new tool name, or a mode on `grep`? A new name keeps the vanilla contract untouched (D9, D11).
2. Is a code-execution tool (C10) acceptable on a self-hosted, localhost-bound install, given D5's single-operator scope?
3. Should C6 open the sync path, which the MVP deliberately left untouched?
4. Flag details (proposed above): `agentTools.enabled` default off, a per-Product override, and per-call and per-Product caps. Confirm, or name other defaults.
5. Should `research` (C17) come before the vanilla parity steps, given T3 asks for parity of the whole offering?
