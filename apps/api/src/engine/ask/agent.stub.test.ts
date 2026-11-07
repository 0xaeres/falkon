import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelMessage } from "ai";
import { scopeFor } from "@falkon/shared";
import { toolDeps } from "../tools";
import { createMessageStream, stubOldSearchResults } from "./agent";
import { fakeOpenAi, type Turn } from "./fakeOpenAi";

// S101 (D193): results of grep, glob and list_tree older than the last three steps are stubbed in the model's copy only.
const big = (c: string) => c.repeat(500);
const content = (text: string) => ({ type: "content" as const, value: [{ type: "text" as const, text }] });
/** One step: an assistant message with tool calls and the tool message with their results. */
const step = (n: number, calls: { tool: string; input: unknown; out: string; error?: boolean }[]): ModelMessage[] => [
  { role: "assistant", content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `c${n}-${i}`, toolName: c.tool, input: c.input })) },
  { role: "tool", content: calls.map((c, i) => ({ type: "tool-result" as const, toolCallId: `c${n}-${i}`, toolName: c.tool, output: c.error ? { type: "error-text" as const, value: c.out } : content(c.out) })) },
];
const texts = (ms: ModelMessage[]) => ms.filter((m) => m.role === "tool").flatMap((m) => (m.content as { output: { type: string; value: unknown } }[]).map((p) => (p.output.type === "content" ? (p.output.value as { text: string }[])[0]!.text : String(p.output.value))));
const head: ModelMessage = { role: "user", content: "q" };

test("with eight steps, search results of steps 1-4 are stubs and everything else is whole", () => {
  const tools = ["grep", "read_file", "glob", "list_commits", "list_tree", "grep", "get_diff", "list_tree"];
  const ms = [head, ...tools.flatMap((t, i) => step(i, [{ tool: t, input: { n: i }, out: big(String(i)) }]))];
  const before = JSON.stringify(ms);
  const got = texts(stubOldSearchResults(ms.slice(0, -2))); // 7 steps done: the request for step 8
  assert.match(got[0]!, /^\[grep \{"n":0\}: 500 bytes; rerun to see\]$/);
  assert.equal(got[1], big("1"), "read_file never");
  assert.match(got[2]!, /^\[glob \{"n":2\}: 500 bytes/);
  assert.equal(got[3], big("3"), "history never");
  for (const i of [4, 5, 6]) assert.equal(got[i], big(String(i)), "last three steps whole");
  assert.equal(JSON.stringify(ms), before, "input not mutated");
});

test("fewer than four steps: nothing is stubbed", () => {
  const ms = [head, ...[0, 1, 2].flatMap((i) => step(i, [{ tool: "grep", input: {}, out: big("x") }]))];
  assert.deepEqual(stubOldSearchResults(ms), ms);
});

test("two tool calls in one step: both stubbed with their own arguments", () => {
  const ms = [head, ...step(0, [{ tool: "grep", input: { pattern: "aa" }, out: big("a") }, { tool: "glob", input: { pattern: "bb" }, out: big("b") }]), ...[1, 2, 3].flatMap((i) => step(i, [{ tool: "grep", input: {}, out: "x" }]))];
  const got = texts(stubOldSearchResults(ms));
  assert.match(got[0]!, /grep .*"aa"/);
  assert.match(got[1]!, /glob .*"bb"/);
});

test("a result smaller than its stub stays whole", () => {
  const ms = [head, ...step(0, [{ tool: "grep", input: { pattern: "p" }, out: "no matches" }]), ...[1, 2, 3].flatMap((i) => step(i, [{ tool: "grep", input: {}, out: "x" }]))];
  assert.equal(texts(stubOldSearchResults(ms))[0], "no matches");
});

test("an error result is never stubbed, however big", () => {
  const ms = [head, ...step(0, [{ tool: "grep", input: {}, out: "boom", error: true }]), ...step(1, [{ tool: "grep", input: {}, out: big("e"), error: true }]), ...[2, 3, 4].flatMap((i) => step(i, [{ tool: "grep", input: {}, out: "x" }]))];
  const got = stubOldSearchResults(ms).filter((m) => m.role === "tool").map((m) => (m.content as { output: { type: string; value: string } }[])[0]!.output);
  assert.deepEqual(got[0], { type: "error-text", value: "boom" });
  assert.deepEqual(got[1], { type: "error-text", value: big("e") });
});

// ---- mock run ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-stub-"));
const REPO = "fixtures.test/atlas";
const user = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What does it do?" }] };
before(() => {
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `file-with-a-long-name-${i}.txt`), "");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  mock.method(toolDeps, "listRepos", async () => [{ name: REPO, pushedAt: null, defaultBranch: "main", isFork: false, isArchived: false }] as never);
  mock.method(toolDeps, "getRepo", async (name: string) => (name === REPO ? { name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir } : undefined));
});
after(() => { mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.FALKON_CHAT_MAX_STEP_COUNT; });

const tree = { tool: "list_tree", args: { repo: REPO } };
const readF = { tool: "read_file", args: { repo: REPO, path: "a.txt" } };
const repos = { tool: "list_repos", args: {} };
async function run(turns: Turn[]) {
  const fake = await fakeOpenAi(turns);
  const log = mock.method(console, "log", () => {});
  try {
    let stored: unknown;
    const stream = await createMessageStream({ audience: "human", messages: [user], selectedRepos: [REPO], scope: scopeFor(["*"]), model: { provider: "openai-compatible", model: "m", baseUrl: fake.url } as never, onFinish: (m) => void (stored = m) });
    const r = stream.getReader();
    while (!(await r.read()).done);
    const seen = fake.requests.map((q) => q.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));
    const choices = (fake.requests as unknown as { tool_choice?: unknown }[]).map((q) => q.tool_choice);
    return { seen, choices, stored: JSON.stringify(stored) };
  } finally { log.mock.restore(); fake.close(); }
}

test("eight-step run: the request at step eight holds stubs for steps 1-4 searches, whole text elsewhere; stored message is whole", async () => {
  const { seen, stored } = await run([tree, readF, { ...tree, args: { ...tree.args, path: "" , depth: 2 } }, repos, tree, readF, tree, { text: "<!--answer-->\nok" }]);
  assert.equal(seen.length, 8);
  const last = seen[7]!;
  assert.equal(last.length, 7);
  assert.match(last[0]!, /^\[list_tree .*fixtures\.test\/atlas.*: \d+ bytes; rerun to see\]$/);
  assert.match(last[2]!, /"depth":2/);
  assert.ok(!/rerun to see/.test(last[1]! + last[3]! + last[4]! + last[5]! + last[6]!), "read_file, list_repos, last three steps whole");
  assert.match(last[1]!, /hello/);
  assert.equal(seen[3]!.filter((t) => /rerun to see/.test(t)).length, 0, "three steps done: nothing stubbed");
  assert.equal(seen[4]!.filter((t) => /rerun to see/.test(t)).length, 1, "four steps done: step 1 stubbed");
  assert.ok(!/rerun to see/.test(stored), "stored message keeps full results");
  assert.match(stored, /file-with-a-long-name-39/);
});

test("the last step keeps toolChoice none while old results are stubbed", async () => {
  process.env.FALKON_CHAT_MAX_STEP_COUNT = "5";
  try {
    const { seen, choices } = await run([tree, tree, tree, tree, { text: "<!--answer-->\nok" }]);
    assert.equal(choices[4], "none");
    assert.equal(seen[4]!.filter((t) => /rerun to see/.test(t)).length, 1);
  } finally { delete process.env.FALKON_CHAT_MAX_STEP_COUNT; }
});
