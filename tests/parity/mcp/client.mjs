// Minimal MCP streamable-HTTP client shared by the parity runners.
export class Client {
  constructor(base, key) {
    this.url = `${base}/api/mcp`;
    this.base = base;
    this.headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { "X-Sourcebot-Api-Key": key } : {}) };
    this.id = 0;
  }
  async rpc(method, params, notify = false) {
    const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++this.id }) };
    const res = await fetch(this.url, { method: "POST", headers: { ...this.headers, ...(this.session ? { "mcp-session-id": this.session } : {}) }, body: JSON.stringify(body) });
    this.session = res.headers.get("mcp-session-id") ?? this.session;
    const text = await res.text();
    if (notify) return null;
    const msgs = /^(event|data):/m.test(text) ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))) : text ? [JSON.parse(text)] : [];
    const m = msgs.find((x) => x.id === this.id) ?? msgs[0];
    if (!m) throw new Error(`${this.url}: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`);
    return m.result;
  }
  async init() {
    const r = await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "0" } });
    await this.rpc("notifications/initialized", undefined, true);
    return r;
  }
}
