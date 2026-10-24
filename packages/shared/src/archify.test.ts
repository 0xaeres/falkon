import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHIFY_MAX_SOURCE, renderArchify } from "./archify";

const workflow = {
  schema_version: 2,
  diagram_type: "workflow",
  meta: { title: "Agent loop", output: "x.html" },
  lanes: [{ id: "agent", label: "Agent" }],
  mainPath: ["start", "end"],
  nodes: [
    { id: "start", label: "Question", lane: "agent", col: 0, type: "external" },
    { id: "end", label: "Answer", lane: "agent", col: 1, type: "backend" },
  ],
  edges: [{ from: "start", to: "end", label: "ask" }],
};

test("valid workflow renders standalone html without embedded fonts", async () => {
  const r = await renderArchify(JSON.stringify(workflow));
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.match(r.html, /<svg/);
  assert.doesNotMatch(r.html, /@font-face/);
});

test("invalid JSON, unknown type, schema errors and remote brands fall back", async () => {
  for (const bad of ["{", "[]", JSON.stringify({ ...workflow, diagram_type: "pie" }), JSON.stringify({ ...workflow, nodes: "x" })]) {
    assert.equal((await renderArchify(bad)).ok, false);
  }
  const branded = { ...workflow, nodes: [{ ...workflow.nodes[0], brand: { url: "http://127.0.0.1/x", sha256: "0" } }, workflow.nodes[1]] };
  assert.deepEqual(await renderArchify(JSON.stringify(branded)), { ok: false, reason: "remote brand marks are not allowed" });
});

test("oversize source is refused before parsing", async () => {
  assert.deepEqual(await renderArchify(" ".repeat(ARCHIFY_MAX_SOURCE + 1)), { ok: false, reason: "source too large" });
});
