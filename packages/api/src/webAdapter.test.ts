import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sendWebResponse, toWebRequest } from "./webAdapter";

async function serve(handler: (req: Request) => Response | Promise<Response>) {
  const server = http.createServer(async (req, res) => sendWebResponse(res, await handler(await toWebRequest(req))));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

test("request: method, path with query, headers and body reach the handler", async () => {
  let seen: { method: string; url: string; headers: Headers; body: string } | undefined;
  const s = await serve(async (req) => { seen = { method: req.method, url: req.url, headers: req.headers, body: await req.text() }; return new Response("ok"); });
  try {
    await fetch(`${s.url}/mcp/core?x=1`, { method: "POST", headers: { "content-type": "application/json", "mcp-session-id": "abc" }, body: '{"a":1}' });
    assert.equal(seen?.method, "POST");
    assert.equal(new URL(seen!.url).pathname + new URL(seen!.url).search, "/mcp/core?x=1");
    assert.equal(seen?.headers.get("mcp-session-id"), "abc");
    assert.equal(seen?.body, '{"a":1}');
  } finally { s.close(); }
});

test("request: DELETE and GET carry no body", async () => {
  const bodies: (string | null)[] = [];
  const s = await serve((req) => { bodies.push(req.body === null ? null : "stream"); return new Response(null, { status: 204 }); });
  try {
    await fetch(s.url, { method: "DELETE" });
    await fetch(s.url);
    assert.deepEqual(bodies, [null, null]);
  } finally { s.close(); }
});

test("response: status, headers and an incrementally streamed body are preserved", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const enc = new TextEncoder();
  const s = await serve(() => new Response(new ReadableStream({
    async start(c) { c.enqueue(enc.encode("event: a\n\n")); await gate; c.enqueue(enc.encode("event: b\n\n")); c.close(); },
  }), { status: 202, headers: { "content-type": "text/event-stream", "x-extra": "1" } }));
  try {
    const res = await fetch(s.url);
    assert.equal(res.status, 202);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    assert.equal(res.headers.get("x-extra"), "1");
    const reader = res.body!.getReader();
    // the first chunk arrives while the producer is still open
    assert.equal(new TextDecoder().decode((await reader.read()).value), "event: a\n\n");
    release();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "event: b\n\n");
    assert.equal((await reader.read()).done, true);
  } finally { s.close(); }
});

test("response: a client that disconnects cancels the upstream body", async () => {
  let cancelled!: () => void;
  const done = new Promise<void>((resolve) => { cancelled = resolve; });
  const s = await serve(() => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel: () => cancelled() })));
  try {
    const res = await fetch(s.url);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await done;
  } finally { s.close(); }
});

test("response: an empty body ends the response", async () => {
  const s = await serve(() => new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } }));
  try {
    const res = await fetch(s.url);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST, DELETE");
    assert.equal(await res.text(), "");
  } finally { s.close(); }
});
