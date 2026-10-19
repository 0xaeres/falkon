import { lstatSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DATASETS, loadDataset, loadProduct, stackRepoName } from "./data.js";
import { TOOLS } from "./harness.js";

export type EvalClient = {
  listTools(): Promise<{ tools: { name: string }[] }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

/** The key from EVAL_API_KEY_FILE, or undefined when none is configured. The file must be private; its contents are never shown. */
export function readKey(file: string | undefined): string | undefined {
  if (!file) return undefined;
  let stat;
  try { stat = lstatSync(file); } catch { throw new Error(`API key file is missing: ${file}. Create it with mode 600.`); }
  if (!stat.isFile()) throw new Error("API key must be a regular file, not a directory or symlink.");
  if (stat.mode & 0o7177) throw new Error("API key file permissions must be no more permissive than 600; run chmod 600 on it.");
  if (!stat.size) throw new Error("API key file is empty.");
  const key = readFileSync(file, "utf8").trim();
  if (!key) throw new Error("API key file is empty.");
  return key;
}

/** Every unique gold path of both datasets, as <repository>/<path>. */
export const goldPaths = () => [...new Set(DATASETS.flatMap((id) => loadDataset(id).questions.flatMap((q) => (q.declarations ?? []).map((d) => d.path))))].sort();

export async function connect(port: number, apiKey?: string): Promise<EvalClient> {
  const client = new Client({ name: "falkon-eval-preflight", version: "1" });
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  try { await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), { requestInit: { headers } })); return client; }
  catch { await client.close().catch(() => {}); throw new Error(`MCP initialize failed at 127.0.0.1:${port}; check that the stack is running (and the API key, if one is set).`); }
}

const text = (r: Record<string, unknown>) => (r.content as { text?: string }[] | undefined)?.map((p) => p.text ?? "").join("\n") ?? "";

/** The stack must list exactly the product's repositories and read every gold path. Diagnostics never include the key. */
export async function preflight(o: { expectedRepos: string[]; gold: string[]; port?: number; apiKey?: string; createClient?: () => Promise<EvalClient> }): Promise<string> {
  const client = await (o.createClient ?? (() => connect(o.port ?? 3400, o.apiKey)))();
  try {
    const have = (await client.listTools()).tools.map((t) => t.name);
    const missing = [...TOOLS, "research_codebase"].filter((n) => !have.includes(n));
    if (missing.length) throw new Error(`tools/list is missing: ${missing.join(", ")}.`);
    const repos: string[] = [];
    for (let page = 1; ; page++) {
      const r = await client.callTool({ name: "list_repos", arguments: { page, perPage: 100 } });
      if (r.isError) throw new Error("list_repos failed.");
      const names = (JSON.parse(text(r)) as { repos: { name: string }[] }).repos.map((x) => x.name);
      repos.push(...names);
      if (names.length < 100) break;
      if (page >= 10) throw new Error("list_repos pagination exceeded ten pages.");
    }
    const expected = o.expectedRepos.map(stackRepoName);
    if (repos.length !== expected.length || new Set(repos).size !== expected.length) throw new Error(`The stack must list exactly ${expected.length} repositories; found ${repos.length}.`);
    if (repos.some((n) => !expected.includes(n))) throw new Error("Stack repositories do not match the O3 product; check the names (github.com/openmrs/<name>) and remove unexpected repositories.");
    const unreadable: string[] = [];
    for (const gold of o.gold) {
      const [repo, ...rest] = gold.split("/");
      const r = await client.callTool({ name: "read_file", arguments: { repo: stackRepoName(repo!), path: rest.join("/"), limit: 1 } }).catch(() => ({ isError: true }));
      if (r.isError) unreadable.push(gold);
    }
    if (unreadable.length) throw new Error(`${unreadable.length} of ${o.gold.length} gold paths unreadable: ${unreadable.slice(0, 10).join(", ")}${unreadable.length > 10 ? ", ..." : ""}`);
    return `${repos.length} of ${expected.length} repositories; ${o.gold.length} of ${o.gold.length} gold paths readable`;
  } finally { await client.close().catch(() => {}); }
}

export const expectedRepos = () => loadProduct().repositories.map((r) => r.name);
