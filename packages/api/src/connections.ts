import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { connectionDtoSchema, connectionRequestSchema, repositoriesQuery, type Repository } from "@sbc/contracts";
import type { PrismaClient } from "@sbc/db";
import { newCredentialId, openCredential, seal } from "@sbc/shared";
import { z } from "zod";
import { body, error } from "./request";

// ---- code host (GitHub / GitHub Enterprise) ----------------------------------------------------------

interface HostRepo {
  full_name: string;
  default_branch: string;
  pushed_at: string | null;
}

/** The two read-only calls the engine makes with a stored token. Injectable: tests never touch the network. */
export interface CodeHost {
  /** `GET /user`; resolves to the scopes in `x-oauth-scopes`. Rejects with CodeHostError("invalid") for a rejected token. */
  check(host: string, token: string): Promise<{ scopes: string[] }>;
  /** `GET /user/repos?per_page=100&sort=pushed`, at most 3 pages (300 repositories). */
  repos(host: string, token: string): Promise<HostRepo[]>;
}

export class CodeHostError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(kind);
  }
}

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const apiBase = (host: string) => (host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`);

/** Plain `fetch` rather than Octokit: two GETs do not justify adding @octokit/rest to this package. */
export function githubCodeHost(fetchImpl: typeof fetch = fetch): CodeHost {
  const get = async (host: string, token: string, path: string) => {
    let res: Response;
    try {
      res = await fetchImpl(`${apiBase(host)}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "falkon" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new CodeHostError("unavailable");
    }
    if (res.status === 401 || res.status === 403) throw new CodeHostError("invalid");
    if (!res.ok) throw new CodeHostError("unavailable");
    return res;
  };
  return {
    async check(host, token) {
      const res = await get(host, token, "/user");
      return { scopes: (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
    },
    async repos(host, token) {
      const out: HostRepo[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const rows = (await (await get(host, token, `/user/repos?per_page=${PAGE_SIZE}&sort=pushed&page=${page}`)).json().catch(() => {
          throw new CodeHostError("unavailable");
        })) as HostRepo[];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return out;
    },
  };
}

// ---- service -----------------------------------------------------------------------------------------

type Db = {
  credential: Pick<PrismaClient["credential"], "update" | "delete">;
  connection: Pick<PrismaClient["connection"], "create" | "findMany" | "findFirst" | "delete">;
};

const FIXED = {
  INVALID_TOKEN: () => error(422, "INVALID_TOKEN", "The code host rejected this token."),
  UPSTREAM_UNAVAILABLE: () => error(502, "UPSTREAM_UNAVAILABLE", "The code host could not be reached."),
  NOT_FOUND: () => error(404, "NOT_FOUND", "Connection not found."),
};

const ID = /^[A-Za-z0-9_-]{22}$/;
const meta = { select: { id: true, host: true, scopes: true, createdAt: true, lastCheckedAt: true, lastError: true } } as const;

/** Runs a code-host call; whatever it throws becomes a fixed-vocabulary error (the original is not kept or logged). */
async function upstream<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw e instanceof CodeHostError && e.kind === "invalid" ? FIXED.INVALID_TOKEN() : FIXED.UPSTREAM_UNAVAILABLE();
  }
}

const dto = (c: { id: string; host: string; scopes: string[]; createdAt: Date; lastCheckedAt: Date | null; lastError: string | null }) =>
  connectionDtoSchema.parse({
    id: c.id,
    host: c.host,
    provider: c.host === "github.com" ? "github" : "github-enterprise",
    createdAt: c.createdAt.toISOString(),
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
    status: c.lastError ? "failed" : "ok",
    scopes: c.scopes,
  });

export class ConnectionService {
  constructor(private readonly db: Db, private readonly host: CodeHost = githubCodeHost()) {}

  /** The api connection whose credential id is `id`; a malformed id is the same 404 as an unknown one. */
  private async find(id: string) {
    const row = ID.test(id) ? await this.db.connection.findFirst({ where: { credentialId: id, source: "api" }, include: { credential: true } }) : null;
    if (!row?.credential) throw FIXED.NOT_FOUND();
    return { connectionId: row.id, credential: row.credential };
  }

  async create(input: z.infer<typeof createBody>) {
    const url = new URL(input.host);
    const token = input.token.trim();
    const { scopes } = await upstream(() => this.host.check(url.host, token));
    const id = newCredentialId();
    const created = await this.db.connection.create({
      data: {
        name: `ui-${id}`,
        connectionType: "github",
        source: "api",
        config: { type: "github", ...(url.host === "github.com" ? {} : { url: url.origin }), repos: [], token: { stored: id } },
        credential: { create: { id, kind: "github-token", host: url.host, ...seal(token, { id, host: url.host }), scopes, lastCheckedAt: new Date() } },
      },
      include: { credential: meta },
    });
    return dto(created.credential!);
  }

  async list() {
    const rows = await this.db.connection.findMany({ where: { source: "api" }, include: { credential: meta }, orderBy: { createdAt: "asc" } });
    return rows.flatMap((r) => (r.credential ? [dto(r.credential)] : []));
  }

  /** Deletes the connection and its credential row. */
  async remove(id: string) {
    const { connectionId } = await this.find(id);
    await this.db.connection.delete({ where: { id: connectionId } });
    await this.db.credential.delete({ where: { id } });
  }

  async rotate(id: string, tokenInput: string) {
    const { credential } = await this.find(id);
    const token = tokenInput.trim();
    const { scopes } = await upstream(() => this.host.check(credential.host, token));
    return dto(
      await this.db.credential.update({
        where: { id },
        data: { ...seal(token, { id, host: credential.host }), scopes, rotatedAt: new Date(), lastCheckedAt: new Date(), lastError: null },
        ...meta,
      }),
    );
  }

  async repositories(id: string, query: z.infer<typeof repositoriesQuery>): Promise<Repository[]> {
    const { credential } = await this.find(id);
    const repos = await upstream(() => this.host.repos(credential.host, openCredential(credential)));
    const q = query.q?.toLowerCase();
    const page = query.page ?? 1;
    return repos
      .filter((r) => !q || r.full_name.toLowerCase().includes(q))
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((r) => {
        const [organization = "", name = ""] = r.full_name.split("/");
        return {
          id: `${credential.host}/${r.full_name}`,
          name,
          organization,
          language: "",
          revision: "",
          updated: new Date(r.pushed_at ?? 0).toISOString(),
          branches: [r.default_branch],
          branch: r.default_branch,
        };
      });
  }
}

// ---- routes ------------------------------------------------------------------------------------------

const createBody = connectionRequestSchema.strict();
const tokenBody = z.strictObject({ token: connectionRequestSchema.shape.token });

@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(ConnectionService) private readonly connections: ConnectionService) {}

  @Post()
  async create(@Req() req: IncomingMessage) {
    return this.connections.create(await body(req, createBody));
  }

  @Get()
  list() {
    return this.connections.list();
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    await this.connections.remove(id);
  }

  @Put(":id/token")
  async rotate(@Param("id") id: string, @Req() req: IncomingMessage) {
    return this.connections.rotate(id, (await body(req, tokenBody)).token);
  }

  @Get(":id/repositories")
  async repositories(@Param("id") id: string, @Query() query: unknown) {
    const parsed = repositoriesQuery.safeParse(query);
    if (!parsed.success) throw error(400, "INVALID_REQUEST_QUERY", z.prettifyError(parsed.error));
    return this.connections.repositories(id, parsed.data);
  }
}
