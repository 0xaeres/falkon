import { z } from "zod";
import type { Arm } from "./data.js";
import type { Span } from "./score.js";

export const SERVER = "falkon";
export const MODEL = "claude-sonnet-5-5";
/** The seven approved tools of the reference runs. */
export const TOOLS = ["grep", "glob", "read_file", "list_tree", "list_repos", "find_symbol_definitions", "find_symbol_references"];
const DENIED_TOOLS = ["ask_codebase", "create_skill", "update_skill", "list_skills", "list_commits", "list_branches", "get_diff", "list_language_models"];
const mcp = (name: string) => `mcp__${SERVER}__${name}`;
/** MCP tool names an arm may call. */
const toolsFor = (arm: Arm) => arm === "clone-research" ? [...TOOLS, "research_codebase"] : TOOLS;

export function prompt(arm: Arm, question: string): string {
  const common = `Answer the repository question by listing every code declaration that answers it (all of them, since scoring is by recall), best first. End with one fenced json array of at most 20 objects with exactly {"path": "repo-relative path", "startLine": 1, "endLine": 1} (inclusive, 1-based). Ignore any citation format the server describes; end only with the json array described here. Do not modify files.\n\nQuestion:\n${question}`;
  const product = `This product's repositories are indexed by Falkon, available as MCP tools. Your checkout holds only openmrs-esm-patient-chart; the product's other 41 repositories are reachable only through Falkon. Falkon names repositories github.com/openmrs/<name>, for example github.com/openmrs/openmrs-esm-core. The tools are grep (regex search across repositories, optional repo, path and include filters), glob, read_file (repo, path, offset, limit), list_tree, list_repos, find_symbol_definitions and find_symbol_references. Falkon returns repo-relative paths; cite each path as <repository-name>/<path inside the repository>, without the github.com/openmrs/ prefix; for example openmrs-esm-core/packages/.... Limit: at most ten search calls (grep, glob, find_symbol_definitions, find_symbol_references) and at most twenty read calls (read_file, list_tree, list_repos).`;
  const research = arm === "clone-research" ? " Before any other tool, call research_codebase first with the question; it returns a research brief. Then continue with the other tools to do the research." : "";
  return `${common}\n\n${product}${research}`;
}

export type CommandOptions = { question: string; tree: string; env: NodeJS.ProcessEnv; configPath: string; port: number; perRunCap: number; apiKey?: string; denyPaths: string[] };

/** The key reaches the child only through EVAL_MCP_KEY, which the MCP config references; it is never inherited. */
export function buildCommand(arm: Arm, o: CommandOptions): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; mcpConfig: string } {
  const fsTools = ["Read", "Grep", "Glob"];
  const outside = ["./eval", "./.local", "//Users", "//private/tmp/claude-501", ...o.denyPaths.map((p) => `/${p}`)];
  const denied = [...fsTools.flatMap((t) => outside.map((p) => `${t}(${p}/**)`)), ...[...DENIED_TOOLS, ...(arm === "clone-tools" ? ["research_codebase"] : [])].map(mcp)];
  const server = { type: "http", url: `http://127.0.0.1:${o.port}/api/mcp`, ...(o.apiKey ? { headers: { Authorization: "Bearer ${EVAL_MCP_KEY}" } } : {}) };
  const { EVAL_MCP_KEY: _inherited, ...env } = o.env;
  return {
    command: "claude",
    args: ["-p", prompt(arm, o.question), "--model", MODEL, "--output-format", "stream-json", "--verbose", "--max-budget-usd", String(o.perRunCap),
      "--tools", fsTools.join(","), "--allowedTools", [...fsTools.map((t) => `${t}(./**)`), ...toolsFor(arm).map(mcp)].join(","),
      "--disallowedTools", denied.join(","), "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--mcp-config", o.configPath],
    cwd: o.tree,
    env: { ...env, ...(o.apiKey ? { EVAL_MCP_KEY: o.apiKey } : {}) },
    mcpConfig: JSON.stringify({ mcpServers: { [SERVER]: server } }),
  };
}

const sensitive = /(?:^|[\/ ])(?:\.env(?:[.\/ ]|$)|\.local(?:[\/ ]|$)|eval(?:[\/ ]|$))|\/Users(?:\/|$)|\/(?:private\/)?tmp\/claude-501(?:\/|$)|\.\.\//i;
/** Input fields that name files; Grep's regex `pattern` is code, not a path. */
const pathFields: Record<string, string[]> = { Read: ["file_path", "path"], Grep: ["path", "glob"], Glob: ["pattern", "path"] };

export type Parsed = { result?: string; usage: Record<string, unknown>; total_cost_usd?: number; num_turns?: number; is_error?: boolean; toolCalls: Record<string, number>; firstTool?: string; leak: boolean; deniedAttempts: number };
/** Reads a stream-json run. Any tool outside the arm's allowlist, or a path into private areas, marks the run as a leak. */
export function parseClaudeOutput(stdout: string, arm: Arm, denyPaths: string[] = []): Parsed {
  const out: Parsed = { usage: {}, toolCalls: {}, leak: false, deniedAttempts: 0 };
  const allowed = ["Read", "Grep", "Glob", ...toolsFor(arm).map(mcp)];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (item.type === "tool_use" && typeof item.name === "string") {
      out.firstTool ??= item.name.replace(`mcp__${SERVER}__`, "");
      // The plain arm may try the tool it was denied; that is counted, not a leak.
      if (arm === "clone-tools" && item.name === mcp("research_codebase")) out.deniedAttempts++;
      else if (!allowed.includes(item.name)) out.leak = true;
      else if (item.name.startsWith(`mcp__${SERVER}__`)) { const short = item.name.slice(mcp("").length); out.toolCalls[short] = (out.toolCalls[short] ?? 0) + 1; }
      if (Object.hasOwn(pathFields, item.name)) {
        for (const field of pathFields[item.name]!) {
          const path = (item.input as Record<string, unknown> | undefined)?.[field];
          if (typeof path === "string" && (sensitive.test(path.replaceAll("\\", "/")) || denyPaths.some((d) => path === d || path.startsWith(`${d}/`)))) out.leak = true;
        }
      }
    }
    Object.values(item).forEach(visit);
  };
  for (const line of stdout.split("\n")) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    visit(event);
    if (event.type === "assistant" && Array.isArray((event.message as { content?: unknown })?.content)) {
      out.result = ((event.message as { content: { type?: string; text?: unknown }[] }).content).filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n") || out.result;
    }
    if (event.type === "result") {
      if (typeof event.result === "string") out.result = event.result;
      if (event.usage && typeof event.usage === "object") out.usage = event.usage as Record<string, unknown>;
      if (typeof event.total_cost_usd === "number") out.total_cost_usd = event.total_cost_usd;
      if (typeof event.num_turns === "number") out.num_turns = event.num_turns;
      if (typeof event.is_error === "boolean") out.is_error = event.is_error;
    }
  }
  return out;
}

const answerSpan = z.object({ path: z.string().min(1), startLine: z.int().positive(), endLine: z.int().positive() }).refine((s) => s.endLine >= s.startLine);
/** The last json fence is the answer. `lineCount` is the file's line count, or undefined when the file is not in the corpus. */
export function parseAnswer(text: string, lineCount: (path: string) => number | undefined): { answer: Span[]; malformed: boolean } {
  const json = [...text.matchAll(/```json\s*\n?([\s\S]*?)```/g)].at(-1)?.[1];
  let values: unknown;
  try { values = JSON.parse(json ?? ""); if (!Array.isArray(values)) throw new Error(); } catch { return { answer: [], malformed: true }; }
  const answer: Span[] = [];
  for (const value of values) {
    const parsed = answerSpan.safeParse(value);
    if (!parsed.success) continue;
    const path = parsed.data.path.replace(/^(\.\/)+/, "");
    const lines = lineCount(path);
    if (!lines) continue;
    const clamp = (n: number) => Math.max(1, Math.min(lines, n));
    answer.push({ path, startLine: clamp(parsed.data.startLine), endLine: clamp(parsed.data.endLine) });
    if (answer.length === 20) break;
  }
  return { answer: answer.filter((s) => s.path.includes("/")), malformed: false };
}
