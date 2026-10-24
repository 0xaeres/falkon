import { Controller, Delete, Get, Inject, Module, Param, Post, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { noneAccessPolicy, scopeFingerprint, scopeFor, type AccessPolicy, type Scope } from "@falkon/shared";
import { allowedHosts, restrict, sendJson } from "./http";
import { isProductName, PRODUCT_REGISTRY, type ProductRegistry } from "./product";
import { SessionBindings, type SessionBinding } from "./sessions";
import { sendWebResponse, toWebRequest } from "./webAdapter";

/** The existing MCP runners (`handleMcpPost`, `handleMcpDelete` in the web package), injected so tests can fake them. */
export interface McpHandlers {
  post(req: Request, scope: Scope, product?: string): Promise<Response>;
  delete(req: Request, scope: Scope): Promise<Response>;
}
export const MCP_HANDLERS = Symbol("McpHandlers");
const ACCESS_POLICY = Symbol("AccessPolicy");
export const SESSIONS = Symbol("SessionBindings");
const SESSION_HEADER = "mcp-session-id";

// One body per outcome, whatever the cause, so responses are no oracle for Product existence or key scope.
const PRODUCT_NOT_FOUND = { statusCode: 404, errorCode: "NOT_FOUND", message: "Product not found." };
const SESSION_NOT_FOUND = { statusCode: 404, errorCode: "NOT_FOUND", message: "Session not found." };
const UNAUTHORIZED = { statusCode: 401, errorCode: "NOT_AUTHENTICATED", message: "Not authenticated." };

@Controller("mcp")
class McpController {
  // Explicit @Inject: tsx does not emit decorator metadata.
  constructor(
    @Inject(PRODUCT_REGISTRY) private readonly products: Pick<ProductRegistry, "find">,
    @Inject(MCP_HANDLERS) private readonly mcp: McpHandlers,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(SESSIONS) private readonly sessions: SessionBindings,
  ) {}

  @Post(":product")
  post(@Param("product") product: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    return this.serve(product, req, res, "post");
  }

  @Delete(":product")
  delete(@Param("product") product: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    return this.serve(product, req, res, "delete");
  }

  @Get(":product")
  get(@Res() res: ServerResponse) {
    res.writeHead(405, { Allow: "POST, DELETE" }).end();
  }

  /** Order (ADR 0001, 4.5): Product name syntax, then authentication (401), then the Product (404), then the effective set (P2), then the session binding (P11). */
  private async serve(product: string, req: IncomingMessage, res: ServerResponse, verb: "post" | "delete") {
    if (!isProductName(product)) return sendJson(res, 404, PRODUCT_NOT_FOUND);
    const caller = this.policy.authenticate(req.headers.authorization);
    if (!caller) return sendJson(res, 401, UNAUTHORIZED, { "WWW-Authenticate": "Bearer" });
    const found = await this.products.find(product);
    const effective = found && this.policy.effectiveScope(caller, found.repoNames);
    if (!found || !effective) return sendJson(res, 404, PRODUCT_NOT_FOUND);
    const binding: SessionBinding = { productId: found.id, principal: effective.scope.principal ?? "anonymous", fingerprint: scopeFingerprint(effective.repos) };

    const raw = req.headers[SESSION_HEADER];
    const sessionId = Array.isArray(raw) ? raw.join(", ") : raw;
    if (sessionId === undefined) {
      // Only a request without a session id may reach mcp.ts without a binding: that is how a session starts.
      if (verb === "delete") return sendJson(res, 404, SESSION_NOT_FOUND);
    } else {
      // Never hand mcp.ts an id this layer did not bind: it would open a new session under that request instead.
      const bound = this.sessions.get(sessionId);
      if (!bound || bound.productId !== binding.productId || bound.principal !== binding.principal) return sendJson(res, 404, SESSION_NOT_FOUND);
      if (bound.fingerprint !== binding.fingerprint) {
        // Membership or key scope changed since creation: the session's tools hold the old set, so it is closed.
        this.sessions.delete(sessionId);
        await closeSession(this.mcp, sessionId, bound).catch(() => undefined);
        return sendJson(res, 404, SESSION_NOT_FOUND);
      }
    }

    const response = await this.mcp[verb](await toWebRequest(req), effective.scope, product);
    if (verb === "delete") this.sessions.delete(sessionId!);
    else {
      const created = response.headers.get(SESSION_HEADER);
      if (created && created !== sessionId) this.sessions.add(created, binding);
    }
    await sendWebResponse(res, response);
  }
}

/** Closes a session in mcp.ts as its owner would (DELETE with its id). */
const closeSession = (mcp: McpHandlers, id: string, b: SessionBinding) =>
  mcp.delete(new Request("http://localhost/", { method: "DELETE", headers: { [SESSION_HEADER]: id } }), { ...scopeFor([]), principal: b.principal });

export interface AppOptions {
  policy?: AccessPolicy;
  /** Most live MCP sessions kept; the least recently used is closed past it. */
  sessionCap?: number;
  env?: Record<string, string | undefined>;
}

/** The product listener: exactly `POST`, `DELETE` and `GET` (405) on `/mcp/:product`; everything else is 404. */
export async function createApp(registry: Pick<ProductRegistry, "find">, mcp: McpHandlers, opts: AppOptions = {}) {
  const sessions = new SessionBindings((id, b) => closeSession(mcp, id, b), opts.sessionCap);
  @Module({
    controllers: [McpController],
    providers: [
      { provide: PRODUCT_REGISTRY, useValue: registry },
      { provide: MCP_HANDLERS, useValue: mcp },
      { provide: ACCESS_POLICY, useValue: opts.policy ?? noneAccessPolicy() },
      { provide: SESSIONS, useValue: sessions },
    ],
  })
  class AppModule {}
  // The MCP transport reads the raw request itself.
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn"] });
  restrict(app, ["GET", "POST", "DELETE"], allowedHosts(opts.env ?? process.env));
  return app;
}
