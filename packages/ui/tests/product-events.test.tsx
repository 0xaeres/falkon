import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, mock, afterEach } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReconnectingNotice } from "../src/components/layout/reconnecting-notice";
import { connectProductEvents, visibleStatusError } from "../src/lib/use-product-events";
import { keys } from "../src/lib/api/client";
import { makeStatus, seedProducts } from "./mock-fixtures";

afterEach(() => mock.timers.reset());

class FakeSource {
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (e: { data: string }) => void>();
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(name: string, l: (e: { data: string }) => void) {
    this.listeners.set(name, l);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}
const status = makeStatus(seedProducts[0]);
const thread = { id: "t1", productId: seedProducts[0].id, title: "Q", updatedAt: 1 };
function connect() {
  FakeSource.all = [];
  const events: [string, unknown][] = [];
  const states: boolean[] = [];
  const close = connectProductEvents(
    "/api/products/p/events",
    (name, data) => events.push([name, data]),
    (connected) => void states.push(connected),
    { EventSource: FakeSource, setTimeout, clearTimeout },
  );
  return { events, states, close, source: () => FakeSource.all.at(-1)! };
}

test("events are parsed with the contract schemas: status, threads, and a new thread pushed on the stream", () => {
  const c = connect();
  c.source().open();
  c.source().emit("status", status);
  c.source().emit("threads", []);
  c.source().emit("threads", [thread]);
  c.source().emit("status", { nonsense: true });
  c.source().emit("threads", "not json");
  assert.deepEqual(c.events, [["status", status], ["threads", []], ["threads", [thread]]]);
  c.close();
});

test("the notice state: failed once the stream drops, open again on the next open", () => {
  const c = connect();
  c.source().open();
  c.source().fail(0); // connection dropped; the browser reconnects by itself
  c.source().open();
  assert.deepEqual(c.states, [true, false, true]);
  c.close();
});

test("a refused reconnect closes the source for good; it is reopened with backoff, and the backoff resets on success", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  FakeSource.all = [];
  const c = connect();
  const first = c.source();
  first.open();
  first.fail(2);
  assert.equal(first.closed, true);
  assert.equal(FakeSource.all.length, 1);
  mock.timers.tick(999);
  assert.equal(FakeSource.all.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeSource.all.length, 2, "reopened after 1 s");
  c.source().fail(2);
  mock.timers.tick(1999);
  assert.equal(FakeSource.all.length, 2);
  mock.timers.tick(1);
  assert.equal(FakeSource.all.length, 3, "then after 2 s");
  c.source().open();
  c.source().fail(2);
  mock.timers.tick(1000);
  assert.equal(FakeSource.all.length, 4, "a successful open resets the delay");
  c.close();
  assert.equal(c.source().closed, true);
});

test("a first connect that is refused is retried too, with the delay capped at 30 s; closing stops a pending retry", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const c = connect();
  for (const delay of [1000, 2000, 4000, 8000, 15000, 30000, 30000]) {
    const n = FakeSource.all.length;
    c.source().fail(2);
    mock.timers.tick(delay - 1);
    assert.equal(FakeSource.all.length, n);
    mock.timers.tick(1);
    assert.equal(FakeSource.all.length, n + 1, `reopened after ${delay} ms`);
  }
  c.source().fail(2);
  c.close();
  const n = FakeSource.all.length;
  mock.timers.tick(120_000);
  assert.equal(FakeSource.all.length, n, "no reopen after close");
});

test("a lost stream never replaces a page once a status has loaded; before that the error shows", () => {
  const error = new Error("down");
  assert.equal(visibleStatusError(status, error), undefined);
  assert.equal(visibleStatusError(undefined, error), error);
  assert.equal(visibleStatusError(undefined, undefined), undefined);
});

test("the Reconnecting notice is a status message, and the events key is the proxied stream", () => {
  assert.match(renderToStaticMarkup(<ReconnectingNotice />), /role="status"[^>]*>Reconnecting/);
  assert.equal(keys.events("a b"), "/api/products/a%20b/events");
});

test("no polling remains in packages/ui/src: no refreshInterval, and the one setInterval is the local minute timer", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(join(import.meta.dirname, "../src"));
  const hits = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => f.split("/src/")[1]);
  assert.deepEqual(hits(/refreshInterval/), []);
  assert.deepEqual(hits(/setInterval/), ["lib/use-minute.ts"]);
});
