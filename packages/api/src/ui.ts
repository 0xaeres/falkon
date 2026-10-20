// UI-shaped Product routes (/ui/products...) on the admin listener. The registry routes (/products...) keep the operator shape.
import { Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { editRequestSchema, setupRequestSchema, syncRequestSchema, type EditRequest, type Product, type Repository, type SetupRequest, type Status } from "@sbc/contracts";
import { RepoKind, type PrismaClient } from "@sbc/db";
import { loadContextResolver } from "../../backend/src/productResolve";
import { ConnectionService } from "./connections";
import { body, error } from "./request";
import { isProductName } from "./product";
import { deriveStatus, memberNames, toUiProduct, withPlaceholders, type ConnectionFacts, type RepoFacts } from "./uiProduct";

type Db = Pick<PrismaClient, "product" | "repo" | "connection" | "$transaction">;
type Tx = Pick<PrismaClient, "product" | "repo" | "connection">;

const notFound = () => error(404, "NOT_FOUND", "Product not found.");
const readOnly = () => error(409, "READ_ONLY", "Product comes from config and is read-only through this API.");
const noConnection = () => error(409, "NO_CONNECTION", "Product has no connection to edit its repositories through.");
const badRepository = () => error(400, "INVALID_REPOSITORY", "A selected repository is not available on this connection.");
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

type ConnectionRow = { id: number; config: unknown; syncError: string | null; syncRequestedAt: Date | null; credential: { id: string; host: string } | null };
const withCredential = { credential: { select: { id: true, host: true } } } as const;

/** A code host url (`https://github.com`) or a bare host (generic git stores `fixtures.test`). */
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export class UiProductService {
  constructor(private readonly db: Db, private readonly connections: ConnectionService) {}

  /** Loads everything the mappers need for `rows` in three queries. */
  private async load(rows: { slug: string; name: string; source: "config" | "api"; definition: unknown; repoNames: string[]; connectionId: number | null; createdAt: Date }[]) {
    const names = [...new Set(rows.flatMap(memberNames))];
    const repos = await this.db.repo.findMany({ where: { name: { in: names }, kind: RepoKind.CODE } });
    const conns = await this.db.connection.findMany({ where: { id: { in: rows.flatMap((r) => (r.connectionId === null ? [] : [r.connectionId])) } }, include: withCredential });
    const byConn = new Map<number, ConnectionRow>(conns.map((c) => [c.id, c]));
    return rows.map((row) => {
      const mine = repos.filter((r) => memberNames(row).includes(r.name));
      const facts = withPlaceholders(memberNames(row), mine, row.createdAt);
      const c = row.connectionId === null ? undefined : byConn.get(row.connectionId);
      // A config Product has no connectionId: its host is the code host of its first repo.
      const connection: ConnectionFacts | null = c
        ? { credentialId: c.credential?.id ?? null, host: c.credential?.host ?? (c.config as { url?: string }).url?.replace(/^https?:\/\//, "") ?? "github.com", syncError: c.syncError, syncRequestedAt: c.syncRequestedAt }
        : mine[0]
          ? { credentialId: null, host: hostOf(mine[0].external_codeHostUrl), syncError: null, syncRequestedAt: null }
          : null;
      return { row, facts, connection };
    });
  }

  private async uiProducts(rows: Parameters<UiProductService["load"]>[0]): Promise<{ product: Product; status: Status }[]> {
    return (await this.load(rows)).map(({ row, facts, connection }) => {
      const status = deriveStatus(row.slug, facts, connection);
      return { product: toUiProduct(row, facts, connection, status), status };
    });
  }

  private async find(slug: string) {
    const row = isProductName(slug) ? await this.db.product.findUnique({ where: { slug } }) : null;
    if (!row) throw notFound();
    return row;
  }

  async list() {
    return (await this.uiProducts(await this.db.product.findMany({ orderBy: { slug: "asc" } }))).map((p) => p.product);
  }

  async get(slug: string) {
    return (await this.uiProducts([await this.find(slug)]))[0]!.product;
  }

  async status(slug: string) {
    return (await this.uiProducts([await this.find(slug)]))[0]!.status;
  }

  /** The exact Repo.name of each chosen repository, each of which must be in the connection's code-host listing. Default branch only. */
  private pick(chosen: { id: string }[], listing: Repository[]) {
    const available = new Set(listing.map((r) => r.id));
    const ids = chosen.map((c) => c.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !available.has(id))) throw badRepository();
    return ids;
  }

  /**
   * Sets the connection's `repos` to the union of the exact `org/repo` names of every UI Product on it (this one
   * replaced by `mine`) and asks for a sync. Another Product's repositories are never dropped.
   * ponytail: two concurrent writes on one connection can lose one update; a row lock if that ever matters.
   */
  private async writeUnion(tx: Tx, connectionId: number, slug: string, mine: string[]) {
    const c = await tx.connection.findUniqueOrThrow({ where: { id: connectionId }, include: withCredential });
    const others = await tx.product.findMany({ where: { connectionId, slug: { notIn: [slug] } } });
    const prefix = `${c.credential?.host}/`;
    const all = new Set([...others.flatMap(memberNames), ...mine].filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)));
    await tx.connection.update({ where: { id: connectionId }, data: { config: { ...(c.config as object), repos: [...all].sort() }, syncRequestedAt: new Date() } });
  }

  async create(input: SetupRequest) {
    const { connectionId, repos } = await this.connections.listing(input.connectionId);
    const names = this.pick(input.repositories, repos);
    try {
      await this.db.$transaction(async (tx) => {
        const repoNames = (await loadContextResolver(tx))({ include: names });
        await tx.product.create({ data: { slug: input.id, name: input.name, source: "api", definition: { include: names }, repoNames, connectionId } });
        await this.writeUnion(tx, connectionId, input.id, names);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw error(409, "ALREADY_EXISTS", "A Product with this slug exists.");
      throw e;
    }
    return this.get(input.id);
  }

  async edit(slug: string, input: EditRequest) {
    const row = await this.find(slug);
    if (row.source !== "api") throw readOnly();
    const conn = row.connectionId === null ? null : await this.db.connection.findUnique({ where: { id: row.connectionId }, include: withCredential });
    if (!conn?.credential) throw noConnection();
    const { repos } = await this.connections.listing(conn.credential.id);
    const names = this.pick(input.repositories, repos);
    await this.db.$transaction(async (tx) => {
      const repoNames = (await loadContextResolver(tx))({ include: names });
      await tx.product.updateMany({ where: { slug, source: "api" }, data: { name: input.name, definition: { include: names }, repoNames } });
      await this.writeUnion(tx, conn.id, slug, names);
    });
    return this.get(slug);
  }

  /** Asks the backend tick to sync the connection and re-index this Product's failed repos (a fetch into the existing clone, never a reclone). */
  async sync(slug: string) {
    const row = await this.find(slug);
    const now = new Date();
    if (row.connectionId !== null) await this.db.connection.updateMany({ where: { id: row.connectionId }, data: { syncRequestedAt: now } });
    await this.db.repo.updateMany({ where: { name: { in: memberNames(row) }, kind: RepoKind.CODE, status: "FAILED" }, data: { indexRequestedAt: now } });
    return this.status(slug);
  }
}

const setupBody = setupRequestSchema.strict();
const editBody = editRequestSchema.strict();
const syncBody = syncRequestSchema.strict();

@Controller("ui/products")
export class UiProductsController {
  constructor(@Inject(UiProductService) private readonly products: UiProductService) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Post()
  async create(@Req() req: IncomingMessage) {
    return this.products.create(await body(req, setupBody));
  }

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.products.get(slug);
  }

  @Patch(":slug")
  async edit(@Param("slug") slug: string, @Req() req: IncomingMessage) {
    return this.products.edit(slug, await body(req, editBody));
  }

  @Get(":slug/status")
  status(@Param("slug") slug: string) {
    return this.products.status(slug);
  }

  @Post(":slug/sync")
  async sync(@Param("slug") slug: string, @Req() req: IncomingMessage) {
    await body(req, syncBody);
    return this.products.sync(slug);
  }
}
