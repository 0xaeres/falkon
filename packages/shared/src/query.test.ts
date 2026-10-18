import { test } from "node:test";
import assert from "node:assert/strict";
import { translateQuery } from "./query";

test("literal term escapes regex chars", () => {
  assert.equal(translateQuery("foo.bar"), "foo\\x2ebar");
});

test("regex mode passes through", () => {
  assert.equal(translateQuery("foo.*bar", { regex: true }), "foo.*bar");
});

test("phrase becomes single term", () => {
  assert.equal(translateQuery('"hello world"'), "hello\\x20world");
});

test("filters map, rev -> branch", () => {
  assert.equal(translateQuery("file:src rev:main lang:go"), "file:src branch:main lang:go");
});

test("or, groups, negation", () => {
  assert.equal(translateQuery("foo (bar or baz) -file:test"), "foo ( bar or baz ) -file:test");
  assert.equal(translateQuery("-(a or b)"), "-( a or b )");
});

test("or inside quotes is a term", () => {
  assert.equal(translateQuery('"or"'), "or");
});
