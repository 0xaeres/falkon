#!/usr/bin/env node
// Ask differential: the same question through POST /api/chat/blocking and MCP ask_codebase on v6 and
// the clone, both driven by mock-llm.mjs (which records every LLM request). Compares the LLM requests
// step by step and the final answers, after normalizing ids and instance base URLs.
//   V6_URL=http://localhost:3000 V6_API_KEY_FILE=... node tests/parity/ask/run.mjs
// Needs: mock-llm.mjs running on :9100 and both instances configured by setup.mjs.
import fs from "node:fs";
import path from "node:path";
import { Client } from "../mcp/client.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "out");
const V6 = (process.env.V6_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CLONE = (process.env.CLONE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const keyOf = (file, env) => (env ?? (file ? fs.readFileSync(file, "utf8").trim() : undefined));
const V6_KEY = keyOf(process.env.V6_API_KEY_FILE, process.env.V6_API_KEY);
const CLONE_KEY = keyOf(process.env.CLONE_API_KEY_FILE, process.env.SOURCEBOT_API_KEY);
const REPO = process.env.ASK_REPO ?? "github.com/openmrs/openmrs-core";
const QUERY = "Where is PatientServiceImpl implemented?";
const ARGS = { query: QUERY, repos: [REPO] };

const sides = [
  { name: "v6", base: V6, key: V6_KEY, prefix: "v6" },
  { name: "clone", base: CLONE, key: CLONE_KEY, prefix: "clone" },
];
const recorded = (s) => {
  const f = path.join(out, `${s.prefix}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const reset = () => sides.forEach((s) => fs.rmSync(path.join(out, `${s.prefix}.jsonl`), { force: true }));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const norm = (s, side) =>
  s
    .replaceAll(side.base, "<BASE>")
    .replaceAll(`http://host.docker.internal:9100/${side.prefix}`, "<LLM>")
    .replace(UUID, "<UUID>")
    .replace(/\/chat\/[A-Za-z0-9_-]{10,}/g, "/chat/<ID>")
    .replace(/"chatId":"[^"]*"/g, '"chatId":"<ID>"');

async function blocking(side) {
  const res = await fetch(`${side.base}/api/chat/blocking`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(side.key ? { "X-Sourcebot-Api-Key": side.key } : {}) },
    body: JSON.stringify(ARGS),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function mcp(side) {
  const c = new Client(side.base, side.key);
  await c.init();
  const r = await c.rpc("tools/call", { name: "ask_codebase", arguments: ARGS });
  return { isError: !!r.isError, text: r.content?.map((x) => x.text).join("\n") ?? "" };
}

const report = [`# Ask parity\n\nquery ${JSON.stringify(QUERY)}, repos [${REPO}]; LLM scripted by tests/parity/ask/mock-llm.mjs\n`];
const log = (s) => {
  report.push(s);
  console.log(s);
};
let diffs = 0;

/** Compares two JSON values key by key, logging the paths that differ. */
function compare(label, a, b) {
  const found = [];
  const walk = (x, y, p) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}${Array.isArray(x) ? `[${k}]` : `.${k}`}`);
      return;
    }
    found.push(`  - \`${p || "."}\`\n    v6:    ${JSON.stringify(x)?.slice(0, 600)}\n    clone: ${JSON.stringify(y)?.slice(0, 600)}`);
  };
  walk(a, b, "");
  diffs += found.length;
  log(`- ${found.length ? "✗" : "✓"} ${label}${found.length ? ` (${found.length} differences)` : ""}`);
  found.slice(0, 20).forEach((f) => log(f));
}

/** The recorded LLM requests of one run, split into the agent steps (by tool results carried) and the title request. */
function requests(side) {
  // Tools keyed by name so a schema difference is not masked by an order difference (order compared on its own).
  const reqs = recorded(side)
    .map((r) => JSON.parse(norm(JSON.stringify(r), side)))
    .map((r) => (r.tools ? { ...r, toolOrder: r.tools.map((t) => t.function.name), tools: Object.fromEntries(r.tools.map((t) => [t.function.name, t])) } : r));
  return { steps: reqs.filter((r) => r.tools), title: reqs.filter((r) => !r.tools) };
}

async function phase(name, run, view) {
  log(`\n## ${name}\n`);
  reset();
  const results = await Promise.all(sides.map(run));
  const [r6, rC] = sides.map(requests);
  log(`LLM requests: v6 ${r6.steps.length} steps + ${r6.title.length} title, clone ${rC.steps.length} steps + ${rC.title.length} title\n`);
  for (let i = 0; i < Math.max(r6.steps.length, rC.steps.length); i++) compare(`step ${i + 1} request`, r6.steps[i], rC.steps[i]);
  for (let i = 0; i < Math.max(r6.title.length, rC.title.length); i++) compare(`title request ${i + 1}`, r6.title[i], rC.title[i]);
  const [a, b] = results.map((r, i) => JSON.parse(norm(JSON.stringify(view(r)), sides[i])));
  compare("response", a, b);
  return results;
}

const [b6] = await phase("POST /api/chat/blocking", blocking, (r) => r);
await phase("MCP ask_codebase", mcp, (r) => r);
log(`\n## MCP list_language_models\n`);
const [m6, mC] = await Promise.all(
  sides.map(async (side) => {
    const c = new Client(side.base, side.key);
    await c.init();
    return JSON.parse((await c.rpc("tools/call", { name: "list_language_models", arguments: {} })).content[0].text);
  }),
);
compare("models", m6, mC);
log(`\n${diffs ? `${diffs} differences` : "identical"}.`);
log(`\n<details><summary>v6 blocking answer</summary>\n\n${"```"}\n${b6.body?.answer ?? JSON.stringify(b6.body)}\n${"```"}\n</details>`);
fs.mkdirSync(path.join(here, "../reports"), { recursive: true });
fs.writeFileSync(path.join(here, "../reports/ask-latest.md"), report.join("\n") + "\n");
process.exit(diffs ? 1 : 0);
