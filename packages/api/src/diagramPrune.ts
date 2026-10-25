import type { PrismaClient } from "@falkon/db";

// A rendered diagram page is about 590KB, so only a Product's most recently updated threads keep theirs. An older thread
// loses its data-diagram parts; the ```archify fence stays in the text and shows as code. Run after each stored turn.

/** Threads per Product that keep their rendered diagrams. */
export const KEEP_DIAGRAM_THREADS = 5;
/** Older threads looked at per run (bounds the read; earlier runs already pruned the rest). */
const SWEEP = 20;

type Message = { parts?: { type?: string }[] };

/** The messages without their data-diagram parts, or null when there were none. */
export function withoutDiagrams(messages: unknown): Message[] | null {
  if (!Array.isArray(messages)) return null;
  let found = false;
  const out = (messages as Message[]).map((m) => {
    if (!m.parts?.some((p) => p.type === "data-diagram")) return m;
    found = true;
    return { ...m, parts: m.parts.filter((p) => p.type !== "data-diagram") };
  });
  return found ? out : null;
}

export async function pruneDiagrams(db: Pick<PrismaClient, "chat">, productId: string) {
  const recent = await db.chat.findMany({ where: { productId }, orderBy: { updatedAt: "desc" }, take: KEEP_DIAGRAM_THREADS + SWEEP, select: { id: true, messages: true, updatedAt: true } });
  for (const chat of recent.slice(KEEP_DIAGRAM_THREADS)) {
    const messages = withoutDiagrams(chat.messages);
    // updatedAt is set to its own value: pruning must not make an old thread the newest.
    if (messages) await db.chat.update({ where: { id: chat.id }, data: { messages: messages as object[], updatedAt: chat.updatedAt } }).catch((e: { code?: string }) => {
      if (e?.code !== "P2025") throw e;
    });
  }
}
