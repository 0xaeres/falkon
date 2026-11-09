import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scopeFor } from "@falkon/shared";
import { toolDeps } from "../tools";
import { createMessageStream, type StepRecord } from "./agent";
import { breaker } from "./breaker";
import { fakeOpenAi, type Turn } from "./fakeOpenAi";

// S98 (D190): per-step usage and tool result bytes, logged and stored on the message metadata.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-steps-"));
const REPO = "fixtures.test/atlas";
const user = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What does it do?" }] };
let getRepoFails = false;
before(() => {
  fs.writeFileSync(path.join(dir, "a.txt"), "héllo wörld\nsecond line\n");
  mock.method(toolDeps, "getRepo", async (name: string) => {
    if (getRepoFails) throw new Error("repo store down");
    return name === REPO ? { name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir } : undefined;
  });
});
after(() => { mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.FALKON_CHAT_MAX_STEP_COUNT; });

const read = { tool: "read_file", args: { repo: REPO, path: "a.txt", ref: "WORKTREE" } };
/** Runs one turn over the scripted fake model; returns the metadata, the ask log lines and the tool message text the model saw per request. */
async function run(turns: Turn[]) {
  const fake = await fakeOpenAi(turns);
  const log = mock.method(console, "log", () => {});
  try {
    const stream = await createMessageStream({ audience: "human", messages: [user], selectedRepos: [REPO], scope: scopeFor(["*"]), model: { provider: "openai-compatible", model: "m", baseUrl: fake.url }, permit: breaker.admit({ provider: "openai-compatible", model: "m" }) });
    const out: { type: string; messageMetadata?: Record<string, unknown> }[] = [];
    const r = stream.getReader();
    for (let c = await r.read(); !c.done; c = await r.read()) out.push(c.value as never);
    const meta = out.find((c) => c.type === "message-metadata")!.messageMetadata as { steps: StepRecord[]; totalCachedInputTokens: number; totalInputTokens: number; totalOutputTokens: number; modelName: string; totalTokens: number };
    const lines = log.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.startsWith("[ask] step"));
    const seen = fake.requests.map((q) => q.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));
    return { meta, lines, seen };
  } finally { log.mock.restore(); fake.close(); }
}

test("three steps store three records with reported tokens and tool byte sizes; sums equal the totals", async () => {
  const { meta, lines, seen } = await run([
    { ...read, usage: { in: 100, cached: 40, out: 5 } },
    { ...read, usage: { in: 150, cached: 90, out: 6 } },
    { text: "<!--answer-->\nok", usage: { in: 200, cached: 160, out: 7 } },
  ]);
  assert.equal(meta.steps.length, 3);
  assert.deepEqual(meta.steps.map((s) => [s.in, s.cached, s.out]), [[100, 40, 5], [150, 90, 6], [200, 160, 7]]);
  const seenBytes = Buffer.byteLength(seen[1]![0]!);
  assert.ok(seenBytes > 0 && seen[1]!.length === 1);
  assert.deepEqual(meta.steps.map((s) => s.toolBytes), [[{ tool: "read_file", bytes: seenBytes }], [{ tool: "read_file", bytes: seenBytes }], []]);
  assert.equal(meta.totalInputTokens, 450);
  assert.equal(meta.totalOutputTokens, 18);
  assert.equal(meta.totalCachedInputTokens, 290);
  assert.equal(meta.steps.reduce((n, s) => n + s.in, 0), meta.totalInputTokens);
  assert.equal(meta.steps.reduce((n, s) => n + s.out, 0), meta.totalOutputTokens);
  assert.equal(meta.modelName, "m", "existing keys stay");
  assert.equal(meta.totalTokens, 468);
  assert.deepEqual(lines, [`[ask] step 1 in=100 cached=40 out=5 tools=read_file:${seenBytes}`, `[ask] step 2 in=150 cached=90 out=6 tools=read_file:${seenBytes}`, "[ask] step 3 in=200 cached=160 out=7 tools="]);
});

test("a provider that reports no cached tokens gives 0, never NaN", async () => {
  const { meta } = await run([{ text: "<!--answer-->\nok", usage: { in: 10, out: 2 } }]);
  assert.equal(meta.steps[0]!.cached, 0);
  assert.equal(meta.totalCachedInputTokens, 0);
  assert.equal(JSON.stringify(meta.steps), '[{"in":10,"cached":0,"out":2,"toolBytes":[]}]');
});

test("a tool that throws is sized by its error text", async () => {
  getRepoFails = true;
  try {
    const { meta, seen } = await run([{ ...read }, { text: "<!--answer-->\nok" }]);
    const text = seen[1]![0]!;
    assert.match(text, /repo store down/);
    assert.equal(meta.steps[0]!.toolBytes[0]!.tool, "read_file");
    assert.ok(meta.steps[0]!.toolBytes[0]!.bytes > 0 && meta.steps[0]!.toolBytes[0]!.bytes <= Buffer.byteLength(text));
  } finally { getRepoFails = false; }
});

test("a run stopped by the step cap has exactly cap records", async () => {
  process.env.FALKON_CHAT_MAX_STEP_COUNT = "2";
  try {
    const { meta, lines } = await run([{ ...read }]);
    assert.equal(meta.steps.length, 2);
    assert.equal(lines.length, 2);
  } finally { delete process.env.FALKON_CHAT_MAX_STEP_COUNT; }
});
