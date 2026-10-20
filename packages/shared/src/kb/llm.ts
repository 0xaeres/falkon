import { z } from "zod";
import { toolJsonSchema } from "../toolJsonSchema";
import { MAX_STEPS_PER_AGENT, SUBMIT_NUDGES } from "./limits";

// ---- budget ---------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(public used: number, public limit: number) {
    super(`token budget exhausted: ${used} of ${limit}`);
  }
}

/** Counts every prompt and completion token a scan spends; agents stop as soon as it is exceeded. */
export class TokenBudget {
  used = 0;
  constructor(public readonly limit: number) {}
  /** Marginal spend: prompt tokens the provider served from cache are free. */
  add(prompt: number, completion: number, cached = 0) {
    this.used += Math.max(0, prompt - cached) + completion;
  }
  exceeded() {
    return this.used >= this.limit;
  }
  check() {
    if (this.exceeded()) throw new BudgetExceededError(this.used, this.limit);
  }
}

// ---- chat client ----------------------------------------------------------

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: { type: "function"; function: { name: string; description: string; parameters: unknown } }[];
  maxTokens?: number;
  /** Require the model to call this tool (OpenAI `tool_choice`); used on an agent's last step. */
  forceTool?: string;
}
export interface ChatResult {
  message: { content: string | null; tool_calls?: ToolCall[] };
  finishReason: string;
  promptTokens: number;
  /** prompt tokens served from the provider's cache; they do not count against the budget */
  cachedTokens?: number;
  completionTokens: number;
}
export interface LlmClient {
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  /** Default model; stages may override. */
  model: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model } = env;
  if (!baseUrl || !apiKey || !model) throw new Error("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set");
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

/** Whether a model is configured: all of LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are set. */
export const llmConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);

/**
 * First-scan cost estimate: total bytes of every file in the owner's tree at the head commit / 4 (about
 * four bytes per token), capped at the per-scan budget. An upper-bound guide: agents read only part of the tree.
 */
export const estimateTokens = (files: { size: number }[], cap: number): number => Math.min(cap, Math.ceil(files.reduce((n, f) => n + f.size, 0) / 4));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OpenAI-compatible chat completions. Retries rate limits and 5xx with backoff. */
export function openAiClient(cfg: LlmConfig, opts: { retries?: number; timeoutMs?: number } = {}): LlmClient {
  const retries = opts.retries ?? 4;
  return {
    async chat(req, signal) {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        try {
          const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000);
          const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
              model: req.model,
              messages: req.messages,
              ...(req.tools?.length
                ? { tools: req.tools, tool_choice: req.forceTool ? { type: "function", function: { name: req.forceTool } } : "auto" }
                : {}),
              ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
              temperature: 0.1,
            }),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
            continue;
          }
          if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 500)}`);
          const json = (await res.json()) as any;
          const choice = json.choices?.[0];
          if (!choice?.message) throw new Error("LLM returned no message");
          return {
            message: choice.message,
            finishReason: choice.finish_reason ?? "",
            promptTokens: json.usage?.prompt_tokens ?? 0,
            cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? json.usage?.prompt_cache_hit_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
          };
        } catch (e) {
          if (signal?.aborted) throw e;
          if ((e as Error).message?.startsWith("LLM 4")) throw e; // non-retryable client error
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}

// ---- agent loop -----------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  run(args: any): Promise<unknown> | unknown;
}

export const tool = <S extends z.ZodObject<any>>(
  name: string,
  description: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<unknown> | unknown,
): ToolDef => ({ name, description, schema, run });

const asOpenAi = (t: ToolDef) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: toolJsonSchema(t.schema) },
});

const MAX_TOOL_OUTPUT = 9_000;

/**
 * Agents resend their whole conversation on every step, so exploration cost grows quadratically with
 * the number of tool calls. Older tool results are replaced by a stub; the model keeps what it learned
 * in its own messages and can re-read a file if it needs the exact text again.
 */
export function maskOldToolOutputs(messages: ChatMessage[], keep: number): ChatMessage[] {
  const toolIdx = messages.flatMap((m, i) => (m.role === "tool" ? [i] : []));
  const stale = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - keep)));
  return messages.map((m, i) =>
    stale.has(i) && m.role === "tool" && m.content.length > 200 ? { ...m, content: `[earlier output elided, ${m.content.length} chars; re-read if you need it]` } : m,
  );
}
const clip = (s: string) => (s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + "\n…(truncated)" : s);

export class AgentError extends Error {}

export interface AgentRun {
  llm: LlmClient;
  model: string;
  label: string;
  system: string;
  user: string;
  tools: ToolDef[];
  /** The agent is finished when this returns true after a step. */
  done: () => boolean;
  /** Name of the tool that completes the task; named in the nudge when the model forgets it. */
  finishTool: string;
  /**
   * Which tool to require on each of the last two steps (steps 2 and 1 remaining), for tasks that need
   * more than one call to finish, e.g. write a document, then finish it. Defaults to finishTool on the last step.
   */
  forcePlan?: (stepsRemaining: number) => string | undefined;
  budget: TokenBudget;
  signal?: AbortSignal;
  maxSteps?: number;
  maxTokens?: number;
  /** How many of the most recent tool results stay in the prompt; older ones are replaced by a stub. */
  keepToolOutputs?: number;
  onStep?: (info: { label: string; step: number; tool?: string }) => void;
}

/**
 * Drive a tool-calling model until `done()`. Tool output that is an object with `ok: false` is a
 * refusal: it goes back to the model verbatim so it can fix the submission and try again. A model
 * that ends a turn without finishing is nudged, at most SUBMIT_NUDGES times.
 */
export async function runAgent(a: AgentRun): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: a.system },
    { role: "user", content: a.user },
  ];
  const byName = new Map(a.tools.map((t) => [t.name, t]));
  const defs = a.tools.map(asOpenAi);
  const maxSteps = a.maxSteps ?? MAX_STEPS_PER_AGENT;
  let nudges = 0;
  let lastRefusal = "";

  for (let step = 1; step <= maxSteps; step++) {
    a.signal?.throwIfAborted();
    a.budget.check();
    // An agent that keeps exploring never delivers. Warn it as the cap nears, then require the finishing tool.
    if (step === maxSteps - 4 && maxSteps > 6) {
      messages.push({ role: "user", content: `You have about 4 steps left. Stop exploring and call ${a.finishTool} now with what you have.` });
    }
    const remaining = maxSteps - step + 1;
    const forced = remaining <= 2 ? (a.forcePlan ? a.forcePlan(remaining) : remaining === 1 ? a.finishTool : undefined) : undefined;
    const res = await a.llm.chat(
      { model: a.model, messages: maskOldToolOutputs(messages, a.keepToolOutputs ?? 8), tools: defs, maxTokens: a.maxTokens, ...(forced && byName.has(forced) ? { forceTool: forced } : {}) },
      a.signal,
    );
    a.budget.add(res.promptTokens, res.completionTokens, res.cachedTokens ?? 0);
    // The call that crossed the limit must not go on to write or commit anything.
    a.budget.check();
    const calls = res.message.tool_calls ?? [];
    messages.push({ role: "assistant", content: res.message.content, tool_calls: calls.length ? calls : undefined });

    if (!calls.length) {
      if (a.done()) return;
      if (nudges++ >= SUBMIT_NUDGES) break;
      messages.push({
        role: "user",
        content: `You ended your turn without calling ${a.finishTool}. Call ${a.finishTool} now with a complete, valid input, fixing any problem reported earlier.`,
      });
      continue;
    }

    for (const call of calls) {
      a.onStep?.({ label: a.label, step, tool: call.function.name });
      const t = byName.get(call.function.name);
      let out: unknown;
      if (!t) out = { ok: false, reason: "unknown_tool", message: `No tool named ${call.function.name}.` };
      else {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = undefined;
        }
        if (args === undefined) {
          out = {
            ok: false,
            reason: res.finishReason === "length" ? "truncated" : "bad_json",
            message:
              res.finishReason === "length"
                ? "Your output was cut off. Submit a shorter, complete input."
                : "Arguments were not valid JSON.",
          };
        } else {
          const parsed = t.schema.safeParse(args);
          if (!parsed.success) {
            out = { ok: false, reason: "invalid_input", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
          } else {
            try {
              out = await t.run(parsed.data);
            } catch (e) {
              if (e instanceof BudgetExceededError || a.signal?.aborted) throw e;
              out = { ok: false, reason: "tool_error", message: e instanceof Error ? e.message : String(e) };
            }
          }
        }
      }
      if (out && typeof out === "object" && (out as any).ok === false) {
        lastRefusal = `${(out as any).reason}: ${(out as any).message}`;
        a.onStep?.({ label: a.label, step, tool: `${call.function.name} REFUSED ${(out as any).reason}` });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: clip(typeof out === "string" ? out : JSON.stringify(out)) });
    }
    if (a.done()) return;
    if (res.finishReason === "length" && calls.some((c) => c.function.name === a.finishTool) && !a.done()) {
      // a cut-off submission cannot be repaired by repeating it at the same length
      nudges++;
    }
  }
  throw new AgentError(`${a.label} ended without completing ${a.finishTool}${lastRefusal ? ` (last refusal ${lastRefusal})` : ""}`);
}

/** Run `fn` over `items` with at most `n` in flight. Failures do not cancel siblings; all outcomes are returned. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
