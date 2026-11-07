import assert from "node:assert/strict";
import test from "node:test";
import { archifyPage } from "./archifyPage";

const viewer = '<!doctype html><html><head><style>.toolbar{}</style></head><body><button><svg viewBox="0 0 8 8"></svg></button><div class="diagram-container"><svg viewBox="0 0 800 400" data-animation="trace"><g data-node-id="a"><svg viewBox="0 0 4 4"></svg></g><path data-edge-from="a" data-edge-to="b"/></svg></div><script>window.viewer=1</script></body></html>';

test("archifyPage keeps only the diagram svg (nested svgs whole) with the palette, hover focus and height bridge", () => {
  const page = archifyPage(viewer)!;
  assert.match(page, /<body><svg viewBox="0 0 800 400" data-animation="trace"><g data-node-id="a"><svg viewBox="0 0 4 4"><\/svg><\/g><path data-edge-from="a" data-edge-to="b"\/><\/svg><script>/);
  assert.doesNotMatch(page, /window\.viewer|\.toolbar|viewBox="0 0 8 8"/);
  assert.match(page, /@keyframes flow/);
  assert.match(page, /svg\[data-focus\]/);
  assert.match(page, /archify:height/);
});

test("archifyPage is idempotent and gives undefined without a diagram", () => {
  const page = archifyPage(viewer)!;
  assert.equal(archifyPage(page), page);
  assert.equal(archifyPage("<p>none</p>"), undefined);
});
