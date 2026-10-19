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
