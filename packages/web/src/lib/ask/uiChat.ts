import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { gitRead, type Scope } from "@sbc/shared";
import { createMessageStream } from "./agent";
import { chatName, pickModel } from "./chat";
import { buildEvidence } from "./evidence";
import type { LanguageModelInfo } from "./models";

/**
 * One chat turn for the UI (S21), as a Web Response carrying the AI SDK UI message stream. The api package
 * loads this module on the first message request so the `ai` SDK stays out of its idle memory. A missing or
 * unconfigured model throws an AskError before any byte is produced.
 */
export async function uiChatResponse(o: {
  messages: UIMessage[];
  selectedRepos: string[];
  scope: Scope;
  languageModel?: LanguageModelInfo;
  productId: string;
  generation: string;
  /** The first question when the chat has no name yet; it is named from it. */
  nameFrom?: string;
  abortSignal?: AbortSignal;
  onFinish: (messages: UIMessage[], name: string | undefined) => Promise<void>;
}): Promise<Response> {
  const model = await pickModel(o.languageModel);
  // Started now so the stream does not wait for it; a failure only leaves the chat unnamed.
  const name = o.nameFrom === undefined ? undefined : chatName(o.nameFrom, model).catch(() => undefined);
  const stream = await createMessageStream({
    messages: o.messages,
    selectedRepos: o.selectedRepos,
    scope: o.scope,
    model,
    abortSignal: o.abortSignal,
    onFinish: async (messages) => o.onFinish(messages, await name),
    postProcess: (ctx) => buildEvidence({ ...ctx, scopeAllows: o.scope.allows, productId: o.productId, generation: o.generation, readFile: gitRead.readFile }),
  });
  return createUIMessageStreamResponse({ stream });
}
