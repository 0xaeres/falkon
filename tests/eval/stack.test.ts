import assert from "node:assert/strict";
import { test } from "node:test";
import { loadProduct } from "./data.js";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT, adminToken, ensureProduct, stackFiles } from "./stack.js";

const files = () => stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3400, project: "falkon-eval" });

test("the config indexes every product repository as a generic git connection on a read-only mount", () => {
  const { config, compose } = files();
  const repos = loadProduct().repositories;
  assert.equal(repos.length, 42);
  const key = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "-");
  assert.deepEqual(Object.keys(config.connections), repos.map((r) => key(r.name)));
  assert.ok(Object.keys(config.connections).every((k) => /^[a-zA-Z0-9_-]+$/.test(k)), "the config schema's connection name pattern");
  for (const r of repos) assert.deepEqual(config.connections[key(r.name)], { type: "git", url: `file:///repos/${r.name}` });
  assert.ok(!JSON.stringify(config).includes('"local"'));
  const mounts = compose.services.api.volumes.filter((v: string) => v.startsWith("/corpus/"));
  assert.equal(mounts.length, 42);
  assert.ok(mounts.every((v: string) => v.endsWith(":ro")));
  assert.ok(mounts.includes("/corpus/o3/openmrs-module-tasks:/repos/openmrs-module-tasks:ro"));
  assert.equal(config.knowledgeBase.enabled, false);
});

test("the stack uses its own project and port, binds loopback only and sets no key", () => {
  const { compose, project } = files();
  assert.equal(project, "falkon-eval");
  assert.deepEqual(compose.services.api.ports, ["127.0.0.1:3400:3001", "127.0.0.1:3500:3002"]);
  assert.deepEqual(Object.keys(compose.services), ["postgres", "redis", "backend", "zoekt", "api"]);
  assert.ok(!JSON.stringify(compose).match(/:3000:3000|3300/));
  assert.ok(!JSON.stringify(compose).includes("API_KEY"));
  for (const s of ["backend", "zoekt", "api"] as const) assert.equal(compose.services[s].image, "falkon-eval-app");
  assert.deepEqual(compose.services.backend.build, { context: "/repo", dockerfile: "docker/Dockerfile" });
});

test("--recipe on sets MCP_IMPACT_RECIPE on the api service only, in its own project and port", () => {
  const on = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3402, project: "falkon-eval-recipe", recipe: "on" });
  assert.equal(on.compose.name, "falkon-eval-recipe");
  assert.deepEqual(on.compose.services.api.ports, ["127.0.0.1:3402:3001", "127.0.0.1:3502:3002"]);
  assert.equal(on.compose.services.api.environment.MCP_IMPACT_RECIPE, "on");
  assert.ok(!("MCP_INSTRUCTIONS" in on.compose.services.api.environment));
  for (const s of ["backend", "zoekt"] as const) assert.ok(!("MCP_IMPACT_RECIPE" in on.compose.services[s].environment), s);
  assert.ok(!JSON.stringify(files().compose).includes("MCP_IMPACT_RECIPE"));
});

test("--instructions off sets MCP_INSTRUCTIONS on the api service only, in its own project and port", () => {
  const off = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3401, project: "falkon-eval-noinstr", instructions: "off" });
  assert.equal(off.compose.name, "falkon-eval-noinstr");
  assert.deepEqual(off.compose.services.api.ports, ["127.0.0.1:3401:3001", "127.0.0.1:3501:3002"]);
  assert.equal(off.compose.services.api.environment.MCP_INSTRUCTIONS, "off");
  for (const s of ["backend", "zoekt"] as const) assert.ok(!("MCP_INSTRUCTIONS" in off.compose.services[s].environment), s);
  assert.ok(!JSON.stringify(files().compose).includes("MCP_INSTRUCTIONS"));
});

test("--prs on mounts the pull request snapshot read-only into the backend only and sets its import environment, in its own project and port", () => {
  const on = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3403, project: "falkon-eval-prs", prs: "on" });
  assert.equal(on.compose.name, "falkon-eval-prs");
  assert.deepEqual(on.compose.services.api.ports, ["127.0.0.1:3403:3001", "127.0.0.1:3503:3002"]);
  const backend = on.compose.services.backend as { environment: Record<string, string>; volumes: string[] };
  assert.equal(backend.environment.DISCUSSIONS_SNAPSHOT_DIR, "/discussions");
  assert.equal(backend.environment.DISCUSSION_TICKET_KEYS, "TRUNK,RESTWS,O3");
  assert.ok(backend.volumes.includes("/corpus/github-snapshot:/discussions:ro"));
  assert.equal(backend.volumes.length, files().compose.services.backend.volumes.length + 1);
  for (const s of ["zoekt", "api"] as const) assert.ok(!JSON.stringify(on.compose.services[s]).includes("discussions"), s);
  assert.ok(!JSON.stringify(files().compose).includes("discussions"));
  // The api service must expose the pull request tools, or the arm silently equals clone-tools-git.
  assert.equal(on.compose.services.api.environment.MCP_HISTORY_TOOLS, "on");
  // Every other stack sets both flags off explicitly, so its tools/list stays what the stored cycle 15 results saw (the api default is on since cycle 19c).
  assert.equal(files().compose.services.api.environment.MCP_HISTORY_TOOLS, "off");
});

test("the api service runs the engine with the admin token by interpolation, never in the file", () => {
  const { compose } = files();
  assert.deepEqual(compose.services.api.command, ["node", "packages/api/dist/main.js"]);
  assert.equal(compose.services.api.environment.ADMIN_TOKEN, "${ADMIN_TOKEN}");
  assert.equal(compose.services.api.environment.AUTH_MODE, "none");
});

const recorder = (failures: string[]) => {
  const calls: string[][] = [];
  const seed = (args: string[]) => {
    calls.push(args);
    const failure = failures.shift();
    if (failure) throw new Error(failure);
  };
  return { calls, seed };
};

test("ensureProduct seeds o3 over every stack repository", async () => {
  const { calls, seed } = recorder([]);
  await ensureProduct(seed);
  assert.deepEqual(calls, [[PRODUCT, "O3", "github.com/openmrs/*"]]);
});

const noSleep = async () => {};

test("ensureProduct retries while the backend is still pushing its schema", async () => {
  const { calls, seed } = recorder(["container is not running", "relation \"Product\" does not exist"]);
  await ensureProduct(seed, { wait: 60_000, sleep: noSleep });
  assert.equal(calls.length, 3);
});

test("ensureProduct names the last error when the schema never appears", async () => {
  await assert.rejects(ensureProduct(recorder(["relation \"Product\" does not exist"]).seed, { wait: -1, sleep: noSleep }), /did not seed the o3 Product.*does not exist/);
});

test("the admin token file is mode 600 (also when it already existed) and its value is not in the compose file", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-token-"));
  writeFileSync(join(dir, "admin.token"), "x".repeat(40), { mode: 0o644 });
  const token = adminToken(dir);
  assert.equal(token, "x".repeat(40));
  assert.equal(statSync(join(dir, "admin.token")).mode & 0o777, 0o600);
  const fresh = mkdtempSync(join(tmpdir(), "stack-token-"));
  const made = adminToken(fresh);
  assert.equal(statSync(join(fresh, "admin.token")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(fresh, "admin.token"), "utf8"), made);
  assert.ok(!JSON.stringify(files().compose).includes(made));
});

test("--git-history on sets MCP_GIT_TOOLS=on and the ticket keys on the api service only, in its own project; the other stacks set it off", () => {
  const on = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3404, project: "falkon-eval-githistory", gitHistory: "on" });
  assert.equal(on.compose.name, "falkon-eval-githistory");
  assert.deepEqual(on.compose.services.api.ports, ["127.0.0.1:3404:3001", "127.0.0.1:3504:3002"]);
  assert.equal(on.compose.services.api.environment.MCP_GIT_TOOLS, "on");
  assert.equal(on.compose.services.api.environment.DISCUSSION_TICKET_KEYS, "TRUNK,RESTWS,O3");
  for (const s of ["backend", "zoekt"] as const) assert.ok(!JSON.stringify(on.compose.services[s]).includes("MCP_GIT_TOOLS"), s);
  // A flag set for one stack must not leak into the next one built in the same process.
  for (const other of [files(), stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3403, project: "p", prs: "on" }), stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3401, project: "n", instructions: "off" })]) {
    assert.equal(other.compose.services.api.environment.MCP_GIT_TOOLS, "off");
    assert.ok(!JSON.stringify(other.compose.services.api).includes("DISCUSSION_TICKET_KEYS"));
  }
});

test("--prs on with --git-history on puts both flags on the api and the snapshot import on the backend, in its own project; no other stack gets either", () => {
  const both = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3405, project: "falkon-eval-githistory-prs", prs: "on", gitHistory: "on" });
  const { api, backend, zoekt } = both.compose.services as unknown as Record<"api" | "backend" | "zoekt", { ports: string[]; environment: Record<string, string>; volumes: string[] }>;
  assert.equal(both.compose.name, "falkon-eval-githistory-prs");
  assert.deepEqual(api.ports, ["127.0.0.1:3405:3001", "127.0.0.1:3505:3002"]);
  assert.deepEqual([api.environment.MCP_HISTORY_TOOLS, api.environment.MCP_GIT_TOOLS, api.environment.DISCUSSION_TICKET_KEYS], ["on", "on", "TRUNK,RESTWS,O3"]);
  assert.deepEqual([backend.environment.DISCUSSIONS_SNAPSHOT_DIR, backend.environment.DISCUSSION_TICKET_KEYS], ["/discussions", "TRUNK,RESTWS,O3"]);
  assert.ok(backend.volumes.includes("/corpus/github-snapshot:/discussions:ro"));
  assert.ok(!JSON.stringify(zoekt).includes("/discussions") && !JSON.stringify(zoekt).includes("MCP_"));
  // Each single-flag stack keeps only its own flag, and the combined stack's flags do not outlive the call.
  const prsOnly = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3403, project: "p", prs: "on" }).compose.services.api.environment as Record<string, string>;
  const histOnly = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3404, project: "g", gitHistory: "on" });
  assert.deepEqual([prsOnly.MCP_HISTORY_TOOLS, prsOnly.MCP_GIT_TOOLS], ["on", "off"]);
  assert.deepEqual([(histOnly.compose.services.api.environment as Record<string, string>).MCP_HISTORY_TOOLS, histOnly.compose.services.api.environment.MCP_GIT_TOOLS], ["off", "on"]);
  assert.ok(!JSON.stringify(histOnly.compose.services.backend).includes("/discussions"));
  const plain = files().compose.services.api.environment;
  assert.deepEqual([plain.MCP_HISTORY_TOOLS, plain.MCP_GIT_TOOLS], ["off", "off"]);
});
