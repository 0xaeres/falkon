import { test } from "node:test";
import assert from "node:assert/strict";
import { runGolden } from "../../../tests/golden/run";

/** Paths the golden runner requests for one grep query. */
async function paths() {
  const seen: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/search") return Response.json({ files: [] });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "DELETE" || body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: {} }, { headers: { "mcp-session-id": "s" } });
  };
  await runGolden("http://fixture.test", [{ id: "g", query: "x", grep: { pattern: "x" } }], request);
  return seen;
}

test("the golden runner uses /api/mcp unless MCP_PATH says otherwise; search stays on /api/search", async () => {
  delete process.env.MCP_PATH;
  assert.deepEqual(await paths(), ["POST /api/mcp", "POST /api/mcp", "GET /api/search", "POST /api/mcp", "DELETE /api/mcp"]);
  process.env.MCP_PATH = "/mcp/fixtures";
  try {
    assert.deepEqual(await paths(), ["POST /mcp/fixtures", "POST /mcp/fixtures", "GET /api/search", "POST /mcp/fixtures", "DELETE /mcp/fixtures"]);
  } finally { delete process.env.MCP_PATH; }
});
