import { Controller, Delete, Get, HttpCode, HttpException, Inject, Module, Param, Post, Put, Req } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { allowedHosts, restrict, sendJson } from "./http";
import { isProductName, PRODUCT_REGISTRY, type ProductRegistry } from "./product";

export const MAX_BODY_BYTES = 64 * 1024;

const error = (statusCode: number, errorCode: string, message: string) => new HttpException({ statusCode, errorCode, message }, statusCode);
const notFound = () => error(404, "NOT_FOUND", "Product not found.");
const readOnly = () => error(409, "READ_ONLY", "Product comes from config and is read-only through this API.");

const pattern = z.string().min(1).max(256).refine((s) => !/[\0\r\n]/.test(s), "must not contain NUL or line breaks");
const text = (schema: z.ZodString) => schema.refine((s) => !s.includes("\0"), "must not contain NUL");
const patterns = z.array(pattern).max(200).optional();
/** The shape of a config context (without its description). */
const definition = z.strictObject({ include: patterns, includeConnections: patterns, includeTopics: patterns, exclude: patterns, excludeConnections: patterns, excludeTopics: patterns });
const fields = {
  name: text(z.string().trim().min(1).max(200)),
  description: text(z.string().max(2000)).nullable().optional(),
  definition,
};
const createBody = z.strictObject({ slug: z.string().refine(isProductName, "must match ^[a-z0-9][a-z0-9-]{0,62}$"), ...fields });
// slug and source are not fields of an update: sending either is an unknown key (400).
const updateBody = z.strictObject(fields);

/** JSON only, at most MAX_BODY_BYTES, validated by `schema`. */
async function body<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) throw error(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  const tooLarge = () => error(413, "PAYLOAD_TOO_LARGE", `Body exceeds ${MAX_BODY_BYTES} bytes.`);
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw error(400, "INVALID_REQUEST_BODY", "Body is not valid JSON.");
  }
  const r = schema.safeParse(parsed);
  if (!r.success) throw error(400, "INVALID_REQUEST_BODY", z.prettifyError(r.error));
  return r.data;
}

@Controller("products")
class ProductsController {
  constructor(@Inject(PRODUCT_REGISTRY) private readonly products: ProductRegistry) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Post()
  async create(@Req() req: IncomingMessage) {
    const { slug, ...input } = await body(req, createBody);
    const created = await this.products.create(slug, input);
    if (created === "conflict") throw error(409, "ALREADY_EXISTS", "A Product with this slug exists.");
    return created;
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    const p = isProductName(slug) ? await this.products.get(slug) : undefined;
    if (!p) throw notFound();
    return p;
  }

  @Put(":slug")
  async update(@Param("slug") slug: string, @Req() req: IncomingMessage) {
    if (!isProductName(slug)) throw notFound();
    const r = await this.products.update(slug, await body(req, updateBody));
    if (r === "not-found") throw notFound();
    if (r === "conflict") throw readOnly();
    return r;
  }

  @Delete(":slug")
  @HttpCode(204)
  async remove(@Param("slug") slug: string) {
    if (!isProductName(slug)) throw notFound();
    const r = await this.products.remove(slug);
    if (r === "not-found") throw notFound();
    if (r === "conflict") throw readOnly();
  }
}

export const MIN_TOKEN_LENGTH = 32;

/**
 * ADMIN_TOKEN: unset or empty disables the admin listener (undefined); a value shorter than MIN_TOKEN_LENGTH
 * throws, so the service refuses to start. The error never contains the value.
 */
export function adminToken(env: Record<string, string | undefined>) {
  const token = env.ADMIN_TOKEN;
  if (!token) return undefined;
  if (token.length < MIN_TOKEN_LENGTH) throw new Error(`ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters (got ${token.length}).`);
  return token;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Runs before routing and before any body is read. The credential is exactly one `Authorization: Bearer <token>`
 * header (the scheme is matched case-sensitively); the digests are compared in constant time. Every failure
 * (none, repeated, wrong scheme, empty, wrong token) gets the same response, whatever the method or path.
 * The token is read from this header only, never from the query, body or cookies.
 */
function requireBearer(app: INestApplication, token: string) {
  const expected = sha256(token);
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Node keeps only the first of repeated Authorization headers, so count them in the raw header list.
    const count = req.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === "authorization").length;
    const header = req.headers.authorization ?? "";
    const presented = count === 1 && header.startsWith("Bearer ") ? header.slice(7) : "";
    // Both digests are always computed, so the work does not depend on how the header failed.
    if (!timingSafeEqual(sha256(presented), expected)) {
      return sendJson(res, 401, { statusCode: 401, errorCode: "UNAUTHORIZED", message: "Unauthorized." }, { "www-authenticate": "Bearer", connection: "close" });
    }
    next();
  });
}

/**
 * The admin listener: exactly `GET/POST /products` and `GET/PUT/DELETE /products/:slug`, everything else 404,
 * all behind `Authorization: Bearer <token>`. It must still listen on loopback only (API_ADMIN_HOST, default 127.0.0.1).
 */
export async function createAdminApp(registry: ProductRegistry, token: string, env: Record<string, string | undefined> = process.env) {
  @Module({ controllers: [ProductsController], providers: [{ provide: PRODUCT_REGISTRY, useValue: registry }] })
  class AdminModule {}
  const app = await NestFactory.create(AdminModule, { bodyParser: false, logger: ["error", "warn"] });
  restrict(app, ["GET", "POST", "PUT", "DELETE"], allowedHosts(env));
  requireBearer(app, token);
  return app;
}

/** Starts the admin listener when ADMIN_TOKEN is set; otherwise nothing listens. Throws on a short token. */
export async function startAdmin(registry: ProductRegistry, env: Record<string, string | undefined> = process.env) {
  const token = adminToken(env);
  if (!token) return void console.log("api admin disabled (ADMIN_TOKEN is not set)");
  const host = env.API_ADMIN_HOST ?? "127.0.0.1";
  const port = Number(env.API_ADMIN_PORT ?? 3002);
  const admin = await createAdminApp(registry, token, env);
  admin.enableShutdownHooks();
  await admin.listen(port, host);
  console.log(`api admin listening on ${host}:${port}`);
  return admin;
}
