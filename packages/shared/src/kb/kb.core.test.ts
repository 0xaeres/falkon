import { test } from "node:test";
import assert from "node:assert/strict";
import { demoteCitations, extractCitations } from "./citations";
import { extractTitle } from "./markdown";
import { isConceptPath, isDocPath, isSystemSlug } from "./paths";
import { carveTerritories, isNoise } from "./territories";
import { checkCandidates, checkReport, checkSystemList, checkWorkList, type SurveyReport, type System } from "./validate";
import { computeTriage, touches, type DocRecord } from "./triage";
import { parseNameStatus, type DiffRecord, type RepoSource } from "./source";

test("concept paths: two kebab segments, specific concept, no repeats", () => {
  assert.ok(isConceptPath("scan-engine/ordering-guarantees.md"));
  assert.ok(!isConceptPath("scan-engine/overview.md"));
  assert.ok(!isConceptPath("scan-engine/scan-engine.md"));
  assert.ok(!isConceptPath("ScanEngine/x.md"));
  assert.ok(!isConceptPath("a/b/c.md"));
  assert.ok(!isConceptPath("x.md"));
  assert.ok(!isConceptPath(`${"a".repeat(65)}/x.md`));
  assert.ok(isSystemSlug("auth-flow") && !isSystemSlug("overview") && !isSystemSlug("Auth"));
});

test("doc paths reject traversal, globs, backslashes and non-markdown", () => {
  for (const bad of ["../x.md", "/x.md", "a//b.md", "a\\b.md", "a/*.md", "a/b.txt", ":x.md", "a/./b.md", ""]) assert.ok(!isDocPath(bad), bad);
  assert.ok(isDocPath("legacy.md") && isDocPath("a/b.md"));
});

test("citations: found in prose, ignored in fences and inline code, deduped, line ranges allowed", () => {
  const body = [
    "# T",
    "See @file:{acme/app::src/a.ts} and @file:{acme/app::src/a.ts:10-20} and @file:{other/lib::pkg/b.go}.",
    "`@file:{acme/app::src/inline.ts}` is code.",
    "```",
    "@file:{acme/app::src/fenced.ts}",
    "```",
    "    @file:{acme/app::src/indented.ts}",
  ].join("\n");
  assert.deepEqual(extractCitations(body), [
    { repo: "acme/app", path: "src/a.ts" },
    { repo: "other/lib", path: "pkg/b.go" },
  ]);
  assert.equal(extractTitle("intro\n\n# Real title #\n"), "Real title");
  assert.equal(demoteCitations("x @file:{a/b::c.ts} y @file:{a/b::d.ts}", [{ repo: "a/b", path: "c.ts" }]), "x `a/b::c.ts` y @file:{a/b::d.ts}");
});

test("territories pack siblings under the budget and descend into heavy directories", () => {
  const files = [
    ...Array.from({ length: 6 }, (_, i) => ({ path: `big/f${i}.ts`, size: 10_000 })),
    { path: "a.ts", size: 1000 }, { path: "b.ts", size: 1000 }, { path: "small/x.ts", size: 1000 },
  ];
  const ts = carveTerritories(files, { weight: 25_000, maxScouts: 100 });
  assert.ok(ts.length >= 3);
  assert.deepEqual(ts.map((t) => t.id), ts.map((_, i) => `t0${i + 1}`));
  const covered = ts.flatMap((t) => t.prefixes);
  for (const f of files) assert.ok(covered.some((p) => f.path === p || f.path.startsWith(p + "/")), f.path);
  assert.equal(carveTerritories([]).length, 1);
  // maxScouts raises the budget so a huge repo never yields more territories than scouts
  const many = Array.from({ length: 400 }, (_, i) => ({ path: `d${i}/f.ts`, size: 30_000 }));
  assert.ok(carveTerritories(many, { weight: 1000, maxScouts: 8 }).length <= 8);
  assert.ok(isNoise("node_modules/x/y.js") && isNoise("a/b.min.js") && isNoise("pnpm-lock.yaml") && !isNoise("src/a.ts"));
});

const sys = (slug: string, docs: string[] = []): System => ({ slug, name: slug, thesis: "t", evidenceAnchors: ["a.ts"], assignedDocPaths: docs });

test("candidate and system-list validation", () => {
  assert.equal(checkCandidates({ systems: [] }).ok, false);
  assert.equal(checkCandidates({ systems: [], territoryTooBig: true }).ok, true);
  assert.equal(checkCandidates({ systems: [{ name: "x", thesis: "", evidenceAnchors: ["a"] }] }).ok, false);
  const existing = ["auth/tokens.md", "queue/retry.md"];
  assert.equal(checkSystemList({ systems: [sys("auth", ["auth/tokens.md"]), sys("queue", ["queue/retry.md"])] }, existing, existing).ok, true);
  const missing = checkSystemList({ systems: [sys("auth", ["auth/tokens.md"])] }, existing, existing);
  assert.ok(!missing.ok && missing.reason === "unassigned");
  assert.ok(!checkSystemList({ systems: [sys("a"), sys("a")] }, [], []).ok);
  assert.ok(!checkSystemList({ systems: [sys("Bad_Slug")] }, [], []).ok);
  assert.ok(!checkSystemList({ systems: [sys("a", ["nope.md"])] }, [], []).ok);
  assert.ok(!checkSystemList({ systems: Array.from({ length: 25 }, (_, i) => sys(`s${i}`)) }, [], []).ok);
});

test("report validation: dispositions cover assigned docs, merge needs a target, proposals follow the path rule", () => {
  const base = { systemSummary: "s", proposedNewDocs: [] as any[] };
  assert.ok(checkReport({ ...base, dispositions: [{ path: "a/x.md", disposition: "keep" }] }, ["a/x.md"]).ok);
  assert.ok(!checkReport({ ...base, dispositions: [] }, ["a/x.md"]).ok);
  assert.ok(!checkReport({ ...base, dispositions: [{ path: "a/x.md", disposition: "merge" }] }, ["a/x.md"]).ok);
  assert.ok(!checkReport({ ...base, dispositions: [{ path: "a/x.md", disposition: "keep", mergeInto: "a/y.md" }] }, ["a/x.md"]).ok);
  const prop = (path: string, claims = ["c in f.ts"]) => ({ path, rationale: "r", keyClaims: claims, keyFiles: ["f.ts"] });
  assert.ok(checkReport({ ...base, dispositions: [], proposedNewDocs: [prop("a/new-thing.md")] }, []).ok);
  assert.ok(!checkReport({ ...base, dispositions: [], proposedNewDocs: [prop("a/overview.md")] }, []).ok);
  assert.ok(!checkReport({ ...base, dispositions: [], proposedNewDocs: [prop("a/new-thing.md", [])] }, []).ok);
  assert.ok(!checkReport({ ...base, dispositions: [], proposedNewDocs: Array.from({ length: 7 }, (_, i) => prop(`a/thing-${i}.md`)) }, []).ok);
});

test("work list validation: coverage, new-path rule, sources, absorbs", () => {
  const existing = ["a/old-one.md", "a/old-two.md"];
  const systems = [sys("a", existing)];
  const reports: SurveyReport[] = [
    { system: systems[0]!, report: { systemSummary: "s", dispositions: existing.map((path) => ({ path, disposition: "keep" as const })), proposedNewDocs: [{ path: "a/fresh-idea.md", rationale: "r", keyClaims: ["c"], keyFiles: ["f"] }] } },
  ];
  const ok = { items: [{ path: "a/old-one.md", action: "keep" as const }, { path: "a/old-two.md", action: "keep" as const }, { path: "a/fresh-idea.md", action: "create" as const, sources: [{ system: "a", path: "a/fresh-idea.md" }] }], deletes: [] };
  assert.ok(checkWorkList(ok, existing, existing, "full", { systems, reports }).ok);

  const miss = checkWorkList({ ...ok, items: ok.items.slice(1) }, existing, existing, "full", { systems, reports });
  assert.ok(!miss.ok && miss.reason === "coverage");
  const noSrc = checkWorkList({ ...ok, items: [...ok.items.slice(0, 2), { path: "a/fresh-idea.md", action: "create", sources: [] }] }, existing, existing, "full", { systems, reports });
  assert.ok(!noSrc.ok && noSrc.reason === "no_sources");
  const generic = checkWorkList({ ...ok, items: [...ok.items.slice(0, 2), { path: "a/overview.md", action: "create", sources: [{ system: "a", path: "a/fresh-idea.md" }] }] }, existing, existing, "full", { systems, reports });
  assert.ok(!generic.ok && generic.reason === "bad_paths");
  const mergeNone = checkWorkList({ items: [{ path: "a/old-one.md", action: "merge" }, { path: "a/old-two.md", action: "keep" }], deletes: [] }, existing, existing, "full", { systems, reports: [] });
  assert.ok(!mergeNone.ok && mergeNone.reason === "merge_without_absorbs");
  const merged = checkWorkList({ items: [{ path: "a/old-one.md", action: "merge", absorbs: ["a/old-two.md"] }], deletes: [] }, existing, existing, "full", { systems, reports: [] });
  assert.ok(merged.ok);
  const readme = checkWorkList({ items: [{ path: "README.md", action: "keep" }], deletes: [] }, existing, existing, "full", { systems, reports: [] });
  assert.ok(!readme.ok && readme.reason === "readme");
  // delta: an unaffected doc may only be an absorb target
  const delta = checkWorkList({ items: [{ path: "a/old-two.md", action: "keep" }, { path: "a/old-one.md", action: "keep" }], deletes: [] }, existing, ["a/old-one.md"], "delta", { systems, reports: [] });
  assert.ok(!delta.ok && delta.reason === "untouchable");
});

// ---- triage ----------------------------------------------------------------

function fakeSource(name: string, commit: string, diffs: Record<string, DiffRecord[] | "missing-base">): RepoSource {
  return {
    name, commit,
    listFiles: async () => [], listTree: async () => [], readFile: async () => undefined, exists: async () => true,
    grep: async () => "", log: async () => "",
    diff: async (base) => (base === commit ? [] : (diffs[base] ?? "missing-base")),
    commitsSince: async (base) => (diffs[base] === "missing-base" || !(base in diffs) ? "missing-base" : [{ sha: "abcdef0123", subject: "change" }]),
  };
}
const doc = (path: string, cites: [string, string][], at = "c1"): DocRecord => ({
  path, title: path, summary: "s", citations: cites.map(([repo, p]) => ({ repo, path: p, commit: at })), generatedAtCommit: at, model: "m", scanId: 1,
});
const NOW = new Date("2026-10-18T00:00:00Z");
const RECENT = new Date("2026-10-17T00:00:00Z");
const base = { now: NOW, lastFullScanAt: RECENT, lastScanCommit: "c1", resolveRepo: async () => undefined as RepoSource | undefined };

test("parseNameStatus handles renames, copies and plain records", () => {
  assert.deepEqual(parseNameStatus("M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0"), [
    { status: "M", path: "a.ts" }, { status: "R100", oldPath: "old.ts", path: "new.ts" }, { status: "D", path: "gone.ts" },
  ]);
  assert.throws(() => parseNameStatus("R100\0only-one\0"));
  assert.equal(touches({ status: "R90", oldPath: "o", path: "n" }, "o"), "renamed");
  assert.equal(touches({ status: "D", path: "x" }, "x"), "changed");
});

test("delta triage: finds docs by cited files, renames, and uncovered changes", async () => {
  const owner = fakeSource("acme/app", "c2", { c1: [{ status: "M", path: "src/a.ts" }, { status: "R100", oldPath: "src/old.ts", path: "src/new.ts" }, { status: "A", path: "src/fresh.ts" }, { status: "D", path: "src/dead.ts" }] });
  const existing = [doc("a/one.md", [["acme/app", "src/a.ts"], ["acme/app", "src/stable.ts"]]), doc("a/two.md", [["acme/app", "src/old.ts"]]), doc("a/three.md", [["acme/app", "src/stable.ts"], ["acme/app", "src/stable2.ts"], ["acme/app", "src/stable3.ts"], ["acme/app", "src/stable4.ts"]])];
  const t = await computeTriage({ ...base, requested: "delta", owner, existing });
  assert.equal(t.mode, "delta");
  if (t.mode !== "delta") return;
  assert.deepEqual(t.affected.map((a) => a.path), ["a/one.md", "a/two.md"]);
  assert.deepEqual(t.affected[1]!.renames, [{ repo: "acme/app", from: "src/old.ts", to: "src/new.ts" }]);
  assert.deepEqual(t.uncovered.sort(), ["src/fresh.ts"]); // the rename target is not "uncovered": its old path is cited
  assert.equal(t.commitLog.length, 1);
});

test("delta triage escalates to full when it cannot trust an incremental update", async () => {
  const owner = fakeSource("acme/app", "c2", { c1: [{ status: "M", path: "src/a.ts" }] });
  const docs = [doc("a/one.md", [["acme/app", "src/a.ts"]])];
  const why = async (o: Partial<Parameters<typeof computeTriage>[0]>) => {
    const t = await computeTriage({ ...base, requested: "delta", owner, existing: docs, ...o });
    return t.mode === "full" ? t.escalated : "delta";
  };
  assert.equal(await why({ lastFullScanAt: null }), "never_full_scanned");
  assert.equal(await why({ lastFullScanAt: new Date("2026-09-01") }), "full_scan_too_old");
  assert.equal(await why({ lastScanCommit: null }), "no_last_scan");
  assert.equal(await why({ lastScanCommit: "unknown" }), "base_missing");
  assert.equal(await why({ maxChangedFiles: 0 }), "too_many_files");
  assert.equal(await why({ maxCitedShare: 0.5 }), "too_many_cited_files"); // 1 of 1 cited files changed
  assert.equal((await computeTriage({ ...base, requested: "full", owner, existing: docs })).mode, "full");
});

test("delta triage flags docs citing a repo that is no longer available", async () => {
  const owner = fakeSource("acme/app", "c2", { c1: [] });
  const t = await computeTriage({ ...base, requested: "delta", owner, existing: [doc("a/one.md", [["other/lib", "x.go"]])] });
  assert.equal(t.mode, "delta");
  if (t.mode === "delta") assert.match(t.affected[0]!.reasons[0]!, /unavailable/);
});

test("delta triage uses each doc's own generation commit for owner citations", async () => {
  const owner = fakeSource("acme/app", "c3", { c1: [{ status: "M", path: "src/a.ts" }], c2: [] });
  const t = await computeTriage({ ...base, lastScanCommit: "c2", maxCitedShare: 1, requested: "delta", owner, existing: [doc("a/old.md", [["acme/app", "src/a.ts"]], "c1"), doc("a/new.md", [["acme/app", "src/a.ts"]], "c2")] });
  assert.equal(t.mode, "delta");
  if (t.mode === "delta") assert.deepEqual(t.affected.map((a) => a.path), ["a/old.md"]);
});

test("old tool outputs are elided from the prompt but the recent ones and pairing stay intact", async () => {
  const { maskOldToolOutputs, TokenBudget } = await import("./llm");
  const big = "x".repeat(500);
  const msgs: any[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
  for (let i = 0; i < 6; i++) msgs.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "t", arguments: "{}" } }] }, { role: "tool", tool_call_id: `c${i}`, content: big + i });
  const out = maskOldToolOutputs(msgs, 2);
  const tools = out.filter((m) => m.role === "tool") as any[];
  assert.equal(tools.length, 6);
  assert.ok(tools.slice(0, 4).every((m) => m.content.startsWith("[earlier output elided")));
  assert.ok(tools.slice(4).every((m) => m.content.startsWith("x")));
  assert.equal(msgs.filter((m) => m.role === "tool")[0].content.length, 501, "input is not mutated");
  const b = new TokenBudget(1000);
  b.add(1000, 10, 900); // 900 cached prompt tokens are free
  assert.equal(b.used, 110);
});

test("normalizeReport folds a re-proposal of an existing doc into its keep disposition", async () => {
  const { normalizeReport } = await import("./validate");
  const r = normalizeReport(
    { systemSummary: "s", dispositions: [{ path: "a/old-doc.md", disposition: "keep" }], proposedNewDocs: [{ path: "a/old-doc.md", rationale: "r", keyClaims: ["c1"], keyFiles: ["f1"] }, { path: "a/new-doc.md", rationale: "r", keyClaims: ["c2"], keyFiles: ["f2"] }] },
    ["a/old-doc.md"],
  );
  assert.deepEqual(r.proposedNewDocs.map((p) => p.path), ["a/new-doc.md"]);
  assert.deepEqual(r.dispositions[0], { path: "a/old-doc.md", disposition: "keep", keyClaims: ["c1"], keyFiles: ["f1"] });
  assert.ok(checkReport(r, ["a/old-doc.md"]).ok);
  // with no matching disposition one is created
  const r2 = normalizeReport({ systemSummary: "s", dispositions: [], proposedNewDocs: [{ path: "a/old-doc.md", rationale: "r", keyClaims: ["c"], keyFiles: [] }] }, ["a/old-doc.md"]);
  assert.equal(r2.dispositions[0]!.disposition, "keep");
  // already-clean reports are returned untouched
  const clean = { systemSummary: "s", dispositions: [], proposedNewDocs: [] };
  assert.equal(normalizeReport(clean, []), clean);
});

test("an agent that never finishes is warned, then forced to call its finishing tool on the last step", async () => {
  const { runAgent, tool, TokenBudget } = await import("./llm");
  const { z } = await import("zod");
  const seen: { forced?: string; warned: boolean }[] = [];
  let done = false;
  const finish = tool("submit_it", "finish", z.object({ v: z.string() }), () => ((done = true), { ok: true }));
  const explore = tool("look", "look", z.object({}), () => "stuff");
  const llm = {
    async chat(req: any) {
      seen.push({ forced: req.forceTool, warned: req.messages.some((m: any) => m.role === "user" && /steps left/.test(m.content)) });
      const name = req.forceTool ?? "look";
      return { message: { content: null, tool_calls: [{ id: `c${seen.length}`, type: "function" as const, function: { name, arguments: name === "look" ? "{}" : '{"v":"x"}' } }] }, finishReason: "tool_calls", promptTokens: 1, completionTokens: 1 };
    },
  };
  await runAgent({ llm, model: "m", label: "t", system: "s", user: "u", tools: [explore, finish], finishTool: "submit_it", done: () => done, budget: new TokenBudget(1e6), maxSteps: 8 });
  assert.equal(seen.length, 8);
  assert.equal(seen.at(-1)!.forced, "submit_it");
  assert.ok(seen.slice(0, -1).every((s) => s.forced === undefined));
  assert.ok(seen[3]!.warned && !seen[2]!.warned);
});

test("forcePlan can require write_doc before finish_doc on the last two steps", async () => {
  const { runAgent, tool, TokenBudget } = await import("./llm");
  const { z } = await import("zod");
  const state = { finished: false, written: false };
  const forced: (string | undefined)[] = [];
  const write = tool("write_doc", "w", z.object({}), () => ((state.written = true), { ok: true }));
  const finish = tool("finish_doc", "f", z.object({}), () => ((state.finished = true), { ok: true }));
  const look = tool("look", "l", z.object({}), () => "x");
  const llm = {
    async chat(req: any) {
      forced.push(req.forceTool);
      return { message: { content: null, tool_calls: [{ id: `c${forced.length}`, type: "function" as const, function: { name: req.forceTool ?? "look", arguments: "{}" } }] }, finishReason: "tool_calls", promptTokens: 1, completionTokens: 1 };
    },
  };
  await runAgent({
    llm, model: "m", label: "t", system: "s", user: "u", tools: [look, write, finish], finishTool: "finish_doc", done: () => state.finished, budget: new TokenBudget(1e6), maxSteps: 8,
    forcePlan: (left) => (state.finished ? undefined : !state.written ? "write_doc" : left === 1 ? "finish_doc" : undefined),
  });
  assert.deepEqual(forced.slice(-2), ["write_doc", "finish_doc"]);
  assert.ok(forced.slice(0, -2).every((f) => f === undefined));
  assert.ok(state.written && state.finished);
});

test("work list: keep must exist, and any new document needs sources and counts toward the cap", () => {
  const existing = ["a/old-doc.md"];
  const systems = [sys("a", existing)];
  const reports: SurveyReport[] = [{ system: systems[0]!, report: { systemSummary: "s", dispositions: [{ path: "a/old-doc.md", disposition: "keep" }], proposedNewDocs: [{ path: "a/fresh-idea.md", rationale: "r", keyClaims: ["c"], keyFiles: ["f"] }] } }];
  const keepGhost = checkWorkList({ items: [{ path: "legacy.md", action: "keep" }], deletes: [] }, existing, [], "delta", { systems, reports });
  assert.ok(!keepGhost.ok && keepGhost.reason === "keep_missing");
  const mergeNoSources = checkWorkList({ items: [{ path: "a/fresh-idea.md", action: "merge", absorbs: ["a/old-doc.md"] }], deletes: [] }, existing, existing, "full", { systems, reports });
  assert.ok(!mergeNoSources.ok && mergeNoSources.reason === "no_sources");
  const withSources = checkWorkList({ items: [{ path: "a/fresh-idea.md", action: "merge", absorbs: ["a/old-doc.md"], sources: [{ system: "a", path: "a/fresh-idea.md" }] }], deletes: [] }, existing, existing, "full", { systems, reports });
  assert.ok(withSources.ok);
});

test("triage: a document with no citation record is regenerated, not trusted", async () => {
  const owner = { name: "acme/app", commit: "c2", diff: async () => [], commitsSince: async () => [] } as unknown as RepoSource;
  const stub: DocRecord = { path: "a/stub.md", title: "a/stub.md", summary: "", citations: [], generatedAtCommit: "", model: "", scanId: 0 };
  const t = await computeTriage({ ...base, requested: "delta", owner, existing: [stub] });
  assert.equal(t.mode, "delta");
  if (t.mode === "delta") {
    assert.deepEqual(t.affected.map((a) => a.path), ["a/stub.md"]);
    assert.match(t.affected[0]!.reasons[0]!, /no verified citation record/);
  }
});

test("a call that crosses the token budget cannot go on to run tools", async () => {
  const { runAgent, tool, TokenBudget, BudgetExceededError } = await import("./llm");
  const { z } = await import("zod");
  let ran = false;
  const commit = tool("commit_it", "c", z.object({}), () => ((ran = true), { ok: true }));
  const llm = { async chat() { return { message: { content: null, tool_calls: [{ id: "c1", type: "function" as const, function: { name: "commit_it", arguments: "{}" } }] }, finishReason: "tool_calls", promptTokens: 5000, completionTokens: 100 }; } };
  await assert.rejects(runAgent({ llm, model: "m", label: "t", system: "s", user: "u", tools: [commit], finishTool: "commit_it", done: () => ran, budget: new TokenBudget(100) }), BudgetExceededError);
  assert.equal(ran, false);
});

test("source.exists accepts files, not directories (real git)", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { gitSource } = await import("./source");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-src-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  g("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n");
  g("add", "."); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i");
  const sha = g("rev-parse", "HEAD").trim();
  const src = gitSource("r", path.join(dir, ".git"), sha);
  assert.equal(await src.exists("src/a.ts"), true);
  assert.equal(await src.exists("src"), false, "a directory is not file evidence");
  assert.equal(await src.exists("src/nope.ts"), false);
  assert.match(await src.grep("export const"), /src\/a\.ts:1:/);
  fs.rmSync(dir, { recursive: true, force: true });
});
