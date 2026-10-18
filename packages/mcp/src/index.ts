import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { toolDefinitions, toolNames, type AnyToolDefinition } from "@sbc/shared";

const BASE = (process.env.SOURCEBOT_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.SOURCEBOT_API_KEY;

async function call(path: string, body: unknown): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { output?: string; answer?: string; id?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  if (json.answer !== undefined) return `${json.answer}\n\nSession: ${BASE}/ask#${json.id}`;
  return json.output ?? "";
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (e: unknown) => ({ ...text(e instanceof Error ? e.message : String(e)), isError: true });

const server = new McpServer({ name: "sourcebot-clone", version: "0.0.1" });

// Every shared tool is a thin proxy to the web app so auth, limits and git access live in one place.
for (const name of toolNames) {
  const d = toolDefinitions[name] as unknown as AnyToolDefinition;
  server.registerTool(
    name,
    { description: d.description, inputSchema: d.inputSchema.shape, annotations: { readOnlyHint: d.isReadOnly, idempotentHint: d.isIdempotent } },
    async (args: Record<string, unknown>) => {
      try {
        return text(await call(`/api/tools/${name}`, args));
      } catch (e) {
        return { ...text(`Tool "${name}" failed: ${e instanceof Error ? e.message : String(e)}`), isError: true };
      }
    },
  );
}

server.tool(
  "ask_codebase",
  "Use an AI agent to search the code and answer a natural-language question. Returns markdown with citations.",
  {
    query: z.string(),
    repos: z.array(z.string()).optional(),
    visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
  },
  async (args) => {
    try {
      return text(await call("/api/ask", args));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
