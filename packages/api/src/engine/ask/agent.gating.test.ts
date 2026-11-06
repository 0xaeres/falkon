import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { scopeFor } from "@falkon/shared";
import { agentTools, chatToolDefinitions, createMessageStream } from "./agent";
import { fakeOpenAi } from "./fakeOpenAi";
import { isHistoryQuery, GIT_BRIEF_RECIPES, HISTORY_RECIPE } from "./recipes";
import { dynamicPrompt, STATIC_PROMPT } from "./prompt";

// S99 (D194): the ten history and git tools and their two recipes are offered only for a history-worded conversation.
const CORE = ["read_file", "list_branches", "list_commits", "list_repos", "get_diff", "grep", "glob", "find_symbol_references", "find_symbol_definitions", "list_tree"];
const HISTORY = ["get_pull_request", "search_discussions", "get_provenance"];
const GIT = ["search_commits", "search_diffs", "compare_revisions", "list_refs", "check_ancestry", "get_range_history", "list_contributors"];
const FLAGS = ["MCP_HISTORY_TOOLS", "MCP_GIT_TOOLS"] as const;
const flags = (history?: string, git?: string) => { for (const [k, v] of [[FLAGS[0], history], [FLAGS[1], git]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
afterEach(() => flags());

const text = (t: string): UIMessage => ({ id: "m", role: "user" as const, parts: [{ type: "text" as const, text: t }] });
const said = (t: string): UIMessage => ({ id: "a", role: "assistant" as const, parts: [{ type: "text" as const, text: `<!--answer-->\n${t}` }] });
const model = (url: string) => ({ provider: "openai-compatible", model: "m", baseUrl: url });

/** Runs a real turn over the fake model and returns the tool names and the system text the model request carried. */
async function sent(messages: UIMessage[]) {
  const fake = await fakeOpenAi([{ text: "<!--answer-->\nok" }]);
  try {
    const r = (await createMessageStream({ audience: "human", messages, selectedRepos: [], scope: scopeFor(["*"]), model: model(fake.url) })).getReader();
    while (!(await r.read()).done);
    const req = fake.requests[0]!;
    return { tools: (req.tools as { function: { name: string } }[]).map((t) => t.function.name), system: req.messages.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n") };
  } finally { fake.close(); }
}
const hasRecipes = (system: string) => [system.includes(HISTORY_RECIPE), system.includes(GIT_BRIEF_RECIPES)];

test("a history-worded question gets all twenty tools and both recipes", async () => {
  const s = await sent([text("Who wrote the payment code and in which commit?")]);
  assert.deepEqual(s.tools, [...CORE, ...HISTORY, ...GIT]);
  assert.deepEqual(hasRecipes(s.system), [true, true]);
});

test("a code question gets the core ten and no recipe", async () => {
  const s = await sent([text("How does the payment flow work?")]);
  assert.deepEqual(s.tools, CORE);
  assert.deepEqual(hasRecipes(s.system), [false, false]);
});

test("both flags off: identical to today for any question", async () => {
  flags("off", "off");
  for (const q of ["How does the payment flow work?", "Who wrote this commit?"]) {
    const s = await sent([text(q)]);
    assert.deepEqual(s.tools, CORE, q);
    assert.deepEqual(hasRecipes(s.system), [false, false], q);
  }
});

test("each flag alone: only its family and its recipe, and only for a history question", async () => {
  flags(undefined, "off");
  let s = await sent([text("Which PR changed this?")]);
  assert.deepEqual(s.tools, [...CORE, ...HISTORY]);
  assert.deepEqual(hasRecipes(s.system), [true, false]);
  s = await sent([text("How does it work?")]);
  assert.deepEqual(s.tools, CORE);
  flags("off", undefined);
  s = await sent([text("Which tag first shipped the fix?")]);
  assert.deepEqual(s.tools, [...CORE, ...GIT]);
  assert.deepEqual(hasRecipes(s.system), [false, true]);
});

test("a follow-up with no history word keeps the tools when an earlier user message had one", async () => {
  const s = await sent([text("Who wrote the retry logic?"), said("Alice, in commit abc123."), text("and the second one?")]);
  assert.equal(s.tools.length, 20);
  assert.deepEqual(hasRecipes(s.system), [true, true]);
});

test("a history word only in an assistant message does not turn the tools on", async () => {
  const s = await sent([text("How does retry work?"), said("It was changed in a commit last year."), text("and the second one?")]);
  assert.deepEqual(s.tools, CORE);
});

test("the static prompt is byte-identical whatever the question", async () => {
  const a = await sent([text("How does the payment flow work?")]);
  const b = await sent([text("Who wrote the payment code?")]);
  assert.ok(a.system.startsWith(STATIC_PROMPT) && b.system.startsWith(STATIC_PROMPT));
});

test("dynamicPrompt leaves the recipes out when history is false and keeps them by default", () => {
  const base = { repos: [], files: [], audience: "human" as const };
  assert.ok(dynamicPrompt(base).includes(HISTORY_RECIPE));
  assert.ok(!dynamicPrompt({ ...base, history: false }).includes(HISTORY_RECIPE));
  assert.ok(!dynamicPrompt({ ...base, history: false }).includes(GIT_BRIEF_RECIPES));
});

test("every registered tool is reachable by some question", () => {
  const reachable = new Set<string>();
  for (const q of ["How does grep work", "Which commit introduced the bug?"]) for (const n of Object.keys(agentTools(scopeFor(["*"]), [], () => {}, isHistoryQuery(q)))) reachable.add(n);
  assert.deepEqual([...reachable].sort(), chatToolDefinitions().map(([n]) => n).sort());
});

// The decision list: which way the predicate goes for ambiguous wording. A history word anywhere wins; "why" and "how" alone are not history words.
const DECISIONS: [string, boolean][] = [
  ["How does the payment flow work?", false],
  ["Why does this function return null?", false],
  ["Why was the retry limit lowered?", true],
  ["Why does the cart code check whether prices changed?", true],
  ["What does the changed-files filter do?", true],
  ["When was the cache added?", true],
  ["Who added the rate limiter?", true],
  ["Which PR fixed this?", true],
  ["Open pull request 42", true],
  ["What does PAY-123 describe?", true],
  ["pay-123 lowercase is not a key", false],
  ["Show the blame for this file", true],
  ["Which release has the fix?", true],
  ["Is there a regression in checkout?", true],
  ["How does the git clone get refreshed?", true],
  ["What is the reclassification rule?", false],
  ["Where is the history table defined?", true],
  ["", false],
  ["hey", false],
];

test("history predicate: decision list for ambiguous and edge wording", () => {
  for (const [q, want] of DECISIONS) assert.equal(isHistoryQuery(q), want, q);
});

test("history predicate: a very long question without a history word stays false and fast, with one it is true", () => {
  const filler = "the cart total is computed from line items ".repeat(50_000);
  const t = Date.now();
  assert.equal(isHistoryQuery(filler), false);
  assert.equal(isHistoryQuery(`${filler} blame`), true);
  assert.ok(Date.now() - t < 1000);
});

test("an empty conversation gets the core ten", async () => {
  const s = await sent([text("")]);
  assert.deepEqual(s.tools, CORE);
});
