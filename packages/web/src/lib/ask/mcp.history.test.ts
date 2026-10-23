import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { snapshot } from "../../../../../tests/contract/snapshot";

// MCP_HISTORY_TOOLS (D113, S49): off keeps today's registration bytes, on appends the three pull request history tools.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-history-"));
process.env.CONFIG_PATH = path.join(dir, "config.json");
fs.writeFileSync(process.env.CONFIG_PATH, "{}");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];
import { registerHooks, createRequire } from "node:module";
// Pin the workspace package to this tree, as the contract test does.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@falkon/shared" ? new URL("../../../../shared/src/index.ts", import.meta.url).href : specifier, context);
  },
});
let createMcpServer: typeof import("../mcp").createMcpServer;
let toolDeps: typeof import("../tools").toolDeps;
let scopeFor: typeof import("@falkon/shared").scopeFor;
const REPO = "fixtures.test/atlas", OTHER = "fixtures.test/secret";
const row = (name: string, id: number) => ({ id, name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "refs/heads/main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir });
before(async () => {
  ({ createMcpServer } = await import("../mcp"));
  ({ toolDeps } = await import("../tools"));
  ({ scopeFor } = createRequire(import.meta.url)("@falkon/shared"));
  const { fakeProvenanceStore } = await import("../../../../shared/src/provenance.fake");
  const rows = [row(REPO, 1), row(OTHER, 2)];
  mock.method(toolDeps, "getRepo", async (name: string) => rows.find((r) => r.name === name));
  mock.method(toolDeps, "listRepos", async () => rows);
  const store = fakeProvenanceStore({ [REPO]: 1, [OTHER]: 2 });
  toolDeps.history = store;
  const ok = { cursorUpdatedAt: null, lastRunAt: null, lastSuccessAt: new Date("2025-02-01T00:00:00Z"), headCommit: null, status: "ok" as const, error: null, importedCount: 1, skippedCount: 0 };
  await store.saveSyncState(1, ok);
  await store.saveSyncState(2, ok);
  const d = { kind: "PR" as const, number: 7, title: "Seven", body: "", state: "merged" as const, authorLogin: "dev", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-02"), mergedAt: null, closedAt: null, mergeCommitSha: null, headRef: null, baseRef: null, url: null, labels: [], truncated: [], comments: [], files: [] };
  await store.replaceDiscussion(1, d, []);
  await store.replaceDiscussion(2, { ...d, title: "Secret seven" }, []);
});
after(() => { hooks.deregister(); mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MCP_HISTORY_TOOLS; });

async function connect(flag: string | undefined, repos = ["*"]) {
  if (flag === undefined) delete process.env.MCP_HISTORY_TOOLS; else process.env.MCP_HISTORY_TOOLS = flag;
  const server = await createMcpServer(scopeFor(repos));
  const client = new Client({ name: "history", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const core = JSON.parse(fs.readFileSync(new URL("../../../../../tests/contract/registration.json", import.meta.url), "utf8")) as { name: string }[];

test("flag off (unset, off, ON, 1, empty): the registration is byte-for-byte the frozen one", async () => {
  for (const flag of [undefined, "off", "ON", "1", ""]) {
    const s = await connect(flag);
    try {
      const tools = (await s.client.listTools()).tools;
      assert.equal(JSON.stringify(tools), JSON.stringify(core), String(flag));
      assert.equal((await s.client.callTool({ name: "get_pull_request", arguments: { repo: REPO, number: 7 } })).isError, true, "an unregistered tool cannot be called");
    } finally { await s.close(); }
  }
});

test("flag on: the three history tools follow the existing ones in a fixed order, the existing ones unchanged", async () => {
  const s = await connect("on");
  try {
    const tools = (await s.client.listTools()).tools;
    assert.equal(JSON.stringify(tools.slice(0, core.length)), JSON.stringify(core));
    assert.deepEqual(tools.slice(core.length).map((t) => t.name), ["get_pull_request", "search_discussions", "get_provenance"]);
    snapshot("registration-history", tools.slice(core.length));
    assert.ok(tools.slice(core.length).every((t) => t.annotations?.readOnlyHint === true));
    assert.doesNotMatch(JSON.stringify(await s.client.getPrompt({ name: "ask_codebase", arguments: { query: "q" } })), /get_pull_request|search_discussions|get_provenance/, "no recipe in the guidance (D113)");
    assert.doesNotMatch(s.client.getInstructions() ?? "", /get_pull_request|search_discussions|get_provenance/, "server instructions unchanged (D113)");
  } finally { await s.close(); }
});

test("flag on: a call works, a repository outside the scope reads like a missing one, and bad arguments are refused", async () => {
  const s = await connect("on", [REPO]);
  try {
    const text = async (name: string, args: Record<string, unknown>) => {
      const r = await s.client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[]).map((c) => c.text).join("\n") };
    };
    const seen = await text("get_pull_request", { repo: REPO, number: 7 });
    assert.deepEqual([seen.isError, JSON.parse(seen.text).title], [false, "Seven"]);
    const outside = await text("get_pull_request", { repo: OTHER, number: 7 });
    const missing = await text("get_pull_request", { repo: "fixtures.test/missing", number: 7 });
    assert.equal(outside.isError && missing.isError, true);
    assert.equal(outside.text.replaceAll(OTHER, "<repo>"), missing.text.replaceAll("fixtures.test/missing", "<repo>"));
    assert.doesNotMatch(outside.text, /Secret/);
    assert.deepEqual(JSON.parse((await text("search_discussions", { query: "seven" })).text).hits.map((h: { repo: string }) => h.repo), [REPO]);
    for (const [name, args] of [["get_pull_request", { repo: REPO, number: 0 }], ["search_discussions", { query: "x", perPage: 21 }], ["search_discussions", { query: "x", page: 0 }], ["get_provenance", { repo: REPO, path: "a", startLine: 3, endLine: 2 }], ["get_provenance", {}]] as const)
      assert.equal((await text(name, args)).isError, true, `${name} ${JSON.stringify(args)}`);
  } finally { await s.close(); }
});
