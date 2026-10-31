import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { scopeFor } from "@falkon/shared";
import { toolDeps } from "../tools";
import { agentTools } from "./agent";

// Ask reads diffs through get_diff (D176): an over-cap diff reaches the model cut in the middle, with the marker.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-diff-"));
const REPO = "fixtures.test/atlas";
const git = (...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=F", "-c", "user.email=f@x.test", ...a], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "pipe" });
before(() => {
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "start\n");
  git("add", "."); git("commit", "-qm", "one");
  fs.writeFileSync(path.join(dir, "big.txt"), Array.from({ length: 2000 }, (_, i) => `generated line ${i} with some padding text`).join("\n") + "\n");
  git("add", "."); git("commit", "-qm", "two");
  fs.writeFileSync(path.join(dir, "mid.txt"), Array.from({ length: 100 }, (_, i) => `mid row ${i} padding padding`).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "zlast.txt"), Array.from({ length: 600 }, (_, i) => `last row ${i} padding`).join("\n") + "\n");
  git("add", "."); git("commit", "-qm", "three");
  mock.method(toolDeps, "getRepo", async (name: string) => (name === REPO ? { name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: dir } : undefined));
});
after(() => { mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); });

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

test("Ask: an over-cap get_diff result reaches the model with the removed-bytes marker", async () => {
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => ++call === 1
      ? { content: [{ type: "tool-call", toolCallId: "t1", toolName: "get_diff", input: JSON.stringify({ repo: REPO, base: "HEAD~2", head: "HEAD" }) }], finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] }
      : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
  });
  await generateText({ model, prompt: "What changed?", tools: agentTools(scopeFor(["*"]), [], () => {}), stopWhen: stepCountIs(3) });
  const seen = JSON.stringify(model.doGenerateCalls[1]!.prompt);
  assert.match(seen, /bytes removed from the middle/);
  assert.ok(seen.includes("generated line 0 "), "the first part of the diff is kept");
  assert.ok(seen.includes("last row 599 "), "the last part of the diff is kept");
  assert.ok(!seen.includes("generated line 1000 "), "the middle is gone");
});

test("Ask: a file cut out of a get_diff result is not offered as a source, a visible one is", async () => {
  const sources: { path?: string }[] = [];
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => ++call === 1
      ? { content: [{ type: "tool-call", toolCallId: "t2", toolName: "get_diff", input: JSON.stringify({ repo: REPO, base: "HEAD~2", head: "HEAD" }) }], finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] }
      : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
  });
  await generateText({ model, prompt: "What changed?", tools: agentTools(scopeFor(["*"]), [], (s) => sources.push(s as { path?: string })), stopWhen: stepCountIs(3) });
  const seen = JSON.stringify(model.doGenerateCalls[1]!.prompt);
  assert.ok(seen.includes("last row 599 ") && seen.includes("file(s) removed entirely"));
  assert.ok(!seen.includes("+++ b/mid.txt"), "mid.txt is cut out of what the model saw");
  const paths = sources.map((s) => s.path);
  assert.ok(paths.includes("zlast.txt") && paths.includes("big.txt"));
  assert.ok(!paths.includes("mid.txt"), "cut text cannot be cited");
});
