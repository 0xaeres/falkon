import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { appConnectionRequestSchema, connectionDtoSchema, repositoriesQuery, type Repository, tokenConnectionRequestSchema } from "@sbc/contracts";
import type { PrismaClient } from "@sbc/db";
import { clearInstallationTokens, githubApiBase, GithubAppError, installationRepositories, listInstallations, newCredentialId, openCredential, seal, sealAppSecret, tokenFromSecret, type AppSecret } from "@sbc/shared";
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
  /** `GET /user/repos?per_page=100&sort=pushed` (`GET /installation/repositories` for kind "app"), at most 3 pages (300 repositories). */
  repos(host: string, token: string, kind?: "token" | "app"): Promise<HostRepo[]>;
}

export class CodeHostError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(kind);
  }
}

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const apiBase = githubApiBase;

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
    async repos(host, token, kind) {
      if (kind === "app")
        return installationRepositories(host, token, { fetch: fetchImpl }).catch((e) => {
          throw new CodeHostError(e instanceof GithubAppError ? e.kind : "unavailable");
        });
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
  DECRYPT_FAILED: () => error(500, "DECRYPT_FAILED", "The stored credential could not be decrypted."),
};

const ID = /^[A-Za-z0-9_-]{22}$/;
const meta = { select: { id: true, host: true, scopes: true, createdAt: true, lastCheckedAt: true } } as const;

/** Runs a code-host call; whatever it throws becomes a fixed-vocabulary error (the original is not kept or logged). */
async function upstream<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw (e instanceof CodeHostError || e instanceof GithubAppError) && e.kind === "invalid" ? FIXED.INVALID_TOKEN() : FIXED.UPSTREAM_UNAVAILABLE();
  }
}

/** `syncError` is the connection's last sync outcome (set and cleared by the backend sync). */
const dto = (c: { id: string; host: string; scopes: string[]; createdAt: Date; lastCheckedAt: Date | null }, syncError: string | null) =>
  connectionDtoSchema.parse({
    id: c.id,
    host: c.host,
    provider: c.host === "github.com" ? "github" : "github-enterprise",
    createdAt: c.createdAt.toISOString(),
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
    status: syncError ? "failed" : "ok",
    scopes: c.scopes,
  });

export class ConnectionService {
  constructor(private readonly db: Db, private readonly host: CodeHost = githubCodeHost(), private readonly fetchImpl: typeof fetch = fetch) {}

  /** The api connection whose credential id is `id`; a malformed id is the same 404 as an unknown one. */
  private async find(id: string) {
    const row = ID.test(id) ? await this.db.connection.findFirst({ where: { credentialId: id, source: "api" }, include: { credential: true } }) : null;
    if (!row?.credential) throw FIXED.NOT_FOUND();
    return { connectionId: row.id, syncError: row.syncError, credential: row.credential };
  }

  /** App connection: one installation. Validated by minting a token and listing the installation's repositories. */
  private async createApp(input: Extract<z.infer<typeof createBody>, { method: "app" }>) {
    const url = new URL(input.host);
    const id = newCredentialId();
    const secret: AppSecret = { appId: input.appId, privateKey: input.privateKey, installationId: input.installationId };
    try {
      const token = await upstream(() => tokenFromSecret({ id, host: url.host, kind: "github-app" }, JSON.stringify(secret), { fetch: this.fetchImpl }));
      await upstream(() => this.host.repos(url.host, token, "app"));
    } catch (e) {
      clearInstallationTokens(id);
      throw e;
    }
    const created = await this.db.connection.create({
      data: {
        name: `ui-${id}`,
        connectionType: "github",
        source: "api",
        config: { type: "github", ...(url.host === "github.com" ? {} : { url: url.origin }), repos: [], token: { stored: id } },
        credential: { create: { id, kind: "github-app", host: url.host, ...sealAppSecret(secret, { id, host: url.host }), scopes: ["app"], lastCheckedAt: new Date() } },
      },
      include: { credential: meta },
    });
    return dto(created.credential!, null);
  }

  /** The App's installations; stateless, the key is used for this call only. */
  async installations(input: z.infer<typeof installationsBody>) {
    return upstream(() => listInstallations(new URL(input.host).host, input.appId, input.privateKey, { fetch: this.fetchImpl }));
  }

  async create(input: z.infer<typeof createBody>) {
    if (input.method === "app") return this.createApp(input);
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
    return dto(created.credential!, null);
  }

  async list() {
    const rows = await this.db.connection.findMany({ where: { source: "api" }, include: { credential: meta }, orderBy: { createdAt: "asc" } });
    return rows.flatMap((r) => (r.credential ? [dto(r.credential, r.syncError)] : []));
  }

  /** Deletes the connection and its credential row. */
  async remove(id: string) {
    const { connectionId } = await this.find(id);
    await this.db.connection.delete({ where: { id: connectionId } });
    await this.db.credential.delete({ where: { id } });
  }

  async rotate(id: string, tokenInput: string) {
    const { credential, syncError } = await this.find(id);
    if (credential.kind === "github-app") throw FIXED.NOT_FOUND(); // an App credential has no token to rotate
    const token = tokenInput.trim();
    const { scopes } = await upstream(() => this.host.check(credential.host, token));
    return dto(
      await this.db.credential.update({
        where: { id },
        data: { ...seal(token, { id, host: credential.host }), scopes, rotatedAt: new Date(), lastCheckedAt: new Date() },
        ...meta,
      }),
      syncError,
    );
  }

  /** Every repository the connection's token can list (at most 300), with the connection row's id. */
  async listing(id: string): Promise<{ connectionId: number; repos: Repository[] }> {
    const { connectionId, credential } = await this.find(id);
    let plain: string;
    try {
      plain = openCredential(credential);
    } catch {
      throw FIXED.DECRYPT_FAILED(); // a key or data problem, not an upstream outage
    }
    const kind = credential.kind === "github-app" ? "app" : "token";
    const attempt = async () => this.host.repos(credential.host, await tokenFromSecret(credential, plain, { fetch: this.fetchImpl }), kind);
    const repos = await upstream(async () => {
      try {
        return await attempt();
      } catch (e) {
        if (kind !== "app" || !(e instanceof CodeHostError) || e.kind !== "invalid") throw e;
        clearInstallationTokens(credential.id); // an installation token the host rejected: mint once more
        return attempt();
      }
    });
    return {
      connectionId,
      repos: repos.map((r) => {
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
      }),
    };
  }

  async repositories(id: string, query: z.infer<typeof repositoriesQuery>): Promise<Repository[]> {
    const q = query.q?.toLowerCase();
    const page = query.page ?? 1;
    const match = (r: Repository) => !q || `${r.organization}/${r.name}`.toLowerCase().includes(q);
    return (await this.listing(id)).repos.filter(match).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }
}

// ---- routes ------------------------------------------------------------------------------------------

const createBody = z.discriminatedUnion("method", [tokenConnectionRequestSchema.strict(), appConnectionRequestSchema.strict()]);
const installationsBody = z.strictObject({ host: appConnectionRequestSchema.shape.host, appId: appConnectionRequestSchema.shape.appId, privateKey: appConnectionRequestSchema.shape.privateKey });
const tokenBody = z.strictObject({ token: tokenConnectionRequestSchema.shape.token });

@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(ConnectionService) private readonly connections: ConnectionService) {}

  @Post()
  async create(@Req() req: IncomingMessage) {
    return this.connections.create(await body(req, createBody));
  }

  @Post("app-installations")
  @HttpCode(200)
  async installations(@Req() req: IncomingMessage) {
    return this.connections.installations(await body(req, installationsBody));
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
