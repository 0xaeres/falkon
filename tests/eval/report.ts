import { SEED, type Arm, type Dataset, type Raw } from "./data.js";
import { bootstrapCI, scoreAnswer, type Span } from "./score.js";

export type ReportInput = { datasets: { dataset: Dataset; floor: Raw[]; runs: Raw[] }[]; accepted: Record<string, Span[]>; split: "dev" | "hidden"; arms: Arm[] };
type Row = { floor: Raw; run?: Raw; floorScore: { recall: number; precision: number }; score?: { recall: number; precision: number } };

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const f4 = (n: number) => n.toFixed(4);
const interval = (xs: number[]) => { const c = bootstrapCI(xs, SEED); return `${f4(c.mean)} [${f4(c.lo)}, ${f4(c.hi)}]`; };

/** Differences are arm minus the recorded floor, per question id, pooled across the datasets of one split. */
export function report({ datasets, accepted, split, arms }: ReportInput): string {
  const questions = datasets.flatMap((d) => d.dataset.questions.filter((q) => q.split === split).map((q) => ({ d, q })));
  const rowsFor = (arm: Arm): Row[] => questions.flatMap(({ d, q }) => {
    const floor = d.floor.find((r) => r.taskId === q.id);
    if (!floor) throw new Error(`No recorded floor run for ${d.dataset.id}/${q.id}`);
    const score = (r: Raw) => scoreAnswer(q.declarations ?? [], r.is_error ? [] : r.answer, r.malformed, accepted[q.id]);
    const run = d.runs.find((r) => r.arm === arm && r.taskId === q.id);
    return [{ floor, run, floorScore: score(floor), score: run && score(run) }];
  });
  const lines = [
    `# Falkon O3 Ask-quality check (${split})`, "",
    `Differences are arm minus the recorded floor, per question id, pooled across ${datasets.map((d) => d.dataset.id).join(" and ")}. 95% bootstrap CI, seed ${SEED}, 10000 resamples.`,
    "Gate (regression gate item 3): the lower CI bound of the recall difference is at or above -0.05.", "",
  ];
  const floorRows = rowsFor(arms[0]!);
  lines.push(`Floor: n ${floorRows.length}; recall ${f4(mean(floorRows.map((r) => r.floorScore.recall)))}; precision ${f4(mean(floorRows.map((r) => r.floorScore.precision)))}; cost ${f4(mean(floorRows.map((r) => r.floor.total_cost_usd)))}.`);
  for (const arm of arms) {
    const rows = rowsFor(arm), paired = rows.filter((r): r is Row & { run: Raw; score: NonNullable<Row["score"]> } => !!r.run);
    const runs = paired.map((r) => r.run);
    const failed = runs.filter((r) => r.is_error).length, malformed = runs.filter((r) => r.malformed).length, leaks = runs.filter((r) => r.leak).length;
    lines.push("", `## ${arm}`, "", `Coverage ${arm}: ${paired.length}/${rows.length} paired; failed ${failed}; malformed ${malformed}; leaks ${leaks}.`, `Denied research_codebase attempts: ${runs.reduce((n, r) => n + (r.deniedAttempts ?? 0), 0)}.`);
    if (paired.length) {
      lines.push("", "| Metric | Arm mean | Floor mean | n | Difference [95% CI] |", "| --- | ---: | ---: | ---: | --- |");
      const metrics = { recall: [(r: typeof paired[number]) => r.score.recall, (r: typeof paired[number]) => r.floorScore.recall], precision: [(r: typeof paired[number]) => r.score.precision, (r: typeof paired[number]) => r.floorScore.precision], cost: [(r: typeof paired[number]) => r.run.total_cost_usd, (r: typeof paired[number]) => r.floor.total_cost_usd] } as const;
      for (const [name, [a, b]] of Object.entries(metrics)) lines.push(`| ${name} | ${f4(mean(paired.map(a)))} | ${f4(mean(paired.map(b)))} | ${paired.length} | ${interval(paired.map((r) => a(r) - b(r)))} |`);
      lines.push("", `Mean turns ${mean(runs.map((r) => r.num_turns)).toFixed(2)}; mean wall clock ${mean(runs.map((r) => r.wallClockMs)).toFixed(0)} ms.`);
      if (arm === "clone-research") lines.push(`research_codebase first in ${runs.filter((r) => r.firstTool === "research_codebase").length}/${runs.length} runs.`);
    }
    const lo = paired.length ? bootstrapCI(paired.map((r) => r.score.recall - r.floorScore.recall), SEED).lo : NaN;
    const complete = paired.length === rows.length && rows.length > 0 && !failed && !malformed && !leaks;
    lines.push("", `${arm}: ${complete ? (lo >= -0.05 ? "PASS" : "FAIL") : "withheld (incomplete coverage, failed, malformed or leaking runs)"}. Recall difference lower bound ${paired.length ? f4(lo) : "n/a"}.`);
  }
  return lines.join("\n") + "\n";
}
