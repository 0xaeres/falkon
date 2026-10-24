/**
 * Real-token proof of the live pull request sync (D120), run by scripts/sync-smoke.sh against a throwaway database:
 * `tsx syncSmoke.ts <clone dir> <owner/name>...`, with DATABASE_URL and GITHUB_TOKEN in the environment. The token is read
 * from the environment by githubTransport and printed nowhere.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@falkon/db";
import { postgresProvenanceStore } from "@falkon/shared";
import { git } from "./git";
import { importDiscussions } from "./discussions";
import { githubSource, githubTransport, type GithubTransport } from "./githubDiscussions";

export interface RepoResult {
  repo: string;
  access: string;
  status: string;
  prs: number;
  /** Commit links from the merge sha and subject rules, and from the `commits/{sha}/pulls` fallback. */
  rule: number;
  api: number;
  /** The import threw (a bad token, no network, an HTTP failure). */
  failed?: boolean;
}

/** The first failing reason as a fixed message, or undefined for PASS. */
export function verdict(rs: RepoResult[]): string | undefined {
  for (const r of rs) {
    if (r.failed) return "sync failed: GitHub request failed (check that the token is valid and not expired)";
    if (r.access === "no-access") return "no access: the token cannot read pull requests of a repository (needs Pull requests: Read and Issues: Read)";
    if (r.status === "waiting") return "rate limited: the sync yielded before the budget ran out; retry after the reset time";
    if (r.status !== "ok") return "sync failed: the import did not finish";
  }
  if (!rs.reduce((n, r) => n + r.prs, 0)) return "no pull requests stored";
  if (!rs.reduce((n, r) => n + r.rule + r.api, 0)) return "no commit links";
  return undefined;
}

async function main() {
  const [dir, ...repos] = process.argv.slice(2);
  if (!dir || !repos.length) throw new Error("usage: syncSmoke <clone dir> <owner/name>...");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const store = postgresProvenanceStore(db);
  const real = await githubTransport({ token: { env: "GITHUB_TOKEN" } });
  const used = { rest: 0, graphql: 0 };
  const transport: GithubTransport = {
    get: (p, q) => (used.rest++, real.get(p, q)),
    graphql: (q, v) => (used.graphql++, real.graphql(q, v)),
  };
  // GET /rate_limit does not count against the budget
  const budget = async () => {
    try {
      const { resources } = (await real.get("/rate_limit", {})).data;
      return { rest: resources.core.remaining as number, graphql: resources.graphql.remaining as number };
    } catch {
      return undefined;
    }
  };
  const before = await budget();
  const results: RepoResult[] = [];
  for (const full of repos) {
    const name = `github.com/${full}`;
    const clone = path.join(dir, full.replace("/", "__") + ".git");
    const { id } = await db.repo.create({ data: { name, cloneUrl: `https://${name}.git`, external_id: name, external_codeHostType: "github", external_codeHostUrl: "https://github.com" } });
    const r: RepoResult = { repo: full, access: "unknown", status: "unknown", prs: 0, rule: 0, api: 0 };
    try {
      const head = await git(clone, ["rev-parse", "HEAD"]);
      await importDiscussions(store, githubSource({ transport }), { id, name, dir: clone, head }, []);
    } catch {
      r.failed = true; // a fixed message in the verdict: never the provider's text
    }
    const s = await store.syncState(id);
    r.access = s?.access ?? "unknown";
    r.status = s?.status ?? "unknown";
    r.prs = await db.discussion.count({ where: { repoId: id } });
    for (const l of await db.provenanceLink.groupBy({ by: ["source"], where: { repoId: id, fromKind: "commit" }, _count: true })) {
      if (l.source === "commit-pulls-api") r.api += l._count;
      else r.rule += l._count;
    }
    results.push(r);
    console.log(`repository ${full}: permission probe ${r.access}, status ${r.status}, ${r.prs} pull requests, ${r.rule} rule links, ${r.api} api links`);
  }
  const after = await budget();
  const sum = (k: "prs" | "rule" | "api") => results.reduce((n, r) => n + r[k], 0);
  console.log(`repositories synced: ${results.filter((r) => r.status === "ok" && r.access === "ok" && !r.failed).length} of ${results.length}`);
  console.log(`pull requests stored: ${sum("prs")}`);
  console.log(`commit links: ${sum("rule")} rule, ${sum("api")} api`);
  console.log(`requests used: ${used.rest} REST, ${used.graphql} GraphQL`);
  console.log(after ? `budget remaining: ${after.rest} REST, ${after.graphql} GraphQL${before ? ` (was ${before.rest} and ${before.graphql})` : ""}` : "budget remaining: unknown");
  const bad = verdict(results);
  console.log(bad ? `FAIL ${bad}` : "PASS");
  await db.$disconnect();
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.log("FAIL smoke run did not start: check DATABASE_URL, the clones and the token");
    process.exit(1);
  });
}
