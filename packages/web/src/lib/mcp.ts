import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { toolDefinitions, toolNames, type AnyToolDefinition, type Scope } from "@sbc/shared";
import { askCodebase } from "./ask/chat";
import { configuredLanguageModels, languageModelsInfo } from "./ask/models";
import { languageModelInfo } from "./ask/http";
import { toolDeps } from "./tools";

export const MCP_SERVER_NAME = "sourcebot-mcp-server";

const ASK_DESCRIPTION = `DO NOT USE THIS TOOL UNLESS EXPLICITLY ASKED TO. THE PROMPT MUST SPECIFICALLY ASK TO USE THE ask_codebase TOOL.

Ask a natural language question about the codebase. This tool uses an AI agent to autonomously search code, read files, and find symbol references/definitions to answer your question.

This is a blocking operation that may take 60+ seconds to research the codebase, so only invoke it if the user has explicitly asked you to by specifying the ask_codebase tool call in the prompt.

The agent will:
- Analyze your question and determine what context it needs
- Search the codebase using multiple strategies (code search, symbol lookup, file reading)
- Synthesize findings into a comprehensive answer with code references

Returns a detailed answer in markdown format with code references, plus a link to view the full research session (including all tool calls and reasoning) in the Sourcebot web UI.

When using this in shared environments (e.g., Slack), you can set the visibility parameter to 'PUBLIC' to ensure everyone can access the chat link.`;

/** One MCP server per session, registering tools in Sourcebot's order with its annotations and error text. */
export async function createMcpServer(scope: Scope) {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: process.env.SOURCEBOT_CLONE_VERSION ?? "0.0.1" });
  for (const name of toolNames) {
    const d = toolDefinitions[name] as unknown as AnyToolDefinition;
    server.registerTool(
      d.name,
      { description: d.description, inputSchema: d.inputSchema.shape, annotations: { readOnlyHint: d.isReadOnly, idempotentHint: d.isIdempotent } },
      async (args: unknown) => {
        try {
          const { output } = await d.execute(d.inputSchema.parse(args), { deps: toolDeps, scope });
          return { content: [{ type: "text" as const, text: output }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: `Tool "${d.name}" failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
      },
    );
  }
  const models = await configuredLanguageModels();
  server.registerTool(
    "list_language_models",
    {
      description: "Lists the available language models configured on the Sourcebot instance. Use this to discover which models can be specified when calling ask_codebase.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await languageModelsInfo()) }] }),
  );
  if (models.length > 0) {
    server.registerTool(
      "ask_codebase",
      {
        description: ASK_DESCRIPTION,
        inputSchema: {
          query: z.string().describe("The query to ask about the codebase."),
          repos: z.array(z.string()).optional().describe("The repositories accessible to the agent. If not provided, all repositories are accessible."),
          languageModel: languageModelInfo
            .optional()
            .describe("The language model to use. If not provided, defaults to the first model in the config."),
          visibility: z.enum(["PRIVATE", "PUBLIC"]).optional().describe("The visibility of the chat session. Defaults to PRIVATE for authenticated users."),
        },
        annotations: { readOnlyHint: true },
      },
      async (a) => {
        try {
          const r = await askCodebase({ query: a.query, repos: a.repos, languageModel: a.languageModel, visibility: a.visibility, scope });
          return { content: [{ type: "text" as const, text: `${r.answer}\n\n---\n**View full research session:** ${r.chatUrl}\n**Model used:** ${r.languageModel.model}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: `Failed to ask codebase: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      },
    );
  }
  return server;
}

/** Live sessions, each owned by the caller that opened it. */
const sessions = new Map<string, { server: McpServer; transport: WebStandardStreamableHTTPServerTransport; owner: string }>();
const SESSION_HEADER = "mcp-session-id";
const json = (status: number, errorCode: string, message: string) => Response.json({ statusCode: status, errorCode, message }, { status });

/** Streamable HTTP, stateful: a request without a known session id starts one. */
export async function handleMcpPost(req: Request, scope: Scope): Promise<Response> {
  const owner = scope.principal ?? "anonymous";
  const id = req.headers.get(SESSION_HEADER);
  const existing = id ? sessions.get(id) : undefined;
  if (existing) {
    if (existing.owner !== owner) return json(403, "INSUFFICIENT_PERMISSIONS", "Session does not belong to the authenticated user.");
    return existing.transport.handleRequest(req);
  }
  const server = await createMcpServer(scope);
  const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { server, transport, owner });
    },
    onsessionclosed: async (sid) => {
      const s = sessions.get(sid);
      if (s) {
        await s.server.close();
        await s.transport.close();
      }
      sessions.delete(sid);
    },
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function handleMcpDelete(req: Request, scope: Scope): Promise<Response> {
  const id = req.headers.get(SESSION_HEADER);
  const s = id ? sessions.get(id) : undefined;
  if (!s) return json(404, "NOT_FOUND", "Session not found.");
  if (s.owner !== (scope.principal ?? "anonymous")) return json(403, "INSUFFICIENT_PERMISSIONS", "Session does not belong to the authenticated user.");
  return s.transport.handleRequest(req);
}
