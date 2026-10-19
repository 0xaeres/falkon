import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapCI, scoreAnswer } from "./score.js";

const gold = [{ path: "a/x.ts", startLine: 10, endLine: 19 }];

test("a span covers gold when paths match, lines overlap and the span is at most 3x gold width + 20", () => {
  assert.deepEqual(scoreAnswer(gold, [{ path: "a/x.ts", startLine: 15, endLine: 40 }]), { recall: 1, precision: 1 });
  assert.equal(scoreAnswer(gold, [{ path: "a/x.ts", startLine: 1, endLine: 60 }]).recall, 0);
  assert.equal(scoreAnswer(gold, [{ path: "a/y.ts", startLine: 10, endLine: 19 }]).recall, 0);
  assert.equal(scoreAnswer(gold, [{ path: "a/x.ts", startLine: 20, endLine: 25 }]).recall, 0);
});

test("malformed answers score zero and accepted spans count towards precision only", () => {
  const span = { path: "a/z.ts", startLine: 1, endLine: 5 };
  assert.deepEqual(scoreAnswer(gold, [span], true), { recall: 0, precision: 0 });
  assert.deepEqual(scoreAnswer(gold, [span, { path: "a/x.ts", startLine: 10, endLine: 19 }], false, [span]), { recall: 1, precision: 1 });
});

test("bootstrapCI is reproducible for a seed and brackets the mean", () => {
  const values = [0, 1, 1, 0.5, 1, 1, 0, 1];
  const a = bootstrapCI(values, 20261017), b = bootstrapCI(values, 20261017);
  assert.deepEqual(a, b);
  assert.equal(a.mean, 0.6875);
  assert.ok(a.lo <= a.mean && a.mean <= a.hi);
});
