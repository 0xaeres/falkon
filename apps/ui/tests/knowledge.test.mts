import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeLine } from "../src/lib/knowledge";

test("knowledgeLine: one plain line per state, nothing when off or absent", () => {
  assert.equal(knowledgeLine(undefined), null);
  assert.equal(knowledgeLine({ state: "off" }), null);
  assert.equal(knowledgeLine({ state: "no-model" }), "Knowledge base skipped: no model configured");
  assert.equal(knowledgeLine({ state: "pending" }), "Knowledge base: waiting for first scan");
  assert.equal(knowledgeLine({ state: "scanning" }), "Knowledge base: scanning");
  assert.equal(knowledgeLine({ state: "ready" }), "Knowledge base: ready");
  assert.equal(knowledgeLine({ state: "budget-exhausted" }), "Knowledge base: stopped at its token limit");
  assert.equal(knowledgeLine({ state: "failed" }), "Knowledge base: last scan failed");
});
