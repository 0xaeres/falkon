import assert from "node:assert/strict";
import test from "node:test";
import { FILE_REFERENCE_REGEX, REPLY_PROMPT, REPLY_TAG, RENDER_PROMPT, STATIC_PROMPT, dynamicPrompt } from "./prompt";

test("the per-chat prompt tells the model GFM Markdown and mermaid render, and leaves the static prompt alone", () => {
  const p = dynamicPrompt({ repos: ["a"], files: [], query: "how does auth work?" });
  assert.ok(p.includes(RENDER_PROMPT));
  assert.match(RENDER_PROMPT, /GFM/);
  assert.match(RENDER_PROMPT, /mermaid/);
  assert.ok(!STATIC_PROMPT.includes(RENDER_PROMPT));
});

test("the per-chat prompt carries the reply addendum, which names the marker; the static prompt is untouched", () => {
  const p = dynamicPrompt({ repos: ["a"], files: [], query: "hey" });
  assert.ok(p.includes(REPLY_PROMPT));
  assert.ok(REPLY_PROMPT.includes(REPLY_TAG));
  assert.ok(!STATIC_PROMPT.includes(REPLY_TAG));
});

// evidence.ts parses these exact strings out of the model's output: a prompt that drifts from them silently breaks citations.
test("the prompt the agent sends names the exact answer tag, reply marker and citation syntax", () => {
  const sent = `${STATIC_PROMPT}\n\n${dynamicPrompt({ repos: ["a"], files: [], query: "hey" })}`;
  assert.ok(sent.includes("<!--answer-->"));
  assert.ok(sent.includes("<!--reply-->"));
  for (const example of ["@file:{acme/app::src/cart.ts}", "@file:{acme/app::src/cart.ts:10-15}"]) {
    assert.ok(sent.includes(example), example);
    assert.equal([...example.matchAll(FILE_REFERENCE_REGEX)].length, 1, "the regex evidence.ts uses accepts it");
  }
});

test("the static prompt says to cite only shown lines and to read a file seen only by name, without forbidding read_file after grep", () => {
  assert.match(STATIC_PROMPT, /cite only lines a tool has shown you in this conversation/i);
  assert.match(STATIC_PROMPT, /only by name[^.]*read with `read_file` before citing/i);
  assert.doesNotMatch(STATIC_PROMPT, /never cite a file you (found|read) (with|via) `?grep/i);
});
