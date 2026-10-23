import assert from "node:assert/strict";
import { test } from "node:test";
import { loadProduct } from "./data.js";
import { stackFiles } from "./stack.js";

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
  const mounts = compose.services.web.volumes.filter((v: string) => v.startsWith("/corpus/"));
  assert.equal(mounts.length, 42);
  assert.ok(mounts.every((v: string) => v.endsWith(":ro")));
  assert.ok(mounts.includes("/corpus/o3/openmrs-module-tasks:/repos/openmrs-module-tasks:ro"));
  assert.equal(config.knowledgeBase.enabled, false);
});

test("the stack uses its own project and port, binds loopback only and sets no key", () => {
  const { compose, project } = files();
  assert.equal(project, "falkon-eval");
  assert.deepEqual(compose.services.web.ports, ["127.0.0.1:3400:3000"]);
  assert.ok(!JSON.stringify(compose).match(/:3000:3000|3300/));
  assert.ok(!JSON.stringify(compose).includes("API_KEY"));
  for (const s of ["backend", "zoekt", "web"] as const) assert.equal(compose.services[s].image, "falkon-eval-app");
  assert.deepEqual(compose.services.backend.build, { context: "/repo", dockerfile: "docker/Dockerfile" });
});

test("--recipe on sets MCP_IMPACT_RECIPE on the web service only, in its own project and port", () => {
  const on = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3402, project: "falkon-eval-recipe", recipe: "on" });
  assert.equal(on.compose.name, "falkon-eval-recipe");
  assert.deepEqual(on.compose.services.web.ports, ["127.0.0.1:3402:3000"]);
  assert.equal(on.compose.services.web.environment.MCP_IMPACT_RECIPE, "on");
  assert.ok(!("MCP_INSTRUCTIONS" in on.compose.services.web.environment));
  for (const s of ["backend", "zoekt"] as const) assert.ok(!("MCP_IMPACT_RECIPE" in on.compose.services[s].environment), s);
  assert.ok(!JSON.stringify(files().compose).includes("MCP_IMPACT_RECIPE"));
});

test("--instructions off sets MCP_INSTRUCTIONS on the web service only, in its own project and port", () => {
  const off = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3401, project: "falkon-eval-noinstr", instructions: "off" });
  assert.equal(off.compose.name, "falkon-eval-noinstr");
  assert.deepEqual(off.compose.services.web.ports, ["127.0.0.1:3401:3000"]);
  assert.equal(off.compose.services.web.environment.MCP_INSTRUCTIONS, "off");
  for (const s of ["backend", "zoekt"] as const) assert.ok(!("MCP_INSTRUCTIONS" in off.compose.services[s].environment), s);
  assert.equal(off.compose.services.web.environment.AUTH_URL, "http://127.0.0.1:3401");
  assert.ok(!JSON.stringify(files().compose).includes("MCP_INSTRUCTIONS"));
});

test("--prs on mounts the pull request snapshot read-only into the backend only and sets its import environment, in its own project and port", () => {
  const on = stackFiles({ o3Dir: "/corpus", repoRoot: "/repo", port: 3403, project: "falkon-eval-prs", prs: "on" });
  assert.equal(on.compose.name, "falkon-eval-prs");
  assert.deepEqual(on.compose.services.web.ports, ["127.0.0.1:3403:3000"]);
  const backend = on.compose.services.backend as { environment: Record<string, string>; volumes: string[] };
  assert.equal(backend.environment.DISCUSSIONS_SNAPSHOT_DIR, "/discussions");
  assert.equal(backend.environment.DISCUSSION_TICKET_KEYS, "TRUNK,RESTWS,O3");
  assert.ok(backend.volumes.includes("/corpus/github-snapshot:/discussions:ro"));
  assert.equal(backend.volumes.length, files().compose.services.backend.volumes.length + 1);
  for (const s of ["web", "zoekt"] as const) assert.ok(!JSON.stringify(on.compose.services[s]).includes("discussions"), s);
  assert.ok(!JSON.stringify(files().compose).includes("discussions"));
});
