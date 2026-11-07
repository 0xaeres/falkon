import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { gitToolNames, historyToolNames } from "@falkon/shared";
import { GIT_BRIEF_RECIPES } from "./recipes";
import { ANSWER_TAG, AUDIENCE_PROMPT, REPLY_PROMPT, RENDER_PROMPT, STATIC_PROMPT, dynamicPrompt } from "./prompt";

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
  assert.match(human(), /senior engineer explains the code to a teammate/);
  assert.match(human(), /first time a domain term or abbreviation appears/);
  assert.match(human(), /Size the answer to the question/);
  assert.match(human(), /Give every fence its language/);
  assert.match(agent(), /locations/);
  assert.match(agent(), /no tutorial/i);
  assert.doesNotMatch(agent(), /senior engineer|first time a domain|fence its language/);
});

test("each tool family is named only when its flag is on, in all four combinations", () => {
  const mentions = (p: string, names: readonly string[]) => names.filter((n) => new RegExp(`\\b${n}\\b`).test(p));
  for (const history of [true, false]) for (const git of [true, false]) {
    withEnv({ MCP_HISTORY_TOOLS: history ? undefined : " Off ", MCP_GIT_TOOLS: git ? "on" : "off" }, () => {
      const p = human();
      const label = `history ${history}, git ${git}`;
      assert.deepEqual(mentions(p, historyToolNames).length > 0, history, label);
      assert.equal(mentions(p, gitToolNames).length > 0, git, label);
      assert.equal(p.includes(GIT_BRIEF_RECIPES), git, label);
      assert.equal(agent() === p.replace(AUDIENCE_PROMPT.human, AUDIENCE_PROMPT.agent), true, label);
    });
  }
  withEnv({ MCP_HISTORY_TOOLS: undefined, MCP_GIT_TOOLS: "off" }, () => {
    assert.match(human(), /not proof that no ticket exists/);
  });
});

test("the human block follows the answer tag and leaves conversational messages alone", () => {
  assert.ok(AUDIENCE_PROMPT.human.includes(`After the ${ANSWER_TAG} line, open with the answer itself`));
  assert.ok(AUDIENCE_PROMPT.human.includes("This does not apply to a conversational message (see the conversational replies section)."));
});

test("reply and render parts are unchanged", () => {
  assert.ok(human().includes(`${RENDER_PROMPT}\n\n${REPLY_PROMPT}`));
  assert.ok(agent().includes(`${RENDER_PROMPT}\n\n${REPLY_PROMPT}`));
});

test("callers pass the audience explicitly: UI chat is human, ask_codebase is agent", () => {
  assert.match(readFileSync(new URL("./uiChat.ts", import.meta.url), "utf8"), /audience: "human"/);
  assert.match(readFileSync(new URL("./chat.ts", import.meta.url), "utf8"), /audience: "agent"/);
});
