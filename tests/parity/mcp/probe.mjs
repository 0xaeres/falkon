// Minimal MCP streamable-HTTP client: initialize, then one method. Key read from V6_API_KEY_FILE.
import fs from "node:fs";
const url = process.argv[2];
const method = process.argv[3] ?? "tools/list";
const params = JSON.parse(process.argv[4] ?? "{}");
const key = process.env.API_KEY_FILE ? fs.readFileSync(process.env.API_KEY_FILE, "utf8").trim() : process.env.API_KEY;
const base = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { "X-Sourcebot-Api-Key": key, authorization: `Bearer ${key}` } : {}) };
async function rpc(body, session) {
  const res = await fetch(url, { method: "POST", headers: { ...base, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
  const text = await res.text();
  const data = text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
    : text ? [JSON.parse(text)] : [];
  return { status: res.status, session: res.headers.get("mcp-session-id") ?? session, data };
}
const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "0" } } });
if (init.status !== 200) { console.log(JSON.stringify(init, null, 2)); process.exit(1); }
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
const r = await rpc({ jsonrpc: "2.0", id: 2, method, params }, init.session);
console.log(JSON.stringify({ server: init.data[0]?.result?.serverInfo, status: r.status, result: r.data[0]?.result ?? r.data[0] }, null, 2));
