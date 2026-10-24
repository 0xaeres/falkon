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
  assert.equal(off.compose.services.api.environment.AUTH_URL, "http://127.0.0.1:3401");
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
  assert.ok(!JSON.stringify(files().compose).includes("MCP_HISTORY_TOOLS"));
});

test("the api service runs the engine with the admin token by interpolation, never in the file", () => {
  const { compose } = files();
  assert.deepEqual(compose.services.api.command, ["node", "packages/api/dist/main.js"]);
  assert.equal(compose.services.api.environment.ADMIN_TOKEN, "${ADMIN_TOKEN}");
  assert.equal(compose.services.api.environment.AUTH_MODE, "none");
});

const reply = (status: number) => ({ status, ok: status < 300 }) as Response;
const recorder = (statuses: number[]) => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: { slug?: string; definition: unknown } }[] = [];
  const fetchFn = (async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const next = statuses.shift()!;
    if (next === 0) throw new TypeError("fetch failed");
    return reply(next);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

test("ensureProduct creates o3 over every stack repository with the bearer token", async () => {
  const { calls, fetchFn } = recorder([201]);
  await ensureProduct("http://127.0.0.1:3500", "tok", { fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://127.0.0.1:3500/products");
  assert.equal(calls[0]!.headers.authorization, "Bearer tok");
  assert.deepEqual(calls[0]!.body, { slug: PRODUCT, name: "O3", definition: { include: ["github.com/openmrs/*"] } });
});

const noSleep = async () => {};

test("ensureProduct on a re-used stack replaces the existing Product instead of failing, and waits for the admin listener", async () => {
  const { calls, fetchFn } = recorder([0, 409, 200]);
  await ensureProduct("http://x", "tok", { fetchFn, wait: 60_000, sleep: noSleep });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST http://x/products", "POST http://x/products", "PUT http://x/products/o3"]);
});

test("ensureProduct retries a 500 and a 404 while the backend is still pushing its schema", async () => {
  const { calls, fetchFn } = recorder([500, 404, 503, 201]);
  await ensureProduct("http://x", "tok", { fetchFn, wait: 60_000, sleep: noSleep });
  assert.equal(calls.length, 4);
});

test("ensureProduct fails at once on 400, 401, 403 and on a read-only config Product, and names a listener that never answers", async () => {
  for (const status of [400, 401, 403]) {
    const { calls, fetchFn } = recorder([status]);
    await assert.rejects(ensureProduct("http://x", "bad", { fetchFn, sleep: noSleep }), new RegExp(`refused the o3 Product \\(HTTP ${status}\\)`));
    assert.equal(calls.length, 1);
  }
  await assert.rejects(ensureProduct("http://x", "tok", { fetchFn: recorder([409, 409]).fetchFn, sleep: noSleep }), /comes from config and is read-only/);
  await assert.rejects(ensureProduct("http://x", "tok", { fetchFn: recorder([500]).fetchFn, wait: -1, sleep: noSleep }), /did not become ready.*last HTTP 500/);
  await assert.rejects(ensureProduct("http://x", "tok", { fetchFn: recorder([0]).fetchFn, wait: -1, sleep: noSleep }), /did not become ready/);
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
