import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptions, findShared, literals, tokens } from "./originality.js";

const run = "alpha bravo charlie delta echo foxtrot golf hotel";

test("a run split across lines and markdown punctuation is found", () => {
  const ref = new Map([["ref.js", `x = "alpha bravo\\n- **charlie** \`delta\`\\n  echo, foxtrot; golf hotel"`]]);
  const ours = new Map([["ours.ts", "see:\n> Alpha Bravo Charlie\n${delta} echo foxtrot golf hotel!"]]);
  const hits = findShared(ref, ours);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "ours.ts");
  assert.equal(hits[0].ref, "ref.js");
  assert.equal(hits[0].text, run);
});

test("7 shared words are not a hit", () => {
  const ref = new Map([["r", "alpha bravo charlie delta echo foxtrot golf"]]);
  const ours = new Map([["o", "alpha bravo charlie delta echo foxtrot golf india"]]);
  assert.deepEqual(findShared(ref, ours), []);
});

test("a longer shared run is reported once, in full", () => {
  const ref = new Map([["r", `${run} india juliet`]]);
  const ours = new Map([["o", `zulu ${run} india juliet yankee`]]);
  const hits = findShared(ref, ours);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, `${run} india juliet`);
});

test("string escapes decode to separators and characters", () => {
  assert.deepEqual(tokens("a\\nb\\tc\\u0064e \\\"f\\\" g\\\\h"), ["a", "b", "cde", "f", "g", "h"]);
  const ref = new Map([["r", run.replaceAll(" ", "\\n")]]);
  assert.equal(findShared(ref, new Map([["o", run]])).length, 1);
});

test("literals keeps string text and drops code and comments", () => {
  const src = "// don't scan this\nconst a = foo(bar); const s = \"say hi\"; const t = `one\ntwo ${x}`; /* it's */ const u = 'it\\'s';";
  const out = literals(src);
  assert.match(out, /say hi/);
  assert.match(out, /one\ntwo/);
  assert.doesNotMatch(out, /foo|scan this|it's \*/);
});

test("template expressions are code and dropped, even with nested braces", () => {
  assert.equal(literals("const a = `keep ${f({ x: { y: 1 } })} this`;").split(/\s+/).filter(Boolean).join(" "), "keep this");
});

test("descriptions keeps only description strings of a schema", () => {
  assert.equal(descriptions(JSON.stringify({ type: "object", properties: { a: { type: "string", description: "the a field" } } })), "the a field");
});
