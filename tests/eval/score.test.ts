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

const change = (n: number, commit: string) => ({ repo: "openmrs-core", commit, pr: n });
const sha = (c: string) => c.repeat(40).slice(0, 40);

test("a commit matches on repo and a cited SHA prefix of at least 7 chars; a 6-char prefix or another repo does not", () => {
  const g = [change(1, sha("a"))];
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", commit: "aaaaaaa" }]).recall, 1);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", commit: sha("a") }]).recall, 1);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", commit: "AAAAAAA" }]).recall, 1);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", commit: "aaaaaa" }]).recall, 0);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", commit: "aaaaaab" }]).recall, 0);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-esm-core", commit: "aaaaaaa" }]).recall, 0);
});

test("a pull request matches on repo and number", () => {
  const g = [change(7, sha("b"))];
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", pr: 7 }]).recall, 1);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-core", pr: 8 }]).recall, 0);
  assert.equal(scoreAnswer(g, [{ repo: "openmrs-esm-core", pr: 7 }]).recall, 0);
});

test("citing one change by commit and by PR counts the unit once for recall and both items for precision", () => {
  const g = [change(7, sha("b")), change(8, sha("c"))];
  assert.deepEqual(scoreAnswer(g, [{ repo: "openmrs-core", commit: "bbbbbbb" }, { repo: "openmrs-core", pr: 7 }]), { recall: 0.5, precision: 1 });
});

// A cited prefix credits every gold unit whose SHA it prefixes, one unit per gold item (a 7-char prefix shared by two gold commits scores both).
test("a prefix shared by two gold commits credits each unit", () => {
  const g = [change(1, "abcdef1" + "0".repeat(33)), change(2, "abcdef1" + "9".repeat(33))];
  assert.deepEqual(scoreAnswer(g, [{ repo: "openmrs-core", commit: "abcdef1" }]), { recall: 1, precision: 1 });
});

test("tickets match by key, case-insensitively, as one unit each", () => {
  const g = [{ ticket: "TRUNK-1234" }, { ticket: "TRUNK-9" }];
  assert.deepEqual(scoreAnswer(g, [{ ticket: "trunk-1234" }, { ticket: "TRUNK-9" }, { ticket: "TRUNK-5" }]), { recall: 1, precision: 2 / 3 });
  assert.equal(scoreAnswer(g, [{ ticket: "Trunk-1234" }]).recall, 0.5);
});

test("recall counts gold units of every kind; empty gold of one kind does not disturb the others", () => {
  const span = { path: "a/x.ts", startLine: 10, endLine: 19 };
  const g = [span, change(7, sha("b")), { ticket: "TRUNK-1" }];
  assert.equal(scoreAnswer(g, [span, { repo: "openmrs-core", pr: 7 }]).recall, 2 / 3);
  assert.equal(scoreAnswer([change(7, sha("b"))], [{ repo: "openmrs-core", pr: 7 }]).recall, 1);
  assert.equal(scoreAnswer([{ ticket: "T-1" }], []).recall, 0);
  assert.deepEqual(scoreAnswer([], [{ ticket: "T-1" }]), { recall: 0, precision: 0 });
});

test("accepted commits, PRs and tickets count towards precision only", () => {
  const g = [change(7, sha("b"))];
  const accepted = [{ repo: "openmrs-core", commit: sha("d") }, { repo: "openmrs-core", pr: 9 }, { ticket: "TRUNK-2" }];
  assert.deepEqual(scoreAnswer(g, [{ repo: "openmrs-core", commit: "ddddddd" }, { repo: "openmrs-core", pr: 9 }, { ticket: "trunk-2" }, { repo: "openmrs-core", pr: 7 }], false, accepted), { recall: 1, precision: 1 });
  assert.deepEqual(scoreAnswer(g, [{ repo: "openmrs-core", pr: 9 }], false, []), { recall: 0, precision: 0 });
});

test("a span never matches a typed gold unit and vice versa", () => {
  assert.equal(scoreAnswer([{ ticket: "T-1" }], [{ path: "a/x.ts", startLine: 1, endLine: 1 }]).recall, 0);
  assert.equal(scoreAnswer([{ path: "a/x.ts", startLine: 1, endLine: 1 }], [{ ticket: "T-1" }]).recall, 0);
});
