import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, componentsFor } from "../src/features/chat/markdown";
import {
  MERMAID_MAX_CHARS,
  viewBoxOf,
  MermaidView,
  drawMermaid,
} from "../src/features/chat/mermaid-block";

const cite = (id: number) => <button className="citation">{id}</button>;
const render = (text: string, final = true) =>
  renderToStaticMarkup(
    <Markdown
      text={text}
      citations={{ 1: cite(1), 2: cite(2) }}
      final={final}
    />,
  );

test("renders heading, nested list, table and task list as GFM", () => {
  const html = render(
    "## Title\n\n- a\n  - nested\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\nuse `foo()` and [docs](https://example.com/a)",
  );
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*nested/);
  assert.match(html, /<table>[\s\S]*<th>x<\/th>[\s\S]*<td>2<\/td>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<code>foo\(\)<\/code>/);
  assert.match(
    html,
    /<a href="https:\/\/example.com\/a" target="_blank" rel="noopener noreferrer"/,
  );
});

test("fenced code is a pre with language label, copy button and no highlighter markup", () => {
  const html = render("```ts\nconst a = 1;\n```");
  assert.match(html, /<pre/);
  assert.match(html, /class="code-lang[^"]*">ts</);
  assert.match(html, /aria-label="Copy code"/);
  assert.match(html, /const a = 1;/);
});

test("mermaid fence keeps source (view/copy) and is a plain code block until drawn", () => {
  const html = render("```mermaid\ngraph TD; A-->B\n```");
  assert.match(html, /graph TD; A--&gt;B/);
  assert.match(html, /aria-label="Copy code"/);
});

test("mermaid is not drawn while streaming", () => {
  assert.doesNotMatch(
    render("```mermaid\ngraph TD; A-->B\n```", false),
    /mermaid-diagram/,
  );
});

const stub = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const api = {
    initialize: () => {},
    parse: async () => {},
    render: async () => ({ svg: "<svg>ok</svg>" }),
    ...over,
  };
  return { calls, load: async () => (calls.push("load"), api as never) };
};

test("drawMermaid returns the svg when the stub parses and renders", async () => {
  assert.equal(
    await drawMermaid("graph TD; A-->B", stub().load),
    "<svg>ok</svg>",
  );
});

test("drawMermaid returns null when parse throws", async () => {
  const s = stub({
    parse: async () => {
      throw new Error("bad");
    },
  });
  assert.equal(await drawMermaid("nonsense", s.load), null);
});

test("drawMermaid returns null for an oversize source without importing mermaid", async () => {
  const s = stub();
  assert.equal(
    await drawMermaid("a".repeat(MERMAID_MAX_CHARS + 1), s.load),
    null,
  );
  assert.deepEqual(s.calls, []);
});

test("MermaidView shows the plain code block without an svg, the diagram and View source with one", () => {
  const none = renderToStaticMarkup(
    <MermaidView source="graph TD" svg={null} />,
  );
  assert.match(none, /code-block/);
  assert.doesNotMatch(none, /mermaid-diagram|View source/);
  const drawn = renderToStaticMarkup(
    <MermaidView source="graph TD" svg="<svg>ok</svg>" />,
  );
  assert.match(drawn, /mermaid-diagram/);
  assert.match(drawn, /<svg>ok<\/svg>/);
  assert.match(drawn, /View source/);
  assert.match(drawn, /Copy source/);
});

test("components keep one identity across renders (no remount of citations, diagrams, copy state)", () => {
  assert.equal(componentsFor(true), componentsFor(true));
  assert.equal(componentsFor(false), componentsFor(false));
  assert.notEqual(componentsFor(true).pre, componentsFor(false).pre);
});

test("javascript:, data: links are not live links", () => {
  const html = render(
    "[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](mailto:x@y.z)",
  );
  assert.doesNotMatch(html, /javascript:|data:text/);
  assert.match(html, /href="mailto:x@y.z"/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
});

test("raw HTML is inert and images are not rendered", () => {
  const html = render(
    "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![pic](https://e.com/p.png)",
  );
  assert.doesNotMatch(html, /<script|<img/);
});

test("citation next to bold stays a button", () => {
  const html = render("The **refund flow** [1] posts.");
  assert.match(
    html,
    /<strong>refund flow<\/strong> <button class="citation">1<\/button>/,
  );
});

test("citation inside table cell stays a button", () => {
  assert.match(
    render("| a |\n|---|\n| x [2] |"),
    /<td>x <button class="citation">2<\/button><\/td>/,
  );
});

test("[1] inside code and mermaid stays literal, zero-width space removed", () => {
  const z = "​";
  const html = render(
    `use \`a[${z}1]\`\n\n\`\`\`js\nx[${z}1]\n\`\`\`\n\n\`\`\`mermaid\ngraph TD; A[${z}1]-->B\n\`\`\``,
  );
  assert.doesNotMatch(html, /​/);
  assert.doesNotMatch(html, /<button class="citation">/);
  assert.match(html, /a\[1\]/);
  assert.match(html, /x\[1\]/);
  assert.match(html, /A\[1\]--&gt;B/);
});

test("a literal [1] inside code is not turned into a citation even without the space", () => {
  assert.doesNotMatch(render("`x[1]`\n\n```\ny[1]\n```"), /citation/);
});

test("streaming partials do not throw", () => {
  for (const partial of [
    "```ts\nconst a =",
    "**bold",
    "- a\n  - b\n- ",
    "| a | b\n|---",
    "[link](http",
    "```mermaid\ngraph T",
    "<scr",
    "1. one\n2.",
  ])
    assert.doesNotThrow(() => render(partial, false), partial);
});

test("viewBoxOf reads a rendered diagram's natural size, zero when absent", () => {
  assert.deepEqual(viewBoxOf('<svg viewBox="0 0 640.5 1200">'), {
    width: 640.5,
    height: 1200,
  });
  assert.deepEqual(viewBoxOf("<svg>ok</svg>"), { width: 0, height: 0 });
});
