import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHooks } from "node:module";

// Chat offers every MCP tool except the agent tier (S89, D180): a tool added to an MCP registry reaches chat, or this test fails.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-parity-"));
process.env.CONFIG_PATH = path.join(dir, "config.json");
fs.writeFileSync(process.env.CONFIG_PATH, "{}");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@falkon/shared" ? new URL("../../../../shared/src/index.ts", import.meta.url).href : specifier, context);
  },
});
let createMcpServer: typeof import("../mcp").createMcpServer;
let toolDeps: typeof import("../tools").toolDeps;
let scopeFor: typeof import("@falkon/shared").scopeFor;
let agent: typeof import("./agent");
const REPO = "fixtures.test/atlas", OTHER = "fixtures.test/secret";
const row = (name: string, id: number) => ({ id, name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "refs/heads/main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir });
before(async () => {
  ({ createMcpServer } = await import("../mcp"));
  ({ toolDeps } = await import("../tools"));
  ({ scopeFor } = await import("@falkon/shared"));
  agent = await import("./agent");
  const { fakeProvenanceStore } = await import("../../../../shared/src/provenance.fake");
  const rows = [row(REPO, 1), row(OTHER, 2)];
  mock.method(toolDeps, "getRepo", async (name: string) => rows.find((r) => r.name === name));
  mock.method(toolDeps, "listRepos", async () => rows);
  const store = fakeProvenanceStore({ [REPO]: 1, [OTHER]: 2 });
  toolDeps.history = store;
  const ok = { cursorUpdatedAt: null, lastRunAt: null, lastSuccessAt: new Date("2025-02-01T00:00:00Z"), headCommit: null, status: "ok" as const, error: null, importedCount: 1, skippedCount: 0, access: "ok" as const, waitUntil: null, reconciledAt: null };
  await store.saveSyncState(1, ok);
  await store.saveSyncState(2, ok);
  const d = { kind: "PR" as const, number: 7, title: "Seven", body: "", state: "merged" as const, authorLogin: "dev", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-02"), mergedAt: null, closedAt: null, mergeCommitSha: null, headRef: null, baseRef: null, url: null, labels: [], truncated: [], comments: [], files: [] };
  await store.replaceDiscussion(1, d, []);
  await store.replaceDiscussion(2, { ...d, title: "Secret seven" }, []);
});
after(() => { hooks.deregister(); mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MCP_HISTORY_TOOLS; delete process.env.MCP_GIT_TOOLS; });

const CORE = ["read_file", "list_branches", "list_commits", "list_repos", "get_diff", "grep", "glob", "find_symbol_references", "find_symbol_definitions", "list_tree"];
const HISTORY = ["get_pull_request", "search_discussions", "get_provenance"];
const GIT = ["search_commits", "search_diffs", "compare_revisions", "list_refs", "check_ancestry", "get_range_history", "list_contributors"];
const flags = (history?: string, git?: string) => {
  for (const [k, v] of [["MCP_HISTORY_TOOLS", history], ["MCP_GIT_TOOLS", git]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
};
const chat = (repos = ["*"], selected: string[] = []) => agent.agentTools(scopeFor(repos), selected, () => {});
const mcpNames = async () => {
  const server = await createMcpServer(scopeFor(["*"]));
  const client = new Client({ name: "parity", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try { return (await client.listTools()).tools.map((t) => t.name); } finally { await client.close(); await server.close(); }
};

test("parity: with both flags unset, chat tools are the MCP tools minus the agent tier, in the stated order", async () => {
  flags();
  const mcp = await mcpNames();
  const expected = mcp.filter((n) => !(agent.CHAT_EXCLUDED_TOOLS as readonly string[]).includes(n));
  assert.deepEqual(Object.keys(chat()).sort(), expected.sort(), "same names (MCP lists the core ten in another order)");
  assert.deepEqual(Object.keys(chat()), [...CORE, ...HISTORY, ...GIT]);
  for (const n of agent.CHAT_EXCLUDED_TOOLS) assert.ok(!(n in chat()), n);
});

test("parity holds for every flag combination", async () => {
  for (const [h, g] of [["off", undefined], [undefined, "off"], ["off", "off"], [" OFF ", "Off"]] as const) {
    flags(h, g);
    const expected = (await mcpNames()).filter((n) => !(agent.CHAT_EXCLUDED_TOOLS as readonly string[]).includes(n));
    assert.deepEqual(Object.keys(chat()).sort(), expected.sort(), `${h} ${g}`);
  }
});

test("flags: git off drops the seven git tools, history off the three pull request tools, both off leaves the ten", () => {
  flags(undefined, "off");
  assert.deepEqual(Object.keys(chat()), [...CORE, ...HISTORY]);
  flags("off", undefined);
  assert.deepEqual(Object.keys(chat()), [...CORE, ...GIT]);
  flags("off", "off");
  assert.deepEqual(Object.keys(chat()), CORE);
});

test("flags: any value other than off keeps a family on", () => {
  for (const v of ["0", "false", "", "no", "on"]) {
    flags(v, v);
    assert.deepEqual(Object.keys(chat()), [...CORE, ...HISTORY, ...GIT], JSON.stringify(v));
  }
});

test("agent tier tools are not offered, and a call to one fails as an unknown tool", () => {
  flags();
  assert.deepEqual(agent.CHAT_EXCLUDED_TOOLS, ["ask_codebase", "research_codebase", "list_language_models"]);
  const tools = chat() as Record<string, unknown>;
  assert.equal(tools.ask_codebase, undefined);
  assert.equal(tools.research_codebase, undefined);
});

test("a history tool in chat keeps the caller's scope: out-of-scope repositories give no data", async () => {
  flags();
  const run = async (tools: ReturnType<typeof chat>, name: keyof ReturnType<typeof chat>, args: unknown) => {
    const t = tools[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<{ output: string }> };
    try { return { ok: true, text: (await t.execute(args, { toolCallId: "1", messages: [] })).output }; } catch (e) { return { ok: false, text: (e as Error).message }; }
  };
  const scoped = chat([REPO], [REPO]);
  const seen = await run(scoped, "get_pull_request", { repo: REPO, number: 7 });
  assert.deepEqual([seen.ok, JSON.parse(seen.text).title], [true, "Seven"]);
  const outside = await run(scoped, "get_pull_request", { repo: OTHER, number: 7 });
  assert.equal(outside.ok, false);
  assert.doesNotMatch(outside.text, /Secret/);
  const hits = JSON.parse((await run(scoped, "search_discussions", { query: "seven" })).text).hits.map((h: { repo: string }) => h.repo);
  assert.deepEqual(hits, [REPO]);
  // A repository the caller may see but the chat did not select is read by explicit name, as for every other tool: selection is a default, scope is the boundary.
  const unselected = await run(chat(["*"], [REPO]), "get_pull_request", { repo: OTHER, number: 7 });
  assert.equal(unselected.ok, true);
});

test("an empty chat selection means no selection: git tools called without repos read the visible repositories", async () => {
  flags();
  const run = async (selected: string[] | undefined) => {
    const t = agent.agentTools(scopeFor(["*"]), selected as string[], () => {}).list_contributors as unknown as { execute: (a: unknown, o: unknown) => Promise<{ output: string }> };
    return (await t.execute({}, { toolCallId: "1", messages: [] })).output;
  };
  const mentions = (out: string, name: string) => out.includes(name);
  for (const empty of [[], undefined]) {
    const out = await run(empty);
    assert.ok(mentions(out, REPO) && mentions(out, OTHER), `${JSON.stringify(empty)} reads both: ${out}`);
  }
  const narrowed = await run([REPO]);
  assert.ok(mentions(narrowed, REPO) && !mentions(narrowed, OTHER), `a selection narrows: ${narrowed}`);
});
