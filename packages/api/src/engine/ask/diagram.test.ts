import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHIFY_MAX_SOURCE } from "@falkon/shared";
import { diagramPartSchema } from "@falkon/contracts";
import { buildDiagrams, MAX_DIAGRAMS } from "./diagram";
import { DIAGRAM_PROMPT, dynamicPrompt } from "./prompt";

const FENCE = "```";
const block = (json: string) => `${FENCE}archify\n${json}\n${FENCE}`;
// The example the model is shown must itself render.
const example = /```archify\n(.+)\n```/.exec(DIAGRAM_PROMPT.replaceAll("\\`", "`"))![1]!;

test("a valid archify block becomes a data-diagram part that matches the contract", async () => {
  const [part, ...rest] = await buildDiagrams(`Intro.\n\n${block(example)}\n\nAfter.`);
  assert.equal(rest.length, 0);
  assert.equal(part!.type, "data-diagram");
  const data = diagramPartSchema.parse(part!.data);
  assert.equal(data.type, "workflow");
  assert.match(data.html, /<svg/);
  assert.equal(data.source, example);
});

test("invalid, unknown, oversize and remote-brand blocks yield no part; other fences are ignored", async () => {
  const brand = JSON.stringify({ ...JSON.parse(example), nodes: [{ id: "a", lane: "api", col: 0, type: "external", label: "A", brand: { url: "http://127.0.0.1/x", sha256: "0" } }] });
  const text = [
    block("{ not json"),
    block('{"schema_version":1,"diagram_type":"workflow","meta":{"title":"t"}}'),
    block(`{"pad":"${"x".repeat(ARCHIFY_MAX_SOURCE)}"}`),
    block(brand),
    `${FENCE}json\n${example}\n${FENCE}`,
    `${FENCE}mermaid\nflowchart TD\n${FENCE}`,
  ].join("\n\n");
  assert.deepEqual(await buildDiagrams(text), []);
});

test(`only the first ${MAX_DIAGRAMS} blocks are rendered`, async () => {
  const parts = await buildDiagrams([example, example, example].map(block).join("\n\n"));
  assert.equal(parts.length, MAX_DIAGRAMS);
});

test("the archify guidance is added only when asked for (the MCP and blocking paths leave it off)", () => {
  const base = { repos: [], files: [] };
  assert.ok(!dynamicPrompt(base).includes("<archify_diagrams>"));
  assert.ok(dynamicPrompt({ ...base, diagrams: true }).includes("<archify_diagrams>"));
});
