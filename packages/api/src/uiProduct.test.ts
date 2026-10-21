import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { productSchema, statusSchema } from "@sbc/contracts";
import { deriveKnowledge, deriveStatus, toUiProduct, withPlaceholders, type ConnectionFacts, type RepoFacts } from "./uiProduct";

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
  assert.deepEqual(p.repositories[0], { id: "github.com/acme/a", name: "a", organization: "acme", language: "Go", revision: "a123456", updated: at(30).toISOString(), branches: ["main"], branch: "main", state: "indexed" });
  assert.deepEqual(p.repositories[1], { id: "github.com/acme/new", name: "new", organization: "acme", language: "", revision: "", updated: at(30).toISOString(), branches: ["main"], branch: "main", state: "pending" });
});

test("toUiProduct: GitHub Enterprise by host; a config Product with no connection is github with an empty host", () => {
  const row = { slug: "core", name: "core", source: "config" as const, definition: {}, repoNames: [], createdAt: at(1) };
  const ghe = toUiProduct(row, [], conn({ host: "ghe.example.com" }), status([]));
  assert.deepEqual([ghe.provider, ghe.host], ["github-enterprise", "ghe.example.com"]);
  const none = toUiProduct(row, [], null, status([], null));
  assert.deepEqual([none.provider, none.host, none.connectionId, none.queuedAt], ["github", "", undefined, null]);
});

// ---- knowledge status (D43) ----
type Scan = NonNullable<RepoFacts["scan"]>;
const kb = (name: string, scan: Scan | null, over: Partial<RepoFacts> = {}) => repo(name, { kbScannedCommit: `${name}1234567890`, scan, ...over });
const know = (repos: RepoFacts[], enabled = true, model = true) => deriveKnowledge(enabled, model, repos);

test("knowledge: off wins, then no-model, regardless of scans", () => {
  assert.deepEqual(know([kb("a", "RUNNING")], false, false), { state: "off" });
  assert.deepEqual(know([kb("a", "RUNNING")], true, false), { state: "no-model", detail: "No model configured" });
});

test("knowledge: precedence scanning > failed > budget-exhausted > pending > ready", () => {
  const ok = kb("ok", "SUCCEEDED");
  assert.equal(know([ok]).state, "ready");
  assert.equal(know([ok, repo("fresh", { scan: null, kbScannedCommit: null })]).state, "pending");
  assert.equal(know([ok, repo("moved", { scan: "SUCCEEDED", kbScannedCommit: "old" })]).state, "pending");
  assert.equal(know([repo("fresh", { scan: null }), kb("b", "BUDGET_EXHAUSTED")]).state, "budget-exhausted");
  assert.equal(know([kb("b", "BUDGET_EXHAUSTED"), kb("f", "FAILED")]).state, "failed");
  assert.equal(know([kb("f", "FAILED"), kb("r", "RUNNING")]).state, "scanning");
});

test("knowledge: unindexed repos do not make it pending; excluded repos are ignored; failure detail is fixed text", () => {
  assert.equal(know([kb("a", "SUCCEEDED"), pending("b")]).state, "ready");
  assert.equal(know([kb("a", "SUCCEEDED"), kb("x", "FAILED", { kbExcluded: true })]).state, "ready");
  assert.equal(know([repo("x", { scan: null, kbExcluded: true })]).state, "ready");
  assert.deepEqual(know([kb("f", "FAILED")]), { state: "failed", detail: "Last scan failed" });
});

test("knowledge: a SKIPPED latest scan is done when scanned at head, pending when not; no scan row but scanned at head is ready", () => {
  assert.equal(know([kb("a", "SKIPPED")]).state, "ready");
  assert.equal(know([repo("a", { scan: "SKIPPED", kbScannedCommit: "old" })]).state, "pending");
  assert.equal(know([kb("a", null)]).state, "ready");
});

test("knowledge: repos the config does not select are ignored", () => {
  const stale = repo("a", { scan: null, kbScannedCommit: null });
  assert.equal(know([stale]).state, "pending");
  assert.deepEqual(deriveKnowledge(true, true, [stale, kb("b", "FAILED")], (n) => n.endsWith("/a")), { state: "pending" });
  assert.equal(deriveKnowledge(true, true, [stale], () => false).state, "ready");
});

// D69: a name the connection's last clean sync did not return has no Repo row; it is Skipped, not forever Pending.
const skipped = (name: string) => repo(name, { status: "SKIPPED", headCommit: null, lastIndexedAt: null });

test("withPlaceholders marks a name with no Repo row SKIPPED once its connection has synced cleanly", () => {
  const out = withPlaceholders(["github.com/acme/a", "github.com/acme/gone"], [repo("a")], at(5), true);
  assert.deepEqual(out.map((r) => [r.name, r.status]), [["github.com/acme/a", "INDEXED"], ["github.com/acme/gone", "SKIPPED"]]);
});

test("every repo skipped: 'No repositories could be indexed', not Building, and nothing counts as indexing", () => {
  const s = status([skipped("a"), skipped("b")]);
  assert.deepEqual([s.verdict, s.scenario, s.build, s.progress, s.generation], ["No repositories could be indexed", "failed", "failed", 0, null]);
  assert.ok(!/Indexing/.test(s.sentence));
  assert.deepEqual(s.gaps.map((g) => g.detail), ["github.com/acme/a", "github.com/acme/b"]);
  statusSchema.parse(s);
});

test("one skipped plus one indexed: the skipped repo is out of 'N of M' and the Product is current, with a gap naming it", () => {
  const s = status([repo("a"), skipped("b")]);
  assert.deepEqual([s.scenario, s.build, s.progress, s.verdict], ["current", "idle", 100, "Current"]);
  assert.match(s.sentence, /all 1 repository\b/);
  assert.deepEqual(s.gaps, [{ count: 1, title: "Repository skipped", detail: "github.com/acme/b" }]);
  const building = status([pending("a"), skipped("b")]);
  assert.deepEqual([building.verdict, building.sentence], ["Building", "Indexing 0 of 1 repository."]);
});

test("none skipped: unchanged, no skipped gap", () => {
  const s = status([repo("a"), pending("b")]);
  assert.deepEqual([s.sentence, s.gaps], [`Answers use ${s.generation}. Indexing 1 of 2 repositories.`, []]);
});

test("toUiProduct gives each repository a state; a skipped one has state skipped and no reason when none is recorded", () => {
  const repos = [repo("a"), pending("b"), repo("c", { status: "SYNCING" }), repo("d", { status: "FAILED" }), skipped("e")];
  const p = toUiProduct({ slug: "pay", name: "Pay", source: "api", definition: {}, repoNames: [], createdAt: at(90) }, repos, conn(), status(repos));
  assert.deepEqual(productSchema.parse(p).repositories.map((r) => r.state), ["indexed", "pending", "indexing", "failed", "skipped"]);
  assert.ok(!("reason" in p.repositories[4]!));
});
