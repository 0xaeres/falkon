import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, QuerySyntaxError, SearchContextNotFoundError } from "./queryParser";

const sub = (pattern: string, cs = false) => ({ substring: { pattern, file_name: false, content: true, case_sensitive: cs } });
const re = (regexp: string, o: { file_name?: boolean; cs?: boolean } = {}) => ({
  regexp: { regexp, file_name: o.file_name ?? false, content: !o.file_name, case_sensitive: o.cs ?? false },
});

test("bare terms are literal substrings, regex mode makes them regexps", () => {
  assert.deepEqual(parseQuery("foo.bar"), sub("foo.bar"));
  assert.deepEqual(parseQuery("foo.*bar", { regex: true }), re("foo.*bar"));
  assert.deepEqual(parseQuery("Foo", { caseSensitive: true }), sub("Foo", true));
});

test("juxtaposition is AND, quoted phrase is one term", () => {
  assert.deepEqual(parseQuery('"hello world" x'), { and: { children: [sub("hello world"), sub("x")] } });
});

test("or binds looser than and", () => {
  assert.deepEqual(parseQuery("a b or c"), {
    or: { children: [{ and: { children: [sub("a"), sub("b")] } }, sub("c")] },
  });
});

test("groups and negation", () => {
  assert.deepEqual(parseQuery("foo (bar or baz) -file:test"), {
    and: {
      children: [
        sub("foo"),
        { or: { children: [sub("bar"), sub("baz")] } },
        { not: { child: re("test", { file_name: true }) } },
      ],
    },
  });
  assert.deepEqual(parseQuery("-(a or b)"), { not: { child: { or: { children: [sub("a"), sub("b")] } } } });
});

test("a dash that is not before a filter or group is ordinary text", () => {
  assert.deepEqual(parseQuery("-foo"), sub("-foo"));
});

test("filters", () => {
  assert.deepEqual(parseQuery("rev:main"), { branch: { pattern: "main", exact: false } });
  assert.deepEqual(parseQuery("rev:*"), { branch: { pattern: "", exact: false } });
  assert.deepEqual(parseQuery("repo:^acme/"), { repo: { regexp: "^acme/" } });
  assert.deepEqual(parseQuery("r:acme"), { repo: { regexp: "acme" } });
  assert.deepEqual(parseQuery("f:src"), re("src", { file_name: true }));
  assert.deepEqual(parseQuery("lang:typescript"), { language: { language: "TypeScript" } });
  assert.deepEqual(parseQuery("lang:Frobnicate"), { language: { language: "Frobnicate" } });
  assert.deepEqual(parseQuery("sym:Handler"), { symbol: { expr: re("Handler") } });
  assert.deepEqual(parseQuery("reposet:a, b"), { and: { children: [{ repo_set: { set: { a: true, "": true } } }, sub("b")] } });
  assert.deepEqual(parseQuery("reposet:a,b"), { repo_set: { set: { a: true, b: true } } });
  assert.deepEqual(parseQuery("content:foo"), sub("foo"));
});

test("modifiers map to raw_config flags", () => {
  assert.deepEqual(parseQuery("archived:no"), { raw_config: { flags: ["FLAG_NO_ARCHIVED"] } });
  assert.deepEqual(parseQuery("fork:only"), { raw_config: { flags: ["FLAG_ONLY_FORKS"] } });
  assert.deepEqual(parseQuery("visibility:public"), { raw_config: { flags: ["FLAG_ONLY_PUBLIC"] } });
  assert.deepEqual(parseQuery("visibility:any"), { raw_config: { flags: [] } });
  assert.throws(() => parseQuery("fork:maybe"), QuerySyntaxError);
});

test("quoted filter values may contain spaces; escaped quotes stay escaped (v6 parity)", () => {
  assert.deepEqual(parseQuery('file:"my dir/x"'), re("my dir/x", { file_name: true }));
  assert.deepEqual(parseQuery('"say \\"hi\\""'), sub('say \\"hi\\"'));
});

test("or as a word inside quotes is a term", () => {
  assert.deepEqual(parseQuery('"or"'), sub("or"));
});

test("parens inside a word stay in the word when balanced", () => {
  assert.deepEqual(parseQuery("fmt.Println(x)"), sub("fmt.Println(x)"));
  // v6 parity: the inner word stops at the paren that may close the group.
  assert.deepEqual(parseQuery("(fmt.Println(x))"), { and: { children: [sub("fmt.Println(x"), sub(")")] } });
});

test("regex mode keeps regex parens in the term, still groups query syntax", () => {
  assert.deepEqual(parseQuery("(foo|bar)baz", { regex: true }), re("(foo|bar)baz"));
  assert.deepEqual(parseQuery("(file:a or file:b)", { regex: true }), {
    or: { children: [re("a", { file_name: true }), re("b", { file_name: true })] },
  });
});

test("hostile text stays inside one leaf and cannot add an alternative", () => {
  const q = parseQuery('"x) or (repo:secret"');
  assert.deepEqual(q, sub("x) or (repo:secret"));
});

test("unbalanced parens, trailing or and unclosed quotes are plain terms (v6 parity)", () => {
  assert.deepEqual(parseQuery("(a"), sub("(a"));
  assert.deepEqual(parseQuery("a)"), sub("a)"));
  assert.deepEqual(parseQuery("a or"), { and: { children: [sub("a"), sub("or")] } });
  assert.deepEqual(parseQuery('"abc'), sub('"abc'));
});

test("syntax errors", () => {
  assert.throws(() => parseQuery("file:"), QuerySyntaxError);
  assert.throws(() => parseQuery("fork:maybe"), QuerySyntaxError);
  assert.throws(() => parseQuery("   "), QuerySyntaxError);
  assert.throws(() => parseQuery("(a \\))"), QuerySyntaxError);
  assert.throws(() => parseQuery("context:x"), SearchContextNotFoundError);
});

test("context: expands to a repo set", () => {
  assert.deepEqual(parseQuery("context:web", { contexts: { web: ["a", "b"] } }), { repo_set: { set: { a: true, b: true } } });
});

test("empty group matches nothing", () => {
  assert.deepEqual(parseQuery("()"), { const: false });
});

test("regex mode: negated non-group parens are not silently turned positive", () => {
  assert.deepEqual(parseQuery("-(foo|bar)", { regex: true }), re("-(foo|bar)"));
  assert.deepEqual(parseQuery("-(file:a or file:b)", { regex: true }), {
    not: { child: { or: { children: [re("a", { file_name: true }), re("b", { file_name: true })] } } },
  });
});

test("escaped parens and character classes do not close groups", () => {
  assert.deepEqual(parseQuery("foo\\)", { regex: true }), re("foo\\)"));
  assert.deepEqual(parseQuery("[)]", { regex: true }), re("[)]"));
  assert.deepEqual(parseQuery("file:foo\\)", { regex: true }), re("foo\\)", { file_name: true }));
});
