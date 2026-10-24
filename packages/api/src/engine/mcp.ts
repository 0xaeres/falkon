import { McpServer, type RegisteredTool, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { historyToolDefinitions, historyToolNames, toolDefinitions, toolNames, toolJsonSchema, type AnyToolDefinition, type Scope } from "@falkon/shared";
import { buildResearchBrief, CLIENT_RESEARCH_INSTRUCTIONS } from "./ask/brief";
import { IMPACT_INSTRUCTIONS } from "./ask/impact";
import { configuredLanguageModels, languageModelsInfo } from "./ask/models";
import { languageModelInfo } from "./ask/http";
import { toolDeps } from "./tools";

export const MCP_SERVER_NAME = "falkon-mcp-server";

const ASK_DESCRIPTION = `Only call this tool when the user's request names ask_codebase explicitly; otherwise use the search and read tools yourself.

Puts a natural-language question about the code to a Falkon agent. The agent runs its own searches, reads files and follows symbol definitions and references, then writes the answer.

Pass the question as \`query\`; optionally narrow the agent with \`repos\` and choose a model with \`languageModel\` (see list_language_models).

The call blocks while the agent works and can take a minute or more.

Returns markdown with code references, followed by a link to the saved chat thread in the Falkon UI, where every tool call and step of the research can be reviewed.

For a chat shared with others (a Slack thread, say), pass visibility 'PUBLIC' so the link opens for everyone.`;

const RESEARCH_DESCRIPTION = "Prepare a repository-scoped research brief for your model to answer a code question with Falkon's search and read tools. Returns a workflow and citation guidance without calling a server model.";

let warnedMode = false;

/** One MCP server per session, retaining the existing tool order, annotations and error text. */
export async function createMcpServer(scope: Scope, product?: string) {
  // MCP_INSTRUCTIONS=off drops the server instructions (eval ablation); unset or "default" keeps them.
  const mode = process.env.MCP_INSTRUCTIONS;
  if (mode !== undefined && mode !== "default" && mode !== "off" && !warnedMode) {
    warnedMode = true;
    console.warn(`MCP_INSTRUCTIONS="${mode.replace(/\s+/g, " ").slice(0, 40)}" is not default or off; using default.`);
  }
  // MCP_IMPACT_RECIPE=on adds the impact-and-change recipe to the instructions and to impact-style research briefs; anything else keeps today's bytes.
  const impactRecipe = process.env.MCP_IMPACT_RECIPE === "on";
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: "0.1.0" },
    mode === "off" ? undefined : { instructions: impactRecipe ? `${CLIENT_RESEARCH_INSTRUCTIONS}\n\n${IMPACT_INSTRUCTIONS}` : CLIENT_RESEARCH_INSTRUCTIONS },
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
  const addDefinition = (d: AnyToolDefinition) =>
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
  for (const name of toolNames) addDefinition(toolDefinitions[name] as unknown as AnyToolDefinition);
  const models = await configuredLanguageModels();
  add(
    "list_language_models",
    {
      description: "Returns the language models this Falkon instance is configured with, so you can pick one for the languageModel parameter of ask_codebase.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await languageModelsInfo()) }] }),
  );
  if (models.length > 0) {
    const schema = z.object({
      query: z.string().describe("The query to ask about the codebase."),
      repos: z.array(z.string()).optional().describe("Repositories the agent may search. Omit to let it use every repository you can see."),
      languageModel: languageModelInfo
        .optional()
        .describe("Model that runs the agent. Omit to use the first configured model."),
      visibility: z.enum(["PRIVATE", "PUBLIC"]).optional().describe("Who can open the saved chat. Defaults to PRIVATE for signed-in callers."),
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
          // Loaded on first use: pulls in the `ai` SDK, which a tool-listing server never needs.
          const { askCodebase } = await import("./ask/chat");
          const r = await askCodebase({ query: a.query, repos: a.repos, languageModel: a.languageModel, visibility: a.visibility, scope, product });
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
    impactRecipe,
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
  // MCP_HISTORY_TOOLS=on adds the pull request history tools after every other tool; anything else keeps today's registration bytes (D113).
  if (process.env.MCP_HISTORY_TOOLS === "on") for (const name of historyToolNames) addDefinition(historyToolDefinitions[name] as unknown as AnyToolDefinition);
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
export async function handleMcpPost(req: Request, scope: Scope, product?: string): Promise<Response> {
  const owner = scope.principal ?? "anonymous";
  const id = req.headers.get(SESSION_HEADER);
  const existing = id ? sessions.get(id) : undefined;
  if (existing) {
    if (existing.owner !== owner) return json(403, "INSUFFICIENT_PERMISSIONS", "This session was opened by a different caller.");
    return existing.transport.handleRequest(req);
  }
  const server = await createMcpServer(scope, product);
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
  if (s.owner !== (scope.principal ?? "anonymous")) return json(403, "INSUFFICIENT_PERMISSIONS", "This session was opened by a different caller.");
  return s.transport.handleRequest(req);
}
