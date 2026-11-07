// Product-scoped knowledge base actions for the Falkon UI (D138): POST /ui/products/:slug/knowledge on the admin listener.
// Sets kbRequest and kbRequestedAt on a member repo exactly as the old web app did; the backend tick picks the request up.
import { Controller, Inject, Param, Post, Req } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { knowledgeActionRequestSchema } from "@falkon/contracts";
import { RepoKind, type PrismaClient } from "@falkon/db";
import { memorySignals, type Signals } from "@falkon/shared";
import { isProductName } from "./product";
import { body, error } from "./request";
import { UiProductService } from "./ui";
import { memberNames } from "./uiProduct";

type Db = Pick<PrismaClient, "product" | "repo">;

const knowledgeBody = knowledgeActionRequestSchema.strict();

export class KnowledgeService {
  constructor(private readonly db: Db, private readonly ui: Pick<UiProductService, "knowledge" | "status">, private readonly signals: Signals = memorySignals()) {}

  async act(slug: string, input: { repo: string; action: string }) {
    const row = isProductName(slug) ? await this.db.product.findUnique({ where: { slug } }) : null;
    if (!row) throw error(404, "NOT_FOUND", "Product not found.");
    // One body for a repository outside the Product and for an unknown one, so the response is no oracle (P12).
    if (!memberNames(row).includes(input.repo)) throw error(404, "NOT_FOUND", "Repository not found.");
    if (!(await this.ui.knowledge()).enabled) throw error(409, "KNOWLEDGE_BASE_DISABLED", "The knowledge base is turned off in the config.");
    // ponytail: the Product read and this write are not atomic (a transaction at read committed would not lock the row); a repo removed in between still gets the request, which is harmless: the same two fields, admin-only listener.
    const { count } = await this.db.repo.updateMany({ where: { name: input.repo, kind: RepoKind.CODE }, data: { kbRequest: input.action, kbRequestedAt: new Date() } });
    if (!count) throw error(404, "NOT_FOUND", "Repository not found.");
    this.signals.request();
    this.signals.changed();
    return this.ui.status(slug);
  }
}

@Controller("ui/products")
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}

  @Post(":slug/knowledge")
  async act(@Param("slug") slug: string, @Req() req: IncomingMessage) {
    return this.knowledge.act(slug, await body(req, knowledgeBody));
  }
}
