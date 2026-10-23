/**
 * Falkon O3 Ask-quality check (regression gate item 3, rule D25).
 *
 *   pnpm eval -- pilot [--list] [--arms a,b]        5 dev questions of the named set
 *   pnpm eval -- run --split dev|hidden [--list]    both datasets; needs the pilot, hidden needs clean dev
 *   pnpm eval -- report [--split dev|hidden]        from stored runs (spends nothing): per-split tables, and without --split the pooled
 *                                                   dev+hidden verdict: PASS when the lower 95% bootstrap bound of the paired recall
 *                                                   difference vs the reference is at least -0.10, losses are at most 2 x wins, and no run
 *                                                   failed, was malformed or leaked; else FAIL, or withheld when coverage is incomplete
 *   pnpm eval -- report --pilot                     one line per pilot run, and the stop rules
 *   pnpm eval -- stack up|down [-v] [--instructions off]   the clone stack over the 42 checkouts (Docker, 127.0.0.1:EVAL_PORT);
 *                                                   --instructions off: project falkon-eval-noinstr on EVAL_NOINSTR_PORT with MCP_INSTRUCTIONS=off
 *   pnpm eval -- preflight [--arms ...]             42 repositories and 104 gold paths readable through each selected arm's server; refuses a shallow checkout
 *   pnpm eval -- corpus deepen                      git fetch --unshallow per checkout (complete ones are left as they are), then HEAD must equal its pin.
 *                                                   After deepening, run `stack down -v` then `stack up`: existing bare clones keep the old depth.
 *
 * Options for pilot, run and report: --model sonnet|haiku (or the full id; default sonnet), --arms from
 * clone-tools,clone-research,v6-tools,clone-tools-noinstr,clone-tools-recipe,clone-tools-git (default clone-tools,clone-research). Runs are stored per model under
 * <runs dir>/<model alias>/; Sonnet runs in the earlier layout (datasets directly under the runs dir) are still read.
 * The reference is the recorded Sonnet floor for sonnet, and the v6-tools runs of the model's own directory otherwise.
 *
 * Impact-and-change set (S25): --dataset impact selects o3-impact (11 questions, its pilot is the 6 dev ones) instead of the two O3 sets;
 * arm clone-tools-recipe talks to a second stack (`stack up --recipe on`: project falkon-eval-recipe on EVAL_RECIPE_PORT with MCP_IMPACT_RECIPE=on);
 * `report --reference clone-tools` compares the arms against that arm's runs of the same model instead of the recorded floor or v6-tools.
 *
 * Commit-history set (S43): --dataset history selects o3-history, whose answers cite spans, commits, pull requests and tickets; arm clone-tools-git
 * (the clone stack, plus list_commits, get_diff and list_branches) is meant for it.
 *
 * Environment: EVAL_O3_DIR (corpus checkouts), EVAL_PORT (3400), EVAL_NOINSTR_PORT (3401), EVAL_RECIPE_PORT (3402), EVAL_RUNS_DIR, EVAL_WORK_DIR,
 * EVAL_API_KEY_FILE (optional key file for the clone stacks), EVAL_SPEND_CAP (agent spend ledger per model directory, default 6),
 * EVAL_V6_URL (the v6-tools arm's MCP endpoint, e.g. http://127.0.0.1:3000/api/mcp) and EVAL_V6_KEY_FILE (its key, a mode 600 file).
 * Start the stack with `pnpm eval -- stack up`; its state lives under tests/eval/.local (ignored).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ALL_ARMS, ARMS, DATASETS, EVAL_DIR, HISTORY_DATASETS, IMPACT_DATASETS, FLOOR_DIR, REPO_ROOT, hasRaw, goldOf, loadAccepted, loadDataset, loadProduct, modelDir, readRaw, resolveModel, type Arm, type Dataset, type Raw } from "./data.js";
import { buildCommand } from "./harness.js";
import { assertFullHistory, deepenCheckouts, expectedRepos, goldPaths, preflight, readKey } from "./preflight.js";
import { report } from "./report.js";
import { execute, runTasks, spentSoFar, type Task } from "./runner.js";
import { scoreAnswer } from "./score.js";
import { stack } from "./stack.js";

const PER_RUN_CAP = 1;
const hash = (id: string) => createHash("sha256").update("eval|" + id).digest("hex");

/** `count` (default five) dev questions of a set: the first of each relation in a fixed hash order, then the next in that order. */
export function pilotIds(dataset: Dataset, count = 5): string[] {
  const dev = dataset.questions.filter((q) => q.split === "dev").sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  const first = [...new Map(dev.map((q) => [q.relation, q.id])).values()];
  return [...first, ...dev.map((q) => q.id).filter((id) => !first.includes(id))].slice(0, count);
}

const config = (env: NodeJS.ProcessEnv) => ({
  o3Dir: resolve(env.EVAL_O3_DIR ?? "/Users/aeres/Desktop/projects/falkon/.local/eval"),
  port: Number(env.EVAL_PORT ?? 3400),
  noinstrPort: Number(env.EVAL_NOINSTR_PORT ?? 3401),
  recipePort: Number(env.EVAL_RECIPE_PORT ?? 3402),
  spendCap: Number(env.EVAL_SPEND_CAP ?? 6),
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

type Backend = { id: string; url: string; key?: string; kind: "clone" | "v6"; instructions?: boolean };
/** The server an arm talks to; the v6 instance is configured only by EVAL_V6_URL and EVAL_V6_KEY_FILE, never by argv. Reads a key file, so it is not used when listing. */
function backendOf(arm: Arm, cfg: ReturnType<typeof config>, env: NodeJS.ProcessEnv): Backend {
  const local = (port: number) => `http://127.0.0.1:${port}/api/mcp`;
  if (arm === "clone-tools-noinstr") return { id: "noinstr", url: local(cfg.noinstrPort), key: readKey(cfg.keyFile), kind: "clone", instructions: false };
  if (arm === "clone-tools-recipe") return { id: "recipe", url: local(cfg.recipePort), key: readKey(cfg.keyFile), kind: "clone", instructions: true };
  if (arm !== "v6-tools") return { id: "clone", url: local(cfg.port), key: readKey(cfg.keyFile), kind: "clone", instructions: true };
  let url: URL | undefined;
  try { url = new URL(env.EVAL_V6_URL ?? ""); } catch { /* reported below */ }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url?.hostname ?? "");
  if (!url || url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error("The v6-tools arm needs EVAL_V6_URL, the instance's MCP endpoint without credentials, over https or on a loopback host, for example http://127.0.0.1:3000/api/mcp.");
  if (!env.EVAL_V6_KEY_FILE) throw new Error("The v6-tools arm needs EVAL_V6_KEY_FILE, a mode 600 file holding the instance's API key.");
  return { id: "v6", url: url.href, key: readKey(env.EVAL_V6_KEY_FILE), kind: "v6" };
}

const flagValue = (args: string[], flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const clean = (r: { is_error: boolean; malformed: boolean; leak?: boolean }) => !r.is_error && !r.malformed && !r.leak;

/** One line per pilot run, then the stop rules; `stop` is true when any rule is STOP. */
function pilotReport(named: Dataset, stored: Raw[], arms: Arm[], alias: string, ids: string[]): { lines: string[]; stop: boolean } {
  const recalls: Record<string, number[]> = {};
  const lines = ids.flatMap((id) => arms.map((arm) => {
    const run = stored.find((r) => r.taskId === id && r.arm === arm);
    if (!run) return `${id} ${arm} missing`;
    const q = named.questions.find((x) => x.id === id)!;
    const recall = scoreAnswer(goldOf(q), run.is_error ? [] : run.answer, run.malformed).recall;
    (recalls[arm] ??= []).push(recall);
    const tools = Object.entries(run.toolCalls ?? {}).map(([k, v]) => `${k}:${v}`).join(",") || "none";
    return `${id} ${arm} first=${run.firstTool ?? "none"} tools=${tools} recall=${recall.toFixed(2)} cost=${run.total_cost_usd.toFixed(4)} leak=${!!run.leak} denied=${run.deniedAttempts ?? 0} malformed=${run.malformed}`;
  }));
  const mine = stored.filter((r) => ids.includes(r.taskId) && arms.includes(r.arm as Arm));
  const research = mine.filter((r) => r.arm === "clone-research"), plain = recalls["clone-tools"] ?? [], v6 = recalls["v6-tools"] ?? [], recipe = recalls["clone-tools-recipe"] ?? [];
  const meanOf = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  const meanPlain = meanOf(plain), meanV6 = meanOf(v6), meanRecipe = meanOf(recipe), plainMin = alias === "haiku" ? 0.7 : 0.8;
  const rules: string[] = [];
  const rule = (ok: boolean, text: string) => rules.push(`${ok ? "PASS" : "STOP"}: ${text}`);
  const shown = (n: number) => Number.isNaN(n) ? "n/a" : n.toFixed(3);
  // The history set expects the plain arm to score low (D100 asks for a gradient above it), so the plain-arm minimum applies to the other sets only.
  const history = named.id === "o3-history";
  if (arms.includes("clone-tools") && !history) rule(plain.length === ids.length && meanPlain >= plainMin, `plain-arm pilot recall ${shown(meanPlain)} (needs complete runs and at least ${plainMin.toFixed(2)})`);
  if (arms.includes("clone-tools-recipe") && !history) rule(recipe.length === ids.length && meanRecipe >= plainMin, `recipe-arm pilot recall ${shown(meanRecipe)} (needs complete runs and at least ${plainMin.toFixed(2)})`);
  if (arms.includes("v6-tools")) rule(v6.length === ids.length && meanV6 >= 0.5, `v6-tools pilot recall ${shown(meanV6)} (needs complete runs and at least 0.50; a reference near zero shows nothing)`);
  rule(mine.length > 0 && !mine.some((r) => r.leak), `no leaks (${mine.filter((r) => r.leak).length} of ${mine.length} runs)`);
  if (arms.includes("clone-research")) rule(research.length > 0 && research.every((r) => r.firstTool === "research_codebase"), `research_codebase first in every research run (${research.filter((r) => r.firstTool === "research_codebase").length}/${research.length})`);
  lines.push("", `Stop rules (spec S5, model ${alias}):`, ...rules, `Denied tool attempts by arms (research_codebase, list_commits, get_diff, list_branches): ${mine.reduce((n, r) => n + (r.deniedAttempts ?? 0), 0)}.`);
  return { lines, stop: rules.some((r) => r.startsWith("STOP")) };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const args = argv.filter((a, i) => !(a === "--" && i < 2)); // pnpm may pass a leading "--"
  const command = args[0], cfg = config(env), listing = args.includes("--list");
  if (!["pilot", "run", "report", "preflight", "stack", "corpus"].includes(command ?? "")) throw new Error("Usage: pnpm eval -- pilot|run|report|preflight|stack|corpus deepen [--split dev|hidden] [--model sonnet|haiku] [--arms clone-tools,clone-research,v6-tools,clone-tools-noinstr,clone-tools-recipe,clone-tools-git] [--dataset impact|history] [--reference arm] [--list] [--pilot] [--instructions off] [--recipe on]");
  const splitFlag = flagValue(args, "--split");
  if (splitFlag && !["dev", "hidden"].includes(splitFlag)) throw new Error("--split must be dev or hidden");
  const split = (splitFlag ?? "dev") as "dev" | "hidden";
  if (!(cfg.spendCap > 0) || !Number.isFinite(cfg.spendCap)) throw new Error("EVAL_SPEND_CAP must be a positive number of dollars.");
  const model = resolveModel(flagValue(args, "--model"));
  if (command === "corpus") {
    if (args[1] !== "deepen") throw new Error("Usage: pnpm eval -- corpus deepen");
    return deepenCheckouts(cfg.o3Dir) + "\n";
  }
  if (command === "stack") {
    const instructions = flagValue(args, "--instructions"), recipe = flagValue(args, "--recipe");
    if (instructions && instructions !== "off") throw new Error("--instructions must be off (the default stack keeps the instructions on).");
    if (recipe && recipe !== "on") throw new Error("--recipe must be on (the default stack serves no recipe).");
    if (instructions && recipe) throw new Error("--instructions off and --recipe on are separate stacks; pass one.");
    const extra = args.slice(2).filter((a, i, all) => !["--instructions", "--recipe"].includes(a) && !["--instructions", "--recipe"].includes(all[i - 1]!));
    const base = { o3Dir: cfg.o3Dir, repoRoot: REPO_ROOT };
    if (recipe) return stack(args[1] ?? "", extra, { ...base, port: cfg.recipePort, project: "falkon-eval-recipe", recipe: "on", stateDir: resolve(env.EVAL_RECIPE_STATE_DIR ?? join(EVAL_DIR, ".local/stack-recipe")) });
    return instructions
      ? stack(args[1] ?? "", extra, { ...base, port: cfg.noinstrPort, project: "falkon-eval-noinstr", instructions: "off", stateDir: resolve(env.EVAL_NOINSTR_STATE_DIR ?? join(EVAL_DIR, ".local/stack-noinstr")) })
      : stack(args[1] ?? "", extra, { ...base, port: cfg.port, project: env.EVAL_COMPOSE_PROJECT ?? "falkon-eval", stateDir: resolve(env.EVAL_STATE_DIR ?? join(EVAL_DIR, ".local/stack")) });
  }
  const datasetFlag = flagValue(args, "--dataset");
  if (datasetFlag && !["impact", "history"].includes(datasetFlag)) throw new Error("--dataset must be impact or history (the default is the two O3 sets).");
  const ids = datasetFlag === "history" ? HISTORY_DATASETS : datasetFlag ? IMPACT_DATASETS : DATASETS;
  if (datasetFlag === "history" && !existsSync(join(EVAL_DIR, "datasets", `${HISTORY_DATASETS[0]}.json`))) throw new Error("--dataset history needs tests/eval/datasets/o3-history.json, which is not in this checkout yet.");
  const datasets = ids.map(loadDataset), named = datasets[0]!;
  const runsDir = modelDir(cfg.runsRoot, model.alias), dirOf = (d: string) => join(runsDir, d);
  // Without --arms: the two clone arms, plus any other arm that already has stored runs (so a report shows everything run).
  const armsFlag = flagValue(args, "--arms"), stored = ids.flatMap((d) => readRaw(dirOf(d)));
  const arms = (armsFlag ? armsFlag.split(",") : ALL_ARMS.filter((a) => ARMS.includes(a) || (command === "report" && stored.some((r) => r.arm === a)))) as Arm[];
  if (arms.some((a) => !ALL_ARMS.includes(a)) || new Set(arms).size !== arms.length) throw new Error(`--arms must be a comma-separated list of ${ALL_ARMS.join(",")}`);

  if (command === "preflight") return await preflightArms(arms, cfg, env, ids) + "\n";

  // The impact set is small (11 questions), so its pilot is the whole dev split.
  const pilot = pilotIds(named, datasetFlag ? 6 : 5);
  if (command === "report") {
    if (args.includes("--pilot")) {
      const { lines } = pilotReport(named, readRaw(dirOf(named.id)), arms, model.alias, pilot);
      return lines.join("\n") + "\n";
    }
    const referenceFlag = flagValue(args, "--reference");
    if (referenceFlag && !ALL_ARMS.includes(referenceFlag as Arm)) throw new Error(`--reference must be one of ${ALL_ARMS.join(",")}`);
    const referenceArm = (referenceFlag as Arm | undefined) ?? (model.alias === "sonnet" ? undefined : "v6-tools" as const);
    return report({
      datasets: datasets.map((dataset) => {
        const runs = readRaw(dirOf(dataset.id));
        return { dataset, floor: referenceArm ? runs.filter((r) => r.arm === referenceArm) : readRaw(join(FLOOR_DIR, dataset.id)), runs };
      }),
      accepted: loadAccepted(), split: splitFlag as "dev" | "hidden" | undefined, arms, model: `${model.alias} (${model.id})`, referenceArm,
    });
  }

  const tasks: Task[] = command === "pilot"
    ? pilot.map((id) => ({ id, dataset: named.id, split: "dev" as const, question: named.questions.find((q) => q.id === id)!.question }))
    : datasets.flatMap((d) => d.questions.filter((q) => q.split === split).map((q) => ({ id: q.id, dataset: d.id, split, question: q.question })));
  const worst = tasks.length * arms.length;
  const header = `${worst} runs (${tasks.length} questions x ${arms.length} arms, model ${model.alias}); worst case $${(worst * PER_RUN_CAP).toFixed(2)} at the $${PER_RUN_CAP} per-run cap, ledger cap $${cfg.spendCap} across all models.`;
  const launch = (task: Task, arm: Arm, configPath: string, backend?: Backend) => buildCommand(arm, { question: task.question, tree: join(cfg.workDir, "chart-only"), env: process.env, configPath, url: backend?.url ?? "", model: model.id, perRunCap: PER_RUN_CAP, apiKey: backend?.key, denyPaths: [cfg.o3Dir, REPO_ROOT], history: datasetFlag === "history" });
  if (listing) {
    return [header, ...tasks.flatMap((t) => arms.map((arm) => { const a = launch(t, arm, "/mcp.json").args; return `${t.dataset}/${t.id} ${arm}: ${a[a.indexOf("--allowedTools") + 1]}`; }))].join("\n") + "\n";
  }

  if (command === "run") {
    if (!pilot.every((id) => arms.every((arm) => hasRaw(dirOf(named.id), arm, id)))) throw new Error(`Run the pilot first: pilot questions need every selected arm (${arms.join(", ")}).`);
    if (readRaw(dirOf(named.id)).some((r) => pilot.includes(r.taskId) && r.leak)) throw new Error("A pilot run leaked; stop and review it before the full runs.");
    if (split === "hidden" && !datasets.every((d) => d.questions.filter((q) => q.split === "dev").every((q) => arms.every((arm) => readRaw(dirOf(d.id)).some((r) => r.arm === arm && r.taskId === q.id && clean(r))))))
      throw new Error("The dev split must be complete and clean (no failed, malformed or leaking runs) before hidden.");
    const rules = pilotReport(named, readRaw(dirOf(named.id)), arms, model.alias, pilot);
    if (rules.stop) throw new Error(`A pilot stop rule failed; review before spending:\n${rules.lines.filter((l) => l.startsWith("STOP")).join("\n")}`);
  }
  const backends = new Map(arms.map((arm) => [arm, backendOf(arm, cfg, env)]));
  exportChart(cfg.o3Dir, cfg.workDir);
  console.log(await preflightArms(arms, cfg, env, ids));
  console.log(header);
  const lineCount = lineCounter(cfg.o3Dir), ledger = join(cfg.runsRoot, "ledger.jsonl");
  await runTasks(tasks, {
    runsRoot: runsDir, ledger, arms, concurrency: 3, perRunCap: PER_RUN_CAP, spendCap: cfg.spendCap,
    run: async (task, arm) => {
      const bin = mkdtempSync(join(cfg.workDir, ".run-")), backend = backends.get(arm)!;
      try {
        const configPath = join(bin, "mcp.json"), c = launch(task, arm, configPath, backend);
        writeFileSync(configPath, c.mcpConfig, { mode: 0o600 });
        return await execute(c, task, arm, PER_RUN_CAP, lineCount, backend.key, [cfg.o3Dir, REPO_ROOT]);
      } finally { rmSync(bin, { recursive: true, force: true }); }
    },
  });
  const done = `Agent spend $${spentSoFar(ledger).toFixed(4)} of $${cfg.spendCap} (all models, ${ledger}).\n`;
  const modelArgs = ["--model", model.alias, ...(armsFlag ? ["--arms", armsFlag] : []), ...(datasetFlag ? ["--dataset", datasetFlag] : []), ...(flagValue(args, "--reference") ? ["--reference", flagValue(args, "--reference")!] : [])];
  return command === "pilot" ? done + await main(["report", "--pilot", ...modelArgs], env) : done + await main(["report", "--split", split, ...modelArgs], env);
}

/** One preflight per distinct server among the arms, each with its own URL and key. */
async function preflightArms(arms: Arm[], cfg: ReturnType<typeof config>, env: NodeJS.ProcessEnv, datasetIds: readonly string[]): Promise<string> {
  assertFullHistory(cfg.o3Dir);
  const servers = new Map(arms.map((arm) => backendOf(arm, cfg, env)).map((b) => [b.id, b]));
  const out: string[] = [];
  for (const b of servers.values()) out.push(`${b.id} (${new URL(b.url).host}): ${await preflight({ expectedRepos: expectedRepos(), gold: goldPaths(datasetIds), url: b.url, apiKey: b.key, kind: b.kind, instructions: b.instructions })}`);
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).then((text) => process.stdout.write(text), (error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
