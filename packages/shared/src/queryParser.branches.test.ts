import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, QuerySyntaxError } from "./queryParser";
import { snapshot } from "../../../tests/contract/snapshot";

test("remaining flag values and invalid modifiers", () => {
  for (const [query, flags] of [
    ["archived:yes", []], ["archived:only", ["FLAG_ONLY_ARCHIVED"]],
    ["fork:yes", []], ["fork:no", ["FLAG_NO_FORKS"]], ["visibility:private", ["FLAG_ONLY_PRIVATE"]],
  ] as const) assert.deepEqual(parseQuery(query), { raw_config: { flags } }, query);
  for (const query of ["archived:maybe", "visibility:hidden"]) assert.throws(() => parseQuery(query), QuerySyntaxError);
});

test("knowledge repository expansion and trimmed context membership", () => {
  assert.deepEqual(parseQuery("repo:atlas", { expandRepoRegexp: () => ["atlas::knowledge"] }), { or: { children: [{ repo: { regexp: "atlas" } }, { repo_set: { set: { "atlas::knowledge": true } } }] } });
  assert.deepEqual(parseQuery("repo:atlas", { expandRepoRegexp: () => [] }), { repo: { regexp: "atlas" } });
  assert.deepEqual(parseQuery("reposet:atlas,worker", { expandRepoSet: (names) => [...names, "atlas::knowledge"] }), { repo_set: { set: { atlas: true, worker: true, "atlas::knowledge": true } } });
  assert.deepEqual(parseQuery("context:web", { contexts: { web: [" atlas ", "worker"] } }), { repo_set: { set: { atlas: true, worker: true } } });
  assert.deepEqual(parseQuery("context:empty", { contexts: { empty: [] } }), { repo_set: { set: {} } });
});

test("tokenizer boundary branches and regex grouping quirks remain frozen", () => {
  const queries = [
    "c:needle", "file:(test|spec)", "(file:(test|spec))", "or needle", "needle orange", "needle orElse", "needle\tor\tother", "needle\nother",
    "((a b))", "- (a or b)", "- file:test", "test()", "func(a)", "(pr", "a\\(b\\)",
    "()", "( )", '("hello world")', "((file:a))", "(-(file:a))", "(-file:a)", "((a|b))", "(a b)", "(a|b)", "-(a|b)", "(a\\)b)", "file:(a|b)", "[()]", "foo\\\\)",
  ];
  snapshot("query-boundaries", queries.flatMap((query) => [false, true].map((regex) => {
    try { return { query, regex, result: parseQuery(query, { regex, caseSensitive: true }) }; }
    catch (e) { return { query, regex, error: (e as Error).message }; }
  })));
  assert.deepEqual(parseQuery("c:Needle", { regex: true, caseSensitive: true }), { regexp: { regexp: "Needle", file_name: false, content: true, case_sensitive: true } });
});
