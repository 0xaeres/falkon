// node --import tsx score-stored.ts <dir>: strict stored-view recall per eval question, from <dir>/<id>.thread.json only.
import fs from "node:fs";
import { scoreAnswer } from "../../../tests/eval/score.ts";
const dir = process.argv[2];
const qs = JSON.parse(fs.readFileSync(new URL("./questions-eval.json", import.meta.url), "utf8"));
const short = (r: string) => r.replace("github.com/openmrs/", "");
let sum = 0, n = 0;
for (const q of qs) {
  const f = `${dir}/${q.id}.thread.json`;
  if (!fs.existsSync(f)) continue;
  const th = JSON.parse(fs.readFileSync(f, "utf8")).answers[0];
  const stored = (th.evidence ?? []).map((e: any) => ({ path: `${short(e.repository)}/${e.path}`, startLine: e.startLine, endLine: e.startLine + (e.code?.length ?? 1) - 1 }));
  const gold = q.gold.filter((g: any) => g.path);
  const r = scoreAnswer(gold, stored).recall;
  sum += r; n++;
  console.log(`${q.id.padEnd(28)} gold=${gold.length} recall=${r.toFixed(2)} evidence=${stored.length}`);
}
console.log(`MEAN n=${n} recall=${(sum / n).toFixed(3)}`);
