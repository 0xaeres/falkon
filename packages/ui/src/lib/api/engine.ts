import "server-only";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { productSchema, type Product } from "@sbc/contracts";

/** True when the UI talks to the engine; unset, the routes keep serving the local mock. */
export const useEngine = () => !!process.env.ENGINE_URL;

let cached: { key: string; token: string } | undefined;
/**
 * ENGINE_ADMIN_TOKEN wins; else the api's `${DATA_DIR||/data}/secrets/admin.token`, read per request and re-read when its
 * mtime or inode changes (read-only: the ui never generates it). Empty when neither exists.
 */
function adminToken() {
  if (process.env.ENGINE_ADMIN_TOKEN) return process.env.ENGINE_ADMIN_TOKEN;
  const file = join(process.env.DATA_DIR || "/data", "secrets", "admin.token");
  try {
    const st = statSync(file);
    const key = `${file}:${st.mtimeMs}:${st.ino}:${st.size}`;
    if (cached?.key !== key) cached = { key, token: readFileSync(file, "utf8").trim() };
    return cached.token;
  } catch {
    return "";
  }
}

/**
 * Forwards one call to the engine's admin listener. The admin token is read here, in server code only, and never
 * reaches the browser. Engine errors become the UI's `{ error: string }` using the engine's fixed message.
 */
export async function forward(
  path: string,
  init: { method?: string; body?: unknown; stream?: AbortSignal } = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${process.env.ENGINE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      // A streamed answer runs as long as the client stays; the client going away aborts the engine call too.
      signal: init.stream ?? AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Falkon is unavailable. Try again." },
      { status: 502 },
    );
  }
  if (res.ok)
    return new Response(res.status === 204 ? null : res.body, {
      status: res.status,
      headers: {
        // The AI SDK UI message stream passes through unchanged (no buffering).
        "content-type": init.stream
          ? (res.headers.get("content-type") ?? "text/event-stream")
          : "application/json",
        "cache-control": "no-store",
        ...(init.stream
          ? { "x-vercel-ai-ui-message-stream": "v1", "x-accel-buffering": "no" }
          : {}),
      },
    });
  const failure: unknown = await res.json().catch(() => null);
  const message = (failure as { message?: unknown } | null)?.message;
  return Response.json(
    {
      error:
        typeof message === "string"
          ? message
          : "Falkon could not complete this request. Try again.",
    },
    { status: res.status },
  );
}

/** Server-rendered pages read Products straight from the engine (the mock store has none of them). Null = not found. */
export async function engineProducts(): Promise<Product[]> {
  const res = await forward("/ui/products");
  if (!res.ok) throw new Error("engine products unavailable");
  return productSchema.array().parse(await res.json());
}
export async function engineProduct(id: string): Promise<Product | null> {
  const res = await forward(`/ui/products/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("engine product unavailable");
  return productSchema.parse(await res.json());
}
