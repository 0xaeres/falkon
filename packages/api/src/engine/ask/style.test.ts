import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { GIT_BRIEF_RECIPES } from "./brief";
import { REPLY_PROMPT, RENDER_PROMPT, STATIC_PROMPT, dynamicPrompt } from "./prompt";

const base = { repos: ["a/b"], files: [], query: "how does checkout work?" };
const human = () => dynamicPrompt({ ...base, audience: "human" });
const agent = () => dynamicPrompt({ ...base, audience: "agent" });
const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
};

test("static prompt carries no audience or length wording", () => {
  assert.doesNotMatch(STATIC_PROMPT, /concise|audience|terse|plain-language|tutorial/i);
  assert.ok(!STATIC_PROMPT.includes("<answer_style"));
});

test("human block only for human, agent block only for agent", () => {
  assert.ok(human().includes('<answer_style audience="human">'));
  assert.ok(!human().includes('<answer_style audience="agent">'));
  assert.ok(agent().includes('<answer_style audience="agent">'));
  assert.ok(!agent().includes('<answer_style audience="human">'));
  assert.match(human(), /short plain-language summary/);
  assert.match(human(), /first time a domain or code term appears/);
  assert.match(human(), /step by step/);
  assert.match(agent(), /locations/);
  assert.match(agent(), /no tutorial/i);
  assert.doesNotMatch(agent(), /plain-language|first time a domain/);
});

test("history recipes follow the flags and name no absent tool", () => {
  withEnv({ MCP_HISTORY_TOOLS: undefined, MCP_GIT_TOOLS: undefined }, () => {
    const p = human();
    assert.match(p, /get_pull_request/);
    assert.match(p, /get_provenance/);
    assert.match(p, /not proof that no ticket exists/);
    assert.ok(p.includes(GIT_BRIEF_RECIPES));
  });
  withEnv({ MCP_HISTORY_TOOLS: "off", MCP_GIT_TOOLS: " OFF " }, () => {
    const p = agent();
    assert.doesNotMatch(p, /get_pull_request|get_provenance|search_commits|list_refs|check_ancestry/);
  });
  withEnv({ MCP_HISTORY_TOOLS: "off", MCP_GIT_TOOLS: "on" }, () => {
    assert.ok(!human().includes("get_pull_request"));
    assert.ok(human().includes(GIT_BRIEF_RECIPES));
  });
});

test("reply and render parts are unchanged", () => {
  assert.ok(human().includes(`${RENDER_PROMPT}\n\n${REPLY_PROMPT}`));
  assert.ok(agent().includes(`${RENDER_PROMPT}\n\n${REPLY_PROMPT}`));
});

test("callers pass the audience explicitly: UI chat is human, ask_codebase is agent", () => {
  assert.match(readFileSync(new URL("./uiChat.ts", import.meta.url), "utf8"), /audience: "human"/);
  assert.match(readFileSync(new URL("./chat.ts", import.meta.url), "utf8"), /audience: "agent"/);
});
