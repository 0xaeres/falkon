import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchResponse } from "@falkon/contracts";
import { SearchResults } from "../src/features/search/search-view";

const result = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  files: [
    {
      repo: "github.com/acme/app",
      path: "src/a.ts",
      branches: ["main"],
      matches: [
        {
          lineNumber: 3,
          text: "const needle = 1; // <b>",
          ranges: [[6, 12]],
          fileNameMatch: false,
        },
        {
          lineNumber: 0,
          text: "src/a.ts",
          ranges: [[4, 5]],
          fileNameMatch: true,
        },
      ],
    },
  ],
  fileCount: 1,
  matchCount: 2,
  durationMs: 7,
  isSearchExhaustive: true,
  ...over,
});

test("results are grouped by file with highlighted lines, counts and escaped text", () => {
  const html = renderToStaticMarkup(<SearchResults result={result()} />);
  assert.match(html, /github\.com\/acme\/app/);
  assert.match(html, /src\/a\.ts/);
  assert.match(html, /const <mark>needle<\/mark> = 1; \/\/ &lt;b&gt;/);
  assert.match(html, /\(file name match\)/);
  assert.match(html, /2 matches in 1 file/);
  assert.ok(!html.includes("2+"));
});

test("a non-exhaustive result shows a plus and an empty result says so", () => {
  assert.match(
    renderToStaticMarkup(
      <SearchResults result={result({ isSearchExhaustive: false })} />,
    ),
    /2\+ matches/,
  );
  assert.match(
    renderToStaticMarkup(
      <SearchResults
        result={result({ files: [], fileCount: 0, matchCount: 0 })}
      />,
    ),
    /No matches/,
  );
});
