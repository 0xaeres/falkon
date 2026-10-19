import { McpServer, type RegisteredTool, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolDefinitions, toolNames, toolJsonSchema, type AnyToolDefinition, type Scope } from "@sbc/shared";
import { askCodebase } from "./ask/chat";
import { buildResearchBrief, CLIENT_RESEARCH_INSTRUCTIONS } from "./ask/brief";
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

const RESEARCH_DESCRIPTION = "Prepare a repository-scoped research brief for your model to answer a code question with Falkon's search and read tools. Returns a workflow and citation guidance without calling a server model.";

/** One MCP server per session, retaining the existing tool order, annotations and error text. */
export async function createMcpServer(scope: Scope) {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: process.env.SOURCEBOT_CLONE_VERSION ?? "0.0.1" },
    { instructions: CLIENT_RESEARCH_INSTRUCTIONS },
  );
  const registered: { name: string; tool: RegisteredTool }[] = [];
  // Every tool must go through add so registration and listing stay together.
  function add<S extends z.ZodObject | undefined = undefined>(
    name: string,
    config: { description?: string; inputSchema?: S; annotations?: RegisteredTool["annotations"] },
    handler: ToolCallback<S>,
  ) {
    registered.push({ name, tool: server.registerTool(name, config, handler) });
  }
  for (const name of toolNames) {
    const d = toolDefinitions[name] as unknown as AnyToolDefinition;
    add(
      d.name,
      { description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.isReadOnly, idempotentHint: d.isIdempotent } },
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
  add(
    "list_language_models",
    {
      description: "Lists the available language models configured on the Sourcebot instance. Use this to discover which models can be specified when calling ask_codebase.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await languageModelsInfo()) }] }),
  );
  if (models.length > 0) {
    const schema = z.object({
      query: z.string().describe("The query to ask about the codebase."),
      repos: z.array(z.string()).optional().describe("The repositories accessible to the agent. If not provided, all repositories are accessible."),
      languageModel: languageModelInfo
        .optional()
        .describe("The language model to use. If not provided, defaults to the first model in the config."),
      visibility: z.enum(["PRIVATE", "PUBLIC"]).optional().describe("The visibility of the chat session. Defaults to PRIVATE for authenticated users."),
    });
    add(
      "ask_codebase",
      {
        description: ASK_DESCRIPTION,
        inputSchema: schema,
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
  const researchSchema = z.object({
    query: z.string().describe("The question to investigate in source code."),
    repos: z.array(z.string()).optional().describe("Repository names to select from your visible repositories. Omit for all visible repositories; an empty list selects none."),
  });
  const researchBrief = async (query: string, repos?: string[]) => buildResearchBrief({
    query,
    repos,
    scope,
    availableRepos: (await toolDeps.listRepos({ sort: "name", direction: "asc" })).map((repo) => repo.name),
  });
  add(
    "research_codebase",
    { description: RESEARCH_DESCRIPTION, inputSchema: researchSchema, annotations: { readOnlyHint: true, idempotentHint: true } },
    async ({ query, repos }) => ({ content: [{ type: "text" as const, text: await researchBrief(query, repos) }] }),
  );
  server.registerPrompt(
    "ask_codebase",
    {
      description: "Plan a code investigation for your model using the repositories you can access.",
      argsSchema: {
        query: researchSchema.shape.query,
        repos: z.string().optional().describe("Comma-separated repository names. Omit for all visible repositories; an empty value selects none."),
      },
    },
    async ({ query, repos }) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: await researchBrief(query, repos?.split(",").map((name) => name.trim()).filter(Boolean)) } }],
    }),
  );
  // The SDK's native Zod 4 conversion changes schema content and key order.
  // Keep its registrations/validation, but list the same normalized bytes as Ask/KB.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registered.filter(({ tool }) => tool.enabled).map(({ name, tool }) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema ? toolJsonSchema(tool.inputSchema as z.ZodObject) : { type: "object" as const, properties: {} },
      annotations: tool.annotations,
      execution: tool.execution,
      _meta: tool._meta,
    })),
  }));
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
