import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { scopeFor } from "@falkon/shared";
import { seedContractRepo } from "../../../tests/contract/fixture";

// Same environment discipline as the web contract test: no database, no Zoekt, no model.
const fixture = seedContractRepo();
process.env.DATA_DIR = fixture.dir;
process.env.ZOEKT_URL = "invalid-contract-url";
process.env.CONFIG_PATH = path.join(fixture.dir, "config.json");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];

const repos = ["fixtures.test/atlas"];
const anonymous = { ...scopeFor(repos), principal: "anonymous" };
let app: INestApplication;
let base: string;
let mcp: typeof import("../../web/src/lib/mcp");
before(async () => {
  mcp = await import("../../web/src/lib/mcp");
  const { createApp } = await import("./app");
  app = await createApp({ find: async (p) => (p === "fx" ? { id: 1, repoNames: repos } : undefined) }, { post: mcp.handleMcpPost, delete: mcp.handleMcpDelete });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
after(() => app.close());

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const rpc = (method: string, id?: number, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) });
const init = { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "api-test", version: "1" } };

/** Initialize a session and return its tools/list reply bytes, through `send`, which is either the Nest app or the handler called directly. */
async function toolsList(send: (body: string, session?: string) => Promise<Response>) {
  const opened = await send(rpc("initialize", 1, init));
  assert.equal(opened.status, 200);
  const session = opened.headers.get("mcp-session-id")!;
  await opened.text();
  await (await send(rpc("notifications/initialized"), session)).body?.cancel();
  const list = await send(rpc("tools/list", 2), session);
  assert.equal(list.status, 200);
  return { session, text: await list.text() };
}
const viaNest = (body: string, session?: string) => fetch(`${base}/mcp/fx`, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session, "mcp-protocol-version": init.protocolVersion } : {}) }, body });
const direct = (body: string, session?: string) => mcp.handleMcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session, "mcp-protocol-version": init.protocolVersion } : {}) }, body }), anonymous);

test("tools/list through Nest is byte-identical to what handleMcpPost serves for the same scope", async () => {
  const nest = await toolsList(viaNest);
  const handler = await toolsList(direct);
  assert.equal(nest.text, handler.text);
  const names = JSON.parse(nest.text.split("\n").find((l) => l.startsWith("data:"))!.slice(5)).result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes("grep") && names.includes("read_file") && names.includes("research_codebase"), names.join(","));
  for (const { session } of [nest, handler]) await mcp.handleMcpDelete(new Request("http://localhost/api/mcp", { method: "DELETE", headers: { "mcp-session-id": session } }), anonymous);
});

test("DELETE closes the caller's own session, rejects another principal, and 404s an unknown or closed one", async () => {
  const { session } = await toolsList(viaNest);
  const del = (id: string) => fetch(`${base}/mcp/fx`, { method: "DELETE", headers: { "mcp-session-id": id } });
  const stranger = await mcp.handleMcpDelete(new Request("http://localhost/api/mcp", { method: "DELETE", headers: { "mcp-session-id": session } }), { ...scopeFor(repos), principal: "key:other" });
  assert.equal(stranger.status, 403);
  assert.equal((await del(session)).status, 200);
  assert.equal((await del(session)).status, 404);
  assert.equal((await del("never-existed")).status, 404);
});
