import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scopeFor } from "@falkon/shared";
import { buildResearchBrief, CLIENT_RESEARCH_INSTRUCTIONS } from "./brief";
import { IMPACT_BRIEF_STEPS, IMPACT_INSTRUCTIONS, IMPACT_PROMPT, isImpactQuery } from "./impact";
import { dynamicPrompt, RENDER_PROMPT, REPLY_PROMPT, STATIC_PROMPT } from "./prompt";

// The rendering addendum is the only per-chat part for a non-impact question; the tests below see the prompt without it.
const withoutRender = (p: string) => p.replace(`${RENDER_PROMPT}\n\n${REPLY_PROMPT}`, "").replace(/^\n\n|\n\n$/, "");

// Pins are SHA-256 of the exact bytes as they were before the recipe existed.
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const input = { scope: scopeFor(["fixtures.test/atlas"]), availableRepos: ["fixtures.test/atlas"] };
const plain = "Where is greeting implemented?";
const impact = "If getPatientByUuid changed, who uses it and what breaks?";

test("impact-style questions are recognised, plain ones are not", () => {
  for (const q of [
    "What would break if we rename Foo?", "which callers does this have", "Who uses saveEncounter?", "Impact of removing the flag",
    "What depends on ObsService?", "If the return shape changed, which apps are affected?", "What changes are needed to drop the column?",
  ]) assert.ok(isImpactQuery(q), q);
  for (const q of [plain, "How does authentication work?", "Find the definition of Patient", "list the exchange rates", ""]) assert.ok(!isImpactQuery(q), q);
});

test("the brief gains the recipe only for an impact question with the recipe enabled", () => {
  const base = buildResearchBrief({ ...input, query: impact });
  assert.ok(!base.includes(IMPACT_BRIEF_STEPS), "off by default");
  const on = buildResearchBrief({ ...input, query: impact, impactRecipe: true });
  assert.ok(on.includes(IMPACT_BRIEF_STEPS));
  assert.ok(on.indexOf("5. Stop when") < on.indexOf(IMPACT_BRIEF_STEPS) && on.indexOf(IMPACT_BRIEF_STEPS) < on.indexOf("Write Markdown."));
  assert.equal(buildResearchBrief({ ...input, query: plain, impactRecipe: true }), buildResearchBrief({ ...input, query: plain }));
});

test("recipe text names the tools it relies on, admits what was not checked, and is bounded", () => {
  for (const t of ["find_symbol_definitions", "find_symbol_references", "grep", "read_file", "name clash", "Never present an empty search"]) assert.ok(IMPACT_BRIEF_STEPS.includes(t) || IMPACT_PROMPT.includes(t), t);
  assert.ok(IMPACT_BRIEF_STEPS.split(/\s+/).length < 260);
  assert.ok(IMPACT_PROMPT.split(/\s+/).length < 260);
  assert.ok(IMPACT_INSTRUCTIONS.split(/\s+/).length < 260);
  const forbidden = /powerful agentic|world's best|code-intelligence platform|Phase 1:|Phase 2:|MANDATORY/i;
  for (const text of [IMPACT_BRIEF_STEPS, IMPACT_PROMPT, IMPACT_INSTRUCTIONS]) assert.doesNotMatch(text, forbidden);
});

test("the UI Ask prompt for a non-impact question is unchanged apart from the rendering and reply addenda; impact adds one trailing section", () => {
  const args = { repos: ["a/b"], files: [] };
  assert.equal(dynamicPrompt({ ...args, query: plain }), dynamicPrompt(args));
  assert.equal(dynamicPrompt({ repos: [], files: [], query: plain }), `${RENDER_PROMPT}\n\n${REPLY_PROMPT}`);
  const withRecipe = dynamicPrompt({ ...args, query: impact });
  assert.ok(withRecipe.startsWith(dynamicPrompt(args)));
  assert.ok(withRecipe.endsWith(IMPACT_PROMPT));
  assert.equal(dynamicPrompt({ repos: [], files: [], query: impact }), `${RENDER_PROMPT}\n\n${REPLY_PROMPT}\n\n${IMPACT_PROMPT}`);
});

test("pins: bytes of the static and per-chat prompts (rewritten in cycle 9), the non-impact brief and the client instructions", () => {
  const brief = buildResearchBrief({ ...input, query: plain });
  assert.equal(sha(brief), "4ee97b238a01456ffd70b4e77d371c19ef11f980d5f8bb516d0e27897d252d22");
  assert.equal(sha(buildResearchBrief({ ...input, query: plain, repos: [], impactRecipe: true })), "8c3cd554a34b6efc5321426432d1fc2527b6f39fa72d08f9945bf7077e59b783");
  assert.equal(sha(STATIC_PROMPT), "4651c39bbe3b9ce1c92e8c8cb9874667679990ee7627fc249abb702ea56e3ef0");
  assert.equal(sha(CLIENT_RESEARCH_INSTRUCTIONS), "9050bcb16e670ddb5ea4da4b5992f7fb462c63988c91aa858b9ee8b5272151d6");
  assert.equal(sha(withoutRender(dynamicPrompt({ repos: ["a/b"], files: [] }))), "2e1557c3daac0bebb47928c9d2584576e11287c8dc199ca79fbd9904b4751060");
});
