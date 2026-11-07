import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeSecretOnce } from "@falkon/shared";
import type { IncomingMessage, ServerResponse } from "node:http";
export { MAX_BODY_BYTES } from "./request";
import { ConnectionsController, ConnectionService } from "./connections";
import { allowedHosts, restrict, sendJson } from "./http";
import { ProductEvents, ProductEventsController } from "./events";
import { KnowledgeController, KnowledgeService } from "./knowledge";
import { SearchController, SearchService } from "./search";
import { ThreadService, ThreadsController } from "./threads";
import { UiProductService, UiProductsController } from "./ui";

export const MIN_TOKEN_LENGTH = 32;

/**
 * The expected admin token, as a getter called per request. ADMIN_TOKEN (>= MIN_TOKEN_LENGTH characters, else this throws
 * without the value) wins; otherwise ${DATA_DIR||/data}/secrets/admin.token, generated on first call (32 random bytes, hex)
 * and re-read when its mtime or inode changes, so a reset needs no restart. An unusable file (missing, or under
 * MIN_TOKEN_LENGTH after trim) throws at startup, and the getter throws on later requests.
 */
export function adminToken(env: Record<string, string | undefined>): () => string {
  const fixed = env.ADMIN_TOKEN;
  if (fixed) {
    if (fixed.length < MIN_TOKEN_LENGTH) throw new Error(`ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters (got ${fixed.length}).`);
    return () => fixed;
  }
  const file = path.join(env.DATA_DIR || "/data", "secrets", "admin.token");
  writeSecretOnce(file, randomBytes(32).toString("hex"));
  let cached: { key: string; token: string } | undefined;
  // Fails closed: a missing file or a token shorter than MIN_TOKEN_LENGTH throws (never returned), and is never cached.
  const read = () => {
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.ino}:${st.size}`;
    if (cached?.key !== key) {
      const token = fs.readFileSync(file, "utf8").trim();
      if (token.length < MIN_TOKEN_LENGTH) throw new Error(`admin.token must hold at least ${MIN_TOKEN_LENGTH} characters.`);
      cached = { key, token };
    }
    return cached.token;
  };
  read();
  return read;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Runs before routing and before any body is read. The credential is exactly one `Authorization: Bearer <token>`
 * header (the scheme is matched case-sensitively); the digests are compared in constant time. Every failure
 * (none, repeated, wrong scheme, empty, wrong token) gets the same response, whatever the method or path.
 * The token is read from this header only, never from the query, body or cookies.
 */
function requireBearer(app: INestApplication, token: () => string) {
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Node keeps only the first of repeated Authorization headers, so count them in the raw header list.
    const count = req.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === "authorization").length;
    const header = req.headers.authorization ?? "";
    const presented = count === 1 && header.startsWith("Bearer ") ? header.slice(7) : "";
    // Both digests are always computed, so the work does not depend on how the header failed.
    // An unreadable or invalid expected token authorizes nobody; an empty one never matches, even an empty presented value.
    let expected = "";
    try { expected = token(); } catch { /* fail closed */ }
    if (!expected || !timingSafeEqual(sha256(presented), sha256(expected))) {
      return sendJson(res, 401, { statusCode: 401, errorCode: "UNAUTHORIZED", message: "Unauthorized." }, { "www-authenticate": "Bearer", connection: "close" });
    }
    next();
  });
}

/**
 * The admin listener: when a ConnectionService is given, `POST|GET /connections`, `DELETE /connections/:id`, `PUT /connections/:id/token`, `GET /connections/:id/repositories`
 * and, when a UiProductService is given, the seven UI-shaped routes under `/ui/products` and, when a ThreadService is given too,
 * the thread routes (including resume and stop) under `/ui/products/:slug/threads` and, when a SearchService is given, `GET /ui/products/:slug/search` and, when a KnowledgeService is given, `POST /ui/products/:slug/knowledge` and, when a ProductEvents is given, the event stream `GET /ui/products/:slug/events`.
 * Everything else is 404, all behind `Authorization: Bearer <token>`. It must still listen on loopback only
 * (API_ADMIN_HOST, default 127.0.0.1).
 */
export async function createAdminApp(token: string | (() => string), env: Record<string, string | undefined> = process.env, connections?: ConnectionService, ui?: UiProductService, threads?: ThreadService, searches?: SearchService, knowledge?: KnowledgeService, events?: ProductEvents) {
  @Module({
    controllers: [...(connections ? [ConnectionsController] : []), ...(ui ? [UiProductsController] : []), ...(threads ? [ThreadsController] : []), ...(searches ? [SearchController] : []), ...(knowledge ? [KnowledgeController] : []), ...(events ? [ProductEventsController] : [])],
    providers: [
      ...(connections ? [{ provide: ConnectionService, useValue: connections }] : []),
      ...(ui ? [{ provide: UiProductService, useValue: ui }] : []),
      ...(threads ? [{ provide: ThreadService, useValue: threads }] : []),
      ...(searches ? [{ provide: SearchService, useValue: searches }] : []),
      ...(knowledge ? [{ provide: KnowledgeService, useValue: knowledge }] : []),
      ...(events ? [{ provide: ProductEvents, useValue: events }] : []),
    ],
  })
  class AdminModule {}
  const app = await NestFactory.create(AdminModule, { bodyParser: false, logger: ["error", "warn"] });
  restrict(app, ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHosts(env));
  requireBearer(app, typeof token === "string" ? () => token : token);
  return app;
}

/** Starts the admin listener (always on: a token always exists). Throws on a short ADMIN_TOKEN. */
export async function startAdmin(env: Record<string, string | undefined> = process.env, connections?: ConnectionService, ui?: UiProductService, threads?: ThreadService, searches?: SearchService, knowledge?: KnowledgeService, events?: ProductEvents) {
  const token = adminToken(env);
  const host = env.API_ADMIN_HOST ?? "127.0.0.1";
  const port = Number(env.API_ADMIN_PORT ?? 3002);
  const admin = await createAdminApp(token, env, connections, ui, threads, searches, knowledge, events);
  admin.enableShutdownHooks();
  await admin.listen(port, host);
  console.log(`api admin listening on ${host}:${port}`);
  return admin;
}
