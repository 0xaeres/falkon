import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { searchResponseSchema } from "@falkon/contracts";
import { search, setZoektTransport, type WSearchRequest, type WSearchResponse } from "@falkon/shared";
import { normalize } from "../../../tests/golden/normalize";
import { createAdminApp } from "./admin";
import { SearchService } from "./search";

const TOKEN = "t".repeat(40);
const ONE = "h/a/one";
const TWO = "h/b/two";
const products: Record<string, string[]> = { alpha: [ONE], beta: [TWO], both: [ONE, TWO] };
// Contexts as synced from config: `fixtures` spans both Products' repositories.
const contexts = [{ name: "fixtures", repoNames: [ONE, TWO] }];
const db = {
  product: { findUnique: async ({ where }: { where: { slug: string } }) => (products[where.slug] ? { repoNames: products[where.slug] } : null) },
  searchContext: { findMany: async () => contexts },
};

const loc = (line: number, column: number) => ({ byte_offset: 0, line_number: line, column });
const hit = (repo: string, text = "needle"): WSearchResponse["files"][number] => ({
  file_name: Buffer.from("src/x.ts"),
  repository: repo,
  branches: ["HEAD"],
  language: "TypeScript",
  chunk_matches: [{ content: Buffer.from(text + "\n"), content_start: loc(1, 1), file_name: false, ranges: [{ start: loc(1, 1), end: loc(1, 7) }], symbol_info: [] }],
});
// Zoekt stand-in that ignores the query and returns a hit in both repositories: the route alone must keep the other Product out.
let requests: WSearchRequest[] = [];
let fail: Error | undefined;
setZoektTransport({
  async search(req) {
    requests.push(req);
    if (fail) throw fail;
    return { files: [hit(ONE), hit(TWO)], stats: { match_count: 2, file_count: 2 } };
  },
  stream: async function* () {},
});

let admin: INestApplication;
let base: string;
before(async () => {
  admin = await createAdminApp({} as never, TOKEN, {}, undefined, undefined, undefined, new SearchService(db as never));
  await admin.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(admin.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => {
  setZoektTransport(undefined);
  await admin.close();
});
afterEach(() => {
  requests = [];
  fail = undefined;
});

const get = async (slug: string, params: Record<string, string>) => {
  const res = await fetch(`${base}/ui/products/${slug}/search?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, json: (await res.json()) as any };
};
const repos = (json: any) => json.files.map((f: { repo: string }) => f.repo);

test("a Product's search never shows another Product's repository, with counts to match", async () => {
  const a = await get("alpha", { q: "needle" });
  assert.equal(a.status, 200);
  assert.deepEqual(repos(a.json), [ONE]);
  assert.equal(a.json.fileCount, 1);
  assert.equal(a.json.matchCount, 1);
  assert.deepEqual(repos((await get("beta", { q: "needle" })).json), [TWO]);
  assert.deepEqual(repos((await get("both", { q: "needle" })).json).sort(), [ONE, TWO]);
  assert.match(JSON.stringify(requests[0]!.query), /\^\(\?:/); // the scope also narrows the query sent to zoekt
  assert.equal(JSON.stringify(requests[0]!.query).includes("two"), false);
});

test("repo: and context: naming another Product's repository return nothing from it", async () => {
  assert.equal(repos((await get("alpha", { q: "repo:two needle" })).json).includes(TWO), false);
  assert.deepEqual(repos((await get("alpha", { q: "context:fixtures needle" })).json), [ONE]);
  assert.deepEqual(repos((await get("beta", { q: "context:fixtures needle" })).json), [TWO]);
});

test("errors: empty query, bad syntax, unknown context, unknown Product, bad params, zoekt failure", async () => {
  assert.equal((await get("alpha", { q: "  " })).status, 400);
  const syntax = await get("alpha", { q: "file:" });
  assert.equal(syntax.status, 400);
  assert.ok(syntax.json.message);
  assert.equal((await get("alpha", { q: "context:nope x" })).status, 404);
  assert.equal((await get("ghost", { q: "x" })).status, 404);
  assert.equal((await get("Bad_Slug", { q: "x" })).status, 404);
  assert.equal((await get("alpha", { q: "x", regex: "maybe" })).status, 400);
  fail = new Error("deadline exceeded: tcp://zoekt:6070");
  const down = await get("alpha", { q: "needle" });
  assert.equal(down.status, 502);
  assert.equal(JSON.stringify(down.json).includes("zoekt:6070"), false);
});

test("limit defaults to 500, is capped at 5000, and regex and case reach the query", async () => {
  await get("alpha", { q: "needle" });
  await get("alpha", { q: "needle", limit: "99999" });
  assert.deepEqual(requests.map((r) => r.opts.max_match_display_count), [500, 5000]);
  requests = [];
  await get("alpha", { q: "a.c", regex: "1", case: "1" });
  assert.match(JSON.stringify(requests[0]!.query), /"regexp":"a\.c"/);
  assert.match(JSON.stringify(requests[0]!.query), /"case_sensitive":true/);
});

test("the golden search set returns identical results through the route and through @falkon/shared", async () => {
  const queries = JSON.parse(fs.readFileSync(new URL("../../../tests/golden/queries.json", import.meta.url), "utf8")) as { id: string; query: string; regex?: boolean; case?: boolean; limit?: number; repos?: string[] }[];
  const ctx = Object.fromEntries(contexts.map((c) => [c.name, c.repoNames]));
  for (const q of queries) {
    const text = q.repos?.length ? `(${q.query}) reposet:${q.repos.join(",")}` : q.query;
    const direct = await (async () => search(text, { regex: q.regex, caseSensitive: q.case, matches: q.limit ?? 500, contexts: ctx }))().catch((e) => e);
    const routed = await get("both", { q: text, regex: q.regex ? "1" : "0", case: q.case ? "1" : "0", limit: String(q.limit ?? 500) });
    if (direct instanceof Error) assert.ok(routed.status >= 400, q.id);
    else assert.deepEqual(normalize(routed.json), normalize(direct), q.id);
  }
  assert.ok(queries.length >= 40);
});

test("the route's body parses as the UI search contract", async () => {
  searchResponseSchema.parse((await get("alpha", { q: "needle" })).json);
});
