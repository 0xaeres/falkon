import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveAnswers } from "./liveAnswers";

const enc = new TextEncoder();
const text = async (r: Response | undefined) =>
  r ? await r.text() : undefined;

/** A turn whose chunks the test pushes by hand. */
function turn() {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (x) => void (c = x) });
  return {
    make: async () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push: (s: string) => c.enqueue(enc.encode(s)),
    end: () => c.close(),
    fail: (e: Error) => c.error(e),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test("a make() that throws releases the thread: the error reaches the caller and a retry is not refused", async () => {
  const live = new LiveAnswers();
  await assert.rejects(
    live.start("t", async () => Promise.reject(new Error("no model"))),
    /no model/,
  );
  assert.equal(await live.read("t"), undefined);
  const t = turn();
  const first = await live.start("t", t.make);
  assert.ok(first, "a retry on the same id starts");
  t.end();
  await first!.text();
});

test("a stream error mid-answer ends the turn: the buffer is released and a resume is undefined", async () => {
  const live = new LiveAnswers();
  const errors = console.error;
  console.error = () => undefined;
  try {
    const t = turn();
    const r = (await live.start("t", t.make))!;
    t.push("a");
    t.fail(new Error("model died"));
    assert.equal(
      await text(r),
      "a",
      "the reader gets what was produced, then the end",
    );
    await tick();
    assert.equal(await live.read("t"), undefined);
    const again = turn();
    assert.ok(
      await live.start("t", again.make),
      "the next turn is not refused",
    );
    again.end();
  } finally {
    console.error = errors;
  }
});

test("two readers get the same chunks from the first one; a cancelled reader does not block a later one", async () => {
  const live = new LiveAnswers();
  const t = turn();
  const first = (await live.start("t", t.make))!;
  t.push("one,");
  const late = (await live.read("t"))!;
  const dropped = (await live.read("t"))!.body!.getReader();
  await dropped.read();
  await dropped.cancel();
  t.push("two");
  t.end();
  assert.deepEqual(
    [await first.text(), await late.text()],
    ["one,two", "one,two"],
  );
  assert.equal(await live.read("t"), undefined, "released once it ended");
});

test("a second start on a running thread is refused, also while the first is still starting", async () => {
  const live = new LiveAnswers();
  let release!: () => void;
  const t = turn();
  const starting = live.start("t", async () => {
    await new Promise<void>((r) => (release = r));
    return t.make();
  });
  assert.equal(await live.start("t", t.make), undefined);
  const resumed = live.read("t");
  release();
  t.push("x");
  t.end();
  assert.equal(
    await text(await resumed),
    "x",
    "a resume in the starting window waits for the turn rather than seeing none",
  );
  assert.equal(await (await starting)!.text(), "x");
});

test("stop aborts the signal make() was given", async () => {
  const live = new LiveAnswers();
  let signal!: AbortSignal;
  const t = turn();
  await live.start("t", async (s) => ((signal = s), t.make()));
  live.stop("t");
  assert.equal(signal.aborted, true);
  t.end();
});
