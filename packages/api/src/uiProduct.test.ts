import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { productSchema, statusSchema } from "@sbc/contracts";
import { deriveStatus, toUiProduct, withPlaceholders, type ConnectionFacts, type RepoFacts } from "./uiProduct";

const NOW = new Date("2026-10-20T12:00:00Z");
const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
const repo = (name: string, over: Partial<RepoFacts> = {}): RepoFacts => ({
  name: `github.com/acme/${name}`, status: "INDEXED", defaultBranch: "main", headCommit: `${name}1234567890`, metadata: {}, pushedAt: at(30), lastIndexedAt: at(10), indexRequestedAt: null, createdAt: at(90), ...over,
});
const conn = (over: Partial<ConnectionFacts> = {}): ConnectionFacts => ({ credentialId: "c".repeat(22), host: "github.com", syncError: null, syncRequestedAt: null, ...over });
const pending = (name: string) => repo(name, { status: "PENDING", headCommit: null, lastIndexedAt: null });
const status = (repos: RepoFacts[], c: ConnectionFacts | null = conn()) => deriveStatus("p", repos, c, NOW);

test("no repo indexed yet: building, nothing active", () => {
  const s = status([pending("a"), repo("b", { status: "SYNCING" })]);
  assert.deepEqual([s.scenario, s.build, s.sync, s.generation, s.nextGeneration === null, s.stage, s.progress, s.verdict, s.sentence], ["building", "building", "current", null, false, 2, 0, "Building", "Indexing 0 of 2 repositories."]);
  assert.equal(s.generationAge, "not yet");
  const empty = status([]);
  assert.deepEqual([empty.scenario, empty.stage, empty.progress, empty.generation], ["building", 0, 0, null]);
});

test("some indexed, some in flight: updating", () => {
  const s = status([repo("a"), pending("b")]);
  assert.deepEqual([s.scenario, s.build, s.sync, s.stage, s.progress, s.verdict], ["updating", "building", "current", 3, 50, "Updating"]);
  assert.match(s.generation!, /^g-[0-9a-f]{6}$/);
  assert.notEqual(s.nextGeneration, s.generation);
});

test("a failed repo: failed, one gap per failed repo with the repo name only, raw error never surfaces", () => {
  const bad = (n: string) => repo(n, { status: "FAILED", headCommit: null, lastIndexedAt: null, metadata: { error: "SECRET provider text" } });
  const s = status([repo("a"), bad("b"), bad("c")]);
  assert.deepEqual([s.scenario, s.build, s.sync, s.verdict], ["failed", "idle", "failed", "Needs attention"]);
  assert.deepEqual(s.gaps, [
    { count: 1, title: "Repository failed to sync", detail: "github.com/acme/b" },
    { count: 1, title: "Repository failed to sync", detail: "github.com/acme/c" },
  ]);
  assert.equal(s.sentence, "Sync failed for github.com/acme/b, github.com/acme/c.");
  assert.equal(JSON.stringify(s).includes("SECRET"), false);
  assert.equal(status([bad("a")]).build, "failed");
});

test("a connection sync error alone is failed with no gaps", () => {
  const s = status([repo("a")], conn({ syncError: "Error: 401 token SECRET" }));
  assert.deepEqual([s.scenario, s.sync, s.gaps, s.sentence], ["failed", "failed", [], "The connection could not sync."]);
  assert.equal(JSON.stringify(s).includes("SECRET"), false);
});

test("every repo indexed and up to date: current, generation is the sha256 of the sorted name@commit pairs", () => {
  const repos = [repo("b"), repo("a")];
  const s = status(repos);
  const expected = "g-" + createHash("sha256").update("github.com/acme/a@a1234567890\ngithub.com/acme/b@b1234567890").digest("hex").slice(0, 6);
  assert.deepEqual([s.scenario, s.build, s.sync, s.stage, s.progress, s.generation, s.nextGeneration, s.generationAge, s.verdict], ["current", "idle", "current", 4, 100, expected, null, "10 min ago", "Current"]);
  assert.equal(status([...repos].reverse()).generation, expected, "order independent");
  assert.equal(status([repo("a", { headCommit: "other" }), repo("b")]).generation === expected, false);
});

test("pushed after the last index: partly-behind, still sync current", () => {
  const s = status([repo("a"), repo("b", { pushedAt: at(1) })]);
  assert.deepEqual([s.scenario, s.build, s.sync, s.verdict, s.sentence], ["partly-behind", "idle", "current", "Partly behind", "1 repository behind the latest push."]);
});

test("every status validates against the contract", () => {
  for (const repos of [[], [pending("a")], [repo("a")], [repo("a"), pending("b")], [repo("a", { status: "FAILED" })]]) statusSchema.parse(status(repos));
});

test("withPlaceholders fills a name that has no Repo row yet as PENDING", () => {
  const out = withPlaceholders(["github.com/acme/a", "github.com/acme/new"], [repo("a")], at(5));
  assert.deepEqual(out.map((r) => [r.name, r.status]), [["github.com/acme/a", "INDEXED"], ["github.com/acme/new", "PENDING"]]);
});

test("toUiProduct maps rows to the contract Product", () => {
  const repos = [repo("a", { metadata: { codeHostMetadata: { github: { language: "Go" } } }, indexRequestedAt: at(2) }), pending("new")];
  const c = conn({ syncRequestedAt: at(1) });
  const p = toUiProduct({ slug: "pay", name: "Payments platform", source: "api", definition: {}, repoNames: [], createdAt: at(90) }, repos, c, status(repos, c));
  assert.deepEqual(productSchema.parse(p), p);
  assert.deepEqual([p.id, p.initials, p.provider, p.host, p.scenario, p.queuedAt, p.connectionId, p.activeGeneration], ["pay", "PP", "github", "github.com", "updating", at(1).getTime(), "c".repeat(22), status(repos, c).generation]);
  assert.deepEqual(p.repositories[0], { id: "github.com/acme/a", name: "a", organization: "acme", language: "Go", revision: "a123456", updated: at(30).toISOString(), branches: ["main"], branch: "main" });
  assert.deepEqual(p.repositories[1], { id: "github.com/acme/new", name: "new", organization: "acme", language: "", revision: "", updated: at(30).toISOString(), branches: ["main"], branch: "main" });
});

test("toUiProduct: GitHub Enterprise by host; a config Product with no connection is github with an empty host", () => {
  const row = { slug: "core", name: "core", source: "config" as const, definition: {}, repoNames: [], createdAt: at(1) };
  const ghe = toUiProduct(row, [], conn({ host: "ghe.example.com" }), status([]));
  assert.deepEqual([ghe.provider, ghe.host], ["github-enterprise", "ghe.example.com"]);
  const none = toUiProduct(row, [], null, status([], null));
  assert.deepEqual([none.provider, none.host, none.connectionId, none.queuedAt], ["github", "", undefined, null]);
});
