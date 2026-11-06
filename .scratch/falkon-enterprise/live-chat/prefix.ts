// Fixed prefix of every chat request: system prompts and tool schemas, bytes and estimated tokens (bytes/4).
// Run: cd packages/api && node --import tsx ../../.scratch/falkon-enterprise/live-chat/prefix.ts
import { toolJsonSchema } from "../../../packages/shared/src/toolJsonSchema";
import { chatToolDefinitions } from "../../../packages/api/src/engine/ask/agent";
import { isHistoryQuery } from "../../../packages/api/src/engine/ask/recipes";
import { dynamicPrompt, STATIC_PROMPT } from "../../../packages/api/src/engine/ask/prompt";

const bytes = (s: string) => Buffer.byteLength(s);
const tok = (b: number) => Math.round(b / 4);
// S99 (D194): the history tools and recipes are offered only for a history question, so print one sample of each kind.
const QUESTIONS = { "code question": "How does the payment flow work?", "history question": "Who wrote the payment retry and in which commit?" };
const HISTORY_FAMILY = ["get_pull_request", "search_discussions", "get_provenance", "search_commits", "search_diffs", "compare_revisions", "list_refs", "check_ancestry", "get_range_history", "list_contributors"];
const row = (name: string, b: number) => console.log(`  ${name.padEnd(28)} ${String(b).padStart(7)} B  ~${String(tok(b)).padStart(6)} tok`);

for (const [kind, query] of Object.entries(QUESTIONS)) for (const flag of ["on", "off"]) {
  const history = isHistoryQuery(query);
  process.env.MCP_HISTORY_TOOLS = flag;
  process.env.MCP_GIT_TOOLS = flag;
  console.log(`\n== ${kind}: MCP_HISTORY_TOOLS=${flag} MCP_GIT_TOOLS=${flag} ==`);
  const dyn = dynamicPrompt({ repos: ["github.com/example/app"], files: [], query, audience: "human", history }) ?? "";
  const tools = chatToolDefinitions().filter(([name]) => history || !HISTORY_FAMILY.includes(name)).map(([name, d]) => [name, bytes(JSON.stringify({ name, description: d.description, inputSchema: toolJsonSchema(d.inputSchema) }))] as const);
  const toolTotal = tools.reduce((n, [, b]) => n + b, 0);
  row("STATIC_PROMPT", bytes(STATIC_PROMPT));
  row("dynamicPrompt", bytes(dyn));
  for (const [name, b] of tools) row(`tool ${name}`, b);
  row(`tools total (${tools.length})`, toolTotal);
  row("PREFIX TOTAL", bytes(STATIC_PROMPT) + bytes(dyn) + toolTotal);
}
