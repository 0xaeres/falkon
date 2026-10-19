# S18 verification

Implemented in branch `loop/s18`, without dependency installation or commits. No `.env` file was read.

## Automated checks

- Red: brief test failed because `./brief` did not exist; green after adding the pure builder.
- Red: MCP client test failed because initialize returned no instructions; green after registering instructions, the research tool and the prompt.
- `pnpm typecheck && pnpm test`: passed, 81 shared tests and 22 web tests.
- Targeted snapshot recording: `UPDATE_SNAPSHOTS=1 pnpm --filter @sbc/web exec node --import tsx --test --test-name-pattern='client research contracts|MCP registration order' src/lib/ask/mcp.contract.test.ts`: passed.
- `node .scratch/falkon-mvp/check-s18-contract-additions.cjs`: passed. Loads both registrations with `git show HEAD:<path>`, checks the first N entries and their raw serialized prefix bytes, checks exactly one appended research entry, and checks every other pre-existing contract file unchanged. Also checks server Ask agent, prompt and chat source bytes against HEAD.
- `git diff --numstat -- tests/contract`: 32 additions, 0 deletions in each registration. The research guidance and outputs are new snapshot files.
- `git diff --check`: passed.

## MCP client evidence

The existing SDK client contract harness connects to this worktree's MCP server through linked transports. It verifies `getInstructions`, `listPrompts`, `getPrompt` and `callTool` with and without a server model, including scope intersection, unknown names, denied repositories, omitted selection, empty selection, empty scope and input validation. Prompt and tool return the same brief.

## Opus wording review and live CLI research

The approved spec requires an Opus wording review and a live Claude Code research transcript. Attempted the wording review through the installed Claude Code CLI:

```sh
claude -p --model opus --tools '' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}' --setting-sources '' --no-session-persistence --output-format json --max-turns 1 < /tmp/s18-wording-review.txt
```

Exit status 1; API status 401. CLI response:

> Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.

No Opus review result or successful live CLI research run is claimed. The running Docker stack belongs to a separate checkout and does not contain these S18 changes. A live stack run remains pending valid Claude authentication and a stack built from this worktree. No existing stack was modified.

## Graph use

Used the worktree's graph project `Users-aeres-Desktop-projects-sourcebot-clone-.loop-worktrees-s18`, indexed at `2026-10-19T05:00:27Z`. Searched MCP and scope functions, traced `createMcpServer` in both directions, read `scopeFor` through the graph, and checked coverage of seven relevant source paths. No recorded coverage issues for those paths; verified relevant implementation directly in source.

## Sample brief

Input: `{ "query": "Where is greeting implemented?" }`; visible repositories are `fixtures.test/atlas` and `fixtures.test/boreal`.

```text
Question: Where is greeting implemented?

Repositories in scope:
- fixtures.test/atlas
- fixtures.test/boreal

Research steps:
1. Keep research within the repositories above. Use their exact names as repo on tool calls, including grep and glob; omitting repo can search beyond this selection. Use list_repos to confirm names, never to expand this list.
2. Locate likely files with glob or list_tree, then search terms with grep. Refine broad searches and inspect additional result pages when needed.
3. Read matching source with read_file, including surrounding logic. Follow declarations and uses with find_symbol_definitions and find_symbol_references; read those locations too.
4. If the question concerns changes or versions, inspect list_branches and list_commits, compare revisions with get_diff, and read source at the relevant ref.
5. Stop when gathered evidence answers the question or further searches yield no useful evidence. State what you could not find and any remaining uncertainty.

Write Markdown. Follow every code mention immediately with @file:{<repo>::<path>} or @file:{<repo>::<path>:1-10}, using the repository name, file path, and line range from your evidence. Replace 1-10 with the relevant start and end lines.
```

## Instructions

```text
Falkon searches and reads code in the repositories your access policy permits. Use list_repos for repository names; glob and list_tree for paths; grep for content; read_file for source; find_symbol_definitions and find_symbol_references for symbol relationships; list_branches, list_commits, and get_diff for history. For open questions, research_codebase returns a scoped research brief for your model to carry out with these tools. Write Markdown. Follow every code mention immediately with @file:{<repo>::<path>} or @file:{<repo>::<path>:1-10}, using the repository name, file path, and line range from your evidence. Replace 1-10 with the relevant start and end lines.
```
