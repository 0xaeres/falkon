#!/usr/bin/env node
// Replays tests/parity/queries.json against Sourcebot v6 (oracle) and the clone, and diffs the results.
//   node tests/parity/run.mjs [--only <id-substring>] [--queries <file>] [--v6 <url>] [--clone <url>]
// Env: V6_URL, V6_API_KEY or V6_API_KEY_FILE (default: tests/parity/.gen/keys.env), SOURCEBOT_API_KEY for the clone.
// Writes tests/parity/reports/<timestamp>.json (full) and tests/parity/reports/latest.md (summary).
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const V6 = arg("--v6", process.env.V6_URL ?? "http://localhost:3100");
const CLONE = arg("--clone", "http://localhost:3200");
const only = arg("--only");

const keys = Object.fromEntries(
  (fs.existsSync(path.join(here, ".gen/keys.env")) ? fs.readFileSync(path.join(here, ".gen/keys.env"), "utf8") : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
// The key is read from a file when V6_API_KEY_FILE is set, so it never has to pass through a shell variable.
const V6_KEY =
  process.env.V6_API_KEY ??
  (process.env.V6_API_KEY_FILE ? fs.readFileSync(process.env.V6_API_KEY_FILE, "utf8").trim() : undefined) ??
  keys.V6_API_KEY;
const CLONE_KEY =
  process.env.SOURCEBOT_API_KEY ??
  (process.env.CLONE_API_KEY_FILE ? fs.readFileSync(process.env.CLONE_API_KEY_FILE, "utf8").trim() : "");

const spec = JSON.parse(fs.readFileSync(path.resolve(arg("--queries", path.join(here, "queries.json"))), "utf8"));

async function post(base, key, body) {
  const headers = { "content-type": "application/json" };
  if (key) {
    headers["X-Sourcebot-Api-Key"] = key;
    headers.authorization = `Bearer ${key}`;
  }
  const t = Date.now();
  try {
    const res = await fetch(`${base}/api/search`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, ms: Date.now() - t, json };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, json: { error: String(e) } };
  }
}

const rangeKey = (r) => `${r.start.lineNumber}:${r.start.column}-${r.end.lineNumber}:${r.end.column}`;

/** Both APIs reduce to: ordered files, each with content match ranges, file-name ranges, language, chunk text. */
function normalize(json) {
  const files = (json.files ?? []).map((f) => {
    const repo = f.repository ?? f.repo;
    const file = typeof f.fileName === "object" ? f.fileName.text : (f.fileName ?? f.path);
    const nameRanges = (typeof f.fileName === "object" ? f.fileName.matchRanges : f.fileNameRanges) ?? [];
    const chunks = f.chunks ?? [];
    return {
      key: `${repo}::${file}`,
      language: f.language ?? "",
      branches: [...(f.branches ?? [])].sort(),
      ranges: chunks.flatMap((c) => c.matchRanges.map(rangeKey)).sort(),
      nameRanges: nameRanges.map(rangeKey).sort(),
      chunkText: chunks.map((c) => `${c.contentStart?.lineNumber}|${c.content}`),
    };
  });
  const stats = json.stats ?? {};
  return {
    files,
    totalMatchCount: stats.totalMatchCount ?? json.rawMatchCount,
    actualMatchCount: stats.actualMatchCount ?? json.matchCount,
    isSearchExhaustive: json.isSearchExhaustive,
  };
}

function diff(a, b) {
  const A = new Map(a.files.map((f) => [f.key, f]));
  const B = new Map(b.files.map((f) => [f.key, f]));
  const missing = [...A.keys()].filter((k) => !B.has(k));
  const extra = [...B.keys()].filter((k) => !A.has(k));
  const common = [...A.keys()].filter((k) => B.has(k));
  const rangeDiffs = [];
  const langDiffs = [];
  const chunkDiffs = [];
  const branchDiffs = [];
  for (const k of common) {
    const x = A.get(k);
    const y = B.get(k);
    const eq = (p, q) => p.length === q.length && p.every((v, i) => v === q[i]);
    if (!eq(x.ranges, y.ranges) || !eq(x.nameRanges, y.nameRanges)) {
      rangeDiffs.push({ file: k, v6: [...x.nameRanges.map((r) => `name ${r}`), ...x.ranges].slice(0, 12), clone: [...y.nameRanges.map((r) => `name ${r}`), ...y.ranges].slice(0, 12) });
    }
    if (x.language !== y.language) langDiffs.push({ file: k, v6: x.language, clone: y.language });
    if (!eq(x.chunkText, y.chunkText)) chunkDiffs.push({ file: k, v6: x.chunkText.slice(0, 2).map((s) => s.slice(0, 200)), clone: y.chunkText.slice(0, 2).map((s) => s.slice(0, 200)) });
    if (!eq(x.branches, y.branches)) branchDiffs.push({ file: k, v6: x.branches, clone: y.branches });
  }
  // Ranking agreement: share of the oracle's top 20 that sit at the same position in the clone.
  const top = a.files.slice(0, 20);
  const samePos = top.filter((f, i) => b.files[i]?.key === f.key).length;
  return {
    missing,
    extra,
    rangeDiffs,
    langDiffs,
    chunkDiffs,
    branchDiffs,
    rankAgreement: top.length ? samePos / top.length : 1,
    counts: {
      v6Files: a.files.length,
      cloneFiles: b.files.length,
      v6Total: a.totalMatchCount,
      cloneTotal: b.totalMatchCount,
      v6Actual: a.actualMatchCount,
      cloneActual: b.actualMatchCount,
    },
  };
}

const results = [];
for (const q of spec.queries) {
  if (only && !q.id.includes(only)) continue;
  const { id, ...rest } = q;
  const body = { ...spec.defaults, ...rest };
  // v6 runs twice: zoekt stops at matches+1 across parallel shards, so a truncated result can
  // differ between identical calls. Only results v6 reproduces are held to exact equality.
  const [v6, v6again, clone] = await Promise.all([post(V6, V6_KEY, body), post(V6, V6_KEY, body), post(CLONE, CLONE_KEY, body)]);
  const ok6 = v6.status === 200;
  const okC = clone.status === 200;
  let verdict;
  let d = null;
  if (!ok6 || !okC) {
    const code = (r) => r.json?.errorCode;
    verdict = v6.status === clone.status && code(v6) === code(clone) ? "match" : "status";
  } else {
    d = diff(normalize(v6.json), normalize(clone.json));
    const self = v6again.status === 200 ? diff(normalize(v6.json), normalize(v6again.json)) : null;
    const stable = self && !self.missing.length && !self.extra.length && !self.rangeDiffs.length;
    const filesEq = !d.missing.length && !d.extra.length;
    verdict = !filesEq ? "files" : d.rangeDiffs.length ? "ranges" : d.chunkDiffs.length ? "chunks" : d.langDiffs.length ? "language" : d.rankAgreement < 1 ? "order" : "match";
    if (verdict !== "match" && !stable) verdict = "unstable";
    if (verdict === "order" && self && self.rankAgreement < 1) verdict = "unstable";
    const ex6 = v6.json.isSearchExhaustive;
    const exC = clone.json.isSearchExhaustive;
    if (verdict === "match" && ex6 !== exC) verdict = "exhaustive";
    d.exhaustive = { v6: ex6, clone: exC };
  }
  // Truncated results cannot be compared exactly (zoekt stops early across parallel shards, so even
  // v6 against itself differs), so compare the complete result instead: re-run uncapped, raising the
  // limit above both observed totals until both are exhaustive. Never complete -> "truncated".
  let full;
  if (d && d.exhaustive.v6 === false && !args.includes("--no-probe")) {
    let limit = Math.max(v6.json.stats?.totalMatchCount ?? 0, clone.json.stats?.totalMatchCount ?? 0) * 2;
    for (let attempt = 0; attempt < 4; attempt++) {
      const probe = { ...body, matches: Math.min(Math.max(limit, 10000), 1_000_000), contextLines: 0 };
      const [p6, pC] = await Promise.all([post(V6, V6_KEY, probe), post(CLONE, CLONE_KEY, probe)]);
      if (p6.status !== 200 || pC.status !== 200) break;
      const fd = diff(normalize(p6.json), normalize(pC.json));
      full = {
        limit: probe.matches,
        complete: p6.json.isSearchExhaustive && pC.json.isSearchExhaustive,
        same: !fd.missing.length && !fd.extra.length && !fd.rangeDiffs.length && !fd.langDiffs.length,
        missing: fd.missing.slice(0, 10),
        extra: fd.extra.slice(0, 10),
        rangeDiffs: fd.rangeDiffs.slice(0, 3),
        counts: fd.counts,
      };
      if (full.complete || probe.matches >= 1_000_000) break;
      limit = Math.max(fd.counts.v6Total, fd.counts.cloneTotal) * 2;
    }
    if (full?.complete) verdict = full.same ? "match" : "full-differs";
    else if (verdict !== "match") verdict = "truncated";
  }
  results.push({
    id,
    full,
    body,
    verdict,
    v6: { status: v6.status, ms: v6.ms, error: ok6 ? undefined : v6.json },
    clone: { status: clone.status, ms: clone.ms, error: okC ? undefined : clone.json },
    diff: d,
  });
  if (full) process.stdout.write(`  [complete: ${full.complete ? (full.same ? "same" : "DIFFERS") : "incomplete"} files ${full.counts.v6Files}/${full.counts.cloneFiles} total ${full.counts.v6Total}/${full.counts.cloneTotal}]\n`);
  process.stdout.write(`${verdict === "match" ? "✓" : verdict === "unstable" || verdict === "truncated" ? "~" : "✗"} ${id.padEnd(24)} ${verdict}${d ? `  files ${d.counts.v6Files}/${d.counts.cloneFiles}  total ${d.counts.v6Total}/${d.counts.cloneTotal}` : `  status ${v6.status}/${clone.status}`}\n`);
}

const by = (v) => results.filter((r) => r.verdict === v).length;
const verdicts = ["match", "full-differs", "unstable", "truncated", "exhaustive", "order", "language", "chunks", "ranges", "files", "status"];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync(path.join(here, "reports"), { recursive: true });
fs.writeFileSync(path.join(here, `reports/${stamp}.json`), JSON.stringify({ v6: V6, clone: CLONE, results }, null, 2));

const md = [
  `# Parity report ${stamp}`,
  "",
  `${by("match")}/${results.length} queries match exactly; ${by("unstable")} are unstable on v6 itself and ${by("truncated")} truncated with no complete result to compare (neither counted as failures).`,
  "",
  "| verdict | count |",
  "| --- | --- |",
  ...verdicts.map((v) => `| ${v} | ${by(v)} |`),
  "",
  "Verdict is the first difference found, in order: status, files, ranges, chunks, language, order, exhaustive. Truncated results are re-run uncapped (contextLines 0) and judged on the complete result: `match` or `full-differs`. `unstable` = v6 returned a different result for the same request twice (truncated searches), so exact equality is not expected. `truncated` = the complete result stayed out of reach (limit 1,000,000), so the capped results cannot be held to equality.",
  "",
  "## Differences",
  "",
  ...results
    .filter((r) => r.verdict !== "match")
    .flatMap((r) => [
      `### ${r.id} — ${r.verdict}`,
      "",
      "```json",
      JSON.stringify(r.body),
      "```",
      "",
      r.diff
        ? [
            `files v6/clone: ${r.diff.counts.v6Files}/${r.diff.counts.cloneFiles}, total matches: ${r.diff.counts.v6Total}/${r.diff.counts.cloneTotal}, rank agreement: ${(r.diff.rankAgreement * 100).toFixed(0)}%`,
            r.full ? `complete result: ${r.full.complete ? (r.full.same ? "same" : "DIFFERS") : "not complete on both"}; missing ${JSON.stringify(r.full.missing)} extra ${JSON.stringify(r.full.extra)} ranges ${JSON.stringify(r.full.rangeDiffs).slice(0, 400)}` : "",
            r.diff.missing.length ? `- missing in clone (${r.diff.missing.length}): ${r.diff.missing.slice(0, 8).join(", ")}` : "",
            r.diff.extra.length ? `- extra in clone (${r.diff.extra.length}): ${r.diff.extra.slice(0, 8).join(", ")}` : "",
            ...r.diff.rangeDiffs.slice(0, 3).map((x) => `- ranges ${x.file}: v6 [${x.v6.join(" ")}] clone [${x.clone.join(" ")}]`),
            ...r.diff.langDiffs.slice(0, 3).map((x) => `- language ${x.file}: v6 ${x.v6} clone ${x.clone}`),
            ...r.diff.chunkDiffs.slice(0, 2).map((x) => `- chunk ${x.file}: v6 ${JSON.stringify(x.v6[0])} clone ${JSON.stringify(x.clone[0])}`),
          ]
            .filter(Boolean)
            .join("\n")
        : `status v6 ${r.v6.status} ${JSON.stringify(r.v6.error)?.slice(0, 300)}\nclone ${r.clone.status} ${JSON.stringify(r.clone.error)?.slice(0, 300)}`,
      "",
    ]),
].join("\n");
fs.writeFileSync(path.join(here, "reports/latest.md"), md);
console.log(`\n${by("match")}/${results.length} match, ${by("unstable")} unstable on v6, ${by("truncated")} truncated, ${results.length - by("match") - by("unstable") - by("truncated")} differ. Report: tests/parity/reports/latest.md`);
