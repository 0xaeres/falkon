// Diffs out/v6.json against out/clone.json per scenario: repo sets by (externalId, codeHostUrl), then every field.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const a = JSON.parse(fs.readFileSync(path.join(here, "out/v6.json"), "utf8"));
const b = JSON.parse(fs.readFileSync(path.join(here, "out/clone.json"), "utf8"));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v);
let bad = 0;
for (const name of Object.keys(a)) {
  const x = a[name], y = b[name];
  if (!y) { console.log(`✗ ${name}: missing on clone`); bad++; continue; }
  if (x.error || y.error) {
    const ok = !!x.error === !!y.error;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${name}: error v6=${JSON.stringify(x.error ?? null)} clone=${JSON.stringify(y.error ?? null)}`);
    continue;
  }
  const key = (r) => `${r.externalId}@${r.codeHostUrl}`;
  const A = new Map(x.repos.map((r) => [key(r), r]));
  const B = new Map(y.repos.map((r) => [key(r), r]));
  const missing = [...A.keys()].filter((k) => !B.has(k));
  const extra = [...B.keys()].filter((k) => !A.has(k));
  const fieldDiffs = [];
  for (const [k, r] of A) {
    const s = B.get(k);
    if (!s) continue;
    for (const f of new Set([...Object.keys(r), ...Object.keys(s)])) {
      if (JSON.stringify(canon(r[f])) !== JSON.stringify(canon(s[f]))) fieldDiffs.push(`${r.name}.${f}: v6 ${JSON.stringify(canon(r[f]))} | clone ${JSON.stringify(canon(s[f]))}`);
    }
  }
  const orderSame = x.repos.map(key).join() === y.repos.map(key).join();
  const ok = !missing.length && !extra.length && !fieldDiffs.length;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${x.repos.length}/${y.repos.length} repos${orderSame ? "" : " (order differs)"}`);
  for (const l of [...missing.slice(0, 5).map((k) => `  missing ${k}`), ...extra.slice(0, 5).map((k) => `  extra ${k}`), ...fieldDiffs.slice(0, 8).map((d) => `  ${d}`)]) console.log(l);
}
console.log(bad ? `\n${bad} scenario(s) differ` : "\nall scenarios agree");
process.exit(bad ? 1 : 0);
