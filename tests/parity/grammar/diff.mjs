// Offline grammar differential: v6 parser + transform (oracle.cjs) vs the clone's parseQuery.
//   pnpm parity:grammar [--fuzz 20000] [--seed 1] [--show 20]
// Inputs: v6's own grammar fixtures, tests/parity/queries.json, and seeded random queries, each in
// normal and regex mode. Exit code 1 if any input disagrees.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseQuery } from "../../../packages/shared/src/queryParser.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const oracle = require("./oracle.cjs");
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FUZZ = Number(arg("--fuzz", 20000));
const SHOW = Number(arg("--show", 20));
let seed = Number(arg("--seed", 1));
const CONTEXTS = { c1: ["github.com/junegunn/fzf", "github.com/google/gson"] };

// ---- inputs ----
const inputs = new Set();
const fixtureDir = path.join(here, "../.oracle/packages/queryLanguage/test");
for (const f of fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".txt"))) {
  const blocks = fs.readFileSync(path.join(fixtureDir, f), "utf8").split(/^# .*$/m);
  for (const b of blocks) {
    const [input] = b.split(/^==>$/m);
    const q = input?.replace(/^\n+|\n+$/g, "");
    if (q) inputs.add(q);
  }
}
for (const f of fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".ts"))) {
  // Inputs in the .ts tests are string literals passed to parse helpers.
  for (const m of fs.readFileSync(path.join(fixtureDir, f), "utf8").matchAll(/(?:parse\w*|input|query)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
    try {
      inputs.add(m[1] === "`" ? m[2] : JSON.parse(m[1] === "'" ? `"${m[2].replace(/"/g, '\\"').replace(/\\'/g, "'")}"` : `"${m[2]}"`));
    } catch {}
  }
}
for (const q of JSON.parse(fs.readFileSync(path.join(here, "../queries.json"), "utf8")).queries) inputs.add(q.query);

// mulberry32: integer-only, so it never loses precision the way a float LCG does.
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];
const PIECES = [
  "foo", "bar", "test()", "func(a)", "(pr", "pr)", "a|b", "(foo|bar)", "or", "orange", "order", "OR",
  "-x", "-", "--", "-foo:bar", "http://x", "\"q\"", "\"a b\"", "\"q\\\"x\"", "\"unclosed", "\\(", "\\)", "\\\\",
  "file:x", "f:\"a b\"", "-file:test", "repo:(a|b)", "r:gson", "-repo:x", "lang:Go", "lang:python", "lang:TypeScript",
  "rev:*", "rev:main", "sym:Foo", "content:x", "c:y", "archived:yes", "archived:no", "archived:maybe", "fork:only",
  "visibility:public", "visibility:Private", "context:c1", "reposet:a,b", "file:", "repo:",
  "(", ")", "(", ")", "-(", "((", "))", "()", "[a-z]+", "^x$", "a.b", "x*", "x\\d", "[)]", "file:(test|spec)",
];
for (let i = 0; i < FUZZ; i++) {
  const n = 1 + Math.floor(rand() * 6);
  let q = "";
  for (let j = 0; j < n; j++) q += pick(PIECES) + (rand() < 0.8 ? " " : rand() < 0.5 ? "" : "  ");
  inputs.add(q.trim());
}

// ---- compare ----
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;

function clone(q, regex) {
  try {
    return { ir: parseQuery(q, { regex, caseSensitive: false, contexts: CONTEXTS }) };
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
}

let total = 0;
const failures = [];
for (const q of inputs) {
  for (const regex of [false, true]) {
    total++;
    const a = oracle.parse(q, { regex, contexts: CONTEXTS });
    const b = clone(q, regex);
    const same = a.error || b.error ? !!a.error === !!b.error : JSON.stringify(canon(a.ir)) === JSON.stringify(canon(b.ir));
    if (!same) failures.push({ q, regex, v6: a.error ?? a.ir, tree: a.tree, clone: b.error ?? b.ir });
  }
}


console.log(`${total - failures.length}/${total} agree (${failures.length} differ)`);
for (const f of failures.slice(0, SHOW)) {
  console.log(`\n${f.regex ? "[regex] " : ""}${JSON.stringify(f.q)}\n  tree:  ${f.tree ?? "-"}\n  v6:    ${JSON.stringify(f.v6)}\n  clone: ${JSON.stringify(f.clone)}`);
}
fs.mkdirSync(path.join(here, "../reports"), { recursive: true });
fs.writeFileSync(path.join(here, "../reports/grammar-latest.json"), JSON.stringify({ total, failures }, null, 2));

process.exit(failures.length ? 1 : 0);
