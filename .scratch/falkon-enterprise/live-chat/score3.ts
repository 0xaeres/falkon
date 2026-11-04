import fs from "node:fs";
import { scoreAnswer } from "/Users/aeres/Desktop/projects/falkon-v1/tests/eval/score.ts";
const dir = process.argv[2];
const qs = JSON.parse(fs.readFileSync("/private/tmp/claude-501/-Users-aeres-Desktop-projects-falkon-v1/6b9a89ca-8ba1-4bb1-a8f9-d31f0291145f/scratchpad/live/q-eval.json", "utf8"));
const short = (r: string) => r.replace("github.com/openmrs/", "");
let tot = { strict: 0, raw: 0, fileStored: 0, fileRaw: 0, fileRead: 0, n: 0 };
for (const q of qs) {
  if (!fs.existsSync(`${dir}/${q.id}.sse`)) continue;
  const ev = fs.readFileSync(`${dir}/${q.id}.sse`, "utf8").split("\n").filter((x) => x.startsWith("data: ") && x !== "data: [DONE]").map((x) => JSON.parse(x.slice(6)));
  const th = JSON.parse(fs.readFileSync(`${dir}/${q.id}.thread.json`, "utf8")).answers[0];
  const stored = (th.evidence ?? []).map((e: any) => ({ path: `${short(e.repository)}/${e.path}`, startLine: e.startLine, endLine: e.startLine + (e.code?.length ?? 1) - 1 }));
  const text = ev.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join("");
  const raw = [...text.matchAll(/@file:\{([^:}]+)::([^:}]+)(?::(\d+)(?:-(\d+))?)?\}/g)].map((m) => ({ path: `${short(m[1])}/${m[2]}`, startLine: +(m[3] ?? 1), endLine: +(m[4] ?? m[3] ?? 100000) }));
  const read = ev.filter((e: any) => e.type === "data-source" && e.data?.type === "file").map((e: any) => ({ path: `${short(e.data.repo)}/${e.data.path}`, startLine: 1, endLine: 100000 }));
  const gold = q.gold.filter((g: any) => g.path);
  const fileHit = (set: { path: string }[]) => gold.length ? gold.filter((g: any) => set.some((a) => a.path === g.path)).length / gold.length : 0;
  const s = scoreAnswer(gold, stored).recall, r = scoreAnswer(gold, raw).recall;
  const fs_ = fileHit(stored), fr = fileHit(raw), fd = fileHit(read);
  tot.strict += s; tot.raw += r; tot.fileStored += fs_; tot.fileRaw += fr; tot.fileRead += fd; tot.n++;
  console.log(`${q.id.padEnd(28)} gold=${String(gold.length).padStart(2)} strict(stored)=${s.toFixed(2)} strict(raw refs)=${r.toFixed(2)} file(stored)=${fs_.toFixed(2)} file(raw)=${fr.toFixed(2)} file(read)=${fd.toFixed(2)} cites stored/raw=${stored.length}/${raw.length} read=${new Set(read.map((x: any) => x.path)).size}`);
}
const m = (x: number) => (x / tot.n).toFixed(3);
console.log(`MEAN n=${tot.n} strict(stored)=${m(tot.strict)} strict(raw)=${m(tot.raw)} file(stored)=${m(tot.fileStored)} file(raw)=${m(tot.fileRaw)} file(read)=${m(tot.fileRead)}`);
