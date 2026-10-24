import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { z } from "zod";
import { prisma } from "@falkon/db";
import { scopeOf, unauthorized } from "@/lib/auth";
import { createMessageStream } from "@engine/ask/agent";
import { AskError, chatName, pickModel, resolveRepos } from "@engine/ask/chat";
import { askErrorResponse, languageModelInfo, schemaError } from "@engine/ask/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const body = z.object({
  id: z.string(),
  messages: z.array(z.any()),
  selectedSearchScopes: z.array(z.object({ type: z.literal("repo"), value: z.string() }).loose()).default([]),
  languageModel: languageModelInfo.optional(),
});

/**
 * One streamed chat turn (AI SDK UI message stream). The chat is created on first use and its
 * messages are saved when the turn ends; only its creator may continue it.
 */
export async function POST(req: Request) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const parsed = await body.safeParseAsync(await req.json().catch(() => undefined));
  if (!parsed.success) return schemaError(parsed.error);
  const { id, messages, selectedSearchScopes, languageModel } = parsed.data;
  try {
    const existing = await prisma.chat.findUnique({ where: { id } });
    if (existing && existing.createdBy !== scope.principal) throw new AskError(403, "INSUFFICIENT_PERMISSIONS", "You do not have access to this chat.");
    const model = await pickModel(languageModel);
    const repos = await resolveRepos(selectedSearchScopes.map((s) => s.value), scope);
    if (!existing) await prisma.chat.create({ data: { id, createdBy: scope.principal, visibility: "PRIVATE", messages: [] } });
    const firstQuestion = !existing?.name ? (messages[0] as UIMessage | undefined)?.parts?.find((p) => p.type === "text") : undefined;
    const stream = await createMessageStream({
      messages: messages as UIMessage[],
      selectedRepos: repos,
      scope,
      model,
      onFinish: async (all) => {
        const name = firstQuestion && "text" in firstQuestion ? await chatName(firstQuestion.text, model).catch(() => null) : undefined;
        await prisma.chat.update({ where: { id }, data: { messages: all as object[], ...(name ? { name } : {}) } });
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (e) {
    return askErrorResponse(e);
  }
}
