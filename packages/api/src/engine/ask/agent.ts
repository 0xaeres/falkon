import { createUIMessageStream, jsonSchema, NoSuchToolError, streamText, tool, type ModelMessage, type StepResult, type ToolSet, type UIMessage } from "ai";
import { gitRead, gitToolDefinitions, gitToolNames, historyToolDefinitions, historyToolNames, toolDefinitions, toolJsonSchema, toolNames, type AnyToolDefinition, type Scope, type ToolSource } from "@falkon/shared";
import { toolDeps } from "../tools";
import { familyOn } from "../toolFamily";
import { answerPart } from "./answer";
import { aiModel, type LanguageModelConfig } from "./models";
import { isHistoryQuery } from "./recipes";
import { dynamicPrompt, STATIC_PROMPT, type Audience } from "./prompt";

const MAX_STEPS = () => Number(process.env.FALKON_CHAT_MAX_STEP_COUNT ?? 30);

/** The most bytes of one tool result the model sees (D191). Sources sent to the UI are not capped. */
export const MODEL_TOOL_OUTPUT_MAX_BYTES = 16_384;
const NOTICE_RESERVE = 256;
/** Tools that enforce their own, larger cut (get_diff: 30,000 bytes, middle removed, hidden files dropped from sources); the generic cut would remove the tail they keep and leave sources the model never saw. */
const SELF_CUT_TOOLS = new Set(["get_diff"]);

/** The text of a tool result as the model sees it: whole when within the cap, else cut at a line boundary (inside the line, at a character boundary, when one line is longer than the cap) plus a notice. */
export function modelText(output: unknown, tool?: string): string {
  const raw = (output as { output?: unknown } | undefined)?.output;
  const full = typeof raw === "string" ? raw : JSON.stringify(output) ?? "";
  const buf = Buffer.from(full);
  if (buf.length <= MODEL_TOOL_OUTPUT_MAX_BYTES || (tool && SELF_CUT_TOOLS.has(tool))) return full;
  const budget = MODEL_TOOL_OUTPUT_MAX_BYTES - NOTICE_RESERVE;
  let end = buf.subarray(0, budget + 1).lastIndexOf(0x0a);
  if (end <= 0) for (end = budget; end > 0 && (buf[end]! & 0xc0) === 0x80; end--); // inside one long line: back to a character start
  const kept = buf.subarray(0, end).toString();
  const lines = (s: string) => s.split("\n").length;
  return `${kept}\n[output cut: ${buf.length - end} bytes, ${lines(full) - lines(kept)} lines dropped; narrow with path, pattern or repo, or read with offset and limit]`;
}

const STUBBED_TOOLS = new Set(["grep", "glob", "list_tree"]);
const KEEP_STEPS = 3;

/** The model's copy of the conversation with `grep`, `glob` and `list_tree` results older than the last three steps (one tool message each) cut to a stub line (D193); `read_file`, git and history results are never stubbed, and a stub that would not be smaller leaves the result whole. */
export function stubOldSearchResults(messages: ModelMessage[]): ModelMessage[] {
  const inputs = new Map(messages.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])).flatMap((p) => (p.type === "tool-call" ? [[p.toolCallId, p.input] as const] : [])));
  let old = messages.filter((m) => m.role === "tool").length - KEEP_STEPS;
  return messages.map((m) => {
    if (m.role !== "tool" || old-- <= 0) return m;
    return {
      ...m,
      content: m.content.map((p) => {
        if (p.type !== "tool-result" || !STUBBED_TOOLS.has(p.toolName)) return p;
        const o = p.output;
        const text = o.type === "content" ? o.value.map((v) => (v.type === "text" ? v.text : "")).join("") : o.type === "text" || o.type === "error-text" ? o.value : undefined;
        if (text === undefined) return p;
        const size = Buffer.byteLength(text);
        const stub = `[${p.toolName} ${JSON.stringify(inputs.get(p.toolCallId))}: ${size} bytes; rerun to see]`;
        if (Buffer.byteLength(stub) >= size) return p;
        return { ...p, output: o.type === "error-text" ? { type: "error-text" as const, value: stub } : { type: "text" as const, value: stub } };
      }),
    };
  });
}

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

const HISTORY_FAMILY: readonly string[] = [...historyToolNames, ...gitToolNames];

/** The agent's tools: the shared definitions, scoped to the caller and the chat's selected repos. `history: false` drops the pull request and git tools (D194). */
export function agentTools(scope: Scope, selectedRepos: string[], onSource: (s: ToolSource) => void, history = true) {
  return Object.fromEntries(
    chatToolDefinitions().filter(([n]) => history || !HISTORY_FAMILY.includes(n)).map(([name, d]) => {
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
          toModelOutput: ({ output }) => ({ type: "content", value: [{ type: "text", text: modelText(output, name) }] }),
        }),
      ];
    }),
  );
}

/** One step's cost: tokens (0 when the provider reports none) and the UTF-8 bytes of each tool result text the model sees next. */
export interface StepRecord { in: number; cached: number; out: number; toolBytes: { tool: string; bytes: number }[] }

export function stepRecord(step: StepResult<ToolSet>): StepRecord {
  const u = step.usage;
  const toolBytes = step.content.flatMap((c) => {
    if (c.type === "tool-error") return [{ tool: c.toolName, bytes: Buffer.byteLength(c.error instanceof Error ? c.error.message : String(c.error)) }];
    if (c.type !== "tool-result") return [];
    return [{ tool: c.toolName, bytes: Buffer.byteLength(modelText(c.output, c.toolName)) }];
  });
  return { in: u.inputTokens ?? 0, cached: u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0, out: u.outputTokens ?? 0, toolBytes };
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
  // History tools and recipes go with the whole conversation's user text (not only the last message), so a follow-up in a history chat keeps them.
  const history = isHistoryQuery(o.messages.filter((m) => m.role === "user").flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : ""))).join("\n"));
  const dyn = dynamicPrompt({ repos, files: await mentionedFiles(o.messages, o.scope), query, diagrams: o.diagrams, audience: o.audience, history });
  return createUIMessageStream({
    originalMessages: o.messages,
    onFinish: async ({ messages }) => o.onFinish?.(messages),
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const started = Date.now();
      const sources: ToolSource[] = [];
      const steps: StepRecord[] = [];
      const result = streamText({
        model,
        system: [{ role: "system", content: STATIC_PROMPT }, ...(dyn ? [{ role: "system" as const, content: dyn }] : [])],
        messages: modelMessages(o.messages),
        tools: agentTools(o.scope, repos, (data) => (sources.push(data), writer.write({ type: "data-source", data })), history),
        temperature,
        abortSignal: o.abortSignal,
        stopWhen: [({ steps }) => steps.length >= MAX_STEPS()],
        toolChoice: "auto",
        // The last allowed step may not call a tool, so a capped run still ends with an answer (D192); old search results shrink to stubs in the model's copy (D193).
        prepareStep: ({ stepNumber, messages }) => ({ messages: stubOldSearchResults(messages), ...(stepNumber === MAX_STEPS() - 1 ? { toolChoice: "none" as const } : {}) }),
        // A model that capitalises a tool name gets the lowercase tool.
        experimental_repairToolCall: async ({ toolCall, tools, error }) => {
          if (NoSuchToolError.isInstance(error)) {
            const lower = toolCall.toolName.toLowerCase();
            if (lower !== toolCall.toolName && lower in tools) return { ...toolCall, toolName: lower };
          }
          return null;
        },
        onStepFinish: (step) => {
          const r = stepRecord(step);
          steps.push(r);
          console.log(`[ask] step ${steps.length} in=${r.in} cached=${r.cached} out=${r.out} tools=${r.toolBytes.map((t) => `${t.tool}:${t.bytes}`).join(",")}`);
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
          steps,
          totalCachedInputTokens: steps.reduce((n, s) => n + s.cached, 0),
        },
      });
      writer.write({ type: "finish" });
    },
  });
}
