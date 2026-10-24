import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { HttpException } from "@nestjs/common";
import { memorySignals, type Signals } from "@falkon/shared";
import { createAdminApp } from "./admin";
import { ProductEvents, type Sink } from "./events";
import { error } from "./request";

afterEach(() => mock.timers.reset());

const status = (productId: string, sentence = "s") => ({ productId, verdict: "Current", sentence, generation: null, generationAt: null, nextGeneration: null, build: "idle", stage: 4, progress: 1, sync: "current", gaps: [], scenario: "current" });
const thread = (id: string) => ({ id, productId: "alpha", title: "Q", updatedAt: 1 });

/** Stub reads: per-Product mutable state, a call counter, and a deleted list. */
function world(slugs = ["alpha", "beta"]) {
  const state = new Map(slugs.map((s) => [s, { sentence: "s", threads: [] as ReturnType<typeof thread>[] }]));
  const calls = { status: new Map<string, number>(), list: new Map<string, number>() };
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const must = (slug: string) => state.get(slug) ?? (() => { throw error(404, "NOT_FOUND", "Product not found."); })();
  return {
    state, calls,
    ui: { status: async (slug: string) => (count(calls.status, slug), status(slug, must(slug).sentence)) } as never,
    threads: { list: async (slug: string) => (count(calls.list, slug), must(slug).threads) } as never,
  };
}
const sink = () => {
  const out = { frames: [] as string[], ended: false };
  return { out, sink: { write: (c: string) => out.frames.push(c), end: () => (out.ended = true) } satisfies Sink };
};
const names = (frames: string[]) => frames.map((f) => f.split("\n")[0]);
const settle = () => new Promise((r) => setImmediate(r));
const WINDOW = 500;
/** Counts live change-signal subscriptions. */
function counted(): { signals: Signals; live: () => number } {
  const signals = memorySignals();
  let live = 0;
  return { signals: { ...signals, onChanged: (cb) => { live++; const off = signals.onChanged(cb); return () => (live--, off()); } }, live: () => live };
}

test("a new stream is sent the status and the thread list first", async () => {
  const w = world();
  w.state.get("alpha")!.threads = [thread("t1")];
  const events = new ProductEvents(w.ui, w.threads, memorySignals());
  const a = sink();
  await events.open("alpha", a.sink, () => {});
  assert.deepEqual(names(a.out.frames), ["event: status", "event: threads"]);
  assert.deepEqual(JSON.parse(a.out.frames[1]!.split("data: ")[1]!), [thread("t1")]);
});

test("a signal sends only what changed, and nothing when nothing changed", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  const events = new ProductEvents(w.ui, w.threads, signals);
  const a = sink();
  await events.open("alpha", a.sink, () => {});
  a.out.frames.length = 0;

  signals.changed();
  await settle();
  assert.deepEqual(a.out.frames, [], "signal that changes nothing");

  mock.timers.tick(WINDOW);
  await settle();
  w.state.get("alpha")!.sentence = "changed";
  signals.changed();
  await settle();
  assert.deepEqual(names(a.out.frames), ["event: status"], "status changed, thread list did not");
  assert.match(a.out.frames[0]!, /"sentence":"changed"/);

  mock.timers.tick(WINDOW);
  await settle();
  w.state.get("alpha")!.threads = [thread("t9")];
  signals.changed();
  await settle();
  assert.deepEqual(names(a.out.frames), ["event: status", "event: threads"], "a thread pushed on the stream");
});

test("many streams and a burst of signals: one recompute per Product per coalescing window", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  const events = new ProductEvents(w.ui, w.threads, signals);
  for (let i = 0; i < 5; i++) await events.open("alpha", sink().sink, () => {});
  w.calls.status.clear();
  w.calls.list.clear();

  for (let i = 0; i < 20; i++) signals.changed();
  await settle();
  assert.equal(w.calls.status.get("alpha"), 1, "leading recompute at once");
  mock.timers.tick(WINDOW);
  await settle();
  assert.equal(w.calls.status.get("alpha"), 2, "the burst during the window gets one trailing recompute");
  mock.timers.tick(WINDOW);
  await settle();
  assert.equal(w.calls.status.get("alpha"), 2, "and then nothing more");
  assert.equal(w.calls.list.get("alpha"), 2);
});

test("a Product nobody watches is never recomputed; another Product's events never arrive", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  const events = new ProductEvents(w.ui, w.threads, signals);
  const a = sink();
  await events.open("alpha", a.sink, () => {});
  w.calls.status.clear();
  a.out.frames.length = 0;
  w.state.get("beta")!.sentence = "beta changed";
  signals.changed();
  await settle();
  assert.equal(w.calls.status.get("beta"), undefined);
  assert.deepEqual(a.out.frames, []);
});

test("the change signal is subscribed only while a stream is open; a closed stream is removed", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const c = counted();
  const events = new ProductEvents(w.ui, w.threads, c.signals);
  assert.equal(c.live(), 0);
  const a = sink();
  const b = sink();
  const closeA = await events.open("alpha", a.sink, () => {});
  const closeB = await events.open("alpha", b.sink, () => {});
  assert.equal(c.live(), 1, "one subscription for all streams");
  closeA();
  w.state.get("alpha")!.sentence = "x";
  c.signals.changed();
  await settle();
  assert.equal(a.out.frames.length, 2, "nothing after close");
  assert.equal(b.out.frames.length, 3);
  closeB();
  assert.equal(c.live(), 0);
  w.calls.status.clear();
  mock.timers.tick(WINDOW);
  c.signals.changed();
  await settle();
  assert.equal(w.calls.status.size, 0, "no stream, no recompute");
});

test("a keepalive comment arrives every 25 seconds and stops with the last stream", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const events = new ProductEvents(w.ui, w.threads, memorySignals());
  const a = sink();
  const close = await events.open("alpha", a.sink, () => {});
  a.out.frames.length = 0;
  mock.timers.tick(24_999);
  assert.deepEqual(a.out.frames, []);
  mock.timers.tick(1);
  assert.deepEqual(a.out.frames, [": keepalive\n\n"]);
  mock.timers.tick(25_000);
  assert.equal(a.out.frames.length, 2);
  close();
  mock.timers.tick(100_000);
  assert.equal(a.out.frames.length, 2);
});

test("a Product deleted while watched ends its streams; an unknown Product is 404 before the stream begins", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  const events = new ProductEvents(w.ui, w.threads, signals);
  const a = sink();
  const other = sink();
  await events.open("alpha", a.sink, () => {});
  await events.open("beta", other.sink, () => {});
  w.state.delete("alpha");
  signals.changed();
  await settle();
  assert.equal(a.out.ended, true);
  assert.equal(other.out.ended, false);

  let begun = false;
  await assert.rejects(events.open("nope", sink().sink, () => (begun = true)), (e) => e instanceof HttpException && e.getStatus() === 404);
  assert.equal(begun, false);
});

test("a failed recompute keeps the streams open and a later signal still delivers", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  let fail = false;
  const ui = { status: (slug: string) => (fail ? Promise.reject(new Error("db down")) : (w.ui as any).status(slug)) } as never;
  const events = new ProductEvents(ui, w.threads, signals);
  const a = sink();
  await events.open("alpha", a.sink, () => {});
  a.out.frames.length = 0;
  fail = true;
  signals.changed();
  await settle();
  assert.deepEqual([a.out.ended, a.out.frames], [false, []]);
  fail = false;
  w.state.get("alpha")!.sentence = "back";
  mock.timers.tick(WINDOW);
  signals.changed();
  await settle();
  assert.deepEqual(names(a.out.frames), ["event: status"]);
});

test("a throwing or stalled stream is dropped and ended; the others keep receiving", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const w = world();
  const signals = memorySignals();
  const events = new ProductEvents(w.ui, w.threads, signals);
  const good = sink();
  let stalled = false;
  const bad = { written: 0, ended: false, writableLength: 0 };
  const stalledSink: Sink = {
    write: () => ((bad.written++, stalled ? ((bad.writableLength = 300 * 1024), false) : true)),
    end: () => (bad.ended = true),
    get writableLength() { return bad.writableLength; },
  };
  const thrower = { ended: false };
  let boom = false;
  const throwing: Sink = { write: () => { if (boom) throw new Error("socket closed"); return true; }, end: () => (thrower.ended = true) };
  await events.open("alpha", good.sink, () => {});
  await events.open("alpha", stalledSink, () => {});
  await events.open("alpha", throwing, () => {});

  stalled = true; // a full buffer below the cap is tolerated, above it the stream goes
  bad.writableLength = 10;
  boom = true;
  w.state.get("alpha")!.sentence = "x";
  signals.changed();
  await settle();
  assert.equal(bad.ended, true, "stalled stream ended");
  assert.equal(thrower.ended, true, "throwing stream ended, no uncaught exception");
  assert.equal(good.out.ended, false);
  assert.match(good.out.frames.at(-1)!, /"sentence":"x"/);
  const written = bad.written;
  mock.timers.tick(25_000);
  assert.equal(bad.written, written, "a dropped stream gets no keepalive");
  assert.equal(good.out.frames.at(-1), ": keepalive\n\n");
});

test("HTTP: GET /ui/products/:slug/events streams state with event-stream headers; unknown Product is 404 JSON", async () => {
  const w = world(["alpha"]);
  const signals = memorySignals();
  const TOKEN = "t".repeat(40);
  const events = new ProductEvents(w.ui, w.threads, signals);
  const app = await createAdminApp({} as never, TOKEN, {}, undefined, undefined, undefined, undefined, undefined, events);
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  try {
    const missing = await fetch(`${base}/ui/products/nope/events`, { headers: auth });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type")!, /json/);
    assert.equal((await fetch(`${base}/ui/products/alpha/events`)).status, 401);

    const ctl = new AbortController();
    const res = await fetch(`${base}/ui/products/alpha/events`, { headers: auth, signal: ctl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /^text\/event-stream/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: threads")) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /^event: status\ndata: \{.*\}\n\nevent: threads\ndata: \[\]\n\n/s);
    // a client that goes away is removed from the watchers
    ctl.abort();
    for (let i = 0; i < 50 && (events as any).watchers.size; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((events as any).watchers.size, 0);
  } finally {
    await app.close();
  }
});
