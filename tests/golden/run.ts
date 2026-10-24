import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "./normalize";

export interface GoldenQuery {
  id: string;
  query: string;
  regex?: boolean;
  repos?: string[];
  case?: boolean;
  limit?: number;
  page?: number;
  grep?: Record<string, unknown>;
}

// Minimal Streamable HTTP client: requests can return JSON or a finite SSE response.
export async function runGolden(baseUrl: string, queries: GoldenQuery[], request: typeof fetch = fetch) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (process.env.API_KEY) headers.authorization = `Bearer ${process.env.API_KEY}`;
  // MCP_PATH is the MCP endpoint: a path on baseUrl, or an absolute URL such as http://127.0.0.1:3001/mcp/<product>.
  // SEARCH_PATH is the search route on baseUrl, e.g. /ui/products/<slug>/search on the api admin listener (API_KEY is then the admin token).
  const mcpPath = process.env.MCP_PATH ?? "";
  const searchPath = process.env.SEARCH_PATH ?? "";
  if (!mcpPath || !searchPath) throw new Error("Set MCP_PATH and SEARCH_PATH: the api routes of the Product to capture.");
  let session: string | null = null;
  let nextId = 0;
  async function rpc(method: string, params?: unknown, notification = false): Promise<any> {
    const response = await request(new URL(mcpPath, baseUrl), { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++nextId }), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`MCP ${method}: HTTP ${response.status}`);
    session = response.headers.get("mcp-session-id") ?? session;
    if (session) headers["mcp-session-id"] = session;
    if (notification) { await response.body?.cancel(); return; }
    const text = await response.text();
    const envelopes = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        return data ? [JSON.parse(data)] : [];
      }) : [JSON.parse(text)];
    const reply = envelopes.find((value) => value.id === nextId);
    if (!reply || reply.error) throw new Error(`MCP ${method}: ${JSON.stringify(reply?.error ?? "missing response")}`);
    return reply.result;
  }
  const recorded = [];
  try {
    if (queries.some((q) => q.grep)) {
      await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "falkon-golden", version: "1" } });
      headers["mcp-protocol-version"] = "2025-03-26";
      await rpc("notifications/initialized", undefined, true);
    }
    for (const query of queries) {
      const url = new URL(searchPath, baseUrl);
      url.searchParams.set("q", query.repos?.length ? `(${query.query}) reposet:${query.repos.join(",")}` : query.query);
      url.searchParams.set("regex", query.regex ? "1" : "0");
      url.searchParams.set("case", query.case ? "1" : "0");
      url.searchParams.set("limit", String(query.limit ?? 500));
      const response = await request(url, { headers: headers.authorization ? { authorization: headers.authorization } : {}, signal: AbortSignal.timeout(60_000) });
      if (response.status >= 500 || response.status === 401 || response.status === 403) throw new Error(`Search ${query.id}: HTTP ${response.status}`);
      const entry: Record<string, unknown> = { id: query.id, query, search: { status: response.status, body: await response.json() } };
      if (query.grep) {
        const result = await rpc("tools/call", { name: "grep", arguments: query.grep });
        entry.grep = result;
      }
      recorded.push(entry);
    }
    return normalize(recorded.sort((a, b) => String(a.id).localeCompare(String(b.id), "en")));
  } finally {
    if (session) {
      const response = await request(new URL(mcpPath, baseUrl), { method: "DELETE", headers, signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`MCP close: HTTP ${response.status}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    if (!process.env.BASE_URL || !process.argv[2]) throw new Error("Usage: BASE_URL=http://127.0.0.1:3002 MCP_PATH=http://127.0.0.1:3001/mcp/<product> SEARCH_PATH=/ui/products/<product>/search API_KEY=<admin token> pnpm golden:record OUTPUT.json");
    const queries = JSON.parse(fs.readFileSync(new URL("./queries.json", import.meta.url), "utf8")) as GoldenQuery[];
    fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(await runGolden(process.env.BASE_URL, queries), null, 2) + "\n");
  })().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
}
