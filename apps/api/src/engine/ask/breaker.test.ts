import { test } from "node:test";
import assert from "node:assert/strict";
import { APICallError, InvalidPromptError, LoadAPIKeyError, NoSuchToolError, RetryError } from "ai";
import { createBreaker, countsAsFailure } from "./breaker";
import { AskError } from "./errors";

const A = { provider: "p", model: "a" };
const B = { provider: "p", model: "b" };

function setup(random = 0.5) {
  let t = 1_000;
  const breaker = createBreaker(() => t, () => random);
  return { breaker, tick: (ms: number) => void (t += ms), set: (v: number) => void (t = v) };
}
const fail = (b: ReturnType<typeof createBreaker>, m = A) => b.admit(m).failure();
const refusal = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e as AskError; }
  assert.fail("expected a refusal");
};
const trip = (b: ReturnType<typeof createBreaker>) => { for (let i = 0; i < 5; i++) fail(b); };

test("4 failures then a success leaves it closed with the count reset; 5 consecutive failures open it", () => {
  const { breaker } = setup();
  for (let i = 0; i < 4; i++) fail(breaker);
  breaker.admit(A).success();
  for (let i = 0; i < 4; i++) fail(breaker);
  breaker.admit(A).release();
  fail(breaker); // the fifth since the reset
  const e = refusal(() => breaker.admit(A));
  assert.deepEqual([e.statusCode, e.errorCode], [503, "MODEL_UNAVAILABLE"]);
});

test("open: every call is refused with retry-after about 30 s, shrinking as time passes; the message names the seconds", () => {
  const { breaker, tick } = setup(0.5); // random 0.5 = no spread: exactly 30 s
  trip(breaker);
  const first = refusal(() => breaker.admit(A));
  assert.equal(first.retryAfter, 30);
  assert.equal(first.message, "The model is temporarily unavailable. Try again in 30 seconds.");
  tick(10_000);
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 20);
  tick(19_500);
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 1);
});

test("the open time spreads plus or minus 20 percent (24 to 36 s)", () => {
  for (const [r, s] of [[0, 24], [1, 36]] as const) {
    const { breaker } = setup(r);
    trip(breaker);
    assert.equal(refusal(() => breaker.admit(A)).retryAfter, s);
  }
});

test("after the open time exactly one probe is admitted; concurrent callers are refused", () => {
  const { breaker, tick } = setup();
  trip(breaker);
  tick(30_000);
  const probe = breaker.admit(A);
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 5, "second simultaneous half-open caller");
  assert.equal(refusal(() => breaker.admit(A)).errorCode, "MODEL_UNAVAILABLE");
  probe.success();
  breaker.admit(A).release(); // closed again
});

test("probe success closes the breaker and the count starts over", () => {
  const { breaker, tick } = setup();
  trip(breaker);
  tick(30_000);
  breaker.admit(A).success();
  for (let i = 0; i < 4; i++) fail(breaker);
  breaker.admit(A).release();
});

test("probe failure reopens for a fresh 30 s", () => {
  const { breaker, tick } = setup();
  trip(breaker);
  tick(30_000);
  breaker.admit(A).failure();
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 30);
  tick(30_000);
  breaker.admit(A).release();
});

test("a probe that ends without an outcome (abort, thrown error) frees the permit: the next caller probes, nothing wedges", () => {
  const { breaker, tick } = setup();
  trip(breaker);
  tick(30_000);
  breaker.admit(A).release();
  const next = breaker.admit(A);
  next.success();
  breaker.admit(A).release();
});

test("a permit settles once: a second call does nothing", () => {
  const { breaker } = setup();
  const p = breaker.admit(A);
  p.release();
  p.release();
  p.failure();
  for (let i = 0; i < 8; i++) breaker.admit(A);
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 5, "one slot was freed once, not twice");
});

test("a failure from a turn that started before the breaker opened does not reset the open window", () => {
  const { breaker, tick } = setup();
  const straggler = breaker.admit(A);
  trip(breaker);
  tick(10_000);
  straggler.failure();
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 20);
});

test("the clock going backwards never lengthens the wait beyond the longest open time", () => {
  const { breaker, set } = setup(1);
  trip(breaker);
  set(-5_000_000);
  assert.equal(refusal(() => breaker.admit(A)).retryAfter, 36);
});

test("the ninth concurrent turn on one model is refused with retry-after 5; another model is unaffected; a freed slot admits again", () => {
  const { breaker } = setup();
  const held = Array.from({ length: 8 }, () => breaker.admit(A));
  const e = refusal(() => breaker.admit(A));
  assert.deepEqual([e.statusCode, e.errorCode, e.retryAfter], [503, "MODEL_UNAVAILABLE", 5]);
  breaker.admit(B).release();
  held[0]!.release();
  breaker.admit(A);
});

test("naming runs only while closed, takes no slot, and its outcome counts", () => {
  const { breaker, tick } = setup();
  assert.equal(breaker.allowsNaming(A), true);
  for (let i = 0; i < 5; i++) breaker.noted(A, false);
  assert.equal(breaker.allowsNaming(A), false, "open");
  tick(30_000);
  assert.equal(breaker.allowsNaming(A), false, "half-open leaves the probe to a turn");
  breaker.admit(A).success();
  assert.equal(breaker.allowsNaming(A), true);
  const held = Array.from({ length: 8 }, () => breaker.admit(A));
  assert.equal(breaker.allowsNaming(A), true, "the eighth turn's own slot does not stop it naming");
  held.forEach((h) => h.release());
  for (let i = 0; i < 4; i++) breaker.noted(A, false);
  breaker.noted(A, true);
  assert.equal(breaker.allowsNaming(A), true);
});

test("state is per model and kept only for models that were admitted", () => {
  const { breaker } = setup();
  trip(breaker);
  assert.equal(breaker.allowsNaming(B), true);
  breaker.admit(B).release();
  assert.equal(breaker.size, 2);
  breaker.allowsNaming({ provider: "p", model: "never-seen" });
  assert.equal(breaker.size, 2);
});

test("countsAsFailure is a whitelist (R4)", () => {
  const api = (statusCode?: number) => new APICallError({ message: "m", url: "u", requestBodyValues: {}, statusCode });
  const retry = (last: unknown) => new RetryError({ message: "r", reason: "maxRetriesExceeded", errors: [last] });
  const withCause = (code: string) => Object.assign(new Error("x"), { cause: Object.assign(new Error("c"), { code }) });
  const counts: [string, unknown][] = [
    ...[500, 502, 503, 429, 408].map((s): [string, unknown] => [`status ${s}`, api(s)]),
    ["no status (connection failure)", api(undefined)],
    ["RetryError over a 503", retry(api(503))],
    ["RetryError over a network failure", retry(api(undefined))],
    ["timeout", new DOMException("timed out", "TimeoutError")],
    ["fetch failed", new TypeError("fetch failed")],
    ...["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"].map((c): [string, unknown] => [c, withCause(c)]),
  ];
  const not: [string, unknown][] = [
    ...[400, 401, 403, 404, 422].map((s): [string, unknown] => [`status ${s}`, api(s)]),
    ["RetryError over a 401", retry(api(401))],
    ["user abort", new DOMException("aborted", "AbortError")],
    ["missing key", new LoadAPIKeyError({ message: "no key" })],
    ["invalid prompt", new InvalidPromptError({ prompt: "p", message: "bad" })],
    ["unknown tool", new NoSuchToolError({ toolName: "t" })],
    ["plain Error (an app bug)", new Error("prepareStep blew up")],
    ["in-stream error event text (not classified, fail-safe)", new Error("model failed")],
    ["error event object", { message: "model failed", type: "server_error" }],
    ["other cause code", withCause("EACCES")],
  ];
  for (const [name, e] of counts) assert.equal(countsAsFailure(e), true, name);
  for (const [name, e] of not) assert.equal(countsAsFailure(e), false, name);
});
