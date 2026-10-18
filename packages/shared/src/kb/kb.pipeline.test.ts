import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocStore } from "./docTools";
import { BudgetExceededError, TokenBudget, type ChatRequest, type ChatResult, type LlmClient } from "./llm";
import { runScan } from "./pipeline";
import type { RepoSource } from "./source";
import { computeTriage, type DocRecord } from "./triage";

// ---- fakes ---------------------------------------------------------------------

function fakeRepo(name: string, commit: string, files: Record<string, string>): RepoSource {
  return {
    name, commit,
    listFiles: async () => Object.entries(files).map(([path, c]) => ({ path, size: c.length })),
    listTree: async (prefix = "") => Object.keys(files).filter((f) => !prefix || f.startsWith(prefix)),
    readFile: async (p) => files[p],
    exists: async (p) => p in files,
    grep: async () => "No matches.",
    log: async () => "No history.",
    diff: async () => "missing-base",
    commitsSince: async () => "missing-base",
  };
}

function memoryStore() {
  const files = new Map<string, string>();
  const recs = new Map<string, DocRecord>();
  const commits: string[] = [];
  const store: DocStore = {
    listPaths: async () => [...files.keys()].filter((p) => p !== "README.md"),
    read: async (p) => files.get(p),
    write: async (p, b) => void files.set(p, b),
    remove: async (p, m) => { files.delete(p); commits.push(m.split("\n")[0]!); },
    commit: async (p, m) => { commits.push(m.split("\n")[0]!); return { committed: true }; },
    records: {
      all: async () => [...recs.values()],
      put: async (r) => void recs.set(r.path, r),
      drop: async (p) => void recs.delete(p),
    },
  };
  return { store, files, recs, commits };
}

const call = (name: string, args: unknown, id = Math.random().toString(36)) => ({
  message: { content: null, tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] },
  finishReason: "tool_calls", promptTokens: 100, completionTokens: 50,
});

interface Script {
  /** doc path -> bodies to try in order (so a bad first draft can be repaired) */
  bodies: Record<string, string[]>;
  reportFor?: (userJson: any) => any;
}

/** A model that plays every role in the pipeline, recognized by its system prompt. */
function scriptedLlm(script: Script, seen: string[] = []): LlmClient {
  const attempts = new Map<string, number>();
  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      const sys = (req.messages[0] as any).content as string;
      const user = JSON.parse((req.messages[1] as any).content);
      const last = req.messages.at(-1)!;
      const lastTool = last.role === "tool" ? JSON.parse(last.content) : undefined;
      const role = sys.includes("You are a scout") ? "scout" : sys.includes("You are the reconciler") ? "reconciler" : sys.includes("You are a surveyor") ? "surveyor" : sys.includes("You are the merge agent") ? "merge" : sys.includes("writing one document") ? "doc" : "readme";
      seen.push(role);

      if (role === "scout") return call("submit_candidate_systems", { systems: [{ name: "Engine", thesis: "Orders and runs jobs", evidenceAnchors: ["src/engine.ts"] }, { name: "Queue", thesis: "Retries", evidenceAnchors: ["src/queue.ts"] }] });
      if (role === "reconciler") return call("submit_system_list", { systems: [
        { slug: "engine", name: "Engine", thesis: "Orders and runs jobs", evidenceAnchors: ["src/engine.ts"], assignedDocPaths: user.existingDocs.filter((p: string) => p.startsWith("engine/")) },
        { slug: "queue", name: "Queue", thesis: "Retries", evidenceAnchors: ["src/queue.ts"], assignedDocPaths: user.existingDocs.filter((p: string) => p.startsWith("queue/")) },
      ] });
      if (role === "surveyor") {
        if (script.reportFor) return call("submit_system_report", script.reportFor(user));
        const slug = user.system.slug as string;
        const concept = slug === "engine" ? "engine/ordering-guarantee.md" : "queue/retry-contract.md";
        return call("submit_system_report", {
          systemSummary: `${slug} summary`,
          dispositions: user.system.assignedDocPaths.map((path: string) => ({ path, disposition: "keep" })),
          proposedNewDocs: user.system.assignedDocPaths.includes(concept) ? [] : [{ path: concept, rationale: "why", keyClaims: [`claim proven by src/${slug}.ts`], keyFiles: [`src/${slug}.ts`] }],
        });
      }
      if (role === "merge") {
        const items = user.requiredPaths.map((path: string) => ({ path, action: "keep" }));
        const proposals = user.reports.flatMap((r: any) => r.report.proposedNewDocs.map((p: any) => ({ system: r.system.slug, path: p.path })));
        for (const p of proposals) items.push({ path: p.path, action: "create", sources: [p] });
        return call("submit_work_list", { items, deletes: user.mode === "delta" ? [] : [] });
      }
      if (role === "doc") {
        const path = user.item.path as string;
        if (!last || last.role === "user") {
          const n = attempts.get(path) ?? 0;
          attempts.set(path, n + 1);
          return call("write_doc", { path, body: script.bodies[path]![0]! });
        }
        if (lastTool?.chars) return call("finish_doc", { path, summary: `Read when working on ${path}.` });
        if (lastTool?.reason === "dangling_citations") {
          attempts.set(path, (attempts.get(path) ?? 0) + 1);
          return call("write_doc", { path, body: script.bodies[path]![1] ?? script.bodies[path]![0]! });
        }
        return call("finish_doc", { path, summary: `Read when working on ${path}.` });
      }
      return call("submit_narrative", { narrative: "A small system with an engine and a queue." });
    },
  };
}

const owner = () => fakeRepo("acme/app", "c1", {
  "src/engine.ts": "export const run = () => {};\n",
  "src/queue.ts": "export const retry = () => {};\n",
  "README.md": "# app\n",
});

const deps = (s: ReturnType<typeof memoryStore>, llm: LlmClient, budget = new TokenBudget(10_000_000)) => ({
  llm, budget, owner: owner(), resolveRepo: async () => undefined, store: s.store, scanId: 7, parallelism: 2,
  models: { discovery: "m", survey: "m", document: "m", overview: "m" },
});

const PAD = " The contract is easy to break by tidying the code, so the reasoning is recorded here: callers depend on the ordering, retries are bounded, and the failure path must stay observable. Reading the cited file shows the one place where the invariant is enforced.".repeat(2);
const GOOD = (slug: string) => `# ${slug}\n\nRead this when changing ${slug}.\n\nIt works as described in @file:{acme/app::src/${slug}.ts}.${PAD}\n`;

// ---- tests ---------------------------------------------------------------------

test("full scan: scouts, reconcile, survey, merge, docs, README, all stamped and committed", async () => {
  const m = memoryStore();
  const roles: string[] = [];
  const llm = scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [GOOD("engine")], "queue/retry-contract.md": [GOOD("queue")] } }, roles);
  const out = await runScan(deps(m, llm), { mode: "full", existing: [] });

  assert.deepEqual([...new Set(roles)].sort(), ["doc", "merge", "readme", "reconciler", "scout", "surveyor"]);
  assert.equal(out.mode, "full");
  assert.equal(out.systems, 2);
  assert.equal(out.docsWritten, 2);
  assert.deepEqual([...m.files.keys()].sort(), ["README.md", "engine/ordering-guarantee.md", "queue/retry-contract.md"]);

  const rec = m.recs.get("engine/ordering-guarantee.md")!;
  assert.equal(rec.scanId, 7);
  assert.equal(rec.generatedAtCommit, "c1");
  assert.deepEqual(rec.citations, [{ repo: "acme/app", path: "src/engine.ts", commit: "c1" }]);
  assert.match(rec.summary, /Read when working on/);

  const readme = m.files.get("README.md")!;
  assert.match(readme, /^# acme\/app knowledge base/);
  assert.match(readme, /A small system with an engine and a queue\./);
  assert.match(readme, /\[engine\/ordering-guarantee\.md\]/);
  assert.match(readme, /## Depends on\n\n_None_/);
  assert.ok(m.commits.some((c) => c.startsWith("kb: add engine/ordering-guarantee.md")));
});

test("a doc with a dangling citation is refused by finish_doc and repaired by the agent", async () => {
  const m = memoryStore();
  const bad = `# engine\n\nRead when changing engine.\n\nSee @file:{acme/app::src/missing.ts}.${PAD}\n`;
  const llm = scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [bad, GOOD("engine")], "queue/retry-contract.md": [GOOD("queue")] } });
  await runScan(deps(m, llm), { mode: "full", existing: [] });
  assert.ok(!m.files.get("engine/ordering-guarantee.md")!.includes("missing.ts"));
  assert.equal(m.recs.get("engine/ordering-guarantee.md")!.citations[0]!.path, "src/engine.ts");
});

test("a citation to an unavailable repo is dangling too", async () => {
  const m = memoryStore();
  const body = `# queue\n\nRead when changing queue.\n\nSee @file:{ghost/lib::x.ts}.${PAD}\n`;
  const llm = scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [GOOD("engine")], "queue/retry-contract.md": [body, GOOD("queue")] } });
  await runScan(deps(m, llm), { mode: "full", existing: [] });
  assert.ok(!m.files.get("queue/retry-contract.md")!.includes("ghost/lib"));
});

test("the token budget is a hard stop", async () => {
  const m = memoryStore();
  const llm = scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [GOOD("engine")], "queue/retry-contract.md": [GOOD("queue")] } });
  const budget = new TokenBudget(450); // three calls at 150 tokens each
  await assert.rejects(runScan(deps(m, llm, budget), { mode: "full", existing: [] }), BudgetExceededError);
  assert.ok(budget.used >= 450);
  assert.equal(m.files.size, 0);
});

test("delta scan rewrites only affected docs and skips when nothing changed", async () => {
  const m = memoryStore();
  const llm = scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [GOOD("engine")], "queue/retry-contract.md": [GOOD("queue")] } });
  await runScan(deps(m, llm), { mode: "full", existing: [] });
  const existing = [...m.recs.values()];

  // c2: only src/engine.ts changed
  const next = (changed: boolean): RepoSource => ({
    ...fakeRepo("acme/app", "c2", { "src/engine.ts": "export const run = () => 1;\n", "src/queue.ts": "export const retry = () => {};\n" }),
    diff: async () => (changed ? [{ status: "M", path: "src/engine.ts" }] : []),
    commitsSince: async () => [{ sha: "deadbeef00", subject: "tweak engine" }],
  });
  const triage = await computeTriage({ requested: "delta", owner: next(true), existing, lastScanCommit: "c1", lastFullScanAt: new Date(), now: new Date(), resolveRepo: async () => undefined, maxCitedShare: 1 });
  assert.equal(triage.mode, "delta");
  if (triage.mode !== "delta") return;
  assert.deepEqual(triage.affected.map((a) => a.path), ["engine/ordering-guarantee.md"]);

  const before = m.recs.get("queue/retry-contract.md")!.scanId;
  const roles: string[] = [];
  const out = await runScan({ ...deps(m, scriptedLlm({ bodies: { "engine/ordering-guarantee.md": [GOOD("engine") + "\nUpdated.\n"] } }, roles)), owner: next(true), scanId: 8 }, triage);
  assert.equal(out.mode, "delta");
  assert.equal(out.docsWritten, 1);
  assert.ok(!roles.includes("scout") && !roles.includes("reconciler"), "delta skips discovery");
  assert.equal(m.recs.get("engine/ordering-guarantee.md")!.scanId, 8);
  assert.equal(m.recs.get("queue/retry-contract.md")!.scanId, before, "unaffected doc untouched");
  assert.match(m.files.get("engine/ordering-guarantee.md")!, /Updated/);

  const quiet = await computeTriage({ requested: "delta", owner: next(false), existing, lastScanCommit: "c1", lastFullScanAt: new Date(), now: new Date(), resolveRepo: async () => undefined });
  const skipped = await runScan({ ...deps(m, scriptedLlm({ bodies: {} })), owner: next(false), scanId: 9 }, quiet);
  assert.equal(skipped.skipped, true);
});
