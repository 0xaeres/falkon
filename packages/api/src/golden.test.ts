import { test } from "node:test";
import assert from "node:assert/strict";
import { runGolden } from "../../../tests/golden/run";

/** Paths the golden runner requests for one grep query. */
async function paths() {
  const seen: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/search")) return Response.json({ files: [] });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "DELETE" || body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: {} }, { headers: { "mcp-session-id": "s" } });
  };
  await runGolden("http://fixture.test", [{ id: "g", query: "x", grep: { pattern: "x" } }], request);
  return seen;
}

test("the golden runner sends MCP steps to MCP_PATH and search steps to SEARCH_PATH", async () => {
  process.env.MCP_PATH = "/mcp/fixtures";
  process.env.SEARCH_PATH = "/ui/products/fixtures/search";
  try {
    assert.deepEqual(await paths(), ["POST /mcp/fixtures", "POST /mcp/fixtures", "GET /ui/products/fixtures/search", "POST /mcp/fixtures", "DELETE /mcp/fixtures"]);
  } finally { delete process.env.MCP_PATH; delete process.env.SEARCH_PATH; }
});

test("the golden runner refuses to guess a missing route", async () => {
  delete process.env.MCP_PATH;
  delete process.env.SEARCH_PATH;
  await assert.rejects(paths(), /Set MCP_PATH and SEARCH_PATH/);
});
