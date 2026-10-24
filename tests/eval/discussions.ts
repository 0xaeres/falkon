/**
 * Pull request snapshot for the gold repositories (S47, D109): `pnpm eval -- corpus discussions [--verify|--check]`.
 * Fetches with the operator's `gh` login (GraphQL, read-only public data) into <EVAL_O3_DIR>/github-snapshot/<repo>/, cut at each
 * repository's pin date. Idempotent and resumable: a pull request file is rewritten only when its content changes, and a file already
 * holding the live updatedAt (or the pin cut of it) is not fetched again. The token is never read, logged or written.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BATCH, conn, detailQuery, scrub, shapePull, type Pages } from "../../packages/backend/src/githubQuery.js";

export { scrub };

export type Gh = (args: string[], input: string) => string;
export type Deps = { gh: Gh; sleep: (ms: number) => Promise<void>; now: () => Date; log: (line: string) => void };
export type Repo = { name: string; checkout: string; commit: string };
export type GoldPr = { repo: string; commit: string; pr: number; id: string };

export const realDeps = (): Deps => ({
  gh: (args, input) => execFileSync("gh", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  log: (line) => console.error(line),
});

const OWNER = "openmrs", MONTHS = 24, MAX_PAGES = 5, LOW = 150;
const RATE = "rateLimit{cost remaining resetAt}";

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

export async function pinWindow(repo: Repo, o3Dir: string) {
  const out = execFileSync("git", ["-C", join(o3Dir, repo.checkout), "log", "-1", "--format=%cI", repo.commit], { encoding: "utf8" }).trim();
  const pin = new Date(out), start = new Date(pin);
  start.setUTCMonth(start.getUTCMonth() - MONTHS);
  return { pinDate: iso(pin), windowStart: iso(start) };
}

class Client {
  points = 0; waits: string[] = [];
  constructor(private d: Deps) {}
  async query(query: string, variables: Record<string, unknown>): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = JSON.parse(this.d.gh(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables })));
        if (res.errors?.length && !res.data?.repository) throw new Error(`GraphQL: ${JSON.stringify(res.errors).slice(0, 300)}`);
        const rate = res.data?.rateLimit;
        if (rate) {
          this.points += rate.cost;
          if (rate.remaining < LOW) {
            const wait = Math.max(0, new Date(rate.resetAt).getTime() - this.d.now().getTime()) + 2000;
            this.waits.push(`remaining ${rate.remaining}, waited ${Math.round(wait / 1000)}s until ${rate.resetAt}`);
            this.d.log(`rate limit low (${rate.remaining}); waiting ${Math.round(wait / 1000)}s`);
            await this.d.sleep(wait);
          }
        }
        return res.data;
      } catch (e) {
        if (attempt >= 3) throw e;
        await this.d.sleep(2000 * attempt);
      }
    }
  }
}

type Conn = { pageInfo: { hasNextPage: boolean; endCursor?: string }; nodes: any[] };
/** Pages a connection further (at most MAX_PAGES in all); true when pages remain after the cap. */
async function drain(c: Client, repo: string, number: number, field: string, first: Conn): Promise<{ nodes: any[]; truncated: boolean }> {
  const nodes = [...first.nodes];
  let info = first.pageInfo;
  for (let pages = 1; info.hasNextPage && pages < MAX_PAGES; pages++) {
    const q = `query($owner:String!,$name:String!,$n:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$n){${conn(field, ",after:$after")}}} ${RATE}}`;
    const next: Conn = (await c.query(q, { owner: OWNER, name: repo, n: number, after: info.endCursor }))?.repository?.pullRequest?.[field];
    nodes.push(...next.nodes);
    info = next.pageInfo;
  }
  return { nodes, truncated: info.hasNextPage };
}

/** One pull request as the snapshot stores it: text cut at the pin date, logins only, emails and tokens scrubbed. */
async function shape(c: Client, repo: string, pr: any, pin: string, pinSha: string) {
  const pages: Pages = {};
  for (const f of ["comments", "reviews", "reviewThreads", "files"]) pages[f] = await drain(c, repo, pr.number, f, pr[f]);
  return shapePull(pr, pages, pin, pinSha);
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const readJson = (p: string) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
/** Writes only when the content differs; true when it wrote. */
function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text);
  return true;
}

export const snapshotDir = (o3Dir: string) => join(o3Dir, "github-snapshot");
export const MANIFEST = (evalDir: string) => join(evalDir, "datasets/github-snapshot.manifest.json");

export async function fetchSnapshot(o3Dir: string, repos: Repo[], deps: Deps, manifestPath: string): Promise<string> {
  const c = new Client(deps), lines: string[] = [];
  const before = (await c.query("query{" + RATE + "}", {})).rateLimit;
  deps.log(`graphql rate limit before: ${before ? `${before.remaining} remaining` : "unknown"}`);
  for (const repo of repos) {
    const { pinDate, windowStart } = await pinWindow(repo, o3Dir);
    const dir = join(snapshotDir(o3Dir), repo.name), pulls = join(dir, "pulls");
    mkdirSync(pulls, { recursive: true });
    // Phase 1: cheap listing of every pull request in the window (newest first, stop below the window).
    const listed: { number: number; updatedAt: string }[] = [];
    for (let after: string | null = null; ;) {
      const q: string = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number createdAt updatedAt}}} ${RATE}}`;
      const page: Conn = (await c.query(q, { owner: OWNER, name: repo.name, after }))?.repository?.pullRequests;
      for (const n of page.nodes) if (n.createdAt <= pinDate && n.createdAt >= windowStart) listed.push(n);
      if (!page.pageInfo.hasNextPage || page.nodes.at(-1)?.createdAt < windowStart) break;
      after = page.pageInfo.endCursor ?? null;
    }
    // Phase 2: full data for the ones without an up-to-date file, in aliased batches.
    const stale = listed.filter((p) => readJson(join(pulls, `${p.number}.json`))?.updatedAt !== (p.updatedAt < pinDate ? p.updatedAt : pinDate));
    let written = 0;
    const fetchBatch = async (nums: number[]): Promise<void> => {
      const q = detailQuery(nums, RATE);
      let data: any;
      try { data = await c.query(q, { owner: OWNER, name: repo.name }); } catch (e) {
        if (nums.length === 1) throw e;
        const half = nums.length >> 1;
        await fetchBatch(nums.slice(0, half)); await fetchBatch(nums.slice(half));
        return;
      }
      for (const n of nums) {
        const pr = data.repository[`p${n}`];
        if (pr && writeIfChanged(join(pulls, `${n}.json`), json(await shape(c, repo.name, pr, pinDate, repo.commit)))) written++;
      }
    };
    for (let i = 0; i < stale.length; i += BATCH) await fetchBatch(stale.slice(i, i + BATCH).map((p) => p.number));
    const count = readdirSync(pulls).filter((f) => f.endsWith(".json")).length;
    const old = readJson(join(dir, "_meta.json"));
    const meta = { repo: repo.name, owner: OWNER, pinSha: repo.commit, pinDate, windowStart, fetchedAt: written || !old || old.pullRequestCount !== count ? iso(deps.now()) : old.fetchedAt, pullRequestCount: count };
    writeIfChanged(join(dir, "_meta.json"), json(meta));
    lines.push(`${repo.name}: ${count} pull requests (${listed.length} in window, ${stale.length} fetched, ${written} files written)`);
    deps.log(lines.at(-1)!);
  }
  writeFileSync(manifestPath, json(computeManifest(o3Dir, repos)));
  lines.push(`API points used: ${c.points}`, `Rate-limit waits: ${c.waits.length ? c.waits.join("; ") : "none"}`, `Manifest: ${manifestPath}`);
  return lines.join("\n");
}

/** Per repository the sha256 of the lines "<number>:<sha256 of file>" in number order, and a top-level sha256 over the repository lines. */
export function computeManifest(o3Dir: string, repos: Repo[]) {
  const out: Record<string, { pullRequestCount: number; sha256: string }> = {};
  for (const r of repos) {
    const pulls = join(snapshotDir(o3Dir), r.name, "pulls");
    const files = readdirSync(pulls).filter((f) => f.endsWith(".json")).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b);
    out[r.name] = { pullRequestCount: files.length, sha256: sha(files.map((n) => `${n}:${sha(readFileSync(join(pulls, `${n}.json`)))}`).join("\n")) };
  }
  return { repositories: out, sha256: sha(Object.entries(out).map(([n, v]) => `${n}:${v.sha256}`).join("\n")) };
}

export function verifySnapshot(o3Dir: string, repos: Repo[], manifestPath: string): string {
  const now = computeManifest(o3Dir, repos), want = readJson(manifestPath);
  if (!want) throw new Error(`No manifest at ${manifestPath}.`);
  const bad = repos.filter((r) => want.repositories?.[r.name]?.sha256 !== now.repositories[r.name]!.sha256 || want.repositories[r.name].pullRequestCount !== now.repositories[r.name]!.pullRequestCount).map((r) => r.name);
  if (bad.length || want.sha256 !== now.sha256) throw new Error(`Snapshot differs from the manifest: ${bad.join(", ") || "top-level checksum"}.`);
  return `Snapshot matches the manifest: ${repos.length} repositories, ${Object.values(now.repositories).reduce((n, v) => n + v.pullRequestCount, 0)} pull requests, sha256 ${now.sha256}.`;
}

/** Gold change items (repo, commit, pr) of every question. */
export function goldPrs(dataset: { questions: { id: string; required?: unknown[] }[] }): GoldPr[] {
  return dataset.questions.flatMap((q) => (q.required ?? []).filter((r: any) => r.pr !== undefined && r.commit).map((r: any) => ({ repo: r.repo, commit: r.commit, pr: r.pr, id: q.id })));
}

/** Gold pull requests against the snapshot and the checkouts; throws the report when any violation is found. */
export function checkSnapshot(o3Dir: string, repos: Repo[], gold: GoldPr[]): string {
  const violations: string[] = [];
  const by = new Map(repos.map((r) => [r.name, r]));
  for (const g of gold) {
    const repo = by.get(g.repo), file = join(snapshotDir(o3Dir), g.repo, "pulls", `${g.pr}.json`);
    const label = `${g.id} ${g.repo}#${g.pr}`;
    if (!repo || !existsSync(file)) { violations.push(`${label}: missing from the snapshot`); continue; }
    const pr = readJson(file);
    if (!pr.merged) violations.push(`${label}: not merged in the snapshot`);
    if (pr.mergeCommitSha !== g.commit) violations.push(`${label}: mergeCommitSha ${pr.mergeCommitSha} differs from gold commit ${g.commit}`);
    try { execFileSync("git", ["-C", join(o3Dir, repo.checkout), "merge-base", "--is-ancestor", g.commit, repo.commit], { stdio: "ignore" }); }
    catch { violations.push(`${label}: commit ${g.commit} is not reachable from the pin ${repo.commit}`); }
  }
  let scanned = 0;
  for (const r of repos) {
    const pulls = join(snapshotDir(o3Dir), r.name, "pulls");
    for (const f of readdirSync(pulls)) {
      const strings: string[] = [];
      JSON.parse(readFileSync(join(pulls, f), "utf8"), (k, v) => { if (typeof v === "string" && k !== "path") strings.push(v); return v; }); // decoded, so a JSON "\n" cannot pose as an address; file paths such as uz@Latn.json are not mail
      scanned++;
      if (strings.some((t) => /\b(?:ghp_|gho_|github_pat_)/.test(t))) violations.push(`${r.name}/${f}: token-like string`);
      if (strings.some((t) => scrub(t) !== t)) violations.push(`${r.name}/${f}: email address`);
    }
  }
  const report = `Gold pull requests checked: ${gold.length}; snapshot files scanned: ${scanned}; violations: ${violations.length}`;
  if (violations.length) throw new Error([report, ...violations].join("\n"));
  return report;
}
