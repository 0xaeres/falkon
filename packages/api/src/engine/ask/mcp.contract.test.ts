import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { snapshot } from "../../../../../tests/contract/snapshot";
import type { WSearchRequest } from "@falkon/shared";
import { seedContractRepo } from "../../../../../tests/contract/fixture";

const fixture = seedContractRepo();
process.env.DATA_DIR = fixture.dir;
// Fail before opening a socket if the transport injection ever stops applying.
process.env.ZOEKT_URL = "invalid-contract-url";
process.env.CONFIG_PATH = path.join(fixture.dir, "config.json");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];
import { registerHooks } from "node:module";
// Worktree node_modules can be symlinked to another checkout. Pin the workspace
// package to this tree so this contract checks the source in this worktree.
const localShared = new URL("../../../../shared/src/index.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@falkon/shared" ? localShared : specifier, context);
  },
});
let createMcpServer: typeof import("../mcp").createMcpServer;
let toolDeps: typeof import("../tools").toolDeps;
let scopeFor: typeof import("@falkon/shared").scopeFor;
let setZoektTransport: typeof import("@falkon/shared").setZoektTransport;
const REPO = "fixtures.test/atlas";
const row = { name: REPO, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "refs/heads/main", isFork: false, isArchived: false, pushedAt: new Date("2026-01-02T00:00:00Z"), indexedAt: new Date("2026-01-03T00:00:00Z"), indexedRevisions: ["HEAD", "refs/heads/feature"], path: fixture.bare };
before(async () => {
  ({ createMcpServer } = await import("../mcp"));
  ({ toolDeps } = await import("../tools"));
  ({ scopeFor, setZoektTransport } = await import("@falkon/shared"));
  toolDeps.baseUrl = "http://localhost:3000";
  mock.method(toolDeps, "getRepo", async (name: string) => name === REPO ? row : undefined);
  mock.method(toolDeps, "listRepos", async ({ query }: { query?: string }) => !query || REPO.includes(query.toLowerCase()) ? [row] : []);
  mock.method(globalThis, "fetch", async () => Response.json({}));
  setZoektTransport({
    search: async (request) => { requests.push({ method: "search", request: structuredClone(request) }); return respond(); },
    async *stream(request) { requests.push({ method: "stream", request: structuredClone(request) }); yield respond(); },
  });
});
const requests: { method: "search" | "stream"; request: WSearchRequest }[] = [];
let mode: "hits" | "empty" | "truncated" | "long" | "error" = "hits";
const loc = (column: number) => ({ byte_offset: column - 1, line_number: 1, column });
const respond = () => {
  if (mode === "error") throw new Error("fixture search unavailable");
  const content = mode === "long" ? "x".repeat(2100) + "\n" : fs.readFileSync(path.join(fixture.dir, "work/src/hello.ts"), "utf8");
  return { files: mode === "empty" ? [] : [{ file_name: Buffer.from("src/hello.ts"), repository: REPO, branches: ["main"], language: "TypeScript", chunk_matches: [{ content: Buffer.from(content), content_start: loc(1), file_name: false, ranges: [{ start: loc(17), end: loc(22) }], symbol_info: [{ sym: "greet", kind: "function" }] }] }], stats: { match_count: mode === "empty" ? 0 : mode === "truncated" ? 2 : 1 } };
};
after(() => { setZoektTransport(undefined); mock.restoreAll(); hooks.deregister(); fs.rmSync(fixture.dir, { recursive: true, force: true }); });

async function connect(models: boolean, repos = ["*"]) {
  fs.writeFileSync(process.env.CONFIG_PATH!, JSON.stringify(models ? { models: [{ provider: "openai", model: "fixture-model", displayName: "Fixture model" }] } : {}));
  const server = await createMcpServer(scopeFor(repos));
  const client = new Client({ name: "contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test("client research instructions, tool and prompt work with and without a server model", async () => {
  for (const models of [false, true]) {
    const session = await connect(models, [REPO]);
    try {
      assert.match(session.client.getInstructions() ?? "", /^Falkon searches and reads code/);
      assert.deepEqual((await session.client.listPrompts()).prompts.map((prompt) => ({ name: prompt.name, arguments: prompt.arguments?.map(({ name, required }) => ({ name, required })) })), [
        { name: "ask_codebase", arguments: [{ name: "query", required: true }, { name: "repos", required: false }] },
      ]);
      const args = { query: "Where is greeting implemented?", repos: [REPO, "missing"] };
      const tool = await session.client.callTool({ name: "research_codebase", arguments: args });
      assert.equal(tool.isError, undefined);
      assert.ok(Array.isArray(tool.content));
      assert.match(JSON.stringify(tool), /Unavailable repositories/);
      const prompt = await session.client.getPrompt({ name: "ask_codebase", arguments: { query: args.query, repos: ` ${REPO}, missing ` } });
      assert.deepEqual(prompt.messages, [{ role: "user", content: tool.content[0] }]);
      await assert.rejects(session.client.getPrompt({ name: "ask_codebase", arguments: {} }), /query/);
      assert.equal((await session.client.callTool({ name: "research_codebase", arguments: { query: args.query, repos: "invalid" } })).isError, true);
    } finally { await session.close(); }
  }
});

test("the server identifies itself as falkon-mcp-server 0.1.0, whatever the old version variable says", async () => {
  const oldVersion = "SOURCE" + "BOT_CLONE_VERSION";
  process.env[oldVersion] = "9.9.9";
  const session = await connect(false);
  try {
    assert.deepEqual(session.client.getServerVersion(), { name: "falkon-mcp-server", version: "0.1.0" });
  } finally { delete process.env[oldVersion]; await session.close(); }
});

test("client research contracts cover repository selection, empty scope and MCP guidance", async (t) => {
  const other = "fixtures.test/boreal";
  const hidden = "fixtures.test/private";
  t.mock.method(toolDeps, "listRepos", async () => [row, { ...row, name: other }, { ...row, name: hidden }]);
  const session = await connect(false, [REPO, other]);
  const query = "Where is greeting implemented?";
  try {
    snapshot("research-guidance", {
      instructions: session.client.getInstructions(),
      prompts: (await session.client.listPrompts()).prompts,
      prompt: await session.client.getPrompt({ name: "ask_codebase", arguments: { query, repos: ` ${REPO}, ${hidden}, missing ` } }),
    });
    const results: Record<string, unknown> = {};
    for (const [name, repos] of [
      ["all-visible", undefined],
      ["scope-intersection", [REPO, hidden]],
      ["unknown-repo", ["missing"]],
      ["empty-selection", []],
    ] as const) {
      const result = await session.client.callTool({ name: "research_codebase", arguments: { query, ...(repos === undefined ? {} : { repos }) } });
      assert.ok(Array.isArray(result.content));
      results[name] = result;
      assert.deepEqual((await session.client.getPrompt({ name: "ask_codebase", arguments: { query, ...(repos === undefined ? {} : { repos: repos.join(", ") }) } })).messages, [
        { role: "user", content: result.content[0] },
      ]);
    }
    const empty = await connect(false, []);
    try {
      results["no-repositories"] = await empty.client.callTool({ name: "research_codebase", arguments: { query } });
      results["outside-scope"] = await empty.client.callTool({ name: "research_codebase", arguments: { query, repos: [REPO] } });
    } finally { await empty.close(); }
    snapshot("research-outputs", results);
  } finally { await session.close(); }
});

test("MCP registration order, exact descriptions, annotations and JSON schemas stay frozen", async () => {
  for (const models of [false, true]) {
    const session = await connect(models);
    try {
      const tools = (await session.client.listTools()).tools;
      assert.deepEqual(tools.map((tool) => tool.name), ["grep", "glob", "get_diff", "list_commits", "list_branches", "list_repos", "read_file", "list_tree", "find_symbol_definitions", "find_symbol_references", "list_language_models", ...(models ? ["ask_codebase"] : []), "research_codebase"]);
      snapshot(models ? "registration-model" : "registration", tools);
      const previous = JSON.parse(fs.readFileSync(new URL(`../../../../../tests/contract/${models ? "registration-model" : "registration"}.json`, import.meta.url), "utf8"));
      for (const [index, tool] of tools.entries()) {
        assert.equal(JSON.stringify(tool.inputSchema), JSON.stringify(previous[index].inputSchema), `Schema bytes changed for ${tool.name}`);
      }
      snapshot(models ? "models-configured" : "models-empty", await session.client.callTool({ name: "list_language_models", arguments: {} }));
    } finally { await session.close(); }
  }
});

test("MCP output text, empty results, truncation and errors stay frozen", async () => {
  const session = await connect(false);
  const results: Record<string, unknown> = {};
  const cases: [string, string, Record<string, unknown>, typeof mode?][] = [
    ["grep", "grep", { pattern: "greet", repo: REPO, path: "src", include: "*.ts", ref: "*" }],
    ["grep-grouped", "grep", { pattern: "greet", groupByRepo: true }],
    ["grep-truncated", "grep", { pattern: "greet", limit: 1 }, "truncated"],
    ["grep-grouped-truncated", "grep", { pattern: "greet", groupByRepo: true, limit: 1 }, "truncated"],
    ["grep-long", "grep", { pattern: "x" }, "long"],
    ["glob", "glob", { pattern: "**/*.ts", path: "src", repo: REPO, ref: "main" }],
    ["glob-truncated", "glob", { pattern: "**/*.ts", limit: 1 }, "truncated"],
    ["diff", "get_diff", { repo: REPO, base: "v1", head: "HEAD", path: "src/hello.ts" }],
    ["diff-empty", "get_diff", { repo: REPO, base: "HEAD", head: "HEAD" }],
    ["diff-ref-error", "get_diff", { repo: REPO, base: "-bad", head: "HEAD" }],
    ["commits", "list_commits", { repo: REPO }],
    ["commits-page", "list_commits", { repo: REPO, page: 2, perPage: 1 }],
    ["commits-filter", "list_commits", { repo: REPO, query: "EXTEND", author: "fixture", path: "src/hello.ts", since: "2026-01-01", until: "2026-01-03" }],
    ["commits-empty", "list_commits", { repo: REPO, query: "absent" }],
    ["commits-date-error", "list_commits", { repo: REPO, since: "2026-02-01", until: "2026-01-01" }],
    ["commits-ref-error", "list_commits", { repo: REPO, ref: "-bad" }],
    ["branches", "list_branches", { repo: REPO }],
    ["branches-page", "list_branches", { repo: REPO, page: 2, perPage: 1 }],
    ["branches-filter", "list_branches", { repo: REPO, query: "FEAT" }],
    ["branches-empty", "list_branches", { repo: REPO, query: "absent" }],
    ["repos", "list_repos", {}],
    ["repos-empty", "list_repos", { query: "absent" }],
    ["repos-page", "list_repos", { page: 2, perPage: 1, sort: "pushed", direction: "desc" }],
    ["read", "read_file", { repo: REPO, path: "src/hello.ts" }],
    ["read-page", "read_file", { repo: REPO, path: "src/hello.ts", offset: 2, limit: 1 }],
    ["read-tag", "read_file", { repo: REPO, path: "src/hello.ts", ref: "v1" }],
    ["read-empty", "read_file", { repo: REPO, path: "empty.txt" }],
    ["read-beyond", "read_file", { repo: REPO, path: "empty.txt", offset: 20 }],
    ["read-long", "read_file", { repo: REPO, path: "long.txt" }],
    ["read-bytes", "read_file", { repo: REPO, path: "bytes.txt" }],
    ["read-lines", "read_file", { repo: REPO, path: "lines.txt" }],
    ["read-missing", "read_file", { repo: REPO, path: "absent" }],
    ["read-bad-ref", "read_file", { repo: REPO, path: "src/hello.ts", ref: "absent" }],
    ["tree", "list_tree", { repo: REPO }],
    ["tree-deep", "list_tree", { repo: REPO, depth: 3 }],
    ["tree-path", "list_tree", { repo: REPO, path: "/src/", depth: 3 }],
    ["tree-directories", "list_tree", { repo: REPO, depth: 3, includeFiles: false }],
    ["tree-files", "list_tree", { repo: REPO, depth: 3, includeDirectories: false }],
    ["tree-truncated", "list_tree", { repo: REPO, maxEntries: 1 }],
    ["tree-empty", "list_tree", { repo: REPO, path: "absent" }],
    ["tree-bad-ref", "list_tree", { repo: REPO, ref: "absent" }],
    ["definitions", "find_symbol_definitions", { repo: REPO, symbol: "greet" }],
    ["references", "find_symbol_references", { repo: REPO, symbol: "greet" }],
  ];
  for (const name of ["grep", "glob", "find_symbol_definitions", "find_symbol_references"]) {
    const args = name === "glob" ? { pattern: "absent" } : name === "grep" ? { pattern: "absent" } : { repo: REPO, symbol: "absent" };
    cases.push([`${name}-empty`, name, args, "empty"], [`${name}-transport-error`, name, args, "error"]);
  }
  for (const name of ["read_file", "list_tree", "get_diff", "list_commits", "grep", "glob"]) {
    for (const badPath of ["../outside", "src/../../outside", "a\0b"]) cases.push([`${name}-path-${JSON.stringify(badPath)}`, name, { repo: REPO, path: badPath, pattern: "greet", base: "v1", head: "HEAD" }]);
    cases.push([`${name}-dash-ref`, name, { repo: REPO, path: "src/hello.ts", pattern: "greet", ref: "--help", base: "v1", head: "--help" }]);
  }
  for (const name of ["grep", "glob", "get_diff", "list_commits", "list_branches", "read_file", "list_tree", "find_symbol_definitions", "find_symbol_references"]) {
    cases.push([`${name}-missing-repo`, name, { repo: "missing", pattern: "x", path: "x", symbol: "x", base: "HEAD", head: "HEAD" }]);
  }
  try {
    for (const [id, name, args, responseMode] of cases) {
      mode = responseMode ?? "hits";
      requests.length = 0;
      const output = await session.client.callTool({ name, arguments: args });
      // Git errors include the disposable repository path. Keep the error text stable.
      results[id] = JSON.parse(JSON.stringify({ requests, output }).replaceAll(fs.realpathSync(fixture.dir), "<fixture>").replaceAll(fixture.dir, "<fixture>"));
    }
    assert.ok(Object.keys(results).length > 60);
    snapshot("outputs", results);
  } finally { await session.close(); }
});

test("the mcp.ts tool descriptions (ask_codebase, list_language_models) name each parameter", () => {
  const registered = JSON.parse(fs.readFileSync(new URL("../../../../../tests/contract/registration-model.json", import.meta.url), "utf8")) as { name: string; description: string; inputSchema: { properties?: object } }[];
  assert.ok(registered.some((t) => t.name === "ask_codebase"));
  for (const t of registered.filter((t) => ["ask_codebase", "list_language_models"].includes(t.name))) for (const param of Object.keys(t.inputSchema.properties ?? {})) assert.ok(t.description.includes(param), `${t.name}: ${param}`);
});
