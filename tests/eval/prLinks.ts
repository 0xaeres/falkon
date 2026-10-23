/**
 * S48 verify: on the `stack up --prs on` stack, every gold (commit, pull request) pair of o3-history is a verified commit link,
 * plus pull requests imported per repository, import time and the size of the new tables.
 * Run: `pnpm --filter @falkon/eval exec tsx prLinks.ts` (EVAL_PRS_PROJECT overrides the compose project falkon-eval-prs).
 * Exits 1 when a gold pair is not linked and verified.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { goldPrs } from "./discussions.js";

const project = process.env.EVAL_PRS_PROJECT ?? "falkon-eval-prs";
const psql = (sql: string) => execFileSync("docker", ["exec", "-i", `${project}-postgres-1`, "psql", "-U", "falkon", "-d", "falkon", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const gold = goldPrs(JSON.parse(readFileSync(join(import.meta.dirname, "datasets/o3-history.json"), "utf8")));
const pairs = [...new Map(gold.map((g) => [`${g.repo} ${g.commit} ${g.pr}`, g])).values()];
const values = pairs.map((g) => `(${lit(`github.com/openmrs/${g.repo}`)}, ${lit(g.commit)}, ${lit(String(g.pr))})`).join(",\n");
const missing = psql(`WITH gold(repo, sha, pr) AS (VALUES ${values})
SELECT g.repo, g.sha, g.pr, coalesce(string_agg(l.source || ':' || l.verified || ':' || l."toRef", ','), 'no link') FROM gold g
LEFT JOIN "Repo" r ON r.name = g.repo
LEFT JOIN "ProvenanceLink" l ON l."repoId" = r.id AND l."fromKind" = 'commit' AND l."fromRef" = g.sha AND l."toKind" = 'pr'
GROUP BY g.repo, g.sha, g.pr HAVING NOT bool_or(coalesce(l.verified AND l."toRef" = g.pr, false)) ORDER BY 1, 3;`);
const bad = missing ? missing.split("\n") : [];
console.log(`gold change units: ${gold.length}; distinct (commit, pull request) pairs: ${pairs.length}; linked and verified: ${pairs.length - bad.length}`);
for (const line of bad) console.log(`  NOT LINKED ${line}`);
console.log("\nrepository\tpull requests\tcommit links (verified/all)\timport ms (last run)");
console.log(psql(`SELECT r.name, s."importedCount", (SELECT count(*) FILTER (WHERE verified) || '/' || count(*) FROM "ProvenanceLink" l WHERE l."repoId" = r.id AND l."fromKind" = 'commit'),
  round(extract(epoch FROM s."lastSuccessAt" - s."lastRunAt") * 1000) FROM "DiscussionSyncState" s JOIN "Repo" r ON r.id = s."repoId" ORDER BY 1;`));
console.log(psql(`SELECT 'total pull requests ' || count(*) FROM "Discussion";
SELECT 'first import start to last finish (s): ' || round(extract(epoch FROM max("lastSuccessAt") - min("lastRunAt"))) FROM "DiscussionSyncState";
SELECT 'database ' || pg_size_pretty(pg_database_size('falkon'));
SELECT 'new tables ' || pg_size_pretty(sum(pg_total_relation_size(c))::bigint) FROM unnest(ARRAY['"Discussion"', '"DiscussionComment"', '"DiscussionFile"', '"ProvenanceLink"', '"DiscussionSyncState"']::regclass[]) c;`));
if (bad.length) process.exit(1);
