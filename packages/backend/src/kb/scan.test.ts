import { test } from "node:test";
import assert from "node:assert/strict";
import { kb } from "@sbc/shared";
import { kbModelReady, runKnowledgeScan } from "./scan";

const model = { LLM_BASE_URL: "http://x", LLM_API_KEY: "k", LLM_MODEL: "m" };

test("llmConfigured needs all three variables", () => {
  assert.equal(kb.llmConfigured(model), true);
  assert.equal(kb.llmConfigured({ ...model, LLM_API_KEY: "" }), false);
  assert.equal(kb.llmConfigured({}), false);
});

test("without a model the skip is logged once and the scheduler gate stays closed", () => {
  const lines: string[] = [];
  assert.equal(kbModelReady({}, (m) => lines.push(m)), false);
  assert.equal(kbModelReady({}, (m) => lines.push(m)), false);
  assert.deepEqual(lines, ["knowledge base skipped: no model configured"]);
  assert.equal(kbModelReady(model, (m) => lines.push(m)), true);
  assert.equal(lines.length, 1);
});

test("a queued scan without a model returns undefined before touching the database", async () => {
  for (const k of Object.keys(model)) delete process.env[k];
  // the id is never looked up: a database call here would fail (no Postgres in unit tests)
  assert.equal(await runKnowledgeScan(1, { manual: true }), undefined);
});
