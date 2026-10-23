import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommand, parseAnswer, parseClaudeOutput, prompt } from "./harness.js";
import type { Arm } from "./data.js";

const base = { question: "Where?", tree: "/chart", env: { PATH: "/bin", ANTHROPIC_API_KEY: "model-fixture", EVAL_MCP_KEY: "inherited" } as NodeJS.ProcessEnv, configPath: "/cfg.json", url: "http://127.0.0.1:3400/api/mcp", model: "claude-sonnet-5-5", perRunCap: 1, denyPaths: ["/data/o3"] };
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]!;
const seven = ["grep", "glob", "read_file", "list_tree", "list_repos", "find_symbol_definitions", "find_symbol_references"];
const stream = (tools: string[], input: Record<string, unknown> = {}) => tools.map((name) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } })).join("\n");

test("the plain arm exposes exactly Read, Grep, Glob and the seven approved tools", () => {
  const c = buildCommand("clone-tools", base);
  assert.equal(c.cwd, "/chart");
  assert.equal(flag(c.args, "--model"), "claude-sonnet-5-5");
  assert.equal(flag(c.args, "--max-budget-usd"), "1");
  assert.equal(flag(c.args, "--output-format"), "stream-json");
  assert.ok(c.args.includes("--strict-mcp-config"));
  assert.deepEqual(flag(c.args, "--tools").split(","), ["Read", "Grep", "Glob"]);
  assert.deepEqual(flag(c.args, "--allowedTools").split(","), ["Read(./**)", "Grep(./**)", "Glob(./**)", ...seven.map((n) => `mcp__falkon__${n}`)]);
  const denied = flag(c.args, "--disallowedTools").split(",");
  for (const n of ["research_codebase", "ask_codebase", "create_skill", "update_skill", "list_skills", "list_commits", "list_branches", "get_diff", "list_language_models"]) assert.ok(denied.includes(`mcp__falkon__${n}`), n);
  for (const d of ["Read(//Users/**)", "Grep(//Users/**)", "Glob(//Users/**)", "Read(./.local/**)", "Read(//data/o3/**)", "Grep(//data/o3/**)", "Glob(//data/o3/**)"]) assert.ok(denied.includes(d), d);
  assert.deepEqual(JSON.parse(c.mcpConfig).mcpServers, { falkon: { type: "http", url: "http://127.0.0.1:3400/api/mcp" } });
});

test("the research arm adds only research_codebase and is told to call it first", () => {
  const c = buildCommand("clone-research", base);
  assert.deepEqual(flag(c.args, "--allowedTools").split(",").slice(3), [...seven, "research_codebase"].map((n) => `mcp__falkon__${n}`));
  assert.ok(!flag(c.args, "--disallowedTools").includes("mcp__falkon__research_codebase"));
  assert.match(prompt("clone-research", "Where?"), /call research_codebase first.*then continue with the other tools/is);
  assert.ok(!prompt("clone-tools", "Where?").includes("research_codebase"));
  assert.match(prompt("clone-tools", "Where?"), /^Answer the repository question by listing every code declaration/);
  assert.match(prompt("clone-tools", "Where?"), /github\.com\/openmrs\/<name>/);
});

test("the key is sent only when configured, by environment reference, and never inherited by accident", () => {
  const none = buildCommand("clone-tools", base);
  assert.equal(none.env.EVAL_MCP_KEY, undefined);
  assert.equal(none.env.ANTHROPIC_API_KEY, "model-fixture");
  assert.ok(!none.mcpConfig.includes("headers"));
  const keyed = buildCommand("clone-tools", { ...base, apiKey: "s3cret" });
  assert.equal(keyed.env.EVAL_MCP_KEY, "s3cret");
  assert.deepEqual(JSON.parse(keyed.mcpConfig).mcpServers.falkon.headers, { Authorization: "Bearer ${EVAL_MCP_KEY}" });
  assert.ok(!keyed.mcpConfig.includes("s3cret") && !keyed.args.join(" ").includes("s3cret"));
});

test("stream parsing counts MCP calls, records the first tool and flags every unexpected tool as a leak", () => {
  const ok = parseClaudeOutput(stream(["mcp__falkon__research_codebase", "mcp__falkon__grep", "Read", "mcp__falkon__grep"]), "clone-research");
  assert.deepEqual(ok.toolCalls, { research_codebase: 1, grep: 2 });
  assert.equal(ok.firstTool, "research_codebase");
  assert.equal(ok.leak, false);
  for (const name of ["Bash", "Write", "WebFetch", "mcp__falkon__ask_codebase", "mcp__other__x", "mcp__falkon__future_tool"]) assert.equal(parseClaudeOutput(stream([name]), "clone-research").leak, true, name);
});

test("leak checks inspect paths but not Grep or Glob patterns", () => {
  const leak = (name: string, input: Record<string, string>) => parseClaudeOutput(stream([name], input), "clone-tools", ["/data/o3"]).leak;
  for (const pattern of ["eval", "from '../", "/Users", ".env"]) assert.equal(leak("Grep", { pattern, path: "." }), false, pattern);
  assert.equal(leak("Glob", { pattern: "**/*.ts", path: "." }), false);
  for (const pattern of ["/Users/**", "../**/*.md", ".LOCAL/**", "eval/**"]) assert.equal(leak("Glob", { pattern }), true, `Glob ${pattern}`);
  for (const glob of ["/users/me/**", "../x/*", ".ENV"]) assert.equal(leak("Grep", { pattern: "safe", glob }), true, `Grep glob ${glob}`);
  assert.equal(leak("Grep", { pattern: "safe", glob: "*.ts" }), false);
  assert.equal(leak("Read", { file_path: "/USERS/me" }), true);
  for (const path of [".env", ".local/x", "eval/gold.json", "/Users/me", "/private/tmp/claude-501/x", "../up", "/data/o3/openmrs-core/a"]) assert.equal(leak("Read", { file_path: path }), true, path);
  assert.equal(leak("Grep", { pattern: "x", path: "/data/o3" }), true);
  // Claude Code's own spill files for oversized tool results are not a leak, but only that exact shape.
  const spill = "/Users/me/.claude/projects/-Users-me-work-falkon/0b1c-session/tool-results/toolu_01AB.txt";
  assert.equal(leak("Read", { file_path: spill }), false);
  assert.equal(leak("Read", { path: spill }), false);
  for (const path of [
    "/Users/me/.claude/settings.json", "/Users/me/.claude/projects/p/s/other/toolu_01.txt", "/Users/me/.claude/projects/p/tool-results/toolu_01.txt",
    "/Users/me/.claude/projects/p/s/tool-results/a/b.txt", "/Users/me/.claude/projects/p/s/tool-results/../../secret.json", "/Users/me/.claude/projects/p/../q/s/tool-results/f",
    "/Users/me/x/.claude/projects/p/s/tool-results/f", "/Users/me/.claude/projects/p/s/tool-results/", "/Users/me/.claude/projects/p/s/tool-results",
    "/Users/me/.claude/projects/p/s/tool-results/.env", "/Users/me/.claude/projects/p/s/tool-results/.local", "/Users/me/.claude/projects/p/s/tool-results/*",
    "/Users/me/.claude/projects/*/s/tool-results/f", "/Users/me/.claude/projects/p/?/tool-results/f", "/Users/me/.claude/projects/p/s/tool-results/[a-z]",
    `${spill}/../../../../.env`, "/Users/me/.claude/projects/p/s/tool-results/f ",
  ]) assert.equal(leak("Read", { file_path: path }), true, path);
  assert.equal(leak("Read", { file_path: "openmrs-esm-patient-chart/src/a.ts" }), false);
});

test("stream parsing takes the result event's text, cost, turns and error flag", () => {
  const out = parseClaudeOutput([stream(["Read"]), JSON.stringify({ type: "result", result: "final", total_cost_usd: 0.12, num_turns: 3, is_error: false, usage: { input_tokens: 5 } })].join("\n"), "clone-tools");
  assert.deepEqual([out.result, out.total_cost_usd, out.num_turns, out.is_error, out.usage], ["final", 0.12, 3, false, { input_tokens: 5 }]);
});

test("answers keep the last json fence, drop unknown files and bare filenames, clamp lines and cap at twenty", () => {
  const lines = (path: string) => path === "repo-a/x.ts" ? 30 : path === "top.ts" ? 5 : undefined;
  const text = "```json\n[]\n```\nfinal\n```json\n" + JSON.stringify([{ path: "./repo-a/x.ts", startLine: 5, endLine: 99 }, { path: "repo-a/missing.ts", startLine: 1, endLine: 2 }, { path: "top.ts", startLine: 1, endLine: 2 }, { path: "repo-a/x.ts", startLine: 9, endLine: 3 }]) + "\n```";
  assert.deepEqual(parseAnswer(text, lines), { answer: [{ path: "repo-a/x.ts", startLine: 5, endLine: 30 }], malformed: false });
  assert.equal(parseAnswer("no fence", lines).malformed, true);
  assert.equal(parseAnswer("```json\n{}\n```", lines).malformed, true);
  const many = "```json\n" + JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ path: "repo-a/x.ts", startLine: i + 1, endLine: i + 1 }))) + "\n```";
  assert.equal(parseAnswer(many, lines).answer.length, 20);
});

test("every arm carries the question; the three tools arms share one prompt", () => {
  const arms: Arm[] = ["clone-tools", "clone-research", "v6-tools", "clone-tools-noinstr", "clone-tools-recipe"];
  for (const arm of arms) assert.ok(prompt(arm, "Q").includes("Question:\nQ"));
  assert.equal(prompt("v6-tools", "Q"), prompt("clone-tools", "Q"));
  assert.equal(prompt("clone-tools-noinstr", "Q"), prompt("clone-tools", "Q"));
  assert.equal(prompt("clone-tools-recipe", "Q"), prompt("clone-tools", "Q"));
});

test("--model reaches the claude command", () => {
  assert.equal(flag(buildCommand("clone-tools", { ...base, model: "claude-haiku-5-5" }).args, "--model"), "claude-haiku-5-5");
});

test("the v6 and no-instructions arms expose the plain arm's tools and denials, at their own URL", () => {
  const plain = buildCommand("clone-tools", base);
  for (const [arm, url] of [["v6-tools", "http://127.0.0.1:3000/api/mcp"], ["clone-tools-noinstr", "http://127.0.0.1:3401/api/mcp"], ["clone-tools-recipe", "http://127.0.0.1:3402/api/mcp"]] as const) {
    const c = buildCommand(arm, { ...base, url, apiKey: "s3cret" });
    assert.equal(flag(c.args, "--allowedTools"), flag(plain.args, "--allowedTools"), arm);
    assert.equal(flag(c.args, "--disallowedTools"), flag(plain.args, "--disallowedTools"), arm);
    assert.deepEqual(JSON.parse(c.mcpConfig).mcpServers, { falkon: { type: "http", url, headers: { Authorization: "Bearer ${EVAL_MCP_KEY}" } } });
    assert.equal(c.env.EVAL_MCP_KEY, "s3cret");
    assert.ok(!c.mcpConfig.includes("s3cret") && !c.args.join(" ").includes("s3cret"));
    assert.equal(parseClaudeOutput(stream(["mcp__falkon__research_codebase", "mcp__falkon__grep"]), arm).deniedAttempts, 1, arm);
    const git = parseClaudeOutput(stream(["mcp__falkon__list_commits"]), arm);
    assert.deepEqual([git.leak, git.deniedAttempts], [false, 1], arm);
  }
});

test("the plain arm trying the denied research tool is counted, not a leak", () => {
  const out = parseClaudeOutput(stream(["mcp__falkon__research_codebase", "mcp__falkon__grep", "mcp__falkon__research_codebase"]), "clone-tools");
  assert.equal(out.deniedAttempts, 2);
  assert.equal(out.leak, false);
  assert.deepEqual(out.toolCalls, { grep: 1 });
  assert.equal(parseClaudeOutput(stream(["mcp__falkon__research_codebase"]), "clone-research").deniedAttempts, 0);
  assert.equal(parseClaudeOutput(stream(["Bash"]), "clone-tools").leak, true);
  assert.equal(parseClaudeOutput(stream(["mcp__falkon__future_tool"]), "clone-tools").leak, true);
});

test("both prompts tell the agent to ignore the server's citation format", () => {
  for (const arm of ["clone-tools", "clone-research", "v6-tools"] as const) assert.match(prompt(arm, "Q"), /Ignore any citation format the server describes; end only with the json array described here\./);
});

test("the prompt for the existing datasets is byte-identical to the one on main", () => {
  assert.equal(prompt("clone-tools", "Where?"), "Answer the repository question by listing every code declaration that answers it (all of them, since scoring is by recall), best first. End with one fenced json array of at most 20 objects with exactly {\"path\": \"repo-relative path\", \"startLine\": 1, \"endLine\": 1} (inclusive, 1-based). Ignore any citation format the server describes; end only with the json array described here. Do not modify files.\n\nQuestion:\nWhere?\n\nThis product's repositories are indexed by Falkon, available as MCP tools. Your checkout holds only openmrs-esm-patient-chart; the product's other 41 repositories are reachable only through Falkon. Falkon names repositories github.com/openmrs/<name>, for example github.com/openmrs/openmrs-esm-core. The tools are grep (regex search across repositories, optional repo, path and include filters), glob, read_file (repo, path, offset, limit), list_tree, list_repos, find_symbol_definitions and find_symbol_references. Falkon returns repo-relative paths; cite each path as <repository-name>/<path inside the repository>, without the github.com/openmrs/ prefix; for example openmrs-esm-core/packages/.... Limit: at most ten search calls (grep, glob, find_symbol_definitions, find_symbol_references) and at most twenty read calls (read_file, list_tree, list_repos).");
  assert.equal(prompt("clone-research", "Where?"), "Answer the repository question by listing every code declaration that answers it (all of them, since scoring is by recall), best first. End with one fenced json array of at most 20 objects with exactly {\"path\": \"repo-relative path\", \"startLine\": 1, \"endLine\": 1} (inclusive, 1-based). Ignore any citation format the server describes; end only with the json array described here. Do not modify files.\n\nQuestion:\nWhere?\n\nThis product's repositories are indexed by Falkon, available as MCP tools. Your checkout holds only openmrs-esm-patient-chart; the product's other 41 repositories are reachable only through Falkon. Falkon names repositories github.com/openmrs/<name>, for example github.com/openmrs/openmrs-esm-core. The tools are grep (regex search across repositories, optional repo, path and include filters), glob, read_file (repo, path, offset, limit), list_tree, list_repos, find_symbol_definitions and find_symbol_references. Falkon returns repo-relative paths; cite each path as <repository-name>/<path inside the repository>, without the github.com/openmrs/ prefix; for example openmrs-esm-core/packages/.... Limit: at most ten search calls (grep, glob, find_symbol_definitions, find_symbol_references) and at most twenty read calls (read_file, list_tree, list_repos). Before any other tool, call research_codebase first with the question; it returns a research brief. Then continue with the other tools to do the research.");
});

test("the history prompt asks for the four-shape array; existing prompt text is untouched", () => {
  const p = prompt("clone-tools", "Q", true);
  assert.ok(p.includes("Question:\nQ"));
  for (const s of ['{"path"', '{"repo"', '"commit"', '"pr"', '{"ticket"', "openmrs-core", "TRUNK-1234", "at most 20"]) assert.ok(p.includes(s), s);
  assert.notEqual(p, prompt("clone-tools", "Q"));
  assert.equal(prompt("clone-tools", "Q", false), prompt("clone-tools", "Q"));
});

test("clone-tools-git allows the seven tools plus list_commits, get_diff and list_branches; every other arm denies them", () => {
  const git = ["list_commits", "get_diff", "list_branches"];
  const c = buildCommand("clone-tools-git", base);
  assert.deepEqual(flag(c.args, "--allowedTools").split(",").slice(3), [...seven, ...git].map((n) => `mcp__falkon__${n}`));
  const denied = flag(c.args, "--disallowedTools").split(",");
  for (const n of git) assert.ok(!denied.includes(`mcp__falkon__${n}`), n);
  for (const n of ["research_codebase", "ask_codebase", "create_skill"]) assert.ok(denied.includes(`mcp__falkon__${n}`), n);
  for (const n of git) {
    assert.equal(parseClaudeOutput(stream([`mcp__falkon__${n}`]), "clone-tools-git").leak, false, n);
    assert.deepEqual(parseClaudeOutput(stream([`mcp__falkon__${n}`]), "clone-tools-git").toolCalls, { [n]: 1 });
    assert.equal(parseClaudeOutput(stream([`mcp__falkon__${n}`]), "clone-tools-git").deniedAttempts, 0, n);
    for (const arm of ["clone-tools", "clone-research", "v6-tools", "clone-tools-noinstr", "clone-tools-recipe"] as const) {
      const out = parseClaudeOutput(stream([`mcp__falkon__${n}`]), arm);
      assert.deepEqual([out.leak, out.deniedAttempts, out.toolCalls], [false, 1, {}], `${arm} ${n}`);
      assert.ok(flag(buildCommand(arm, base).args, "--disallowedTools").split(",").includes(`mcp__falkon__${n}`), `${arm} ${n}`);
    }
  }
  assert.equal(parseClaudeOutput(stream(["mcp__falkon__research_codebase"]), "clone-tools-git").deniedAttempts, 1);
});

test("answers accept spans, commits, pull requests and tickets; malformed typed items are dropped", () => {
  const lines = (path: string) => path === "repo-a/x.ts" ? 30 : undefined;
  const items = [
    { path: "repo-a/x.ts", startLine: 1, endLine: 2 }, { repo: "openmrs-core", commit: "abcdef1234" }, { repo: "openmrs-core", pr: 77 }, { ticket: "TRUNK-1234" },
    { repo: "openmrs-core", commit: "abcdef" }, { repo: "openmrs-core", commit: "xyzxyzxyz" }, { repo: "openmrs-core", pr: 1.5 }, { repo: "openmrs-core", pr: "7" }, { repo: "openmrs-core", pr: 0 }, { ticket: "" }, { ticket: 5 }, { repo: "", commit: "abcdef1" }, 7, null,
  ];
  assert.deepEqual(parseAnswer("```json\n" + JSON.stringify(items) + "\n```", lines), {
    answer: [{ path: "repo-a/x.ts", startLine: 1, endLine: 2 }, { repo: "openmrs-core", commit: "abcdef1234" }, { repo: "openmrs-core", pr: 77 }, { ticket: "TRUNK-1234" }], malformed: false,
  });
  const many = "```json\n" + JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ ticket: `T-${i + 1}` }))) + "\n```";
  assert.equal(parseAnswer(many, lines).answer.length, 20);
});
