import assert from "node:assert/strict";
import { test } from "node:test";
import { DATASETS, FLOOR_DIR, loadAccepted, loadDataset, readRaw, type Raw } from "./data.js";
import { report, type ReportInput } from "./report.js";
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

test("an arm that matches the floor passes the gate with a zero difference", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  const text = report({ datasets: input, accepted, split: "dev", arms: ["clone-tools"] });
  assert.match(text, /Floor: n 48; recall 0\.9726/);
  assert.match(text, /\| recall \| 0\.9726 \| 0\.9726 \| 48 \| 0\.0000 \[0\.0000, 0\.0000\]/);
  assert.match(text, /clone-tools: PASS/);
  assert.match(text, /Coverage clone-tools: 48\/48 paired; failed 0; malformed 0; leaks 0\./);
});

test("an arm that answers nothing fails the gate, and a missing run withholds it", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", () => []);
  assert.match(report({ datasets: input, accepted, split: "dev", arms: ["clone-tools"] }), /clone-tools: FAIL/);
  input[0]!.runs.pop();
  assert.match(report({ datasets: input, accepted, split: "dev", arms: ["clone-tools"] }), /clone-tools: withheld/);
});

test("the research arm reports how often research_codebase came first", () => {
  const input = floorInput();
  cloneRuns(input, "clone-research", (_q, f) => f.answer);
  input[0]!.runs[0]!.firstTool = "grep";
  assert.match(report({ datasets: input, accepted, split: "dev", arms: ["clone-research"] }), /research_codebase first in 47\/48 runs/);
});

test("the report shows the plain arm's denied research_codebase attempts and malformed count", () => {
  const input = floorInput();
  cloneRuns(input, "clone-tools", (_q, f) => f.answer);
  input[0]!.runs[0]!.deniedAttempts = 3; input[0]!.runs[1]!.malformed = true;
  const text = report({ datasets: input, accepted, split: "dev", arms: ["clone-tools"] });
  assert.match(text, /malformed 1; leaks 0\./);
  assert.match(text, /Denied research_codebase attempts: 3\./);
});
