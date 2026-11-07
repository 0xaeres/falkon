import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { currentMinute, subscribeMinute } from "../src/lib/use-minute";

test("the minute tick fires once a minute, locally, and stops when unsubscribed", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.parse("2026-10-20T23:59:30Z") });
  const before = currentMinute();
  let ticks = 0;
  const off = subscribeMinute(() => ticks++);
  mock.timers.tick(59_000);
  assert.equal(ticks, 0);
  mock.timers.tick(1_000);
  assert.equal(ticks, 1);
  assert.equal(currentMinute() - before, 60_000, "the snapshot advances across midnight");
  off();
  mock.timers.tick(120_000);
  assert.equal(ticks, 1);
  mock.timers.reset();
});
