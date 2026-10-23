import assert from "node:assert/strict";
import { test } from "node:test";
import { DATASETS, FLOOR_DIR, datasetSchema, loadAccepted, loadDataset, readRaw, type Arm, type Raw } from "./data.js";
import { d25, report, type ReportInput } from "./report.js";
import { scoreAnswer } from "./score.js";
import { join } from "node:path";

const accepted = loadAccepted();
const floorInput = (): ReportInput["datasets"] => DATASETS.map((id) => ({ dataset: loadDataset(id), floor: readRaw(join(FLOOR_DIR, id)), runs: [] as Raw[] }));

// A clone run that returns exactly the answer the floor gave (or its gold, or nothing) for each question.
const cloneRuns = (datasets: ReportInput["datasets"], arm: string, pick: (q: { declarations?: Raw["answer"] }, floor: Raw) => Raw["answer"], cost = 0.03): void => {
  for (const d of datasets) d.runs.push(...d.floor.map((f) => ({ ...f, arm, answer: pick(d.dataset.questions.find((q) => q.id === f.taskId)!, f), total_cost_usd: cost, leak: false, toolCalls: { grep: 1 }, firstTool: arm === "clone-research" ? "research_codebase" : "grep" })));
};

test("the recorded floor reproduces: dev 0.973 and hidden 0.923 mean recall", () => {
  const floor = floorInput();
  for (const [split, expected] of [["dev", 0.973], ["hidden", 0.923]] as const) {
    const recalls = floor.flatMap((d) => d.dataset.questions.filter((q) => q.split === split).map((q) => {
      const run = d.floor.find((r) => r.taskId === q.id)!;
      return scoreAnswer(q.declarations ?? [], run.is_error ? [] : run.answer, run.malformed, accepted[q.id]).recall;
    }));
    assert.equal(Math.round(1000 * recalls.reduce((a, b) => a + b, 0) / recalls.length) / 1000, expected, split);
    assert.equal(recalls.length, split === "dev" ? 48 : 32);
  }
});

const dev = (input: ReportInput["datasets"], arms: Arm[] = ["clone-tools"]) => report({ datasets: input, accepted, split: "dev", arms });
const pooled = (input: ReportInput["datasets"], arms: Arm[] = ["clone-tools"], extra: Partial<ReportInput> = {}) => report({ datasets: input, accepted, arms, ...extra });

test("a per-split report keeps the recall, precision and cost table and the win, loss and tie counts, with no verdict", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  const text = dev(input);
  assert.match(text, /Floor: n 48; recall 0\.9726/);
  assert.match(text, /\| recall \| 0\.9726 \| 0\.9726 \| 48 \| 0\.0000 \[0\.0000, 0\.0000\]/);
  assert.match(text, /Recall wins 0, losses 0, ties 48 against the reference\./);
  assert.match(text, /Coverage clone-tools: 48\/48 paired; failed 0; malformed 0; leaks 0\./);
  assert.doesNotMatch(text, /PASS|FAIL|withheld/);
});

test("the pooled verdict passes a tie over all 80 questions, and prints mean, interval, wins, losses and ties", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  const text = pooled(input);
  assert.match(text, /clone-tools: PASS\. n 80; recall difference 0\.0000 \[0\.0000, 0\.0000\]; wins 0, losses 0, ties 80\./);
  assert.match(text, /## dev[\s\S]*## hidden[\s\S]*## Pooled verdict/);
});

test("an arm that answers nothing fails the pooled verdict, and a missing run withholds it", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", () => []);
  assert.match(pooled(input), /clone-tools: FAIL\. n 80; recall difference -0\.9\d+/);
  input[0]!.runs.pop();
  assert.match(pooled(input), /clone-tools: withheld/);
});

test("any failed, malformed or leaked run withholds the verdict even when recall is a tie", () => {
  for (const bad of [{ is_error: true }, { malformed: true }, { leak: true }] as Partial<Raw>[]) {
    const input = floorInput();
    cloneRuns(input, "clone-tools", (_q, f) => f.answer);
    Object.assign(input[1]!.runs[0]!, bad);
    assert.match(pooled(input), /clone-tools: withheld/, JSON.stringify(bad));
  }
});

test("a failed, malformed or leaked reference run withholds every verdict, and the reference counts are printed", () => {
  for (const bad of [{ is_error: true }, { malformed: true }, { leak: true }] as Partial<Raw>[]) {
    const input = floorInput();
    cloneRuns(input, "clone-tools", (_q, f) => f.answer);
    // The arm answers exactly what the (broken) reference run answered, so the tie would otherwise pass.
    Object.assign(input[1]!.floor[0]!, bad);
    const text = pooled(input);
    assert.match(text, /clone-tools: withheld/, JSON.stringify(bad));
    assert.match(text, /Reference: n 80, failed \d+, malformed \d+, leaks \d+\./);
  }
  const clean = pooled((() => { const i = floorInput(); cloneRuns(i, "clone-tools", (_q, f) => f.answer); return i; })());
  assert.match(clean, /Reference: n 80, failed 0, malformed 0, leaks 0\./);
  assert.match(clean, /clone-tools: PASS/);
});

test("D25: a synthetic tie passes at n=80, a 0.15 drop fails, three times as many losses as wins fails", () => {
  const tie = d25(Array(80).fill(0));
  assert.deepEqual([tie.pass, tie.wins, tie.losses, tie.ties, tie.mean, tie.lo], [true, 0, 0, 80, 0, 0]);
  const drop = d25(Array(80).fill(-0.15));
  assert.equal(drop.pass, false);
  assert.ok(drop.lo < -0.10);
  // 4 small wins and 12 small losses: the interval is nowhere near -0.10, so only the loss ratio fails it.
  const skew = d25([...Array(4).fill(0.05), ...Array(12).fill(-0.02), ...Array(64).fill(0)]);
  assert.ok(skew.lo > -0.10);
  assert.deepEqual([skew.wins, skew.losses, skew.ties, skew.pass], [4, 12, 64, false]);
  // Exactly twice as many losses as wins is allowed; a difference of 0.001 or less is a tie.
  const edge = d25([0.05, 0.05, -0.02, -0.02, -0.02, -0.02, 0.001, -0.001, ...Array(72).fill(0)]);
  assert.deepEqual([edge.wins, edge.losses, edge.ties, edge.pass], [2, 4, 74, true]);
});

test("the reference arm's own runs are the floor for another model, and it gets no verdict itself", () => {
  const input = floorInput();
  for (const d of input) { d.runs.push(...d.floor.map((f) => ({ ...f, arm: "v6-tools" }))); d.floor = d.runs.filter((r) => r.arm === "v6-tools"); }
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  const text = pooled(input, ["v6-tools", "clone-tools"], { model: "haiku", referenceArm: "v6-tools" });
  assert.match(text, /Model: haiku\. Reference: v6-tools runs of this model/);
  assert.match(text, /clone-tools: PASS/);
  assert.doesNotMatch(text, /v6-tools: (PASS|FAIL|withheld)/);
  for (const d of input) d.floor = [];
  assert.match(pooled(input, ["clone-tools"], { referenceArm: "v6-tools" }), /clone-tools: withheld/);
});

test("the research arm reports how often research_codebase came first", () => {
  const input = floorInput();
  cloneRuns(input, "clone-research", (_q, f) => f.answer);
  input[0]!.runs[0]!.firstTool = "grep";
  assert.match(dev(input, ["clone-research"]), /research_codebase first in 47\/48 runs/);
});

test("the report shows the plain arm's denied research_codebase attempts and malformed count", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  input[0]!.runs[0]!.deniedAttempts = 3; input[0]!.runs[1]!.malformed = true;
  const text = dev(input);
  assert.match(text, /malformed 1; leaks 0\./);
  assert.match(text, /Denied tool attempts \(research_codebase, list_commits, get_diff, list_branches\): 3\./);
});

test("a history run scores commits, PRs and tickets against typed gold, with accepted extras for precision", () => {
  const sha = "a".repeat(40);
  const dataset = datasetSchema.parse({
    id: "hist", repo: { url: "https://github.com/openmrs/openmrs-core", ref: "main", commit: sha }, corpus: { include: [], exclude: [] },
    questions: [{ id: "h1", question: "Q", vocab: "natural", split: "dev", author: "a", required: [{ repo: "openmrs-core", commit: sha, pr: 7 }, { ticket: "TRUNK-1" }] }],
  });
  const raw = (arm: string, answer: Raw["answer"]): Raw => ({ taskId: "h1", repository: "hist", arm, answer, malformed: false, is_error: false, total_cost_usd: 0.1, usage: {}, num_turns: 1, wallClockMs: 1 });
  const floor = [raw("v6-tools", [])], runs = [...floor, raw("clone-tools-git", [{ repo: "openmrs-core", commit: "aaaaaaa" }, { repo: "openmrs-core", pr: 7 }, { ticket: "trunk-1" }, { ticket: "TRUNK-9" }])];
  const text = report({ datasets: [{ dataset, floor, runs }], accepted: { h1: [{ ticket: "TRUNK-9" }] }, split: "dev", arms: ["v6-tools", "clone-tools-git"], referenceArm: "v6-tools" });
  assert.match(text, /\| recall \| 1\.0000 \| 0\.0000 \| 1 \|/);
  assert.match(text, /\| precision \| 1\.0000 \| 0\.0000 \| 1 \|/);
});

test("the report shows tool calls per tool and recall and precision per history question kind, and accepts clone-tools-git-prs against clone-tools-git", () => {
  const sha = "a".repeat(40), q = (id: string, ticket: string) => ({ id, question: "Q", vocab: "natural", split: "dev", author: "a", required: [{ ticket }] });
  const dataset = datasetSchema.parse({ id: "hist", repo: { url: "https://github.com/openmrs/openmrs-core", ref: "main", commit: sha }, corpus: { include: [], exclude: [] }, questions: [q("hist-a-01", "T-1"), q("hist-b-01", "T-2")] });
  const raw = (arm: string, taskId: string, answer: Raw["answer"], toolCalls: Record<string, number>): Raw => ({ taskId, repository: "hist", arm, answer, malformed: false, is_error: false, total_cost_usd: 0.1, usage: {}, num_turns: 1, wallClockMs: 1, toolCalls });
  const floor = [raw("clone-tools-git", "hist-a-01", [], { grep: 1 }), raw("clone-tools-git", "hist-b-01", [], {})];
  const runs = [...floor, raw("clone-tools-git-prs", "hist-a-01", [{ ticket: "T-1" }], { grep: 2, get_pull_request: 3 }), raw("clone-tools-git-prs", "hist-b-01", [], { get_pull_request: 1, get_provenance: 2 })];
  const text = report({ datasets: [{ dataset, floor, runs }], accepted: {}, split: "dev", arms: ["clone-tools-git", "clone-tools-git-prs"], referenceArm: "clone-tools-git" });
  assert.match(text, /### clone-tools-git-prs \(dev\)[\s\S]*Tool calls clone-tools-git-prs: get_provenance 2, get_pull_request 4, grep 2\./);
  assert.match(text, /Kind why \(n 1\): recall 1\.0000; precision 1\.0000\./);
  assert.match(text, /Kind what-when \(n 1\): recall 0\.0000/);
  assert.doesNotMatch(text, /Kind ticket-to-code/);
});
