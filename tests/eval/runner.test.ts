import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute, runTasks, type Task } from "./runner.js";
import { hasRaw, readRaw, type Raw } from "./data.js";

const task = (id: string, dataset = "openmrs-xrepo"): Task => ({ id, dataset, split: "dev", question: "Q" });
const lineCount = (p: string) => p === "repo/a.ts" ? 100 : undefined;
const tmp = () => mkdtempSync(join(tmpdir(), "eval-runner-"));
const script = (dir: string, body: string) => { const f = join(dir, "fake.sh"); writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o700 }); return f; };
const result = (extra: object = {}) => JSON.stringify({ type: "result", result: "```json\n[{\"path\":\"repo/a.ts\",\"startLine\":1,\"endLine\":9}]\n```", total_cost_usd: 0.1, num_turns: 2, is_error: false, usage: { input_tokens: 3 }, ...extra });

test("execute records the parsed answer, cost, tool use and leak flag of a stream", async () => {
  const dir = tmp();
  try {
    const tool = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__falkon__research_codebase", input: {} }] } });
    const f = script(dir, `printf '%s\\n' '${tool}' '${result()}'`);
    const run = await execute({ command: f, args: [], cwd: dir, env: process.env }, task("q1"), "clone-research", 1, lineCount);
    assert.ok(run);
    assert.deepEqual([run.taskId, run.repository, run.arm, run.is_error, run.malformed, run.leak, run.firstTool, run.total_cost_usd], ["q1", "openmrs-xrepo", "clone-research", false, false, false, "research_codebase", 0.1]);
    assert.deepEqual(run.answer, [{ path: "repo/a.ts", startLine: 1, endLine: 9 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("execute redacts the key from the record, even when escaped inside stream json", async () => {
  const dir = tmp();
  try {
    const escaped = '{"type":"result","result":"tok-\\u0073ecret","total_cost_usd":0.1,"num_turns":1,"usage":{}}';
    const f = script(dir, `printf '%s\\n' '${escaped}'\necho tok-secret >&2`);
    const run = await execute({ command: f, args: [], cwd: dir, env: { ...process.env, EVAL_MCP_KEY: "tok-secret" } }, task("q"), "clone-tools", 1, lineCount, "tok-secret");
    assert.ok(run);
    assert.ok(!JSON.stringify(run).includes("tok-secret"));
    assert.ok(JSON.stringify(run).includes("[REDACTED]"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a run that fails before the model ran is not recorded, and its error never shows the key", async (t) => {
  const dir = tmp(); const logs: string[] = [];
  t.mock.method(console, "error", (...a: unknown[]) => logs.push(a.join(" ")));
  try {
    const f = script(dir, `printf '%s\\n' '${result({ result: "bad tok-secret", is_error: true, total_cost_usd: 0, usage: {} })}'`);
    assert.equal(await execute({ command: f, args: [], cwd: dir, env: process.env }, task("q"), "clone-tools", 1, lineCount, "tok-secret"), undefined);
    assert.ok(logs.length && !logs.join(" ").includes("tok-secret"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failed run is recorded as an error with an empty answer", async () => {
  const dir = tmp();
  try {
    const run = await execute({ command: script(dir, `printf '%s\\n' '${result({ is_error: true, total_cost_usd: 0.2 })}'\nexit 1`), args: [], cwd: dir, env: process.env }, task("q"), "clone-tools", 1, lineCount);
    assert.ok(run?.is_error && run.answer.length === 0 && run.total_cost_usd === 0.2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const fake = (cost: number, calls: string[] = []) => async (t: Task, arm: string): Promise<Raw> => {
  calls.push(`${t.dataset}/${t.id}/${arm}`);
  return { taskId: t.id, repository: t.dataset, split: t.split, arm, answer: [], malformed: false, is_error: false, total_cost_usd: cost, usage: {}, num_turns: 1, wallClockMs: 1 };
};

test("runTasks writes one raw file per task and arm, then skips what is already recorded", async () => {
  const root = tmp(); const calls: string[] = [];
  try {
    const opts = { runsRoot: root, arms: ["clone-tools", "clone-research"] as const, concurrency: 2, perRunCap: 1, spendCap: 15, run: fake(0.1, calls) };
    await runTasks([task("a"), task("b"), task("a", "openmrs-xrepo-unnamed")], { ...opts, arms: [...opts.arms] });
    assert.equal(calls.length, 6);
    assert.ok(hasRaw(join(root, "openmrs-xrepo-unnamed"), "clone-research", "a"));
    await runTasks([task("a"), task("b"), task("c")], { ...opts, arms: [...opts.arms] });
    assert.equal(calls.length, 8);
    assert.equal(readRaw(join(root, "openmrs-xrepo")).length, 6);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the spend cap spans datasets and arms, and stops new runs before it is exceeded", async () => {
  const root = tmp(); const calls: string[] = [];
  try {
    const opts = { runsRoot: root, arms: ["clone-tools"], concurrency: 1, perRunCap: 1, spendCap: 2.5, run: fake(1, calls) };
    await assert.rejects(runTasks([task("a"), task("b"), task("c", "openmrs-xrepo-unnamed"), task("d")], opts), /spend cap/i);
    assert.ok(calls.length < 4 && calls.length >= 2);
    const spent = ["openmrs-xrepo", "openmrs-xrepo-unnamed"].flatMap((d) => readRaw(join(root, d))).reduce((s, r) => s + r.total_cost_usd, 0);
    assert.ok(spent <= 2.5 + 1e-9, String(spent));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a run that cost money but returned no result is recorded as an error with its real cost", async () => {
  const dir = tmp();
  try {
    const f = script(dir, `printf '%s\\n' '{"type":"result","is_error":true,"total_cost_usd":0.4,"num_turns":3,"usage":{"input_tokens":9}}'`);
    const run = await execute({ command: f, args: [], cwd: dir, env: process.env }, task("q"), "clone-tools", 1, lineCount);
    assert.ok(run && run.is_error && run.total_cost_usd === 0.4 && run.answer.length === 0);
    const free = script(dir, `printf '%s\\n' '{"type":"result","is_error":true,"total_cost_usd":0,"usage":{}}'`);
    assert.equal(await execute({ command: free, args: [], cwd: dir, env: process.env }, task("q"), "clone-tools", 1, lineCount), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent runs reserve their full cap, so the ledger cannot overshoot", async () => {
  const root = tmp();
  try {
    const slow = async (t: Task, arm: string): Promise<Raw> => { await new Promise((r) => setTimeout(r, 20)); return fake(1)(t, arm); };
    await assert.rejects(runTasks([task("a"), task("b"), task("c"), task("d")], { runsRoot: root, arms: ["clone-tools"], concurrency: 3, perRunCap: 1, spendCap: 2.5, run: slow }), /spend cap/i);
    const spent = readRaw(join(root, "openmrs-xrepo")).reduce((s, r) => s + r.total_cost_usd, 0);
    assert.ok(spent <= 2.5, String(spent));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
