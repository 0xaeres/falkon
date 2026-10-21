import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openAiTools, toolDefinitions, toolNames, type AnyToolDefinition } from "./tools";
import { TokenBudget, type ChatRequest, type LlmClient } from "./kb/llm";
import { runScan } from "./kb/pipeline";
import type { RepoSource } from "./kb/source";
import type { DocStore } from "./kb/docTools";
import type { DocRecord } from "./kb/triage";

// Captured from these tools on Zod 3.25.76 with the previous converter 3.25.2.
const previous = () => JSON.parse(fs.readFileSync(new URL("./toolSchemas.v3.json", import.meta.url), "utf8"));

test("Ask tool parameters remain byte-identical to the Zod 3 output for every tool", () => {
  assert.equal(JSON.stringify(Object.fromEntries(openAiTools().map((t) => [t.function.name, t.function.parameters]))), JSON.stringify(previous().ask));
});

/** Exercise every KB stage and collect the actual requests sent to its model. */
async function kbSchemas() {
  const files = new Map<string, string>();
  const records = new Map<string, DocRecord>();
  const store: DocStore = {
    listPaths: async () => [...files.keys()],
    read: async (p) => files.get(p),
    write: async (p, body) => { files.set(p, body); },
    remove: async (p) => { files.delete(p); },
    commit: async () => ({ committed: true }),
    records: {
      all: async () => [...records.values()],
      put: async (r) => { records.set(r.path, r); },
      drop: async (p) => { records.delete(p); },
    },
  };
  const owner: RepoSource = {
    name: "fixtures.test/schema", commit: "abc123",
    listFiles: async () => [{ path: "src/engine.ts", size: 100 }],
    listTree: async () => ["src/engine.ts"], readFile: async () => "export const engine = 1;",
    exists: async () => true, grep: async () => "", log: async () => "",
    diff: async () => [], commitsSince: async () => [],
  };
  const schemas: Record<string, NonNullable<ChatRequest["tools"]>[number]> = {};
  const path = "engine/ordering.md";
  const replies: Record<string, unknown> = {
    submit_candidate_systems: { systems: [{ name: "Engine", thesis: "Orders jobs", evidenceAnchors: ["src/engine.ts"] }] },
    submit_system_list: { systems: [{ slug: "engine", name: "Engine", thesis: "Orders jobs", evidenceAnchors: ["src/engine.ts"], assignedDocPaths: [] }] },
    submit_system_report: { proposedNewDocs: [{ path, rationale: "Ordering contract", keyClaims: ["src/engine.ts orders jobs"], keyFiles: ["src/engine.ts"] }], dispositions: [], systemSummary: "Orders jobs" },
    submit_work_list: { items: [{ path, action: "create", sources: [{ system: "engine", path }] }], deletes: [] },
    write_doc: { path, body: "# Ordering\n\n" + "The engine orders jobs. ".repeat(30) },
    finish_doc: { path, summary: "Read when changing job ordering." },
    submit_narrative: { narrative: "The engine orders jobs." },
  };
  const llm: LlmClient = {
    async chat(req) {
      for (const t of req.tools ?? []) {
        if (schemas[t.function.name]) assert.equal(JSON.stringify(t), JSON.stringify(schemas[t.function.name]));
        schemas[t.function.name] = t;
      }
      const names = req.tools!.map((t) => t.function.name);
      const name = names.includes("write_doc")
        ? req.messages.some((m) => m.role === "tool") ? "finish_doc" : "write_doc"
        : names.at(-1)!;
      return {
        message: { content: null, tool_calls: [{ id: "schema", type: "function", function: { name, arguments: JSON.stringify(replies[name]) } }] },
        finishReason: "tool_calls", promptTokens: 1, completionTokens: 1,
      };
    },
  };
  const outcome = await runScan({
    llm, models: { discovery: "fixture", survey: "fixture", document: "fixture", overview: "fixture" },
    budget: new TokenBudget(1000), owner, resolveRepo: async () => undefined, store, scanId: 1, parallelism: 1,
  }, { mode: "full", existing: [] });
  assert.equal(outcome.docsWritten, 1);
  assert.equal(outcome.docsFailed, 0);
  return Object.fromEntries(Object.values(schemas).map((t) => [t.function.name, t.function.parameters]));
}

test("every KB tool schema sent to the LLM remains byte-identical to the Zod 3 output", async () => {
  assert.equal(JSON.stringify(await kbSchemas()), JSON.stringify(previous().kb));
});

test("every tool description names each of the tool's parameters", () => {
  for (const name of toolNames) {
    const d = toolDefinitions[name] as unknown as AnyToolDefinition;
    for (const param of Object.keys(d.inputSchema.shape)) assert.ok(d.description.includes(param), `${name}: ${param}`);
  }
});
