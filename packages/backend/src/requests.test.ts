import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { memorySignals } from "@falkon/shared";
import { announceJobs, coalesce } from "./requests";

const tick = () => new Promise((r) => setImmediate(r));

test("a request signal runs the claims at once, without a tick", async () => {
  const s = memorySignals();
  let runs = 0;
  s.onRequest(coalesce(async () => void runs++, () => {}));
  s.request();
  await tick();
  assert.equal(runs, 1);
});

test("a burst while a run is in flight starts no second concurrent run, and one more pass follows", async () => {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const run = coalesce(async () => {
    runs++;
    maxActive = Math.max(maxActive, ++active);
    if (runs === 1) await gate;
    active--;
  }, () => {});
  for (let i = 0; i < 50; i++) run();
  await tick();
  assert.equal(runs, 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs, 2); // the burst is covered by exactly one more pass
  assert.equal(maxActive, 1);
});

test("a failing run is reported and does not stop later runs", async () => {
  const errors: unknown[] = [];
  let runs = 0;
  const run = coalesce(async () => {
    if (++runs === 1) throw new Error("db down");
  }, (e) => errors.push(e));
  run();
  await tick();
  run();
  await tick();
  assert.equal(errors.length, 1);
  assert.equal(runs, 2);
});

test("each worker's active, completed and failed events publish changed", () => {
  const s = memorySignals();
  let changed = 0;
  s.onChanged(() => changed++);
  const a = new EventEmitter();
  const b = new EventEmitter();
  announceJobs([a, b], s);
  for (const w of [a, b]) for (const ev of ["active", "completed", "failed"]) w.emit(ev);
  assert.equal(changed, 6);
});
