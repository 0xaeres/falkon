import { DefaultChatTransport, type UIMessage } from "ai";
import { check, keys } from "./client";

export const textOf = (message: Pick<UIMessage, "parts">) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/**
 * The chat transport: the thread to ask in comes with each `sendMessage` (`{ body: { threadId } }`, because a
 * first question creates its thread first), and only the new question goes up; the engine holds the history.
 */
export const chatTransport = (productId: string) =>
  new DefaultChatTransport<UIMessage>({
    api: keys.messages(productId, "new"),
    prepareSendMessagesRequest: ({ messages, body }) => ({
      api: keys.messages(productId, String(body?.threadId)),
      body: { text: textOf(messages.findLast((m) => m.role === "user")!) },
    }),
    // Pre-stream engine errors arrive as { error: string }; surface the engine's fixed message.
    fetch: async (input, init) => check(await fetch(input, init)),
  });
