import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { createAdminApp } from "./admin";
import { ConnectionService } from "./connections";
import { fakeEngineDb } from "./fakeEngineDb";
import { KnowledgeService } from "./knowledge";
import { PrismaProductRegistry } from "./product";
import { UiProductService } from "./ui";

process.env.LLM_BASE_URL = "http://llm.test";
process.env.LLM_API_KEY = "k";
process.env.LLM_MODEL = "m";
const TOKEN = "t".repeat(40);
const ONE = "github.com/acme/one";
const TWO = "github.com/acme/two";
const engine = fakeEngineDb();
let enabled = true;
let clock = 0; // the config is cached for 30 s: moving the clock past it makes the next request re-read the flag
let admin: INestApplication;
let base: string;
before(async () => {
  const indexed = { status: "INDEXED", headCommit: "abc1234567" };
  engine.addRepo(ONE, indexed);
  engine.addRepo(TWO, indexed);
  for (const [slug, repos] of [["alpha", [ONE]], ["beta", [TWO]], ["both", [ONE, TWO]]] as [string, string[]][]) {
    await engine.product.create({ data: { slug, name: slug, source: "api", definition: { include: repos }, repoNames: repos } });
  }
  const ui = new UiProductService(engine.db, new ConnectionService(engine.db as never), () => clock, async () => ({ enabled, repos: "all" }) as never);
  admin = await createAdminApp(new PrismaProductRegistry(engine.db as never), TOKEN, {}, undefined, ui, undefined, undefined, new KnowledgeService(engine.db, ui));
  await admin.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(admin.getHttpServer().address() as AddressInfo).port}`;
});
after(() => admin.close());

const post = async (slug: string, body: unknown) => {
  const res = await fetch(`${base}/ui/products/${slug}/knowledge`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const row = (name: string) => engine.repos.find((r: any) => r.name === name)!;
const clear = () => engine.repos.forEach((r: any) => ((r.kbRequest = null), (r.kbRequestedAt = null)));

test("scan, delete and include set kbRequest and kbRequestedAt and the returned status is pending", async () => {
  for (const action of ["scan", "delete", "include"]) {
    clear();
    const r = await post("alpha", { repo: ONE, action });
    assert.equal(r.status, 201, action);
    assert.equal(row(ONE).kbRequest, action);
    assert.ok(row(ONE).kbRequestedAt instanceof Date);
    assert.equal(r.json.knowledge.state, "pending");
  }
});

test("a repository outside the Product is refused exactly like an unknown one, and left untouched", async () => {
  clear();
  const outside = await post("alpha", { repo: TWO, action: "scan" });
  const unknown = await post("alpha", { repo: "github.com/acme/nope", action: "scan" });
  assert.equal(outside.status, 404);
  assert.deepEqual(outside, unknown);
  assert.equal(row(TWO).kbRequest ?? null, null);
});

test("a repository in two Products can be targeted from either", async () => {
  clear();
  assert.equal((await post("both", { repo: ONE, action: "scan" })).status, 201);
  assert.equal(row(ONE).kbRequest, "scan");
  clear();
  assert.equal((await post("alpha", { repo: ONE, action: "delete" })).status, 201);
  assert.equal(row(ONE).kbRequest, "delete");
  assert.equal((await post("beta", { repo: ONE, action: "scan" })).status, 404);
});

test("an unknown Product is 404, a bad action or body is 400", async () => {
  assert.equal((await post("nope", { repo: ONE, action: "scan" })).status, 404);
  for (const b of [{ repo: ONE, action: "drop" }, { repo: ONE }, { action: "scan" }, { repo: ONE, action: "scan", x: 1 }]) {
    assert.equal((await post("alpha", b)).status, 400, JSON.stringify(b));
  }
});

test("a double click is idempotent: the same request, still one pending action", async () => {
  clear();
  await post("alpha", { repo: ONE, action: "scan" });
  const again = await post("alpha", { repo: ONE, action: "scan" });
  assert.equal(again.status, 201);
  assert.equal(row(ONE).kbRequest, "scan");
});

test("knowledge base disabled in config: refused with a clear message, nothing written", async () => {
  clear();
  enabled = false;
  clock += 60_000;
  const r = await post("alpha", { repo: ONE, action: "scan" });
  enabled = true;
  clock += 60_000;
  assert.equal(r.status, 409);
  assert.equal(r.json.errorCode, "KNOWLEDGE_BASE_DISABLED");
  assert.match(r.json.message, /turned off/);
  assert.equal(row(ONE).kbRequest ?? null, null);
});
