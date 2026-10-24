import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, searchQuerySchema, searchResponseSchema } from "./index";

test("search query: limit defaults to 500 and caps at 5000; toggles are 0 or 1", () => {
  assert.equal(searchQuerySchema.parse({ q: "x" }).limit, SEARCH_DEFAULT_LIMIT);
  assert.equal(searchQuerySchema.parse({ q: "x", limit: "999999" }).limit, SEARCH_MAX_LIMIT);
  assert.equal(searchQuerySchema.safeParse({ q: "x", regex: "yes" }).success, false);
  assert.equal(searchQuerySchema.safeParse({ q: "x", limit: "0" }).success, false);
  assert.equal(searchQuerySchema.safeParse({ q: "x", extra: "1" }).success, false);
  assert.equal(searchQuerySchema.safeParse({ q: "x".repeat(2001) }).success, false);
});

test("search response keeps the grouped file shape and drops engine-only fields", () => {
  const match = { lineNumber: 3, text: "needle", ranges: [[0, 6]], fileNameMatch: false };
  const r = searchResponseSchema.parse({ files: [{ repo: "h/o/r", path: "a.ts", branches: ["main"], chunks: [], matches: [match] }], fileCount: 1, matchCount: 1, durationMs: 4, isSearchExhaustive: true, crashes: 0 });
  assert.deepEqual(r.files[0], { repo: "h/o/r", path: "a.ts", branches: ["main"], matches: [match] });
});
