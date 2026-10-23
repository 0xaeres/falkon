#!/usr/bin/env node
// Validates tests/eval/datasets/o3-history.json against D88, D89, D91, D95, D96 and D98, plus the D100 round 1 rewrite
// rules (kind a: no path or changed-file identifier in the text; kind b: criterion-computed gold of at least 4) and the round 2
// rules (kind a: the commit message names no Jira key, no corpus commit names the ticket, the PR or a Jira issue linking it
// names the key), and prints counts and violations.
// Plain node, no dependencies. Usage: node validate.mjs [--live]   (--live re-reads every ticket from the public Jira)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const E = process.env.EVAL_O3_DIR ?? "/Users/aeres/Desktop/projects/falkon/.local/eval";
const live = process.argv.includes("--live");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const dataset = read("tests/eval/datasets/o3-history.json");
const record = new Map(JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8")).map((r) => [r.id, r]));
const repos = new Map(read("tests/eval/datasets/o3.json").repositories.map((r) => [r.name, r]));
const violations = [];
const bad = (id, msg) => violations.push(`${id}: ${msg}`);
const git = (repo, ...args) => execFileSync("git", ["-C", join(E, repos.get(repo).checkout), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const ok = (fn) => { try { fn(); return true; } catch { return false; } };

// Schema (S43): parse with the harness's own loader.
try {
  execFileSync("pnpm", ["exec", "tsx", "-e", "import { loadDataset } from './data.ts'; const d = loadDataset('o3-history'); console.log(d.questions.length);"], { cwd: join(ROOT, "tests/eval"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) { bad("dataset", `S43 schema parse failed: ${e.stderr || e.message}`); }

// Counts and stratification (D89).
const KIND = { "history-why": "a", "history-what-when": "b", "history-ticket-to-code": "c" };
const WANT = { a: [10, 6], b: [7, 5], c: [7, 5] };
const counts = { a: { dev: 0, hidden: 0 }, b: { dev: 0, hidden: 0 }, c: { dev: 0, hidden: 0 } };
const ids = new Set();
for (const q of dataset.questions) {
  if (ids.has(q.id)) bad(q.id, "duplicate id");
  ids.add(q.id);
  const kind = KIND[q.relation];
  if (!kind) { bad(q.id, `unknown relation ${q.relation}`); continue; }
  if (!q.id.startsWith(`hist-${kind}-`)) bad(q.id, `id does not match kind ${kind}`);
  if (q.author !== "history-probe") bad(q.id, "author is not history-probe");
  if (kind !== "b" && q.vocab !== "natural") bad(q.id, "kinds a and c must be vocab natural (D98)");
  counts[kind][q.split]++;
}
for (const [k, [dev, hidden]] of Object.entries(WANT)) {
  if (counts[k].dev !== dev || counts[k].hidden !== hidden) bad("counts", `kind ${k} has ${counts[k].dev} dev / ${counts[k].hidden} hidden, want ${dev}/${hidden}`);
}
const total = Object.values(counts).reduce((s, c) => ({ dev: s.dev + c.dev, hidden: s.hidden + c.hidden }), { dev: 0, hidden: 0 });
if (total.dev !== 24 || total.hidden !== 16) bad("counts", `split ${total.dev}/${total.hidden}, want 24/16`);

// Per-repository pin and window: six calendar months before the pin's committer date (D96).
const pinInfo = new Map();
const pinOf = (repo) => {
  if (!pinInfo.has(repo)) {
    const pin = repos.get(repo).commit;
    const date = new Date(git(repo, "log", "-1", "--format=%cI", pin).trim());
    const start = new Date(date); start.setUTCMonth(start.getUTCMonth() - 6);
    pinInfo.set(repo, { pin, date, start, shallow: git(repo, "rev-parse", "--is-shallow-repository").trim() });
  }
  return pinInfo.get(repo);
};

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const EXT = /\.(java|kt|ts|tsx|js|jsx|mjs|cjs|json|xml|ya?ml|properties|sql|s?css|html|md|gradle)\b/i;
const CAMEL = /\b(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)\b/g;
const grams = (ws, n = 4) => new Set(ws.slice(0, Math.max(0, ws.length - n + 1)).map((_, i) => ws.slice(i, i + n).join(" ")));
const jiraCache = (key) => join(HERE, "cache/jira", `${key}.json`);
async function ticketResolves(key) {
  if (!live && existsSync(jiraCache(key))) { const t = JSON.parse(readFileSync(jiraCache(key), "utf8")); return t.key === key && !t.error; }
  const res = await fetch(`https://openmrs.atlassian.net/rest/api/3/issue/${key}?fields=summary`);
  await new Promise((r) => setTimeout(r, 300));
  return res.ok && (await res.json()).key === key;
}

const ANYKEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const cached = (p) => existsSync(join(HERE, p)) ? JSON.parse(readFileSync(join(HERE, p), "utf8")) : null;
// Where the PR names the key: its cached title or body, its branch (from the merged-PR listing), or, with --live or from
// cache/jiralink, a Jira issue whose text names the PR URL.
async function keyReachesPr(repo, pr, key) {
  const k = new RegExp(`\\b${key}\\b`, "i");
  const p = cached(`cache/pr/${repo}#${pr}.json`) ?? {};
  const branch = (cached(`cache/prlist/${repo}.json`) ?? []).find((x) => x.number === pr)?.branch ?? "";
  if (k.test(`${p.title} ${p.body} ${branch}`)) return true;
  if (!live) return (cached(`cache/jiralink/${repo}#${pr}.json`) ?? []).includes(key);
  const url = `github.com/openmrs/${repo}/pull/${pr}`;
  let text = "";
  for (const path of [`${key}?fields=description,comment`, `${key}/remotelink`]) {
    const res = await fetch(`https://openmrs.atlassian.net/rest/api/3/issue/${path}`);
    await new Promise((r) => setTimeout(r, 300));
    if (res.ok) text += JSON.stringify(await res.json());
  }
  return new RegExp(`${url.replace(/[.\/]/g, "\\$&")}(?!\\d)`).test(text);
}

let changeUnits = 0, ticketUnits = 0, spanUnits = 0, overlapChecks = 0;
for (const q of dataset.questions) {
  const kind = KIND[q.relation];
  const rec = record.get(q.id);
  if (!rec) { bad(q.id, "missing from the mining record questions.json"); continue; }
  const changes = q.required.filter((g) => "commit" in g);
  const tickets = q.required.filter((g) => "ticket" in g);
  const spans = q.required.filter((g) => "path" in g);
  changeUnits += changes.length; ticketUnits += tickets.length; spanUnits += spans.length;
  if (!changes.length) bad(q.id, "no change unit");
  if (kind === "b" && (tickets.length || spans.length)) bad(q.id, "kind b gold is change units only");
  if (kind === "a" && (tickets.length !== 1 || spans.length)) bad(q.id, "kind a gold is the change and its ticket");
  if (kind === "c" && (tickets.length !== 1 || !spans.length)) bad(q.id, "kind c gold is the change, its ticket and spans");

  for (const c of changes) {
    if (!repos.has(c.repo)) { bad(q.id, `unknown repo ${c.repo}`); continue; }
    const { pin, date, start, shallow } = pinOf(c.repo);
    if (shallow !== "false") bad(q.id, `${c.repo} checkout is shallow`);
    if (!ok(() => git(c.repo, "cat-file", "-e", `${c.commit}^{commit}`))) { bad(q.id, `${c.commit} missing from ${c.repo}`); continue; }
    if (!ok(() => git(c.repo, "merge-base", "--is-ancestor", c.commit, pin))) bad(q.id, `${c.commit} not reachable from ${c.repo} pin`);
    const merged = new Date(git(c.repo, "log", "-1", "--format=%cI", c.commit).trim());
    if (!(merged >= start && merged <= date)) bad(q.id, `${c.commit.slice(0, 8)} merged ${merged.toISOString()} outside ${start.toISOString()}..${date.toISOString()}`);
    const prFile = join(HERE, "cache/pr", `${c.repo}#${c.pr}.json`);
    if (!existsSync(prFile)) bad(q.id, `no cached PR ${c.repo}#${c.pr}`);
    else if (JSON.parse(readFileSync(prFile, "utf8")).mergeCommit !== c.commit) bad(q.id, `PR ${c.repo}#${c.pr} merge commit is not ${c.commit}`);
    if (kind !== "b") {
      const subject = git(c.repo, "log", "-1", "--format=%s", c.commit).trim();
      const shared = [...grams(words(q.question))].filter((g) => grams(words(subject)).has(g));
      overlapChecks++;
      if (shared.length) bad(q.id, `shares a 4-word run with the commit subject: "${shared[0]}"`);
      if (kind === "a") {
        if (q.question.includes(String(c.pr)) || q.question.toLowerCase().includes(c.commit.slice(0, 7))) bad(q.id, "kind a question leaks the PR number or SHA");
        for (const t of tickets) if (q.question.toUpperCase().includes(t.ticket.toUpperCase())) bad(q.id, "kind a question leaks the ticket key");
        // Round 1 rewrite (D100): no path-like token and no CamelCase identifier from the change, so the agent must locate the code.
        if (q.question.includes("/") || EXT.test(q.question)) bad(q.id, "kind a question has a path-like token");
        const code = git(c.repo, "show", "--format=", c.commit) + git(c.repo, "show", "--format=", "--name-only", c.commit).split("\n").filter(Boolean)
          .map((p) => { try { return git(c.repo, "show", `${pinOf(c.repo).pin}:${p}`); } catch { return ""; } }).join("\n");
        for (const id of q.question.match(CAMEL) ?? []) if (new RegExp(`\\b${id}\\b`).test(code)) bad(q.id, `kind a question names identifier ${id} from the changed files`);
      }
      if (kind === "a") {
        // Round 2 rewrite (D100, option i): the commit message names no Jira key, no corpus commit names the gold ticket,
        // and the key is reachable only through the PR (title, body, branch) or a Jira issue that names the PR URL.
        const message = git(c.repo, "log", "-1", "--format=%B", c.commit);
        if (ANYKEY.test(message)) bad(q.id, `commit message of ${c.commit.slice(0, 8)} names a Jira key: ${message.match(ANYKEY)[0]}`);
        for (const t of tickets) {
          for (const r of repos.keys()) {
            const named = git(r, "log", "--format=%H", "-i", "-E", `--grep=${t.ticket}([^0-9]|$)`, repos.get(r).commit).split(/\s+/).filter(Boolean);
            if (named.length) bad(q.id, `${r} ${named[0].slice(0, 8)} names ${t.ticket} in its message, so git recovers the ticket`);
          }
          if (!(await keyReachesPr(c.repo, c.pr, t.ticket))) bad(q.id, `${t.ticket} is not named by PR ${c.repo}#${c.pr} (title, body, branch) nor by a Jira issue linking it`);
        }
      }
      // Every commit at the pin that names the ticket must be gold, so exactly the gold units answer the question.
      for (const t of tickets) {
        const named = git(c.repo, "log", "--format=%H", "-E", `--grep=${t.ticket}([^0-9]|$)`, pin).split(/\s+/).filter(Boolean);
        for (const h of named) if (!changes.some((g) => g.commit === h)) bad(q.id, `${h.slice(0, 8)} also names ${t.ticket} but is not gold`);
      }
    }
  }
  if (kind === "b") {
    // Round 1 rewrite (D100): gold is exactly what the stated criterion selects over the window, at least 4 changes,
    // and the anchor (directory or file) has more commits than that, so listing the anchor's commits is not the answer.
    const repo = changes[0]?.repo;
    const { pin, start } = pinOf(repo);
    const base = ["log", "--first-parent", "--format=%H", `--since=${rec.since}`];
    const lines = (out) => out.split(/\s+/).filter(Boolean);
    let listed = [], anchor = [];
    if (rec.criterion === "pickaxe") {
      listed = lines(git(repo, ...base, `-G${rec.token}`, pin, "--", rec.dir));
      anchor = lines(git(repo, ...base, pin, "--", rec.dir));
      if (!q.question.includes(`\`${rec.token}\``) || !q.question.includes(`\`${rec.dir}\``)) bad(q.id, "question does not name its directory and identifier");
    } else if (rec.criterion === "decl") {
      listed = git(repo, "log", "--first-parent", `--since=${rec.since}`, `-L${rec.startLine},${rec.endLine}:${rec.path}`, "-s", "--format=@@C %H", pin).split("\n").filter((l) => l.startsWith("@@C ")).map((l) => l.slice(4));
      anchor = lines(git(repo, ...base, pin, "--", rec.path));
      if (!git(repo, "show", `${pin}:${rec.path}`).split("\n")[rec.startLine - 1]?.includes(rec.decl)) bad(q.id, `line ${rec.startLine} of ${rec.path} at the pin does not declare ${rec.decl}`);
      if (!q.question.includes(`\`${rec.decl}\``)) bad(q.id, "question does not name its declaration");
    } else bad(q.id, `unknown kind b criterion ${rec.criterion}`);
    const gold = new Set(changes.map((c) => c.commit));
    if (listed.length !== gold.size || !listed.every((h) => gold.has(h))) bad(q.id, `gold is not exactly the ${rec.criterion} selection since ${rec.since}`);
    if (gold.size < 4) bad(q.id, `gold has ${gold.size} changes, want at least 4`);
    if (anchor.length < gold.size + 2) bad(q.id, `anchor has ${anchor.length} commits, want at least gold + 2`);
    if (new Date(`${rec.since}T00:00:00Z`) < start) bad(q.id, `since ${rec.since} is before the window`);
    if (!q.question.includes(rec.since)) bad(q.id, "question does not name its date");
  }
  for (const t of tickets) {
    if (!/^(TRUNK|RESTWS|O3)-\d+$/.test(t.ticket)) bad(q.id, `ticket ${t.ticket} is not a TRUNK, RESTWS or O3 key`);
    if (!(await ticketResolves(t.ticket))) bad(q.id, `ticket ${t.ticket} does not resolve on the public Jira`);
  }
  for (const s of spans) {
    const repo = changes[0].repo;
    if (!s.path.startsWith(`${repo}/`)) { bad(q.id, `span ${s.path} is not under ${repo}/`); continue; }
    const inner = s.path.slice(repo.length + 1);
    let lines;
    try { lines = git(repo, "show", `${pinOf(repo).pin}:${inner}`).split("\n").length - 1; } catch { bad(q.id, `span file ${s.path} missing at the pin`); continue; }
    if (s.startLine > s.endLine || s.endLine > lines) bad(q.id, `span ${s.path}:${s.startLine}-${s.endLine} outside its ${lines}-line file at the pin`);
    // The span must hold lines the target change wrote that survive at the pin.
    const blame = git(repo, "blame", "-l", "-s", `-L${s.startLine},${s.endLine}`, `${changes[0].commit}^..${pinOf(repo).pin}`, "--", inner);
    if (!blame.split("\n").some((l) => l.startsWith(changes[0].commit))) bad(q.id, `span ${s.path}:${s.startLine}-${s.endLine} has no line from the target change at the pin`);
  }
}

console.log(`questions: ${dataset.questions.length} (unique ids ${ids.size})`);
for (const k of ["a", "b", "c"]) console.log(`kind ${k}: ${counts[k].dev + counts[k].hidden} (dev ${counts[k].dev}, hidden ${counts[k].hidden})`);
console.log(`split: dev ${total.dev}, hidden ${total.hidden}`);
console.log(`gold units: ${changeUnits} change, ${ticketUnits} ticket, ${spanUnits} span; subject-overlap checks: ${overlapChecks}; tickets checked ${live ? "live" : "from cache"}`);
console.log(`repositories: ${[...pinInfo.keys()].map((r) => `${r} (pin ${pinInfo.get(r).date.toISOString().slice(0, 10)}, window from ${pinInfo.get(r).start.toISOString().slice(0, 10)})`).join("; ")}`);
console.log(`violations: ${violations.length}`);
for (const v of violations) console.log(`  ${v}`);
process.exit(violations.length ? 1 : 0);
