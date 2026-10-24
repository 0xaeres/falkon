import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Diagram } from "@falkon/contracts";
import { Markdown } from "../src/features/chat/markdown";
import { viewBoxOf } from "../src/features/chat/archify-block";

const source = '{"schema_version":2,"diagram_type":"workflow","meta":{"title":"Loop"}}';
const diagram: Diagram = {
  type: "workflow",
  html: '<!doctype html><svg viewBox="0 0 800 400"></svg><script>window.x=1</script>',
  source,
};
const fence = "```archify\n" + source + "\n```";
const render = (text: string, final = true, diagrams: Diagram[] = [diagram]) => renderToStaticMarkup(<Markdown text={text} final={final} diagrams={diagrams} />);

test("a finished archify fence shows the rendered diagram in a sandboxed iframe with the toolbar", () => {
  const html = render(fence);
  assert.match(html, /<iframe[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.match(html, /srcDoc|srcdoc/i);
  assert.match(html, /aspect-ratio:\s*800 \/ 540/);
  for (const label of ["View source", "Copy source", "Download HTML", "Open full screen"]) assert.match(html, new RegExp(`aria-label="${label}"`));
});

test("while streaming the fence stays code, and so does a fence with no matching diagram", () => {
  assert.doesNotMatch(render(fence, false), /<iframe/);
  assert.match(render(fence, false), /class="code-lang">archify</);
  const none = render(fence, true, []);
  assert.doesNotMatch(none, /<iframe/);
  assert.match(none, /class="code-lang">archify</);
  assert.match(none, /diagram_type/);
});

test("mermaid fences are unchanged", () => {
  assert.match(render("```mermaid\ngraph TD; A-->B\n```", false), /class="code-lang">mermaid</);
});

test("viewBoxOf reads the first svg's size and has a fallback", () => {
  assert.deepEqual(viewBoxOf(diagram.html), { width: 800, height: 400 });
  assert.deepEqual(viewBoxOf("<p>x</p>"), { width: 16, height: 9 });
});
