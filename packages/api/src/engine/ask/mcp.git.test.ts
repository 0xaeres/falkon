import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { snapshot } from "../../../../../tests/contract/snapshot";

// MCP_GIT_TOOLS (D167, S75): off keeps today's registration bytes; on appends the git tools after the pull request tools.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-git-"));
process.env.CONFIG_PATH = path.join(dir, "config.json");
fs.writeFileSync(process.env.CONFIG_PATH, "{}");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];
import { registerHooks } from "node:module";
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
  ({ scopeFor } = await import("@falkon/shared"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "F", GIT_AUTHOR_EMAIL: "f@x.test", GIT_COMMITTER_NAME: "F", GIT_COMMITTER_EMAIL: "f@x.test" }, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.ts"), "x\n");
  git("add", "a.ts"); git("-c", "commit.gpgsign=false", "commit", "-qm", "ship TRUNK-9 fix (#4)");
  const rows = [row(REPO, 1), row(OTHER, 2)];
  mock.method(toolDeps, "getRepo", async (name: string) => rows.find((r) => r.name === name));
  mock.method(toolDeps, "listRepos", async () => rows);
  toolDeps.ticketKeys = ["TRUNK"];
});
after(() => { hooks.deregister(); mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MCP_GIT_TOOLS; delete process.env.MCP_HISTORY_TOOLS; });

async function connect(git: string | undefined, history?: string, repos = ["*"]) {
  for (const [k, v] of [["MCP_GIT_TOOLS", git], ["MCP_HISTORY_TOOLS", history]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  const server = await createMcpServer(scopeFor(repos));
  const client = new Client({ name: "git", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const contract = (n: string) => JSON.parse(fs.readFileSync(new URL(`../../../../../tests/contract/${n}.json`, import.meta.url), "utf8")) as { name: string }[];
const core = contract("registration");

test("git flag off (unset, off, ON, 1, empty), with or without the history flag: registrations are the frozen ones", async () => {
  for (const flag of [undefined, "off", "ON", "1", ""]) {
    for (const [history, frozen] of [[undefined, core], ["on", [...core, ...contract("registration-history")]]] as const) {
      const s = await connect(flag, history);
      try {
        assert.equal(JSON.stringify((await s.client.listTools()).tools), JSON.stringify(frozen), `${flag} ${history}`);
        assert.equal((await s.client.callTool({ name: "search_commits", arguments: {} })).isError, true, "an unregistered tool cannot be called");
      } finally { await s.close(); }
    }
  }
});

test("git flag on: the seven git tools follow the existing tools; with the history flag they follow the pull request tools", async () => {
  let s = await connect("on");
  try {
    const tools = (await s.client.listTools()).tools;
    assert.equal(JSON.stringify(tools.slice(0, core.length)), JSON.stringify(core));
    assert.deepEqual(tools.slice(core.length).map((t) => t.name), ["search_commits", "search_diffs", "compare_revisions", "list_refs", "check_ancestry", "get_range_history", "list_contributors"]);
    snapshot("registration-git", tools.slice(core.length));
    assert.ok(tools.slice(core.length).every((t) => t.annotations?.readOnlyHint === true));
    assert.doesNotMatch(s.client.getInstructions() ?? "", /search_commits|search_diffs|compare_revisions|list_refs|check_ancestry|get_range_history|list_contributors/, "server instructions unchanged");
  } finally { await s.close(); }
  s = await connect("on", "on");
  try {
    const tools = (await s.client.listTools()).tools;
    assert.deepEqual(tools.slice(core.length).map((t) => t.name), ["get_pull_request", "search_discussions", "get_provenance", "search_commits", "search_diffs", "compare_revisions", "list_refs", "check_ancestry", "get_range_history", "list_contributors"]);
    assert.equal(JSON.stringify(tools.slice(core.length, -7)), JSON.stringify(contract("registration-history")));
    snapshot("registration-git-history", tools.slice(core.length));
  } finally { await s.close(); }
});

test("git flag on: a call answers from the clone, a repository outside the scope reads like a missing one, bad arguments are refused", async () => {
  const s = await connect("on", undefined, [REPO]);
  try {
    const call = async (args: Record<string, unknown>) => {
      const r = await s.client.callTool({ name: "search_commits", arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[]).map((c) => c.text).join("\n") };
    };
    const ok = await call({ repos: [REPO], messageTerms: ["fix"] });
    const c = JSON.parse(ok.text).commits[0];
    assert.deepEqual([ok.isError, c.ticketKeys, c.pullRequests], [false, ["TRUNK-9"], [4]]);
    const hidden = JSON.parse((await call({ repos: [OTHER] })).text);
    assert.deepEqual([hidden.commits, hidden.coverageGaps], [[], [`repository "${OTHER}" not found`]]);
    for (const args of [{ count: 0 }, { count: 101 }, { revisions: ["--all"] }, { contentTerms: ["x"] }, { unknown: 1 }]) assert.equal((await call(args)).isError, true, JSON.stringify(args));
  } finally { await s.close(); }
});

test("git flag on: search_diffs and compare_revisions answer from the clone and refuse bad arguments", async () => {
  const s = await connect("on", undefined, [REPO]);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await s.client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[]).map((c) => c.text).join("\n") };
    };
    const found = await call("search_diffs", { repos: [REPO], terms: ["x"] });
    assert.deepEqual([found.isError, JSON.parse(found.text).commits[0].matches[0].side], [false, "added"]);
    const same = await call("compare_revisions", { repo: REPO, base: "HEAD", head: "HEAD" });
    assert.deepEqual([same.isError, JSON.parse(same.text).files], [false, []]);
    assert.equal((await call("compare_revisions", { repo: OTHER, base: "HEAD", head: "HEAD" })).isError, true, "outside the scope");
    for (const [name, args] of [["search_diffs", { terms: ["x"] }], ["search_diffs", { repos: [REPO], terms: [] }], ["compare_revisions", { repo: REPO, base: "-x", head: "HEAD" }], ["compare_revisions", { repo: REPO, base: "HEAD", head: "HEAD", perPage: 101 }]] as const)
      assert.equal((await call(name, args)).isError, true, JSON.stringify(args));
  } finally { await s.close(); }
});

test("git flag on: list_refs and check_ancestry answer from the clone and refuse bad arguments", async () => {
  const s = await connect("on", undefined, [REPO]);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await s.client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[]).map((c) => c.text).join("\n") };
    };
    const refs = await call("list_refs", { repos: [REPO], kind: "heads" });
    assert.deepEqual([refs.isError, JSON.parse(refs.text).refs.map((r: any) => r.name)], [false, ["main"]]);
    const same = await call("check_ancestry", { repo: REPO, ancestor: "HEAD", descendant: "main" });
    assert.deepEqual([same.isError, JSON.parse(same.text).result], [false, "yes"]);
    assert.equal((await call("check_ancestry", { repo: OTHER, ancestor: "HEAD", descendant: "HEAD" })).isError, true, "outside the scope");
    for (const [name, args] of [["list_refs", { contains: "--all" }], ["list_refs", { count: 501 }], ["check_ancestry", { repo: REPO, ancestor: "-x", descendant: "HEAD" }], ["check_ancestry", { repo: REPO, ancestor: "HEAD" }]] as const)
      assert.equal((await call(name, args)).isError, true, JSON.stringify(args));
  } finally { await s.close(); }
});

test("research brief: the git recipes appear only with the git flag; with it off the brief is today's, byte for byte", async () => {
  const brief = async (flag: string | undefined) => {
    const s = await connect(flag, undefined, [REPO]);
    try {
      const r = await s.client.callTool({ name: "research_codebase", arguments: { query: "Which release first has the fix?" } });
      return (r.content as { text: string }[])[0]!.text;
    } finally { await s.close(); }
  };
  const off = await brief(undefined), on = await brief("on");
  assert.equal(await brief("off"), off);
  assert.doesNotMatch(off, /list_refs|check_ancestry/);
  assert.match(on, /list_refs[\s\S]*check_ancestry[\s\S]*not proof/);
  assert.equal(on.replace(/\nThe git history tools are on[\s\S]*?\n(?=\nWrite Markdown)/, ""), off);
});
