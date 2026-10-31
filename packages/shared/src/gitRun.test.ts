import { test } from "node:test";
import assert from "node:assert/strict";
import { cutMiddle } from "./gitRun";

const len = (s: string) => Buffer.byteLength(s);

test("cutMiddle: text at or under the cap is returned as it is; one byte over is cut", () => {
  const exact = "a\n".repeat(500);
  assert.equal(cutMiddle(exact, 1000), exact);
  const over = exact + "b";
  const cut = cutMiddle(over, 1000);
  assert.notEqual(cut, over);
  assert.match(cut, /1 bytes removed/);
});

test("cutMiddle: keeps the first 75% and the last 25% of the cap and states the removed byte count", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${String(i).padStart(4, "0")}\n`).join(""); // 10 bytes each: 4000
  const cut = cutMiddle(lines, 1000);
  assert.ok(cut.startsWith(lines.slice(0, 750)));
  assert.ok(cut.endsWith(lines.slice(-250)));
  assert.match(cut, /3000 bytes removed/);
  assert.ok(len(cut) <= 1000 + 200, "cap plus marker");
});

test("cutMiddle: never splits a multi-byte character", () => {
  for (const ch of ["é", "€", "😀"]) {
    for (let pad = 0; pad < 5; pad++) {
      const s = "x".repeat(pad) + ch.repeat(3000);
      const cut = cutMiddle(s, 1000);
      assert.ok(!cut.includes("�"), `${ch} ${pad}`);
      assert.ok(len(cut) <= 1000 + 200);
    }
  }
});

test("cutMiddle: says when a line is cut, and stays silent about it when the cuts fall on line ends", () => {
  assert.match(cutMiddle("y".repeat(5000), 1000), /may be partial/);
  const clean = "ab\n".repeat(2000); // cap 1200: head 900 = 300 whole lines, tail 300 = 100 whole lines
  assert.doesNotMatch(cutMiddle(clean, 1200), /may be partial/);
});
