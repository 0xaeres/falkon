import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The Node request as the Web Request the MCP handlers take. */
export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) for (const v of [value ?? []].flat()) headers.append(name, v);
  const body = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : Buffer.concat(await req.toArray());
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    ...(body.length ? { body } : {}),
  });
}

/** Writes status and headers, then streams the body (SSE included); a client that goes away cancels the body. */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, [...response.headers].flat());
  res.flushHeaders();
  if (!response.body) return void res.end();
  await pipeline(Readable.fromWeb(response.body as never), res).catch(() => undefined);
}
