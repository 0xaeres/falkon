// Chat transport contracts (S21): the request body, the file-reference preview rewrite, and the mapping between
// stored AI SDK UI messages and `Answer`s. Pure; shared by the engine (GET thread) and the UI (live view, seeding).
import { z } from "zod";
import { answerSchema, answerPartSchema, evidencePartSchema, type Answer } from "./index";

/** POST /ui/products/:slug/threads/:id/messages. The server owns the history: a `messages` key is an unknown key. */
export const chatMessageRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  languageModel: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
});
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;

/** Copy of FILE_REFERENCE_REGEX in packages/web/src/lib/ask/prompt.ts (chat.test.ts keeps them in step). Use `new RegExp(...)` per scan. */
export const FILE_REFERENCE_REGEX = new RegExp("@file:\\{([^:}]+(:\\d+)?[^:}]*)::([^:}]+)(?::(\\d+)(?:-(\\d+))?)?\\}", "g");

/** Streaming preview: each distinct `@file:{repo::path:a-b}` becomes `[n]`, numbered by first appearance. */
export function rewriteFileRefs(text: string): string {
  const ids = new Map<string, number>();
  return text.replace(new RegExp(FILE_REFERENCE_REGEX), (_m, repo: string, _port, path: string, start = "", end = "") => {
    const key = [repo, path, start, end].join("\0");
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    return `[${ids.get(key)}]`;
  });
}

/** The least a message needs to be mapped: structurally satisfied by the AI SDK's `UIMessage`. */
export interface ChatMessageLike {
  id: string;
  role: string;
  parts: { type: string; text?: string; data?: unknown }[];
}

export const ABSTENTION_INCOMPLETE = "This answer did not finish. Ask again to retry.";

const textOf = (m: ChatMessageLike) => m.parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");

function toAnswer(productId: string, question: string, m: ChatMessageLike): Answer {
  const answerData = m.parts.find((p) => p.type === "data-answer")?.data;
  const parsed = answerSchema.safeParse({
    ...(answerData && typeof answerData === "object" ? answerData : {}),
    id: m.id,
    productId,
    question,
    evidence: m.parts.filter((p) => p.type === "data-evidence").map((p) => p.data),
  });
  if (m.parts.some((p) => p.type === "data-answer") && parsed.success) return parsed.data;
  const generation = (answerData as { generation?: unknown } | undefined)?.generation;
  return { id: m.id, productId, question, generation: typeof generation === "string" ? generation : "", kind: "abstention", paragraphs: [], evidence: [], gaps: [], partialReasons: [], abstention: ABSTENTION_INCOMPLETE, suggestions: [] };
}

/** Pairs each user message with the assistant message right after it; a user message with no reply is left out. */
export function messagesToAnswers(productId: string, messages: ChatMessageLike[]): Answer[] {
  const out: Answer[] = [];
  messages.forEach((m, i) => {
    const next = messages[i + 1];
    if (m.role === "user" && next?.role === "assistant") out.push(toAnswer(productId, textOf(m), next));
  });
  return out;
}

type Part = { type: "text"; text: string } | { type: `data-${string}`; data: unknown };

/** Answers as UI messages, to seed `useChat` (and to store). The inverse of `messagesToAnswers`. */
export function answersToMessages(answers: Answer[]): { id: string; role: "user" | "assistant"; parts: Part[] }[] {
  return answers.flatMap((a) => [
    { id: `${a.id}-q`, role: "user" as const, parts: [{ type: "text" as const, text: a.question }] },
    {
      id: a.id,
      role: "assistant" as const,
      parts: [
        ...a.evidence.map((e) => ({ type: "data-evidence" as const, data: evidencePartSchema.parse(e) })),
        { type: "data-answer" as const, data: answerPartSchema.parse(a) },
      ],
    },
  ]);
}
