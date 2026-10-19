/**
 * Falkon O3 Ask-quality check (regression gate item 3).
 *
 *   pnpm eval -- pilot [--list] [--arms a,b]        5 dev questions of the named set, both arms
 *   pnpm eval -- run --split dev|hidden [--list]    both datasets, both arms; needs the pilot, hidden needs clean dev
 *   pnpm eval -- report --split dev|hidden          the floor comparison, from stored runs (spends nothing)
 *   pnpm eval -- report --pilot                     one line per pilot run
 *   pnpm eval -- stack up|down [-v]                 the clone stack over the 42 checkouts (Docker, 127.0.0.1:EVAL_PORT)
 *   pnpm eval -- preflight                          42 repositories and 104 gold paths readable through the stack
 *
 * Environment: EVAL_O3_DIR (corpus checkouts), EVAL_PORT (3400), EVAL_RUNS_DIR, EVAL_WORK_DIR, EVAL_API_KEY_FILE (optional).
 * Start the stack with `pnpm eval -- stack up`; its state lives under tests/eval/.local (ignored).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ARMS, DATASETS, EVAL_DIR, FLOOR_DIR, REPO_ROOT, hasRaw, loadAccepted, loadDataset, loadProduct, readRaw, type Arm, type Dataset } from "./data.js";
import { buildCommand } from "./harness.js";
import { expectedRepos, goldPaths, preflight, readKey } from "./preflight.js";
import { report } from "./report.js";
import { execute, runTasks, spentSoFar, type Task } from "./runner.js";
import { scoreAnswer } from "./score.js";
import { stack } from "./stack.js";

const SPEND_CAP = 15, PER_RUN_CAP = 1;
const hash = (id: string) => createHash("sha256").update("eval|" + id).digest("hex");

/** Five dev questions of a set: the first of each relation in a fixed hash order, then the next in that order. */
export function pilotIds(dataset: Dataset): string[] {
  const dev = dataset.questions.filter((q) => q.split === "dev").sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  const first = [...new Map(dev.map((q) => [q.relation, q.id])).values()];
  return [...first, ...dev.map((q) => q.id).filter((id) => !first.includes(id))].slice(0, 5);
}

const config = (env: NodeJS.ProcessEnv) => ({
  o3Dir: resolve(env.EVAL_O3_DIR ?? "/Users/aeres/Desktop/projects/falkon/.local/eval"),
  port: Number(env.EVAL_PORT ?? 3400),
  runsRoot: resolve(env.EVAL_RUNS_DIR ?? join(REPO_ROOT, ".scratch/falkon-mvp/eval-runs")),
  workDir: resolve(env.EVAL_WORK_DIR ?? "/private/tmp/falkon-eval"),
  keyFile: env.EVAL_API_KEY_FILE,
});

/** Line count of <repository>/<path> at the repository's pinned commit; undefined for anything that is not a file there. */
export function lineCounter(o3Dir: string) {
  const roots = new Map(loadProduct().repositories.map((r) => [r.name, { dir: join(o3Dir, r.checkout), commit: r.commit }]));
  return (path: string) => {
    const [name, ...rest] = path.split("/"), repo = roots.get(name!);
    if (!repo || !rest.length || rest.some((p) => p === ".." || p === "")) return undefined;
    try {
      const text = execFileSync("git", ["-C", repo.dir, "cat-file", "blob", `${repo.commit}:${rest.join("/")}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      return lines.length;
    } catch { return undefined; }
  };
}

/** The agent's checkout: openmrs-esm-patient-chart only, at its pinned commit, outside any repository. */
function exportChart(o3Dir: string, workDir: string): string {
  const repos = loadProduct().repositories;
  for (const r of repos) {
    const head = existsSync(join(o3Dir, r.checkout)) ? execFileSync("git", ["-C", join(o3Dir, r.checkout), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "missing";
    if (head !== r.commit) throw new Error(`Checkout ${join(o3Dir, r.checkout)} is at ${head}, expected ${r.commit}. Set EVAL_O3_DIR.`);
  }
  const chart = repos.find((r) => r.name === "openmrs-esm-patient-chart")!, dest = join(workDir, "chart-only"), marker = join(workDir, "chart-only.commit");
  if (existsSync(marker) && readFileSync(marker, "utf8") === chart.commit) return dest;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, chart.name), { recursive: true });
  execFileSync("bash", ["-o", "pipefail", "-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "export", join(o3Dir, chart.checkout), chart.commit, join(dest, chart.name)]);
  writeFileSync(marker, chart.commit);
  return dest;
}

const flagValue = (args: string[], flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const clean = (r: { is_error: boolean; malformed: boolean; leak?: boolean }) => !r.is_error && !r.malformed && !r.leak;

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const args = argv.filter((a, i) => !(a === "--" && i < 2)); // pnpm may pass a leading "--"
  const command = args[0], cfg = config(env), listing = args.includes("--list");
  if (!["pilot", "run", "report", "preflight", "stack"].includes(command ?? "")) throw new Error("Usage: pnpm eval -- pilot|run|report|preflight|stack [--split dev|hidden] [--arms clone-tools,clone-research] [--list] [--pilot]");
  const split = (flagValue(args, "--split") ?? "dev") as "dev" | "hidden";
  if (!["dev", "hidden"].includes(split)) throw new Error("--split must be dev or hidden");
  const armsFlag = flagValue(args, "--arms");
  const arms = (armsFlag ? armsFlag.split(",") : ARMS) as Arm[];
  if (arms.some((a) => !ARMS.includes(a)) || new Set(arms).size !== arms.length) throw new Error(`--arms must be a comma-separated list of ${ARMS.join(",")}`);
  if (command === "stack") return stack(args[1] ?? "", args.slice(2), { o3Dir: cfg.o3Dir, repoRoot: REPO_ROOT, port: cfg.port, project: env.EVAL_COMPOSE_PROJECT ?? "falkon-eval", stateDir: resolve(env.EVAL_STATE_DIR ?? join(EVAL_DIR, ".local/stack")) });
  const datasets = DATASETS.map(loadDataset), named = datasets[0]!, dirOf = (d: string) => join(cfg.runsRoot, d);

  if (command === "preflight") return await preflight({ expectedRepos: expectedRepos(), gold: goldPaths(), port: cfg.port, apiKey: readKey(cfg.keyFile) }) + "\n";

  if (command === "report") {
    if (args.includes("--pilot")) {
      const stored = readRaw(dirOf(named.id)), recalls: Record<string, number[]> = {};
      const lines = pilotIds(named).flatMap((id) => arms.map((arm) => {
        const run = stored.find((r) => r.taskId === id && r.arm === arm);
        if (!run) return `${id} ${arm} missing`;
        const q = named.questions.find((x) => x.id === id)!;
        const recall = scoreAnswer(q.declarations ?? [], run.is_error ? [] : run.answer, run.malformed).recall;
        (recalls[arm] ??= []).push(recall);
        const tools = Object.entries(run.toolCalls ?? {}).map(([k, v]) => `${k}:${v}`).join(",") || "none";
        return `${id} ${arm} first=${run.firstTool ?? "none"} tools=${tools} recall=${recall.toFixed(2)} cost=${run.total_cost_usd.toFixed(4)} leak=${!!run.leak} denied=${run.deniedAttempts ?? 0} malformed=${run.malformed}`;
      }));
      const mine = stored.filter((r) => pilotIds(named).includes(r.taskId) && arms.includes(r.arm as Arm));
      const research = mine.filter((r) => r.arm === "clone-research"), plain = recalls["clone-tools"] ?? [];
      const meanPlain = plain.length ? plain.reduce((a, b) => a + b, 0) / plain.length : NaN;
      const rule = (ok: boolean, text: string) => `${ok ? "PASS" : "STOP"}: ${text}`;
      lines.push("", "Stop rules (spec S5):",
        rule(plain.length === pilotIds(named).length && meanPlain >= 0.8, `plain-arm pilot recall ${Number.isNaN(meanPlain) ? "n/a" : meanPlain.toFixed(3)} (needs complete runs and at least 0.80)`),
        rule(mine.length > 0 && !mine.some((r) => r.leak), `no leaks (${mine.filter((r) => r.leak).length} of ${mine.length} runs)`),
        rule(research.length > 0 && research.every((r) => r.firstTool === "research_codebase"), `research_codebase first in every research run (${research.filter((r) => r.firstTool === "research_codebase").length}/${research.length})`),
        `Denied research_codebase attempts by the plain arm: ${mine.filter((r) => r.arm === "clone-tools").reduce((n, r) => n + (r.deniedAttempts ?? 0), 0)}.`);
      return lines.join("\n") + "\n";
    }
    return report({ datasets: datasets.map((dataset) => ({ dataset, floor: readRaw(join(FLOOR_DIR, dataset.id)), runs: readRaw(dirOf(dataset.id)) })), accepted: loadAccepted(), split, arms });
  }

  const pilot = pilotIds(named);
  const tasks: Task[] = command === "pilot"
    ? pilot.map((id) => ({ id, dataset: named.id, split: "dev" as const, question: named.questions.find((q) => q.id === id)!.question }))
    : datasets.flatMap((d) => d.questions.filter((q) => q.split === split).map((q) => ({ id: q.id, dataset: d.id, split, question: q.question })));
  const worst = tasks.length * arms.length;
  const header = `${worst} runs (${tasks.length} questions x ${arms.length} arms); worst case $${(worst * PER_RUN_CAP).toFixed(2)} at the $${PER_RUN_CAP} per-run cap, ledger cap $${SPEND_CAP}.`;
  const launch = (task: Task, arm: Arm, configPath: string, apiKey?: string) => buildCommand(arm, { question: task.question, tree: join(cfg.workDir, "chart-only"), env: process.env, configPath, port: cfg.port, perRunCap: PER_RUN_CAP, apiKey, denyPaths: [cfg.o3Dir, REPO_ROOT] });
  if (listing) {
    return [header, ...tasks.flatMap((t) => arms.map((arm) => { const a = launch(t, arm, "/mcp.json").args; return `${t.dataset}/${t.id} ${arm}: ${a[a.indexOf("--allowedTools") + 1]}`; }))].join("\n") + "\n";
  }

  if (command === "run") {
    if (!pilot.every((id) => arms.every((arm) => hasRaw(dirOf(named.id), arm, id)))) throw new Error(`Run the pilot first: pilot questions need both selected arms (${arms.join(", ")}).`);
    if (readRaw(dirOf(named.id)).some((r) => pilot.includes(r.taskId) && r.leak)) throw new Error("A pilot run leaked; stop and review it before the full runs.");
    if (split === "hidden" && !datasets.every((d) => d.questions.filter((q) => q.split === "dev").every((q) => arms.every((arm) => readRaw(dirOf(d.id)).some((r) => r.arm === arm && r.taskId === q.id && clean(r))))))
      throw new Error("The dev split must be complete and clean (no failed, malformed or leaking runs) before hidden.");
  }
  const key = readKey(cfg.keyFile);
  exportChart(cfg.o3Dir, cfg.workDir);
  console.log(await preflight({ expectedRepos: expectedRepos(), gold: goldPaths(), port: cfg.port, apiKey: key }));
  console.log(header);
  const lineCount = lineCounter(cfg.o3Dir);
  await runTasks(tasks, {
    runsRoot: cfg.runsRoot, arms, concurrency: 3, perRunCap: PER_RUN_CAP, spendCap: SPEND_CAP,
    run: async (task, arm) => {
      const bin = mkdtempSync(join(cfg.workDir, ".run-"));
      try {
        const configPath = join(bin, "mcp.json"), c = launch(task, arm, configPath, key);
        writeFileSync(configPath, c.mcpConfig, { mode: 0o600 });
        return await execute(c, task, arm, PER_RUN_CAP, lineCount, key, [cfg.o3Dir, REPO_ROOT]);
      } finally { rmSync(bin, { recursive: true, force: true }); }
    },
  });
  const done = `Agent spend $${spentSoFar(cfg.runsRoot).toFixed(4)} of $${SPEND_CAP}.\n`;
  return command === "pilot" ? done + await main(["report", "--pilot", ...(armsFlag ? ["--arms", armsFlag] : [])], env) : done + await main(["report", "--split", split], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).then((text) => process.stdout.write(text), (error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
