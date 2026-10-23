import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVAL_DIR, datasetSchema, loadDataset, loadProduct, readRaw, writeRaw, type Raw } from "./data.js";
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
    assert.match(out[0]!, /10 runs.*model sonnet.*cap \$6 across all models\./);
    assert.equal(readRaw(runs).length, 0);
  });
});

test("pilot --list works offline for every arm and model, reading no key and creating nothing; the cap comes from EVAL_SPEND_CAP", async () => {
  await withRuns(async (runs) => {
    for (const model of ["sonnet", "haiku", "claude-haiku-5-5"]) {
      const out = lines(await main(["pilot", "--list", "--model", model, "--arms", "v6-tools,clone-tools,clone-tools-noinstr,clone-research"], env(runs)));
      assert.match(out[0]!, new RegExp(`20 runs \\(5 questions x 4 arms, model ${model.replace("claude-haiku-5-5", "haiku")}\\)`));
      const runLines = out.slice(1);
      assert.equal(runLines.length, 20);
      for (const arm of ["v6-tools", "clone-tools", "clone-tools-noinstr"]) assert.equal(runLines.filter((l) => l.includes(` ${arm}: `) && !l.includes("research_codebase")).length, 5, arm);
      assert.equal(runLines.filter((l) => l.includes(" clone-research: ") && l.includes("mcp__falkon__research_codebase")).length, 5);
    }
    assert.match(await main(["run", "--split", "dev", "--list", "--arms", "v6-tools"], { ...env(runs), EVAL_SPEND_CAP: "2.5" }), /48 runs.*ledger cap \$2\.5/);
    assert.deepEqual(readdirSync(runs), []);
    await assert.rejects(main(["pilot", "--list", "--model", "opus"], env(runs)), /--model/);
    await assert.rejects(main(["pilot", "--list"], { ...env(runs), EVAL_SPEND_CAP: "0" }), /EVAL_SPEND_CAP/);
  });
});

test("runs are stored per model, and Sonnet runs in the earlier layout stay readable as the sonnet set", async () => {
  await withRuns(async (runs) => {
    const d = loadDataset("openmrs-xrepo"), [id] = pilotIds(d);
    writeRaw(join(runs, "openmrs-xrepo"), run(id!, "clone-tools", { firstTool: "grep" }));   // earlier layout
    assert.match(await main(["report", "--pilot", "--arms", "clone-tools"], env(runs)), new RegExp(`${id} clone-tools first=grep`));
    assert.match(await main(["report", "--pilot", "--model", "haiku", "--arms", "clone-tools"], env(runs)), new RegExp(`${id} clone-tools missing`));
    writeRaw(join(runs, "haiku", "openmrs-xrepo"), run(id!, "clone-tools", { firstTool: "glob" }));
    assert.match(await main(["report", "--pilot", "--model", "haiku", "--arms", "clone-tools"], env(runs)), new RegExp(`${id} clone-tools first=glob`));
    assert.match(await main(["report", "--pilot", "--arms", "clone-tools"], env(runs)), new RegExp(`${id} clone-tools first=grep`));
    writeRaw(join(runs, "sonnet", "openmrs-xrepo"), run(id!, "clone-tools", { firstTool: "list_tree" }));   // a per-model directory wins once it exists
    assert.match(await main(["report", "--pilot", "--arms", "clone-tools"], env(runs)), new RegExp(`${id} clone-tools first=list_tree`));
  });
});

test("a non-Sonnet report compares against the v6-tools runs of the same model, with no verdict for v6-tools itself", async () => {
  await withRuns(async (runs) => {
    const text = await main(["report", "--model", "haiku", "--arms", "v6-tools,clone-tools"], env(runs));
    assert.match(text, /Model: haiku \(claude-haiku-5-5\)\. Reference: v6-tools runs of this model/);
    assert.match(text, /clone-tools: withheld/);
    assert.doesNotMatch(text, /v6-tools: withheld/);
    assert.match(await main(["report"], env(runs)), /Reference: the recorded floor[\s\S]*Floor: n 48; recall 0\.9726/);
  });
});

test("the v6-tools arm needs its URL and a key file before anything runs, and says so without echoing the key", async () => {
  await withRuns(async (runs) => {
    await assert.rejects(main(["preflight", "--arms", "v6-tools"], env(runs)), /EVAL_V6_URL/);
    for (const bad of ["ftp://x", "https://user:pw@127.0.0.1/api/mcp", "http://example.com/api/mcp", "http://10.0.0.5/api/mcp"])
      await assert.rejects(main(["preflight", "--arms", "v6-tools"], { ...env(runs), EVAL_V6_URL: bad }), (e: Error) => /EVAL_V6_URL/.test(e.message) && !e.message.includes("pw@"), bad);
    await assert.rejects(main(["preflight", "--arms", "v6-tools"], { ...env(runs), EVAL_V6_URL: "http://127.0.0.1:1/api/mcp" }), /EVAL_V6_KEY_FILE/);
    await assert.rejects(main(["preflight", "--arms", "v6-tools"], { ...env(runs), EVAL_V6_URL: "http://127.0.0.1:1/api/mcp", EVAL_V6_KEY_FILE: join(runs, "nokey") }), /missing/);
  });
});

test("stack takes --instructions off only", async () => {
  await assert.rejects(main(["stack", "up", "--instructions", "on"], {}), /--instructions must be off/);
});

test("stack takes --recipe on only, and not together with --instructions off", async () => {
  await assert.rejects(main(["stack", "up", "--recipe", "off"], {}), /--recipe must be on/);
  await assert.rejects(main(["stack", "up", "--recipe", "on", "--instructions", "off"], {}), /separate stacks/);
  await assert.rejects(main(["stack", "up", "--prs", "on", "--recipe", "on"], {}), /separate stacks/);
  await assert.rejects(main(["stack", "up", "--prs", "off"], {}), /--prs must be on/);
});

test("the impact set: 11 questions, 6 dev and 5 hidden, with 3 to 8 gold spans each, and a pilot of all the dev ones", async () => {
  const d = loadDataset("o3-impact");
  assert.equal(d.questions.length, 11);
  assert.equal(new Set(d.questions.map((q) => q.id)).size, 11);
  assert.equal(d.questions.filter((q) => q.split === "dev").length, 6);
  for (const q of d.questions) {
    assert.ok(q.required.length >= 3 && q.required.length <= 8, q.id);
    assert.deepEqual(q.declarations, q.required, q.id);
    assert.ok(q.declarations!.every((s) => s.endLine >= s.startLine && loadProduct().repositories.some((r) => s.path.startsWith(`${r.name}/`))), q.id);
  }
  assert.deepEqual([...pilotIds(d, 6)].sort(), d.questions.filter((q) => q.split === "dev").map((q) => q.id).sort());
});

test("pilot --dataset impact --list works offline for every arm, including clone-tools-recipe", async () => {
  await withRuns(async (runs) => {
    const out = lines(await main(["pilot", "--dataset", "impact", "--list", "--model", "haiku", "--arms", "clone-tools,clone-tools-recipe"], env(runs)));
    assert.match(out[0]!, /12 runs \(6 questions x 2 arms, model haiku\)/);
    const runLines = out.slice(1);
    assert.equal(runLines.length, 12);
    assert.ok(runLines.every((l) => l.startsWith("o3-impact/impact-") && !l.includes("research_codebase")));
    assert.equal(runLines.filter((l) => l.includes(" clone-tools-recipe: ")).length, 6);
    assert.match(await main(["run", "--dataset", "impact", "--split", "hidden", "--list", "--arms", "clone-tools-recipe"], env(runs)), /5 runs/);
    assert.deepEqual(readdirSync(runs), []);
    await assert.rejects(main(["pilot", "--dataset", "other", "--list"], env(runs)), /--dataset/);
  });
});

test("report --dataset impact --reference clone-tools compares the recipe arm with the plain arm of the same model", async () => {
  await withRuns(async (runs) => {
    const d = loadDataset("o3-impact"), gold = d.questions.find((q) => q.id === "impact-6")!;
    writeRaw(join(runs, "haiku", "o3-impact"), run("impact-6", "clone-tools", { repository: "o3-impact", answer: [] }));
    writeRaw(join(runs, "haiku", "o3-impact"), run("impact-6", "clone-tools-recipe", { repository: "o3-impact", answer: gold.required }));
    const text = await main(["report", "--split", "dev", "--model", "haiku", "--dataset", "impact", "--arms", "clone-tools,clone-tools-recipe", "--reference", "clone-tools"], env(runs));
    assert.match(text, /Reference: clone-tools runs of this model/);
    assert.match(text, /### clone-tools-recipe \(dev\)[\s\S]*Coverage clone-tools-recipe: 1\/6 paired[\s\S]*Recall wins 1, losses 0, ties 0/);
    await assert.rejects(main(["report", "--reference", "nope"], env(runs)), /--reference/);
  });
});

test("report --pilot applies the plain-arm recall floor to the recipe arm too", async () => {
  await withRuns(async (runs) => {
    const out = await main(["report", "--pilot", "--dataset", "impact", "--model", "haiku", "--arms", "clone-tools-recipe"], env(runs));
    assert.match(out, /STOP: recipe-arm pilot recall n\/a/);
    assert.match(out, /o3-impact|impact-\d+ clone-tools-recipe missing/);
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
    const text = await main(["report"], env(runs));
    assert.match(text, /Falkon O3 Ask-quality check \(dev and hidden\)/);
    assert.match(text, /Floor: n 32; recall 0\.9229/);
    assert.match(await main(["report", "--split", "hidden"], env(runs)), /Falkon O3 Ask-quality check \(hidden\)/);
    assert.match(text, /clone-tools: withheld/);
    assert.match(text, /## dev[\s\S]*## hidden[\s\S]*## Pooled verdict/);
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

test("run refuses to start when a pilot stop rule is STOP, before any key, stack or spend", async () => {
  await withRuns(async (runs) => {
    allPilot(runs); // recall 0 on every pilot run
    await assert.rejects(main(["run", "--split", "dev"], env(runs)), /stop rule failed[\s\S]*STOP: plain-arm pilot recall 0\.000/);
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
    assert.match(low, /Denied tool attempts by arms \(research_codebase, list_commits, get_diff, list_branches\): 0\./);
    allPilot(runs, (arm) => arm === "clone-research" ? { firstTool: "grep", leak: true, deniedAttempts: 0 } : { deniedAttempts: 2 });
    const bad = await main(["report", "--pilot"], env(runs));
    assert.match(bad, /STOP: no leaks \(5 of 10/);
    assert.match(bad, /STOP: research_codebase first in every research run \(0\/5\)/);
    assert.match(bad, /list_branches\): 10\./);
    assert.match(bad, /malformed=false/);
  });
});

const o3 = process.env.EVAL_O3_DIR ?? "/Users/aeres/Desktop/projects/falkon/.local/eval";
test("every impact gold span lies inside its file at the pinned commit", { skip: existsSync(join(o3, "openmrs-core")) ? false : "corpus checkouts not present" }, () => {
  const count = lineCounter(o3);
  for (const q of loadDataset("o3-impact").questions) for (const s of q.declarations!) {
    const lines = count(s.path);
    assert.ok(lines !== undefined && s.endLine <= lines, `${q.id} ${s.path}:${s.startLine}-${s.endLine}`);
  }
});

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

test("the question schema takes spans, change units and tickets; unknown shapes are rejected", () => {
  const base = { id: "d", repo: { url: "https://github.com/openmrs/openmrs-core", ref: "main", commit: "a".repeat(40) }, corpus: { include: [], exclude: [] } };
  const q = (required: unknown[]) => ({ ...base, questions: [{ id: "q", question: "Q", vocab: "natural", split: "dev", author: "a", required }] });
  const ok = [{ path: "a/b.ts", startLine: 1, endLine: 2 }, { repo: "openmrs-core", commit: "a".repeat(40), pr: 3 }, { ticket: "TRUNK-1" }];
  assert.equal(datasetSchema.safeParse(q(ok)).success, true);
  for (const bad of [{ repo: "openmrs-core", commit: "abc", pr: 3 }, { repo: "openmrs-core", commit: "a".repeat(40) }, { ticket: "" }, { ticket: "T-1", extra: 1 }]) assert.equal(datasetSchema.safeParse(q([bad])).success, false, JSON.stringify(bad));
});

test("clone-tools-git is a valid arm that lists the git tools; --dataset history without its file says so", async () => {
  await withRuns(async (runs) => {
    const out = await main(["pilot", "--list", "--arms", "clone-tools-git"], env(runs));
    assert.match(out, /clone-tools-git: .*mcp__falkon__list_commits,mcp__falkon__get_diff,mcp__falkon__list_branches/);
    if (!existsSync(join(EVAL_DIR, "datasets/o3-history.json"))) await assert.rejects(main(["pilot", "--dataset", "history", "--list"], env(runs)), /o3-history\.json/);
  });
});
