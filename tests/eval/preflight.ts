import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DATASETS, loadDataset, loadProduct, stackRepoName } from "./data.js";
import { TOOLS } from "./harness.js";

export type EvalClient = {
  listTools(): Promise<{ tools: { name: string }[] }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<Record<string, unknown>>;
  getInstructions?(): string | undefined;
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

/** Every unique gold path of the datasets (both O3 sets unless told otherwise), as <repository>/<path>. */
export const goldPaths = (ids: readonly string[] = DATASETS) => [...new Set(ids.flatMap((id) => loadDataset(id).questions.flatMap((q) => (q.declarations ?? []).map((d) => d.path))))].sort();

export async function connect(url: string, apiKey?: string): Promise<EvalClient> {
  const client = new Client({ name: "falkon-eval-preflight", version: "1" });
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  try { await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })); return client; }
  catch (e) {
    await client.close().catch(() => {});
    const status = (e as { code?: number }).code;
    if (status === 404) throw new Error(`MCP initialize got 404 at ${url}: the Product does not exist there. Run pnpm eval -- stack up, which creates it.`);
    if (status === 401 || status === 403) throw new Error(`MCP initialize was refused (${status}) at ${new URL(url).host}; set EVAL_API_KEY_FILE to a valid key.`);
    throw new Error(`MCP initialize failed at ${new URL(url).host}; check that the server is running (and the API key, if one is set).`);
  }
}

const text = (r: Record<string, unknown>) => (r.content as { text?: string }[] | undefined)?.map((p) => p.text ?? "").join("\n") ?? "";

/**
 * The server must list exactly the product's repositories and read every gold path. Diagnostics never include the key.
 * `kind` v6 is the reference instance: no research tool, and a read succeeds only with a `<content>` block or a numbered first line.
 * `instructions` true or false asserts whether the server sends its instructions (undefined skips the check).
 */
export async function preflight(o: { expectedRepos: string[]; gold: string[]; url?: string; apiKey?: string; kind?: "clone" | "v6"; instructions?: boolean; createClient?: () => Promise<EvalClient> }): Promise<string> {
  const client = await (o.createClient ?? (() => connect(o.url!, o.apiKey)))();
  try {
    const have = (await client.listTools()).tools.map((t) => t.name);
    const missing = (o.kind === "v6" ? TOOLS : [...TOOLS, "research_codebase"]).filter((n) => !have.includes(n));
    if (missing.length) throw new Error(`tools/list is missing: ${missing.join(", ")}.`);
    if (o.kind === "v6" && have.includes("research_codebase")) throw new Error("The server lists research_codebase, so it is not the v6 instance; check EVAL_V6_URL.");
    const sent = !!client.getInstructions?.();
    if (o.instructions === false && sent) throw new Error("The server's instructions are on, but this arm needs them off; start the stack with --instructions off.");
    if (o.instructions === true && !sent) throw new Error("The server's instructions are off, but this arm needs them on.");
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
      if (o.kind === "v6" ? r.isError || !/<content>|^\s*1\| /.test(text(r)) : r.isError) unreadable.push(gold);
    }
    if (unreadable.length) throw new Error(`${unreadable.length} of ${o.gold.length} gold paths unreadable: ${unreadable.slice(0, 10).join(", ")}${unreadable.length > 10 ? ", ..." : ""}`);
    return `${repos.length} of ${expected.length} repositories; ${o.gold.length} of ${o.gold.length} gold paths readable`;
  } finally { await client.close().catch(() => {}); }
}

export const expectedRepos = () => loadProduct().repositories.map((r) => r.name);

type Checkout = { checkout: string; commit: string };
const gitIn = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Checkouts under o3Dir that are shallow clones. A missing checkout is skipped here; the pin check reports it. */
export function shallowCheckouts(o3Dir: string, repos: Checkout[] = loadProduct().repositories): string[] {
  return repos.map((r) => join(o3Dir, r.checkout)).filter((dir) => existsSync(dir) && gitIn(dir, ["rev-parse", "--is-shallow-repository"]) === "true");
}

/** The eval stack needs full history; a shallow checkout names itself and the fix. */
export function assertFullHistory(o3Dir: string, repos?: Checkout[]): void {
  const shallow = shallowCheckouts(o3Dir, repos);
  if (shallow.length) throw new Error(`Shallow checkout (partial history): ${shallow.join(", ")}. Run pnpm eval corpus deepen first.`);
}

/** Unshallows each shallow checkout and checks its HEAD still equals its pin. Moves no head and no pin. */
export function deepenCheckouts(o3Dir: string, repos: Checkout[] = loadProduct().repositories): string {
  return repos.map((r) => {
    const dir = join(o3Dir, r.checkout);
    if (!existsSync(dir)) throw new Error(`Checkout ${dir} is missing; clone it before deepening.`);
    const wasShallow = gitIn(dir, ["rev-parse", "--is-shallow-repository"]) === "true";
    if (wasShallow) gitIn(dir, ["fetch", "--unshallow"]);
    const head = gitIn(dir, ["rev-parse", "HEAD"]);
    if (head !== r.commit) throw new Error(`Checkout ${dir} HEAD is ${head}, expected pin ${r.commit}; deepen does not move heads.`);
    return `${r.checkout}: ${wasShallow ? "deepened" : "already complete"} at ${head}`;
  }).join("\n");
}
