import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-instructions-"));
process.env.CONFIG_PATH = path.join(dir, "config.json");
fs.writeFileSync(process.env.CONFIG_PATH, "{}");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];
import { registerHooks, createRequire } from "node:module";
// Pin the workspace package to this tree, as the contract test does.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@sbc/shared" ? new URL("../../../../shared/src/index.ts", import.meta.url).href : specifier, context);
  },
});
let createMcpServer: typeof import("../mcp").createMcpServer;
let scopeFor: typeof import("@sbc/shared").scopeFor;
before(async () => {
  ({ createMcpServer } = await import("../mcp"));
  ({ scopeFor } = createRequire(import.meta.url)("@sbc/shared"));
});
after(() => { hooks.deregister(); mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MCP_INSTRUCTIONS; });

/** The `instructions` a client sees in the initialize result, and the single-line notices the server logged. */
async function initialize(value: string | undefined) {
  if (value === undefined) delete process.env.MCP_INSTRUCTIONS; else process.env.MCP_INSTRUCTIONS = value;
  const warn = mock.method(console, "warn", () => {});
  const server = await createMcpServer(scopeFor(["*"]));
  const client = new Client({ name: "instructions", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const result = { instructions: client.getInstructions(), warnings: warn.mock.calls.map((c) => String(c.arguments[0])) };
  await client.close(); await server.close(); warn.mock.restore();
  return result;
}

test("MCP_INSTRUCTIONS unset or default serves the research instructions, as today", async () => {
  const unset = await initialize(undefined);
  assert.match(unset.instructions ?? "", /^Falkon searches and reads code/);
  assert.deepEqual(unset.warnings, []);
  assert.deepEqual(await initialize("default"), unset);
});

test("MCP_INSTRUCTIONS=off omits the instructions from the initialize result", async () => {
  const off = await initialize("off");
  assert.equal(off.instructions, undefined);
  assert.deepEqual(off.warnings, []);
});

test("any other MCP_INSTRUCTIONS value behaves as default and logs one line per process", async () => {
  const bad = await initialize("Off");
  assert.match(bad.instructions ?? "", /^Falkon searches and reads code/);
  assert.equal(bad.warnings.length, 1);
  assert.match(bad.warnings[0]!, /MCP_INSTRUCTIONS/);
  assert.ok(!bad.warnings[0]!.includes("\n"));
  const again = await initialize("Off");
  assert.match(again.instructions ?? "", /^Falkon searches and reads code/);
  assert.deepEqual(again.warnings, [], "logged once per process");
});
