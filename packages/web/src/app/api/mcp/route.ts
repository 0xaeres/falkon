import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import { toolSpecs, toolNames } from "@sbc/shared";
import { runTool } from "@/lib/tools";

export const dynamic = "force-dynamic";

/** Stateless streamable-HTTP MCP endpoint (auth is enforced by middleware): one server per request. */
async function handle(req: Request): Promise<Response> {
  const server = new McpServer({ name: "sourcebot-clone", version: "0.0.1" });
  for (const name of toolNames) {
    const spec = toolSpecs[name];
    server.tool(name, spec.description, spec.shape as unknown as z.ZodRawShape, async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: "text" as const, text: await runTool(name, args) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
