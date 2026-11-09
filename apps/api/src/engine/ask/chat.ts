import { randomUUID } from "node:crypto";
import { generateText, type UIMessage } from "ai";
import { prisma, type ChatVisibility } from "@falkon/db";
import { gitRead, type Scope } from "@falkon/shared";
import { AskError } from "./errors";
import { answerPart, sourcesOf, toPortableMarkdown } from "./answer";
import { createMessageStream } from "./agent";
import { breaker, countsAsFailure } from "./breaker";
import { aiModel, configuredLanguageModels, describeModel, modelKey, toInfo, type LanguageModelConfig, type LanguageModelInfo } from "./models";
import { CHAT_NAME_PROMPT } from "./prompt";
import { productDeps } from "../tools";

/** The Falkon UI's thread page (FALKON_UI_URL, trailing slash trimmed; unset or empty uses the local default). */
export const threadUrl = (product: string, id: string) => `${(process.env.FALKON_UI_URL || "http://127.0.0.1:3100").replace(/\/$/, "")}/${encodeURIComponent(product)}/chat/${encodeURIComponent(id)}`;

/** The new chat row: PUBLIC for anonymous callers, else the requested visibility (PRIVATE by default); `productId` makes it a thread of that Product. */
export function newChatData(scope: Scope, requested: ChatVisibility | undefined, productId: string | undefined) {
  const authenticated = scope.principal !== undefined && scope.principal !== "anonymous";
  const visibility: ChatVisibility = requested && authenticated ? requested : authenticated ? "PRIVATE" : "PUBLIC";
  return { visibility, createdBy: scope.principal, productId, messages: [] };
}

// Lives in errors.ts so http.ts (reached from the MCP path) need not load this module and the `ai` SDK.
export { AskError };

/** The configured model to use: the requested one, else the first. */
export async function pickModel(requested?: LanguageModelInfo): Promise<LanguageModelConfig> {
  const models = await configuredLanguageModels();
  if (models.length === 0) throw new AskError(400, "INVALID_REQUEST_BODY", "No language models are configured. Please configure at least one language model.");
  if (!requested) return models[0]!;
  const m = models.find((x) => modelKey(toInfo(x)) === modelKey(requested));
  if (!m) throw new AskError(400, "INVALID_REQUEST_BODY", `Language model '${requested.provider}/${requested.model}' is not configured.`);
  return m;
}

/** Repo names, checked to exist and to be visible to the caller. */
export async function resolveRepos(names: string[], scope: Scope) {
  for (const n of names) {
    const r = scope.allows(n) ? await prisma.repo.findUnique({ where: { name: n }, select: { id: true } }) : null;
    if (!r) throw new AskError(400, "INVALID_REQUEST_BODY", `Repository '${n}' not found.`);
  }
  return names;
}

/** The chat's name from its first question; undefined (the chat keeps its fallback name) while the model's breaker is open or the model is at its cap. Never takes a slot. */
export async function chatName(question: string, m: LanguageModelConfig) {
  if (!breaker.allowsNaming(m)) return undefined;
  const { model } = await aiModel(m);
  try {
    const { text } = await generateText({ model, prompt: CHAT_NAME_PROMPT(question) });
    breaker.noted(m, true);
    return text;
  } catch (e) {
    if (countsAsFailure(e)) breaker.noted(m, false);
    throw e;
  }
}

/**
 * Drains a UI message stream: the work happens in its onFinish. An error chunk (a provider or
 * agent failure) fails the ask as a 500 UNEXPECTED_ERROR rather than a partial answer.
 */
export async function drain(s: ReadableStream<{ type: string; errorText?: string }>) {
  const r = s.getReader();
  let error: string | undefined;
  for (let c = await r.read(); !c.done; c = await r.read()) if (c.value.type === "error") error ??= c.value.errorText ?? "Unknown error";
  if (error !== undefined) throw new AskError(500, "UNEXPECTED_ERROR", error);
}

/** The UI chat's evidence step for a Product: the same `buildEvidence` over the Product's current generation (none yet: an empty id, as `messagesToAnswers` reads a missing one). */
async function evidenceFor(product: string, scope: Scope) {
  const { buildEvidence } = await import("./evidence");
  const generation = await productDeps.generation(product);
  return (ctx: Parameters<NonNullable<Parameters<typeof createMessageStream>[0]["postProcess"]>>[0]) =>
    buildEvidence({ ...ctx, scopeAllows: scope.allows, productId: product, generation, readFile: gitRead.readFile });
}

/**
 * The blocking Ask (/api/chat/blocking and MCP ask_codebase): creates a chat, runs one
 * agent turn to completion, names the chat, and returns the answer as portable markdown.
 */
export async function askCodebase(o: { query: string; repos?: string[]; languageModel?: LanguageModelInfo; visibility?: ChatVisibility; scope: Scope; product?: string }) {
  const model = await pickModel(o.languageModel);
  // Before the chat row is created: a refused ask leaves nothing behind.
  const permit = breaker.admit(model);
  let repos: string[], chat: { id: string }, user: UIMessage, postProcess: Awaited<ReturnType<typeof evidenceFor>> | undefined, stream: Awaited<ReturnType<typeof createMessageStream>>;
  let final: UIMessage[] = [];
  try {
    repos = await resolveRepos(o.repos ?? [], o.scope);
    chat = await prisma.chat.create({ data: newChatData(o.scope, o.visibility, o.product) });
    user = { id: randomUUID(), role: "user", parts: [{ type: "text", text: o.query }] };
    // A thread of a Product stores what the UI chat stores (answer and evidence parts), so its page renders the answer.
    postProcess = o.product ? await evidenceFor(o.product, o.scope) : undefined;
    stream = await createMessageStream({ messages: [user], selectedRepos: repos, scope: o.scope, model, permit, onFinish: (m) => void (final = m), postProcess, audience: "agent" });
  } catch (e) {
    permit.release();
    throw e;
  }
  const [, name] = await Promise.all([drain(stream), chatName(o.query, model)]);
  // The chat may have been deleted while the agent ran: the answer still returns, without a link.
  const saved = await prisma.chat.update({ where: { id: chat.id }, data: { messages: final as object[], name } }).then(() => true, (e: { code?: string }) => {
    if (e?.code !== "P2025") throw e;
    return false;
  });
  const assistant = final.find((m) => m.role === "assistant");
  const text = assistant ? (answerPart(assistant, false)?.text ?? "") : "";
  return {
    answer: toPortableMarkdown(text, sourcesOf(final)),
    chatId: chat.id,
    chatUrl: saved && o.product ? threadUrl(o.product, chat.id) : undefined,
    languageModel: await describeModel(model),
  };
}
