import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataset, loadProduct, readRaw, writeRaw, type Raw } from "./data.js";
import { existsSync } from "node:fs";
import { lineCounter, main, pilotIds } from "./cli.js";
import { goldPaths } from "./preflight.js";

// Pointing the checkouts at a missing directory proves the listing never touches them (or the network or the model).
const env = (runs: string) => ({ EVAL_RUNS_DIR: runs, EVAL_O3_DIR: "/nonexistent", EVAL_PORT: "1" });
const withRuns = async (fn: (runs: string) => Promise<void>) => { const runs = mkdtempSync(join(tmpdir(), "eval-cli-")); try { await fn(runs); } finally { rmSync(runs, { recursive: true, force: true }); } };
const lines = (text: string) => text.trim().split("\n");

test("the pilot is five dev questions of the named set, covering every relation, in a fixed order", () => {
  const ids = pilotIds(loadDataset("openmrs-xrepo"));
  assert.equal(ids.length, 5);
  assert.deepEqual(ids, pilotIds(loadDataset("openmrs-xrepo")));
  const d = loadDataset("openmrs-xrepo");
  const relations = new Set(ids.map((id) => d.questions.find((q) => q.id === id)!.relation));
  assert.equal(relations.size, new Set(d.questions.map((q) => q.relation)).size);
  assert.ok(ids.every((id) => d.questions.find((q) => q.id === id)!.split === "dev"));
});

test("pilot --list prints each selected question with both arms' allowed tools and spends nothing", async () => {
  await withRuns(async (runs) => {
    const out = lines(await main(["--", "pilot", "--list"], env(runs)));
    const runLines = out.filter((l) => l.includes(": Read(./**)"));
    assert.equal(runLines.length, 10);
    assert.equal(runLines.filter((l) => l.includes(" clone-research: ") && l.includes("mcp__falkon__research_codebase")).length, 5);
    assert.equal(runLines.filter((l) => l.includes(" clone-tools: ") && l.includes("research_codebase")).length, 0);
    assert.match(out[0]!, /10 runs.*cap \$15/);
    assert.equal(readRaw(runs).length, 0);
  });
});

test("run --list covers both datasets and the whole split; hidden needs no clean dev when only listing", async () => {
  await withRuns(async (runs) => {
    assert.match(await main(["run", "--split", "dev", "--list"], env(runs)), /96 runs/);
    assert.match(await main(["run", "--split", "hidden", "--list"], env(runs)), /64 runs/);
    assert.match(await main(["run", "--split", "dev", "--list", "--arms", "clone-tools"], env(runs)), /48 runs/);
  });
});

test("run refuses to start before the pilot is complete, and hidden before dev is complete and clean", async () => {
  await withRuns(async (runs) => {
    await assert.rejects(main(["run", "--split", "dev"], env(runs)), /pilot first/i);
    const d = loadDataset("openmrs-xrepo");
    for (const id of pilotIds(d)) for (const arm of ["clone-tools", "clone-research"]) writeRaw(join(runs, "openmrs-xrepo"), run(id, arm));
    await assert.rejects(main(["run", "--split", "hidden"], env(runs)), /dev split.*complete and clean/i);
  });
});

const run = (id: string, arm: string, extra: Partial<Raw> = {}): Raw => ({ taskId: id, repository: "openmrs-xrepo", split: "dev", arm, answer: [], malformed: false, is_error: false, total_cost_usd: 0.04, usage: {}, num_turns: 1, wallClockMs: 1, leak: false, ...extra });

test("report prints the floor comparison from stored runs and writes nothing", async () => {
  await withRuns(async (runs) => {
    const text = await main(["report", "--split", "hidden"], env(runs));
    assert.match(text, /Falkon O3 Ask-quality check \(hidden\)/);
    assert.match(text, /Floor: n 32; recall 0\.9229/);
    assert.match(text, /clone-tools: withheld/);
    assert.equal(readdirSync(runs).length, 0);
  });
});

test("report --pilot lists each pilot run's first tool, tools used, recall and cost", async () => {
  await withRuns(async (runs) => {
    const d = loadDataset("openmrs-xrepo"), [id] = pilotIds(d);
    writeRaw(join(runs, "openmrs-xrepo"), run(id!, "clone-research", { firstTool: "research_codebase", toolCalls: { research_codebase: 1, grep: 2 } }));
    const out = await main(["report", "--pilot"], env(runs));
    assert.match(out, new RegExp(`${id} clone-research first=research_codebase tools=research_codebase:1,grep:2 recall=0\\.00 cost=0\\.0400 leak=false`));
    assert.match(out, new RegExp(`${id} clone-tools missing`));
  });
});

test("unknown commands and bad flags are refused", async () => {
  await assert.rejects(main(["nope"], {}), /Usage/);
  await assert.rejects(main(["pilot", "--arms", "x", "--list"], {}), /--arms/);
  await assert.rejects(main(["run", "--split", "x", "--list"], {}), /--split/);
});

const allPilot = (runs: string, extra: (arm: string) => Partial<Raw> = () => ({})) => {
  for (const id of pilotIds(loadDataset("openmrs-xrepo"))) for (const arm of ["clone-tools", "clone-research"]) writeRaw(join(runs, "openmrs-xrepo"), run(id, arm, { firstTool: arm === "clone-research" ? "research_codebase" : "grep", ...extra(arm) }));
};

test("run refuses to start when a pilot run leaked", async () => {
  await withRuns(async (runs) => {
    allPilot(runs);
    writeRaw(join(runs, "openmrs-xrepo"), run(pilotIds(loadDataset("openmrs-xrepo"))[0]!, "clone-tools", { leak: true }));
    await assert.rejects(main(["run", "--split", "dev"], env(runs)), /pilot run leaked/i);
  });
});

test("report --pilot prints the stop rules as PASS or STOP lines", async () => {
  await withRuns(async (runs) => {
    const empty = await main(["report", "--pilot"], env(runs));
    assert.match(empty, /STOP: plain-arm pilot recall n\/a/);
    allPilot(runs);
    const low = await main(["report", "--pilot"], env(runs));
    assert.match(low, /STOP: plain-arm pilot recall 0\.000/);
    assert.match(low, /PASS: no leaks \(0 of 10 runs\)/);
    assert.match(low, /PASS: research_codebase first in every research run \(5\/5\)/);
    assert.match(low, /Denied research_codebase attempts by the plain arm: 0\./);
    allPilot(runs, (arm) => arm === "clone-research" ? { firstTool: "grep", leak: true, deniedAttempts: 0 } : { deniedAttempts: 2 });
    const bad = await main(["report", "--pilot"], env(runs));
    assert.match(bad, /STOP: no leaks \(5 of 10/);
    assert.match(bad, /STOP: research_codebase first in every research run \(0\/5\)/);
    assert.match(bad, /attempts by the plain arm: 10\./);
    assert.match(bad, /malformed=false/);
  });
});

const o3 = process.env.EVAL_O3_DIR ?? "/Users/aeres/Desktop/projects/falkon/.local/eval";
test("line counts come from the pinned commit and cover all 104 gold files", { skip: existsSync(join(o3, "openmrs-core")) ? false : "corpus checkouts not present" }, () => {
  const count = lineCounter(o3);
  const gold = goldPaths();
  assert.equal(gold.length, 104);
  const missing = gold.filter((p) => !count(p));
  assert.deepEqual(missing, []);
  // Parity with the checkouts' working trees, which the reference runs were validated against.
  const product = new Map(loadProduct().repositories.map((r) => [r.name, r.checkout]));
  for (const p of gold) {
    const [name, ...rest] = p.split("/");
    const lines = readFileSync(join(o3, product.get(name!)!, ...rest), "utf8").split("\n");
    if (lines.at(-1) === "") lines.pop();
    assert.equal(count(p), lines.length, p);
  }
  assert.equal(count("openmrs-core/../openmrs-esm-core/package.json"), undefined);
  assert.equal(count("openmrs-core"), undefined);
  assert.equal(count("openmrs-core/api"), undefined);
  assert.equal(count("nonexistent/x.ts"), undefined);
});
