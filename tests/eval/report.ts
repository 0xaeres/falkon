import { SEED, goldOf, type Arm, type Dataset, type Raw } from "./data.js";
import { bootstrapCI, scoreAnswer, type Gold } from "./score.js";

/** `floor` holds the reference runs: the recorded Sonnet floor, or the v6-tools runs of the model's own directory. */
export type ReportInput = { datasets: { dataset: Dataset; floor: Raw[]; runs: Raw[] }[]; accepted: Record<string, Gold[]>; split?: "dev" | "hidden"; arms: Arm[]; model?: string; referenceArm?: Arm };
type Row = { floor?: Raw; run?: Raw; floorScore?: { recall: number; precision: number }; score?: { recall: number; precision: number } };
type Paired = Row & { floor: Raw; run: Raw; floorScore: NonNullable<Row["floorScore"]>; score: NonNullable<Row["score"]> };

/** Regression gate item 3 (D25). A question is a win or a loss when recall differs by more than this. */
export const TIE = 0.001, LOWER_BOUND = -0.10, LOSS_RATIO = 2;

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const f4 = (n: number) => n.toFixed(4);
const interval = (xs: number[]) => { const c = bootstrapCI(xs, SEED); return `${f4(c.mean)} [${f4(c.lo)}, ${f4(c.hi)}]`; };

/** The D25 numbers for per-question recall differences (arm minus reference). */
export function d25(diffs: number[]) {
  const ci = bootstrapCI(diffs, SEED), wins = diffs.filter((d) => d > TIE).length, losses = diffs.filter((d) => d < -TIE).length;
  return { ...ci, wins, losses, ties: diffs.length - wins - losses, pass: ci.lo >= LOWER_BOUND && losses <= LOSS_RATIO * wins };
}

/** Differences are arm minus the reference, per question id. Without `split`, both splits are listed and pooled for the D25 verdict. */
export function report({ datasets, accepted, split, arms, model = "sonnet", referenceArm }: ReportInput): string {
  const questions = (s?: string) => datasets.flatMap((d) => d.dataset.questions.filter((q) => !s || q.split === s).map((q) => ({ d, q })));
  const rowsFor = (arm: Arm, s?: string): Row[] => questions(s).map(({ d, q }) => {
    const score = (r: Raw) => scoreAnswer(goldOf(q), r.is_error ? [] : r.answer, r.malformed, accepted[q.id]);
    const floor = d.floor.find((r) => r.taskId === q.id), run = d.runs.find((r) => r.arm === arm && r.taskId === q.id);
    return { floor, run, floorScore: floor && score(floor), score: run && score(run) };
  });
  const pairedOf = (rows: Row[]) => rows.filter((r): r is Paired => !!r.run && !!r.floor);
  const counts = (rows: Row[]) => {
    const runs = rows.flatMap((r) => r.run ? [r.run] : []);
    return { runs, failed: runs.filter((r) => r.is_error).length, malformed: runs.filter((r) => r.malformed).length, leaks: runs.filter((r) => r.leak).length };
  };
  const names = datasets.map((d) => d.dataset.id).join(" and ");
  const lines = [
    `# Falkon O3 Ask-quality check (${split ?? "dev and hidden"})`, "",
    `Model: ${model}. Reference: ${referenceArm ? `${referenceArm} runs of this model` : "the recorded floor"}. Differences are arm minus reference, per question id, pooled across ${names}. 95% bootstrap CI, seed ${SEED}, 10000 resamples.`,
    `Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above ${LOWER_BOUND}, losses are at most ${LOSS_RATIO} x wins (a win or loss is a recall difference of more than ${TIE}), and no run failed, was malformed or leaked.`, "",
  ];
  const section = (arm: Arm, s: string | undefined) => {
    const rows = rowsFor(arm, s), paired = pairedOf(rows), { runs, failed, malformed, leaks } = counts(rows);
    lines.push(`Coverage ${arm}: ${paired.length}/${rows.length} paired; failed ${failed}; malformed ${malformed}; leaks ${leaks}.`, `Denied research_codebase attempts: ${runs.reduce((n, r) => n + (r.deniedAttempts ?? 0), 0)}.`);
    if (paired.length) {
      lines.push("", "| Metric | Arm mean | Reference mean | n | Difference [95% CI] |", "| --- | ---: | ---: | ---: | --- |");
      const metrics = { recall: [(r: Paired) => r.score.recall, (r: Paired) => r.floorScore.recall], precision: [(r: Paired) => r.score.precision, (r: Paired) => r.floorScore.precision], cost: [(r: Paired) => r.run.total_cost_usd, (r: Paired) => r.floor.total_cost_usd] } as const;
      for (const [name, [a, b]] of Object.entries(metrics)) lines.push(`| ${name} | ${f4(mean(paired.map(a)))} | ${f4(mean(paired.map(b)))} | ${paired.length} | ${interval(paired.map((r) => a(r) - b(r)))} |`);
      const t = d25(paired.map((r) => r.score.recall - r.floorScore.recall));
      lines.push("", `Recall wins ${t.wins}, losses ${t.losses}, ties ${t.ties} against the reference.`, `Mean turns ${mean(runs.map((r) => r.num_turns)).toFixed(2)}; mean wall clock ${mean(runs.map((r) => r.wallClockMs)).toFixed(0)} ms.`);
      if (arm === "clone-research") lines.push(`research_codebase first in ${runs.filter((r) => r.firstTool === "research_codebase").length}/${runs.length} runs.`);
    }
    // The reference's own bad runs would distort every comparison, so they count like the arm's.
    const refs = paired.map((r) => r.floor), ref = { failed: refs.filter((r) => r.is_error).length, malformed: refs.filter((r) => r.malformed).length, leaks: refs.filter((r) => r.leak).length };
    lines.push(`Reference: n ${refs.length}, failed ${ref.failed}, malformed ${ref.malformed}, leaks ${ref.leaks}.`);
    return { rows, paired, failed: failed + ref.failed, malformed: malformed + ref.malformed, leaks: leaks + ref.leaks };
  };
  const mine = arms.filter((a) => a !== referenceArm);
  for (const s of split ? [split] : (["dev", "hidden"] as const)) {
    const floorRows = rowsFor(mine[0] ?? arms[0]!, s).filter((r) => r.floor);
    lines.push(`## ${s}`, "", `Floor: n ${floorRows.length}; recall ${f4(mean(floorRows.map((r) => r.floorScore!.recall)))}; precision ${f4(mean(floorRows.map((r) => r.floorScore!.precision)))}; cost ${f4(mean(floorRows.map((r) => r.floor!.total_cost_usd)))}.`);
    for (const arm of mine) { lines.push("", `### ${arm} (${s})`, ""); section(arm, s); }
    lines.push("");
  }
  if (!split) {
    lines.push("## Pooled verdict (dev and hidden)");
    for (const arm of mine) {
      lines.push("", `### ${arm}`, "");
      const { rows, paired, failed, malformed, leaks } = section(arm, undefined);
      const t = paired.length ? d25(paired.map((r) => r.score.recall - r.floorScore.recall)) : undefined;
      const complete = paired.length === rows.length && rows.length > 0 && !failed && !malformed && !leaks;
      lines.push("", `${arm}: ${complete && t ? (t.pass ? "PASS" : "FAIL") : "withheld (incomplete coverage, failed, malformed or leaking runs)"}. n ${paired.length}; recall difference ${t ? `${f4(t.mean)} [${f4(t.lo)}, ${f4(t.hi)}]` : "n/a"}; wins ${t?.wins ?? "n/a"}, losses ${t?.losses ?? "n/a"}, ties ${t?.ties ?? "n/a"}.`);
    }
  }
  return lines.join("\n") + "\n";
}
