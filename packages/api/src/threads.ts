// UI threads and the chat messages route (S21) on the admin listener: /ui/products/:slug/threads...
// The server is the only authority on history: the messages route takes the new text only and loads the rest from the Chat row.
import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { chatMessageRequestSchema, messagesToAnswers, type ChatMessageLike, type Thread, type ThreadSummary } from "@sbc/contracts";
import type { PrismaClient } from "@sbc/db";
import { noneAccessPolicy, scopeFor } from "@sbc/shared";
import { AskError } from "../../web/src/lib/ask/errors";
import { sendJson } from "./http";
import { isProductName } from "./product";
import { body, error } from "./request";
import { UiProductService } from "./ui";
import { sendWebResponse } from "./webAdapter";

type Db = Pick<PrismaClient, "chat" | "product">;

const notFound = () => error(404, "NOT_FOUND", "Product not found.");
// One body for an unknown thread and for another Product's thread, so the response is no oracle.
const threadNotFound = () => error(404, "NOT_FOUND", "Thread not found.");
const UI_PRINCIPAL = "ui";
export const NO_GENERATION = "Chat opens when the first Evidence Generation publishes.";

const title = (name: string | null) => name ?? "New thread";
const messagesOf = (json: unknown) => (Array.isArray(json) ? (json as (ChatMessageLike & { role: "user" | "assistant" | "system" })[]) : []);

export class ThreadService {
  constructor(private readonly db: Db, private readonly products: Pick<UiProductService, "status">) {}

  private async product(slug: string) {
    const p = isProductName(slug) ? await this.db.product.findUnique({ where: { slug }, select: { repoNames: true } }) : null;
    if (!p) throw notFound();
    return p;
  }

  private async thread(slug: string, id: string) {
    const chat = await this.db.chat.findUnique({ where: { id } });
    if (!chat || chat.productId !== slug) throw threadNotFound();
    return chat;
  }

  async list(slug: string): Promise<ThreadSummary[]> {
    await this.product(slug);
    const chats = await this.db.chat.findMany({ where: { productId: slug, createdBy: UI_PRINCIPAL }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, updatedAt: true } });
    return chats.map((c) => ({ id: c.id, productId: slug, title: title(c.name), updatedAt: c.updatedAt.getTime() }));
  }

  async create(slug: string): Promise<Thread> {
    await this.product(slug);
    const c = await this.db.chat.create({ data: { id: randomUUID(), productId: slug, createdBy: UI_PRINCIPAL, visibility: "PRIVATE", messages: [] } });
    return { id: c.id, productId: slug, title: title(c.name), updatedAt: c.updatedAt.getTime(), answers: [] };
  }

  async get(slug: string, id: string): Promise<Thread> {
    await this.product(slug);
    const c = await this.thread(slug, id);
    return { id: c.id, productId: slug, title: title(c.name), updatedAt: c.updatedAt.getTime(), answers: messagesToAnswers(slug, messagesOf(c.messages)) };
  }

  /** Removes a thread that has no answer (the UI's cleanup after a failed first send); a thread with an answer is refused. */
  async remove(slug: string, id: string): Promise<void> {
    await this.product(slug);
    const c = await this.thread(slug, id);
    if (messagesToAnswers(slug, messagesOf(c.messages)).length) throw error(409, "THREAD_HAS_ANSWERS", "This thread has answers and was kept.");
    // Only the row as it was read (same Product, same updatedAt): a turn that stored anything since keeps the thread.
    const { count } = await this.db.chat.deleteMany({ where: { id, productId: slug, updatedAt: c.updatedAt } });
    if (count === 0) throw threadNotFound();
  }

  /** One turn. Resolves to the response to stream, or throws an HttpException; Ask errors become JSON in the controller. */
  async message(slug: string, id: string, input: { text: string; languageModel?: { provider: string; model: string } }, signal: AbortSignal): Promise<Response> {
    const { repoNames } = await this.product(slug);
    const chat = await this.thread(slug, id);
    const { generation } = await this.products.status(slug);
    if (generation === null) throw error(409, "NO_GENERATION", NO_GENERATION);

    const history = messagesOf(chat.messages);
    const user = { id: randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text: input.text }] };
    // The Product's repositories exactly (the same intersection the MCP path uses), whatever the caller sent.
    const effective = noneAccessPolicy().effectiveScope({ ...scopeFor(["*"]), principal: UI_PRINCIPAL }, repoNames)!;
    const { uiChatResponse } = await import("../../web/src/lib/ask/uiChat");
    return uiChatResponse({
      messages: [...history, user] as never,
      selectedRepos: effective.repos,
      scope: effective.scope,
      languageModel: input.languageModel,
      productId: slug,
      generation,
      nameFrom: chat.name ? undefined : input.text,
      abortSignal: signal,
      // Stored once the model is picked, so a model-config error leaves nothing behind; kept if the turn is then stopped or fails.
      onAccepted: async () => void (await this.db.chat.update({ where: { id }, data: { messages: [...history, user] as object[] } })),
      onFinish: async (messages, name) => {
        // A stopped turn keeps only the question (stored above); the next turn goes on from it.
        if (signal.aborted) return;
        // The thread may have been deleted while the turn ran (the UI's cleanup): nothing to store then.
        await this.db.chat.update({ where: { id }, data: { messages: messages as object[], productId: slug, ...(name ? { name } : {}) } }).catch((e: { code?: string }) => {
          if (e?.code !== "P2025") throw e;
        });
      },
    });
  }
}

@Controller("ui/products")
export class ThreadsController {
  constructor(@Inject(ThreadService) private readonly threads: ThreadService) {}

  @Get(":slug/threads")
  list(@Param("slug") slug: string) {
    return this.threads.list(slug);
  }

  @Post(":slug/threads")
  create(@Param("slug") slug: string) {
    return this.threads.create(slug);
  }

  @Get(":slug/threads/:id")
  get(@Param("slug") slug: string, @Param("id") id: string) {
    return this.threads.get(slug, id);
  }

  @Delete(":slug/threads/:id")
  @HttpCode(204)
  remove(@Param("slug") slug: string, @Param("id") id: string) {
    return this.threads.remove(slug, id);
  }

  @Post(":slug/threads/:id/messages")
  async message(@Param("slug") slug: string, @Param("id") id: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    if (!isProductName(slug)) throw notFound();
    const input = await body(req, chatMessageRequestSchema);
    const stop = new AbortController();
    res.on("close", () => stop.abort());
    let response: Response;
    try {
      response = await this.threads.message(slug, id, input, stop.signal);
    } catch (e) {
      // Ask errors (no model configured, unknown model) keep the shape the web Ask routes use.
      if (e instanceof AskError) return sendJson(res, e.statusCode, { statusCode: e.statusCode, errorCode: e.errorCode, message: e.message });
      throw e;
    }
    await sendWebResponse(res, response);
  }
}
