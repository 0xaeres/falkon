import { randomUUID } from "node:crypto";
import { generateText, type UIMessage } from "ai";
import { prisma, type ChatVisibility } from "@sbc/db";
import type { Scope } from "@sbc/shared";
import { answerPart, sourcesOf, toPortableMarkdown } from "./answer";
import { createMessageStream } from "./agent";
import { aiModel, configuredLanguageModels, describeModel, modelKey, toInfo, type LanguageModelConfig, type LanguageModelInfo } from "./models";
import { CHAT_NAME_PROMPT } from "./prompt";

export const baseUrl = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const chatUrl = (id: string) => `${baseUrl()}/chat/${id}`;

export class AskError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

/** The configured model to use: the requested one, else the first. */
export async function pickModel(requested?: LanguageModelInfo): Promise<LanguageModelConfig> {
  const models = await configuredLanguageModels();
  if (models.length === 0) throw new AskError(400, "INVALID_REQUEST_BODY", "No language models are configured. Please configure at least one language model. See: https://docs.sourcebot.dev/docs/configuration/language-model-providers");
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

export async function chatName(question: string, m: LanguageModelConfig) {
  const { model } = await aiModel(m);
  return (await generateText({ model, prompt: CHAT_NAME_PROMPT(question) })).text;
}

/** Drains a stream, keeping nothing: the work happens in its onFinish. */
async function drain(s: ReadableStream<unknown>) {
  const r = s.getReader();
  while (!(await r.read()).done);
}

/**
 * Sourcebot's blocking Ask (/api/chat/blocking and MCP ask_codebase): creates a chat, runs one
 * agent turn to completion, names the chat, and returns the answer as portable markdown.
 */
export async function askCodebase(o: { query: string; repos?: string[]; languageModel?: LanguageModelInfo; visibility?: ChatVisibility; scope: Scope }) {
  const model = await pickModel(o.languageModel);
  const repos = await resolveRepos(o.repos ?? [], o.scope);
  const authenticated = o.scope.principal !== undefined && o.scope.principal !== "anonymous";
  const visibility: ChatVisibility = o.visibility && authenticated ? o.visibility : authenticated ? "PRIVATE" : "PUBLIC";
  const chat = await prisma.chat.create({ data: { visibility, createdBy: o.scope.principal, messages: [] } });
  const user: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: o.query }] };
  let final: UIMessage[] = [];
  const stream = await createMessageStream({ messages: [user], selectedRepos: repos, scope: o.scope, model, onFinish: (m) => void (final = m) });
  const [, name] = await Promise.all([drain(stream), chatName(o.query, model)]);
  await prisma.chat.update({ where: { id: chat.id }, data: { messages: final as object[], name } });
  const assistant = final.find((m) => m.role === "assistant");
  const text = assistant ? (answerPart(assistant, false)?.text ?? "") : "";
  return {
    answer: toPortableMarkdown(text, baseUrl(), sourcesOf(final)),
    chatId: chat.id,
    chatUrl: chatUrl(chat.id),
    languageModel: await describeModel(model),
  };
}
