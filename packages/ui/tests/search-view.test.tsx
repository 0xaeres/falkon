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

test("overlapping, unsorted and out-of-range ranges never duplicate characters", () => {
  const line = (ranges: [number, number][]) =>
    renderToStaticMarkup(
      <SearchResults
        result={result({
          files: [
            {
              repo: "r",
              path: "p",
              branches: [],
              matches: [
                { lineNumber: 1, text: "abcdef", ranges, fileNameMatch: false },
              ],
            },
          ],
        })}
      />,
    );
  const text = (html: string) =>
    html
      .match(/search-line[^>]*>.*?<span>(.*?)<\/span><\/div>/)![1]
      .replace(/<\/?mark>/g, "");
  assert.match(
    line([
      [3, 5],
      [0, 2],
    ]),
    /<mark>ab<\/mark>c<mark>de<\/mark>f/,
  );
  assert.match(
    line([
      [0, 4],
      [2, 5],
    ]),
    /<mark>abcd<\/mark><mark>e<\/mark>f/,
  );
  assert.match(line([[4, 99]]), /abcd<mark>ef<\/mark>/);
  assert.match(
    line([
      [3, 3],
      [5, 2],
      [-4, 1],
    ]),
    /<mark>a<\/mark>bcdef/,
  );
  for (const r of [
    [
      [3, 5],
      [0, 2],
    ],
    [
      [0, 4],
      [2, 5],
    ],
    [[4, 99]],
    [
      [3, 3],
      [5, 2],
    ],
  ] as [number, number][][])
    assert.equal(text(line(r)), "abcdef");
});
