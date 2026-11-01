import { createUIMessageStream, jsonSchema, NoSuchToolError, streamText, tool, type ModelMessage, type UIMessage } from "ai";
import { gitRead, gitToolDefinitions, gitToolNames, historyToolDefinitions, historyToolNames, toolDefinitions, toolJsonSchema, toolNames, type AnyToolDefinition, type Scope, type ToolSource } from "@falkon/shared";
import { toolDeps } from "../tools";
import { familyOn } from "../toolFamily";
import { answerPart } from "./answer";
import { aiModel, type LanguageModelConfig } from "./models";
import { dynamicPrompt, STATIC_PROMPT, type Audience } from "./prompt";

const MAX_STEPS = () => Number(process.env.FALKON_CHAT_MAX_STEP_COUNT ?? 100);

/** The first ten tools, in the order the model has always seen them; every other registered tool follows in registry order. */
const CORE_TOOL_ORDER = ["read_file", "list_branches", "list_commits", "list_repos", "get_diff", "grep", "glob", "find_symbol_references", "find_symbol_definitions", "list_tree"] as const;

/** MCP tools the chat agent is never offered: the agent tier (they would nest a model run in a model run). They are added by `mcp.ts` itself, not in the three registries, so nothing here filters them; the parity test reads this list. */
export const CHAT_EXCLUDED_TOOLS = ["ask_codebase", "research_codebase", "list_language_models"] as const;

/** Every registered tool the chat offers, in order: the core ten, then shared, pull request (MCP_HISTORY_TOOLS) and git (MCP_GIT_TOOLS) tools. */
export function chatToolDefinitions(): [string, AnyToolDefinition][] {
  const all = [
    ...toolNames.map((n) => [n, toolDefinitions[n]]),
    ...(familyOn("MCP_HISTORY_TOOLS") ? historyToolNames.map((n) => [n, historyToolDefinitions[n]]) : []),
    ...(familyOn("MCP_GIT_TOOLS") ? gitToolNames.map((n) => [n, gitToolDefinitions[n]]) : []),
  ] as [string, AnyToolDefinition][];
  const core = CORE_TOOL_ORDER.flatMap((n) => all.filter(([name]) => name === n));
  return [...core, ...all.filter(([n]) => !(CORE_TOOL_ORDER as readonly string[]).includes(n))];
}

/** The agent's tools: the shared definitions, scoped to the caller and the chat's selected repos. */
export function agentTools(scope: Scope, selectedRepos: string[], onSource: (s: ToolSource) => void) {
  return Object.fromEntries(
    chatToolDefinitions().map(([name, d]) => {
      return [
        name,
        tool({
          description: d.description,
          // zod emits draft-2020-12 JSON Schema, wider than the JSONSchema7 type that @types/json-schema gives `ai` when it is installed.
          inputSchema: jsonSchema(toolJsonSchema(d.inputSchema) as Parameters<typeof jsonSchema>[0], {
            validate: (value) => {
              const parsed = d.inputSchema.safeParse(value);
              return parsed.success ? { success: true, value: parsed.data } : { success: false, error: parsed.error };
            },
          }),
          needsApproval: !d.isReadOnly,
          execute: async (args) => {
            const r = await d.execute(args, { deps: toolDeps, scope, selectedRepos });
            r.sources?.forEach(onSource);
            return r;
          },
          // The model sees only the text; sources go to the UI as data parts.
          toModelOutput: ({ output }) => ({ type: "content", value: [{ type: "text", text: (output as { output: string }).output }] }),
        }),
      ];
    }),
  );
}

/** Model input for a conversation: user text, and only the answer part of earlier assistant turns. */
function modelMessages(messages: UIMessage[]): ModelMessage[] {
  return messages.flatMap((m): ModelMessage[] => {
    if (m.role === "user") return [{ role: "user", content: m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("") }];
    if (m.role === "assistant") {
      const a = answerPart(m, false);
      return a ? [{ role: "assistant", content: [{ type: "text", text: a.text }] }] : [];
    }
    return [];
  });
}

/** Files the user mentioned (file data-source parts on the last message) in repos the caller may see, with their source text. */
async function mentionedFiles(messages: UIMessage[], scope: Scope) {
  const last = messages.at(-1);
  const files = (last?.parts ?? []).filter((p) => p.type === "data-source").map((p) => (p as { data: ToolSource }).data).filter((s) => s.type === "file" && scope.allows(s.repo));
  const out = [];
  for (const f of files) {
    try {
      out.push({ path: f.path, repo: f.repo, language: "", revision: f.revision, source: await gitRead.readFile(f.repo, f.path, f.revision) });
    } catch {
      /* unreadable: left out */
    }
  }
  return out;
}

/**
 * One chat turn: one streamText run over the shared tools, at most FALKON_CHAT_MAX_STEP_COUNT
 * steps, as an AI SDK UI message stream (text, reasoning, tool calls, data-source parts, metadata).
 */
export async function createMessageStream(o: {
  messages: UIMessage[];
  selectedRepos: string[];
  scope: Scope;
  model: LanguageModelConfig;
  onFinish?: (messages: UIMessage[]) => Promise<void> | void;
  /** Stops the model run (an explicit Stop). */
  abortSignal?: AbortSignal;
  /** The UI chat renders ```archify blocks: adds the diagram guidance to the prompt. The MCP and blocking paths leave it off. */
  diagrams?: boolean;
  /** Who reads the answer: the UI chat is a person, ask_codebase over MCP is another agent. Set at every call site. */
  audience: Audience;
  /** Extra data parts written (and persisted) once the model stream has ended, before the finish chunk. */
  postProcess?: (ctx: { text: string; sources: ToolSource[]; stepCapHit: boolean; toolCalls: number }) => Promise<{ type: `data-${string}`; data: unknown }[]>;
}) {
  const { model, temperature } = await aiModel(o.model);
  const repos = [...o.selectedRepos].sort((a, b) => a.localeCompare(b));
  const query = o.messages.findLast((m) => m.role === "user")?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
  const dyn = dynamicPrompt({ repos, files: await mentionedFiles(o.messages, o.scope), query, diagrams: o.diagrams, audience: o.audience });
  return createUIMessageStream({
    originalMessages: o.messages,
    onFinish: async ({ messages }) => o.onFinish?.(messages),
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const started = Date.now();
      const sources: ToolSource[] = [];
      const result = streamText({
        model,
        system: [{ role: "system", content: STATIC_PROMPT }, ...(dyn ? [{ role: "system" as const, content: dyn }] : [])],
        messages: modelMessages(o.messages),
        tools: agentTools(o.scope, repos, (data) => (sources.push(data), writer.write({ type: "data-source", data }))),
        temperature,
        abortSignal: o.abortSignal,
        stopWhen: [({ steps }) => steps.length >= MAX_STEPS()],
        toolChoice: "auto",
        // A model that capitalises a tool name gets the lowercase tool.
        experimental_repairToolCall: async ({ toolCall, tools, error }) => {
          if (NoSuchToolError.isInstance(error)) {
            const lower = toolCall.toolName.toLowerCase();
            if (lower !== toolCall.toolName && lower in tools) return { ...toolCall, toolName: lower };
          }
          return null;
        },
        onError: ({ error }) => console.error("[ask]", error),
      });
      await new Promise<void>((resolve) =>
        writer.merge(result.toUIMessageStream({ originalMessages: o.messages, sendReasoning: true, sendStart: false, sendFinish: false, onFinish: () => resolve() })),
      );
      if (o.postProcess) {
        // A failed model run already put an error chunk in the stream: it gets no answer parts.
        const done = await Promise.all([result.text, result.steps]).catch(() => undefined);
        if (done) for (const part of await o.postProcess({ text: done[0], sources, stepCapHit: done[1].length >= MAX_STEPS(), toolCalls: done[1].reduce((n, s) => n + s.toolCalls.length, 0) })) writer.write(part);
      }
      const usage = await result.totalUsage;
      writer.write({
        type: "message-metadata",
        messageMetadata: {
          totalTokens: usage.totalTokens ?? 0,
          totalInputTokens: usage.inputTokens ?? 0,
          totalOutputTokens: usage.outputTokens ?? 0,
          totalResponseTimeMs: Date.now() - started,
          modelName: o.model.displayName ?? o.model.model,
        },
      });
      writer.write({ type: "finish" });
    },
  });
}
