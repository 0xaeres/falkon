#!/usr/bin/env node
// MCP differential: tools/list and a tools/call corpus against v6 and the clone over streamable HTTP.
//   V6_URL=http://localhost:3000 V6_API_KEY_FILE=... node parity/mcp/run.mjs [--only <id>] [--calls <file>]
// Clone at CLONE_URL (default http://localhost:3200), key from CLONE_API_KEY_FILE / SOURCEBOT_API_KEY.
// Outputs are compared as text after normalizing the instance base URL and indexedAt timestamps.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = arg("--only");
const V6 = (process.env.V6_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CLONE = (process.env.CLONE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const keyOf = (file, env) => (env ?? (file ? fs.readFileSync(file, "utf8").trim() : undefined));
const V6_KEY = keyOf(process.env.V6_API_KEY_FILE, process.env.V6_API_KEY);
const CLONE_KEY = keyOf(process.env.CLONE_API_KEY_FILE, process.env.SOURCEBOT_API_KEY);

class Client {
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

const normalize = (s, base) =>
  s
    .replaceAll(base, "<BASE>")
    .replace(/"indexedAt":"[^"]*"/g, '"indexedAt":"<T>"');

const v6 = new Client(V6, V6_KEY);
const clone = new Client(CLONE, CLONE_KEY);
const [i6, iC] = await Promise.all([v6.init(), clone.init()]);
const report = [`# MCP parity\n\nv6 ${i6.serverInfo.name} ${i6.serverInfo.version} vs clone ${iC.serverInfo.name} ${iC.serverInfo.version}\n`];
const log = (s) => {
  report.push(s);
  console.log(s);
};

// ---- tools/list ----
const [l6, lC] = await Promise.all([v6.rpc("tools/list", {}), clone.rpc("tools/list", {})]);
const T6 = new Map(l6.tools.map((t) => [t.name, t]));
const TC = new Map(lC.tools.map((t) => [t.name, t]));
log(`## tools/list (v6 ${T6.size}, clone ${TC.size})\n`);
let listOk = 0;
for (const name of [...new Set([...T6.keys(), ...TC.keys()])]) {
  const a = T6.get(name);
  const b = TC.get(name);
  if (!a || !b) {
    log(`- ✗ ${name}: only on ${a ? "v6" : "clone"}`);
    continue;
  }
  const diffs = ["description", "inputSchema", "annotations", "execution"].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (!diffs.length) listOk++;
  log(`- ${diffs.length ? "✗" : "✓"} ${name}${diffs.length ? `: differs in ${diffs.join(", ")}` : ""}`);
  for (const k of diffs) log(`  v6:    ${JSON.stringify(a[k]).slice(0, 400)}\n  clone: ${JSON.stringify(b[k]).slice(0, 400)}`);
}
const v6Order = l6.tools.map((t) => t.name).filter((n) => TC.has(n)).join(",");
const cloneOrder = lC.tools.map((t) => t.name).filter((n) => T6.has(n)).join(",");
log(`\nregistration order ${v6Order === cloneOrder ? "matches" : `differs\n  v6:    ${v6Order}\n  clone: ${cloneOrder}`}`);

// ---- tools/call ----
const calls = JSON.parse(fs.readFileSync(arg("--calls", path.join(here, "calls.openmrs.json")), "utf8")).calls;
log(`\n## tools/call\n`);
let ok = 0;
let tieOrder = 0;
let total = 0;
for (const c of calls) {
  if (only && !c.id.includes(only)) continue;
  total++;
  const [a, b] = await Promise.all([v6.rpc("tools/call", { name: c.tool, arguments: c.args }), clone.rpc("tools/call", { name: c.tool, arguments: c.args })].map((p) => p.catch((e) => ({ rpcError: e.message }))));
  const ta = a.rpcError ?? normalize(a.content?.map((x) => x.text).join("\n") ?? "", V6);
  const tb = b.rpcError ?? normalize(b.content?.map((x) => x.text).join("\n") ?? "", CLONE);
  const same = ta === tb && !!a.isError === !!b.isError;
  // Equal-score results come back in shard order, which follows repo ids the two instances assign differently.
  const sameLines = !same && ta.split("\n").sort().join("\n") === tb.split("\n").sort().join("\n");
  if (same) ok++;
  if (sameLines) tieOrder++;
  log(`- ${same ? "✓" : sameLines ? "~" : "✗"} ${c.id} (${c.tool})${sameLines ? " — same lines, tie order differs" : ""}`);
  if (!same && !sameLines) {
    // First differing line, with a little context.
    const la = ta.split("\n");
    const lb = tb.split("\n");
    const i = la.findIndex((l, k) => l !== lb[k]);
    const at = i === -1 ? Math.min(la.length, lb.length) : i;
    log(`  isError v6=${!!a.isError} clone=${!!b.isError}; lines ${la.length}/${lb.length}; first difference at line ${at + 1}`);
    log(`  v6:    ${JSON.stringify(la.slice(Math.max(0, at - 1), at + 2).join("\n")).slice(0, 500)}`);
    log(`  clone: ${JSON.stringify(lb.slice(Math.max(0, at - 1), at + 2).join("\n")).slice(0, 500)}`);
  }
}
log(`\ntools/list: ${listOk}/${T6.size} identical. tools/call: ${ok}/${total} identical, ${tieOrder} differ only in tie order.`);
fs.mkdirSync(path.join(here, "../reports"), { recursive: true });
fs.writeFileSync(path.join(here, "../reports/mcp-latest.md"), report.join("\n") + "\n");
