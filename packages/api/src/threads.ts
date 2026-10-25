// UI threads and the chat messages route (S21) on the admin listener: /ui/products/:slug/threads...
// The server is the only authority on history: the messages route takes the new text only and loads the rest from the Chat row.
import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { chatMessageRequestSchema, messagesToAnswers, type ChatMessageLike, type Thread, type ThreadSummary } from "@falkon/contracts";
import type { PrismaClient } from "@falkon/db";
import { memorySignals, noneAccessPolicy, scopeFor, type Signals } from "@falkon/shared";
import { pruneDiagrams } from "./diagramPrune";
import { AskError } from "./engine/ask/errors";
import { sendJson } from "./http";
import { LiveAnswers } from "./liveAnswers";
import { isProductName } from "./product";
import { body, error } from "./request";
import { UiProductService } from "./ui";
import { sendWebResponse } from "./webAdapter";

type Db = Pick<PrismaClient, "chat" | "product">;

const notFound = () => error(404, "NOT_FOUND", "Product not found.");
// One body for an unknown thread and for another Product's thread, so the response is no oracle.
const threadNotFound = () => error(404, "NOT_FOUND", "Thread not found.");
const UI_PRINCIPAL = "ui";
/** Most threads one list returns, newest first. */
export const LIST_CAP = 200;
export const NO_GENERATION = "Chat opens when the first Evidence Generation publishes.";

const title = (name: string | null) => name ?? "New thread";
const messagesOf = (json: unknown) => (Array.isArray(json) ? (json as (ChatMessageLike & { role: "user" | "assistant" | "system" })[]) : []);

export class ThreadService {
  constructor(private readonly db: Db, private readonly products: Pick<UiProductService, "status">, private readonly signals: Signals = memorySignals(), private readonly live = new LiveAnswers()) {}

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
    const chats = await this.db.chat.findMany({ where: { productId: slug, OR: [{ createdBy: { in: [UI_PRINCIPAL, "anonymous"] } }, { visibility: "PUBLIC" }] }, orderBy: { updatedAt: "desc" }, take: LIST_CAP, select: { id: true, name: true, updatedAt: true } });
    return chats.map((c) => ({ id: c.id, productId: slug, title: title(c.name), updatedAt: c.updatedAt.getTime() }));
  }

  async create(slug: string): Promise<Thread> {
    await this.product(slug);
    const c = await this.db.chat.create({ data: { id: randomUUID(), productId: slug, createdBy: UI_PRINCIPAL, visibility: "PRIVATE", messages: [] } });
    this.signals.changed();
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
    this.signals.changed();
  }

  /**
   * One turn. Resolves to the response to stream, or throws an HttpException; Ask errors become JSON in the controller.
   * The turn runs to its end whether or not the client stays (`resume` reads it again); only `stop` ends it early.
   */
  async message(slug: string, id: string, input: { text: string; languageModel?: { provider: string; model: string } }): Promise<Response> {
    const { repoNames } = await this.product(slug);
    const chat = await this.thread(slug, id);
    const { generation } = await this.products.status(slug);
    if (generation === null) throw error(409, "NO_GENERATION", NO_GENERATION);

    const history = messagesOf(chat.messages);
    const user = { id: randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text: input.text }] };
    // The Product's repositories exactly (the same intersection the MCP path uses), whatever the caller sent.
    const effective = noneAccessPolicy().effectiveScope({ ...scopeFor(["*"]), principal: UI_PRINCIPAL }, repoNames)!;
    const { uiChatResponse } = await import("./engine/ask/uiChat");
    const response = await this.live.start(id, (signal) => uiChatResponse({
      messages: [...history, user] as never,
      selectedRepos: effective.repos,
      scope: effective.scope,
      languageModel: input.languageModel,
      productId: slug,
      generation,
      nameFrom: chat.name ? undefined : input.text,
      abortSignal: signal,
      // Stored once the model is picked, so a model-config error leaves nothing behind; kept if the turn is then stopped or fails.
      onAccepted: async () => {
        await this.db.chat.update({ where: { id }, data: { messages: [...history, user] as object[] } });
        this.signals.changed();
      },
      onFinish: async (messages, name) => {
        // A stopped turn keeps only the question (stored above); the next turn goes on from it.
        if (signal.aborted) return;
        // The thread may have been deleted while the turn ran (the UI's cleanup): nothing to store then.
        await this.db.chat.update({ where: { id }, data: { messages: messages as object[], productId: slug, ...(name ? { name } : {}) } }).catch((e: { code?: string }) => {
          if (e?.code !== "P2025") throw e;
        });
        // Only the Product's newest threads keep their rendered diagram pages.
        await pruneDiagrams(this.db, slug);
        this.signals.changed();
      },
    }));
    if (!response) throw error(409, "ANSWER_RUNNING", "An answer is still being written in this thread.");
    return response;
  }

  /** The answer being written in the thread, from its first chunk; undefined when none is. */
  async resume(slug: string, id: string): Promise<Response | undefined> {
    await this.product(slug);
    await this.thread(slug, id);
    return this.live.read(id);
  }

  /** Stops the answer being written in the thread: the question stays stored, the answer is not. */
  async stop(slug: string, id: string): Promise<void> {
    await this.product(slug);
    await this.thread(slug, id);
    this.live.stop(id);
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
    let response: Response;
    try {
      response = await this.threads.message(slug, id, input);
    } catch (e) {
      // Ask errors (no model configured, unknown model) keep the shape the web Ask routes use.
      if (e instanceof AskError) return sendJson(res, e.statusCode, { statusCode: e.statusCode, errorCode: e.errorCode, message: e.message });
      throw e;
    }
    await sendWebResponse(res, response);
  }

  /** Resumes the answer being written (204 when none is): a client that lost its connection reads it again from the start. */
  @Get(":slug/threads/:id/stream")
  async stream(@Param("slug") slug: string, @Param("id") id: string, @Res() res: ServerResponse) {
    if (!isProductName(slug)) throw notFound();
    const response = await this.threads.resume(slug, id);
    if (!response) return void res.writeHead(204).end();
    await sendWebResponse(res, response);
  }

  @Post(":slug/threads/:id/stop")
  @HttpCode(204)
  stop(@Param("slug") slug: string, @Param("id") id: string) {
    return this.threads.stop(slug, id);
  }
}
