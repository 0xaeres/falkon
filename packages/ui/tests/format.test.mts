import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeTime } from "../src/lib/format";

const now = Date.parse("2026-10-20T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("relativeTime formats ISO timestamps against a clock", () => {
  assert.equal(relativeTime(ago(10_000), now), "just now");
  assert.equal(relativeTime(ago(12 * 60_000), now), "12 min ago");
  assert.equal(relativeTime(ago(2 * 3_600_000), now), "2 h ago");
  assert.equal(relativeTime(ago(30 * 3_600_000), now), "yesterday");
  assert.equal(relativeTime(ago(3 * 86_400_000), now), "3 days ago");
  assert.equal(relativeTime(ago(14 * 86_400_000), now), "2 weeks ago");
  assert.equal(relativeTime(ago(90 * 86_400_000), now), "3 months ago");
  assert.equal(relativeTime("not a date", now), "unknown");
});
