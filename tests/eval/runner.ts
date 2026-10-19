import { spawn } from "node:child_process";
import { DATASETS, hasRaw, readRaw, writeRaw, type Arm, type Raw } from "./data.js";
import { parseAnswer, parseClaudeOutput } from "./harness.js";
import { join } from "node:path";

export type Task = { id: string; dataset: string; split: "dev" | "hidden"; question: string };
type Launch = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

/** Runs one agent child to completion; undefined when it failed before the model ran (retry on the next run). */
export function execute(launch: Launch, task: Task, arm: Arm, cap: number, lineCount: (path: string) => number | undefined, secret?: string, denyPaths: string[] = []): Promise<Raw | undefined> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (s: string) => stdout += s);
    child.stderr.setEncoding("utf8").on("data", (s: string) => stderr += s);
    child.on("error", (e) => stderr += e.message);
    const timer = setTimeout(() => { timedOut = true; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } } }, 15 * 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      // Decode JSON first so an escaped credential cannot survive in records or diagnostics.
      const redact = (text: string) => !secret ? text : text.split("\n").map((line) => {
        try { return JSON.stringify(JSON.parse(line), (_k, v) => typeof v === "string" ? v.replaceAll(secret, "[REDACTED]") : v); } catch { return line.replaceAll(secret, "[REDACTED]"); }
      }).join("\n");
      stdout = redact(stdout); stderr = redact(stderr);
      const out = parseClaudeOutput(stdout, arm, denyPaths);
      // A zero-cost failure never reached the model and is retried; anything that cost money is recorded, so the ledger sees it.
      const spent = (out.total_cost_usd ?? 0) > 0;
      if (!timedOut && !spent && (typeof out.result !== "string" || (out.is_error === true && !out.usage.input_tokens && !out.usage.output_tokens))) {
        console.error(`${task.id}/${arm}: error before the model ran; retry on next run. ${String(out.result ?? stderr).slice(0, 120)}`);
        return resolve(undefined);
      }
      const parsed = parseAnswer(out.result ?? "", lineCount);
      const failed = timedOut || status !== 0 || out.is_error === true || typeof out.result !== "string";
      resolve({
        taskId: task.id, repository: task.dataset, split: task.split, arm, result: out.result, answer: failed ? [] : parsed.answer, malformed: parsed.malformed, is_error: failed,
        total_cost_usd: timedOut || typeof out.total_cost_usd !== "number" ? cap : out.total_cost_usd, usage: out.usage, toolCalls: out.toolCalls, firstTool: out.firstTool, leak: out.leak, deniedAttempts: out.deniedAttempts,
        num_turns: out.num_turns ?? 0, wallClockMs: Date.now() - start, stdout, stderr,
      });
    });
  });
}

export type RunOptions = { runsRoot: string; arms: Arm[] | readonly string[]; concurrency: number; perRunCap: number; spendCap: number; run: (task: Task, arm: Arm) => Promise<Raw | undefined> };
export const spentSoFar = (runsRoot: string) => DATASETS.flatMap((d) => readRaw(join(runsRoot, d))).reduce((s, r) => s + r.total_cost_usd, 0);

/** Records one raw file per task and arm. Tasks run in batches; a task's arms run in turn, so a batch has at most `concurrency` runs in flight. */
export async function runTasks(tasks: Task[], o: RunOptions): Promise<void> {
  const missing = (t: Task) => (o.arms as Arm[]).filter((arm) => !hasRaw(join(o.runsRoot, t.dataset), arm, t.id));
  let inFlight = 0;
  const runOne = async (t: Task) => {
    for (const arm of missing(t)) {
      // Every run in flight may still cost its full cap, so reserve for all of them before starting another.
      if (spentSoFar(o.runsRoot) + (inFlight + 1) * o.perRunCap > o.spendCap) throw new Error(`Agent spend cap $${o.spendCap} reached; stopping new runs.`);
      inFlight++;
      try { const run = await o.run(t, arm); if (run) writeRaw(join(o.runsRoot, t.dataset), run); } finally { inFlight--; }
    }
  };
  for (let i = 0; i < tasks.length; i += o.concurrency) {
    const batch = tasks.slice(i, i + o.concurrency).filter((t) => missing(t).length);
    const results = await Promise.allSettled(batch.map(runOne));
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
