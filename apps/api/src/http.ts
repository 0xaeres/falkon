import type { INestApplication } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";

export const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  void res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers }).end(JSON.stringify(body));

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** The Host names a listener answers: loopback, plus the comma-separated API_ALLOWED_HOSTS (for a proxy in front). */
export const allowedHosts = (env: Record<string, string | undefined>) => [...LOOPBACK, ...(env.API_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];

function hostname(host: string | undefined) {
  try {
    return host ? new URL(`http://${host}`).hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs before every route. Methods outside `methods` are 404, as an unknown route is (no HEAD or OPTIONS
 * handling by Express). A Host outside `hosts` is 403, so a web page that rebinds its DNS name to loopback
 * cannot reach these unauthenticated listeners.
 */
export function restrict(app: INestApplication, methods: string[], hosts: string[]) {
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!methods.includes(req.method ?? "")) return sendJson(res, 404, { statusCode: 404, message: "Not Found" });
    const name = hostname(req.headers.host);
    if (!name || !hosts.includes(name)) return sendJson(res, 403, { statusCode: 403, message: "Host not allowed" });
    next();
  });
}
