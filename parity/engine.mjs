// Engine-level differential: the same zoekt request, built by the clone's parser and request
// builder, sent over gRPC to v6's zoekt (:16070) and the clone's zoekt (:16071). Isolates
// indexing differences (shards, branches, languages, ranking) from the web layer.
//   pnpm parity:engine [--only <id>]
// Also diffs the indexed repository list (zoekt List): branches, documents, sizes.
import fs from "node:fs";
import path from "node:path";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { parseQuery } from "../packages/shared/src/queryParser.ts";
import { buildRequest } from "../packages/shared/src/zoekt.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const protoDir = path.join(here, "../packages/shared/proto");
const def = protoLoader.loadSync(path.join(protoDir, "zoekt/webserver/v1/webserver.proto"), {
  keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true, includeDirs: [protoDir],
});
const Svc = grpc.loadPackageDefinition(def).zoekt.webserver.v1.WebserverService;
const opts = { "grpc.max_receive_message_length": 500 * 1024 * 1024 };
const v6 = new Svc(process.env.V6_ZOEKT ?? "127.0.0.1:16070", grpc.credentials.createInsecure(), opts);
const sbc = new Svc(process.env.CLONE_ZOEKT ?? "127.0.0.1:16071", grpc.credentials.createInsecure(), opts);
const call = (c, m, req) => new Promise((res, rej) => c[m](req, (e, r) => (e ? rej(e) : res(r))));

const repoInfo = (r) => {
  const rep = r.repository;
  return {
    name: rep.name,
    branches: rep.branches.map((b) => `${b.name}@${b.version.slice(0, 10)}`).sort(),
    docs: r.stats?.documents,
    contentBytes: r.stats?.content_bytes,
    shards: r.stats?.shards,
  };
};

const report = [];
const log = (s) => {
  report.push(s);
  console.log(s);
};

// ---- repository list ----
const listReq = { query: { const: true }, opts: { field: "REPO_LIST_FIELD_REPOS" } };
const [l6, lc] = await Promise.all([call(v6, "List", listReq), call(sbc, "List", listReq)]);
const R6 = new Map(l6.repos.map((r) => [r.repository.name, repoInfo(r)]));
const RC = new Map(lc.repos.map((r) => [r.repository.name, repoInfo(r)]));
log(`# Engine parity\n\n## Indexed repositories (v6 ${R6.size}, clone ${RC.size})\n`);
for (const name of [...new Set([...R6.keys(), ...RC.keys()])].sort()) {
  const a = R6.get(name);
  const b = RC.get(name);
  const same = a && b && JSON.stringify({ ...a, shards: 0 }) === JSON.stringify({ ...b, shards: 0 });
  log(`- ${same ? "✓" : "✗"} ${name}${same ? ` (${a.docs} docs)` : `\n  v6:    ${JSON.stringify(a)}\n  clone: ${JSON.stringify(b)}`}`);
}

// ---- queries ----
const spec = JSON.parse(fs.readFileSync(path.resolve(args.includes("--queries") ? args[args.indexOf("--queries") + 1] : path.join(here, "queries.json")), "utf8"));
const rk = (r) => `${r.start.line_number}:${r.start.column}-${r.end.line_number}:${r.end.column}`;
const norm = (res) =>
  res.files.map((f) => ({
    key: `${f.repository}::${Buffer.from(f.file_name).toString("utf8")}`,
    lang: f.language,
    branches: [...f.branches].sort().join(","),
    ranges: f.chunk_matches.flatMap((c) => c.ranges.map((r) => `${c.file_name ? "n" : "c"}${rk(r)}`)).sort().join(" "),
    content: f.chunk_matches.map((c) => Buffer.from(c.content).toString("utf8")).join("␞"),
  }));

log(`\n## Queries\n`);
let agree = 0;
let total = 0;
for (const q of spec.queries) {
  if (only && !q.id.includes(only)) continue;
  let req;
  try {
    req = buildRequest(parseQuery(q.query, { regex: q.isRegexEnabled, caseSensitive: q.isCaseSensitivityEnabled, contexts: {} }), {
      matches: q.matches ?? spec.defaults.matches,
      contextLines: q.contextLines ?? spec.defaults.contextLines,
    });
    if (q.whole) req.opts.whole = true;
  } catch {
    continue; // parse errors are the grammar differential's job
  }
  total++;
  const [a, b] = await Promise.allSettled([call(v6, "Search", req), call(sbc, "Search", req)]);
  if (a.status === "rejected" || b.status === "rejected") {
    const ok = a.status === b.status;
    if (ok) agree++;
    log(`- ${ok ? "✓" : "✗"} ${q.id}: ${a.status === "rejected" ? a.reason.details : "ok"} / ${b.status === "rejected" ? b.reason.details : "ok"}`);
    continue;
  }
  const A = norm(a.value);
  const B = norm(b.value);
  const MB = new Map(B.map((f) => [f.key, f]));
  const MA = new Map(A.map((f) => [f.key, f]));
  const missing = A.filter((f) => !MB.has(f.key)).map((f) => f.key);
  const extra = B.filter((f) => !MA.has(f.key)).map((f) => f.key);
  const fieldDiffs = [];
  for (const f of A) {
    const g = MB.get(f.key);
    if (!g) continue;
    for (const k of ["lang", "branches", "ranges", "content"]) if (f[k] !== g[k]) fieldDiffs.push(`${k} ${f.key}: v6 ${JSON.stringify(f[k]).slice(0, 160)} | clone ${JSON.stringify(g[k]).slice(0, 160)}`);
  }
  const orderSame = A.every((f, i) => B[i]?.key === f.key);
  const stats = `match_count ${a.value.stats.match_count}/${b.value.stats.match_count} files ${A.length}/${B.length}`;
  const ok = !missing.length && !extra.length && !fieldDiffs.length && orderSame && a.value.stats.match_count === b.value.stats.match_count;
  if (ok) agree++;
  log(`- ${ok ? "✓" : "✗"} ${q.id}: ${stats}${orderSame ? "" : " (order differs)"}`);
  if (missing.length) log(`  missing in clone: ${missing.slice(0, 6).join(", ")}`);
  if (extra.length) log(`  extra in clone: ${extra.slice(0, 6).join(", ")}`);
  for (const d of fieldDiffs.slice(0, 4)) log(`  ${d}`);
}
log(`\n${agree}/${total} queries agree at the engine level.`);
fs.mkdirSync(path.join(here, "reports"), { recursive: true });
fs.writeFileSync(path.join(here, "reports/engine-latest.md"), report.join("\n") + "\n");
v6.close();
sbc.close();
