// Child process for lazy.test.ts: records every module specifier resolved, then drives an MCP session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks, createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-lazy-"));
process.env.CONFIG_PATH = path.join(dir, "config.json");
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ models: [{ provider: "openai", model: "fixture-model" }] }));
const seen = new Set<string>();
registerHooks({
  resolve(specifier, context, nextResolve) {
    seen.add(specifier);
    return nextResolve(specifier === "@falkon/shared" ? new URL("../../../../shared/src/index.ts", "file://" + __filename).href : specifier, context);
  },
});
const loadedAi = () => [...seen].filter((s) => s === "ai" || s.startsWith("ai/") || s.startsWith("@ai-sdk/"));

async function main() {
  const { createMcpServer } = await import("../mcp");
  const { scopeFor } = createRequire(__filename)("@falkon/shared");
  const server = await createMcpServer(scopeFor(["*"]));
  const client = new Client({ name: "lazy", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  await client.callTool({ name: "list_language_models", arguments: {} });
  const afterList = loadedAi();
  const ask = await client.callTool({ name: "ask_codebase", arguments: { query: "q", languageModel: { provider: "anthropic", model: "other" } } });
  console.log(JSON.stringify({ tools, afterList, afterAsk: loadedAi(), ask }));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
void main();
