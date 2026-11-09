import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scopeFor } from "@falkon/shared";
import { toolDeps } from "../tools";
import { createMessageStream, modelText, MODEL_TOOL_OUTPUT_MAX_BYTES as CAP, type StepRecord } from "./agent";
import { breaker } from "./breaker";
import { fakeOpenAi, type Turn } from "./fakeOpenAi";

// S100 (D191, D192): the model sees at most CAP bytes of any tool result; the step guard ends a capped run with an answer.
const bytes = (s: string) => Buffer.byteLength(s);
const text = (o: string) => modelText({ output: o });

test("a result at or under the cap is returned byte-identical, including empty and exactly the cap", () => {
  for (const s of ["", "one line", "x".repeat(CAP), ("é" + "\n").repeat(CAP / 3 | 0)]) {
    assert.ok(bytes(s) <= CAP);
    assert.equal(text(s), s);
  }
});

test("one byte over the cap is cut at a line boundary, stays under the cap, and says what was dropped", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}: ${"y".repeat(20)}`);
  const full = lines.join("\n");
  assert.ok(bytes(full) > CAP);
  const out = text(full);
  assert.ok(bytes(out) <= CAP, String(bytes(out)));
  const [kept, notice] = out.split("\n[output cut:");
  assert.ok(full.startsWith(kept! + "\n"), "kept part is whole lines");
  assert.ok(lines.includes(kept!.split("\n").at(-1)!));
  assert.match(notice!, new RegExp(`${bytes(full) - bytes(kept!)} bytes, ${2000 - kept!.split("\n").length} lines dropped; narrow with path, pattern or repo, or read with offset and limit\\]$`));
});

test("multi-byte characters are never split, in the line cut or inside one long line", () => {
  for (const unit of ["é", "日本", "🦅"]) {
    const long = unit.repeat(CAP); // one huge single line, no newline
    const out = text(long);
    assert.ok(bytes(out) <= CAP);
    const kept = out.split("\n[output cut:")[0]!;
    assert.ok(kept.length > 0 && kept.split(unit).join("") === "", `${unit} split`);
    assert.ok(!out.includes("�"));
    const lined = text((unit.repeat(40) + "\n").repeat(2000));
    assert.ok(!lined.includes("�") && bytes(lined) <= CAP);
  }
});

test("a get_diff result between 16 KB and 30 KB reaches the model uncut (it enforces its own cut); other tools are cut", () => {
  const diff = ("+ added line\n").repeat(1500); // about 19.5 KB
  assert.ok(bytes(diff) > CAP && bytes(diff) < 30_000);
  assert.equal(modelText({ output: diff }, "get_diff"), diff);
  assert.notEqual(modelText({ output: diff }, "grep"), diff);
});

test("one huge ASCII line is cut inside it, with a one-line notice", () => {
  const out = text("z".repeat(100_000));
  assert.ok(bytes(out) <= CAP && bytes(out) > CAP - 512);
  assert.match(out, /\n\[output cut: \d+ bytes, 0 lines dropped; narrow/);
});

// ---- mock runs ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-cap-"));
const REPO = "fixtures.test/atlas";
const user = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What does it do?" }] };
before(() => {
  const repos = Array.from({ length: 100 }, (_, i) => ({ name: `fixtures.test/${"r".repeat(200)}${i}`, pushedAt: null, defaultBranch: "main", isFork: false, isArchived: false }));
  mock.method(toolDeps, "listRepos", async () => repos as never);
  mock.method(toolDeps, "getRepo", async (name: string) => (name === REPO ? { name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir } : undefined));
});
after(() => { mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.FALKON_CHAT_MAX_STEP_COUNT; });

const read = { tool: "list_repos", args: { perPage: 100 } };
async function run(turns: Turn[]) {
  const fake = await fakeOpenAi(turns);
  const log = mock.method(console, "log", () => {});
  try {
    let ctx: { text: string; stepCapHit: boolean } | undefined;
    const stream = await createMessageStream({
      audience: "human", messages: [user], selectedRepos: [REPO], scope: scopeFor(["*"]), model: { provider: "openai-compatible", model: "m", baseUrl: fake.url } as never, permit: breaker.admit({ provider: "openai-compatible", model: "m" }),
      postProcess: async (c) => ((ctx = c), []),
    });
    const out: { type: string; messageMetadata?: { steps: StepRecord[] } }[] = [];
    const r = stream.getReader();
    for (let c = await r.read(); !c.done; c = await r.read()) out.push(c.value as never);
    const choices = (fake.requests as unknown as { tool_choice?: unknown }[]).map((q) => q.tool_choice);
    const seen = fake.requests.map((q) => q.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));
    return { ctx: ctx!, choices, seen, steps: out.find((c) => c.type === "message-metadata")!.messageMetadata!.steps };
  } finally { log.mock.restore(); fake.close(); }
}

test("the model sees a capped result; the step record sizes the same text", async () => {
  const { seen, steps } = await run([read, { text: "<!--answer-->\nok" }]);
  // The provider serialises the content parts as JSON text; the model text is the part inside.
  const shown = (JSON.parse(seen[1]![0]!) as { text: string }[])[0]!.text;
  assert.ok(bytes(shown) <= CAP);
  assert.match(shown, /\[output cut: \d+ bytes, \d+ lines dropped; narrow with path/);
  assert.deepEqual(steps[0]!.toolBytes, [{ tool: "list_repos", bytes: bytes(shown) }]);
});

test("step count 3: last request has tool_choice none, the run ends with answer text, stepCapHit is true", async () => {
  process.env.FALKON_CHAT_MAX_STEP_COUNT = "3";
  try {
    const { ctx, choices } = await run([read, read, { text: "<!--answer-->\nfinal answer" }]);
    assert.deepEqual(choices, ["auto", "auto", "none"]);
    assert.match(ctx.text, /final answer/);
    assert.equal(ctx.stepCapHit, true);
  } finally { delete process.env.FALKON_CHAT_MAX_STEP_COUNT; }
});

test("the default step cap is 30: a model that never stops gets exactly 30 requests, the 30th with tool_choice none", async () => {
  delete process.env.FALKON_CHAT_MAX_STEP_COUNT;
  const { choices, ctx } = await run([read]);
  assert.equal(choices.length, 30);
  assert.ok(choices.slice(0, 29).every((c) => c === "auto") && choices[29] === "none");
  assert.equal(ctx.stepCapHit, true);
});
