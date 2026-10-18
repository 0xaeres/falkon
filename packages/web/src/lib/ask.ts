import { prisma } from "@sbc/db";
import { openAiTools, type Scope, type ToolName } from "@sbc/shared";
import { runTool } from "./tools";

const MAX_STEPS = 12;
const MAX_TOOL_OUTPUT = 12_000;

const SYSTEM = `You answer questions about the user's indexed codebases.
Use the tools to search and read real code before answering. Never guess file contents.
Cite every claim with a reference of the form [repo:path#L10-L20] using exact repo names and paths you read.
Prefer grep/find_symbol_* to locate code, then read_file for the relevant range. Be concise.
If the answer is not in the code, say so.`;

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AskStep {
  tool: string;
  args: unknown;
  output: string;
}

export function llmConfig() {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseUrl || !model) throw new Error("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set");
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ""), model };
}

export async function ask(query: string, opts: { scope: Scope; repos?: string[]; visibility?: "PRIVATE" | "PUBLIC" }) {
  const cfg = llmConfig();
  const scopeNote = opts.repos?.length ? `\nRestrict your investigation to these repos: ${opts.repos.join(", ")}.` : "";
  const messages: Msg[] = [
    { role: "system", content: SYSTEM + scopeNote },
    { role: "user", content: query },
  ];
  const steps: AskStep[] = [];
  const tools = openAiTools();
  let answer = "";

  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: "auto", temperature: 0.1 }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const msg = (await res.json()).choices?.[0]?.message as { content: string | null; tool_calls?: ToolCall[] } | undefined;
    if (!msg) throw new Error("LLM returned no message");
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

    if (!msg.tool_calls?.length) {
      answer = msg.content ?? "";
      break;
    }
    for (const call of msg.tool_calls) {
      let output: string;
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
        output = await runTool(call.function.name as ToolName, args, opts.scope);
      } catch (e) {
        output = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (output.length > MAX_TOOL_OUTPUT) output = output.slice(0, MAX_TOOL_OUTPUT) + "\n…(truncated)";
      steps.push({ tool: call.function.name, args, output });
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
  if (!answer) answer = "Step limit reached without a final answer. Try a narrower question.";

  const session = await prisma.chatSession.create({
    data: { query, answer, steps: steps as object[], visibility: opts.visibility ?? "PRIVATE" },
  });
  return { id: session.id, answer, steps };
}
