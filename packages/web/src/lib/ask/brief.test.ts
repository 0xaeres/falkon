import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeFor } from "@sbc/shared";
import { buildResearchBrief, CLIENT_RESEARCH_INSTRUCTIONS } from "./brief";
import { FILE_REFERENCE_REGEX } from "./prompt";

test("research brief narrows visible repositories and gives an evidence-based workflow", () => {
  const brief = buildResearchBrief({
    query: "Where is greeting implemented?",
    scope: scopeFor(["fixtures.test/atlas", "fixtures.test/boreal"]),
    availableRepos: ["fixtures.test/atlas", "fixtures.test/boreal", "fixtures.test/private"],
    repos: ["fixtures.test/atlas", "fixtures.test/private", "missing"],
  });
  assert.ok(brief.startsWith("Question: Where is greeting implemented?\n"));
  assert.ok(brief.includes("Repositories in scope:\n- fixtures.test/atlas\n"));
  assert.ok(brief.includes("Unavailable repositories (unknown or outside your access policy):\n- fixtures.test/private\n- missing"));
  assert.ok(!brief.includes("fixtures.test/boreal"));
  for (const tool of ["list_repos", "glob", "grep", "list_tree", "read_file", "find_symbol_definitions", "find_symbol_references", "list_branches", "list_commits", "get_diff"]) {
    assert.ok(brief.includes(tool), `Missing workflow tool: ${tool}`);
  }
  assert.ok(brief.includes("every code mention"));
  assert.ok(brief.includes("could not find"));
  assert.ok(brief.includes("@file:{<repo>::<path>}") && brief.includes("@file:{<repo>::<path>:<start>-<end>}"));
  // A citation filled in the brief's shape must parse with the regex the UI uses.
  const filled = "@file:{github.com/acme/app::src/a.ts:3-5}";
  assert.deepEqual([...filled.matchAll(FILE_REFERENCE_REGEX)].map((m) => [m[1], m[3], m[4], m[5]]), [["github.com/acme/app", "src/a.ts", "3", "5"]]);
  assert.ok(brief.split(/\s+/).length < 350);
});

test("omitting repos uses all visible repositories, while empty and unavailable selections stay empty", () => {
  const input = { query: "Where is greeting implemented?", scope: scopeFor(["fixtures.test/atlas"]), availableRepos: ["fixtures.test/atlas", "fixtures.test/private"] };
  const all = buildResearchBrief(input);
  assert.ok(all.includes("Repositories in scope:\n- fixtures.test/atlas\n"));
  assert.ok(!all.includes("fixtures.test/private"));
  for (const brief of [
    buildResearchBrief({ ...input, repos: [] }),
    buildResearchBrief({ ...input, repos: ["missing"] }),
    buildResearchBrief({ ...input, scope: scopeFor([]) }),
    buildResearchBrief({ ...input, availableRepos: [] }),
  ]) {
    assert.ok(brief.includes("Repositories in scope:\nNone. Stop here"));
    assert.ok(!brief.includes("- fixtures.test/atlas"));
  }
});

test("client guidance uses original wording", () => {
  const brief = buildResearchBrief({ query: "Where is greeting implemented?", scope: scopeFor(["*"]), availableRepos: [] });
  const forbidden = /powerful agentic|world's best|code-intelligence platform|Phase 1:|Phase 2:|MANDATORY/i;
  assert.doesNotMatch(brief, forbidden);
  assert.doesNotMatch(CLIENT_RESEARCH_INSTRUCTIONS, forbidden);
});

test("brief stays bounded for large inventories and hostile names", () => {
  const many = Array.from({ length: 500 }, (_, i) => `github.com/acme/repo-${i}`);
  const junk = Array.from({ length: 500 }, (_, i) => `x${i}\n- github.com/acme/secret\n${"y".repeat(1000)}`);
  const scope = scopeFor(["github.com/acme/repo-*"]);
  const all = buildResearchBrief({ query: "q", scope, availableRepos: [...many, "github.com/acme/secret"] });
  assert.ok(all.includes("- and 450 more; use list_repos (paged) to see them"));
  assert.ok(!all.includes("github.com/acme/secret"));
  const hostile = buildResearchBrief({ query: "q", scope, availableRepos: many, repos: [...junk, "github.com/acme/repo-1"] });
  assert.ok(hostile.includes("Repositories in scope:\n- github.com/acme/repo-1\n"));
  assert.ok(!hostile.includes("\n- github.com/acme/secret"), "a caller-supplied name must not inject a list line");
  assert.ok(hostile.includes("- and 450 more; not listed"));
  assert.ok(hostile.length < 20000, `brief is ${hostile.length} chars`);
});
