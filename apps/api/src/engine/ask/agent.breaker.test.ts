// R1 to R5 through the real agent: a scripted OpenAI-compatible model, the process-wide breaker, a mocked monotonic clock.
import { test, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { scopeFor } from "@falkon/shared";
import { createMessageStream } from "./agent";
import { breaker, MAX_CONCURRENT, OPEN_MS } from "./breaker";
import { chatName } from "./chat";
import { fakeOpenAi } from "./fakeOpenAi";
import { AskError } from "./errors";

const user = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What does it do?" }] };
let url = "";
const model = () => ({ provider: "openai-compatible", model: "m", baseUrl: url });
const fake = await fakeOpenAi();
url = fake.url;

let clock = 1_000;
beforeEach(() => {
  breaker.reset();
  clock = 1_000;
  mock.method(performance, "now", () => clock);
});
afterEach(() => mock.restoreAll());
after(() => fake.close());

/** Admits (as the callers do, before storing anything) and runs a turn; a refusal throws. */
const turn = async (o: { abortSignal?: AbortSignal; postProcess?: () => Promise<never[]>; messages?: typeof user[] } = {}) =>
  createMessageStream({ audience: "human", messages: [user], selectedRepos: [], scope: scopeFor(["*"]), model: model(), permit: breaker.admit(model()), ...o });
async function drainAll(stream: ReadableStream) {
  const r = stream.getReader();
  try { while (!(await r.read()).done); } catch { /* an errored stream still ends the turn */ }
}
const run = async (o?: Parameters<typeof turn>[0]) => drainAll(await turn(o));
/** The refusal a new turn gets, or undefined when it was admitted (it is then run to its end). */
const refused = async () => turn().then((s) => drainAll(s), (e: unknown) => e as AskError) as Promise<AskError | undefined>;
/** True when every slot of the model is free (eight can be taken at once). */
function slotsFree() {
  const held: { release(): void }[] = [];
  try { for (let i = 0; i < MAX_CONCURRENT; i++) held.push(breaker.admit(model())); return true; } catch { return false; } finally { held.forEach((h) => h.release()); }
}
const until = async (cond: () => boolean) => { for (let i = 0; i < 150 && !cond(); i++) await new Promise((r) => setTimeout(r, 20)); assert(cond(), "condition not met in time"); };

test("5 failing turns open the breaker: the sixth is refused 503 MODEL_UNAVAILABLE with retry-after and the model is not called", async () => {
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  const asked = fake.requests.length;
  const e = await refused();
  assert.deepEqual([e?.statusCode, e?.errorCode, e?.retryAfter], [503, "MODEL_UNAVAILABLE", Math.ceil(e!.retryAfter!)]);
  assert.ok(e!.retryAfter! >= 24 && e!.retryAfter! <= 36);
  assert.equal(fake.requests.length, asked, "a refused turn makes no model call");
});

test("a 503 from the provider (after the SDK's own retries) counts; a 401 never does", async () => {
  fake.play([{ status: 401 }]);
  for (let i = 0; i < 8; i++) await run();
  assert.equal(await refused(), undefined, "bad key: still closed");
  assert.equal(slotsFree(), true, "and no slot leaked");
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  assert.equal((await refused())?.errorCode, "MODEL_UNAVAILABLE");
});

test("an error event in the stream is not classified: five such turns neither open the breaker nor leak a slot", async () => {
  fake.play([{ fail: "partial" }]);
  for (let i = 0; i < 6; i++) await run();
  assert.equal(await refused(), undefined);
  assert.equal(slotsFree(), true);
});

test("a recovering model: after the open time one probe goes through, a concurrent caller is refused, success closes", async () => {
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  clock += OPEN_MS * 1.2 + 1;
  const hold = Promise.withResolvers<string>();
  fake.play([{ hang: "<!--answer-->\nok", rest: hold.promise }]);
  const probe = await turn();
  assert.equal((await refused())?.retryAfter, 5, "second half-open caller");
  hold.resolve("");
  await drainAll(probe);
  fake.play([{ text: "<!--answer-->\nfine" }]);
  await run();
  await run();
  assert.equal(await refused(), undefined, "closed");
});

test("a probe that fails reopens for a fresh open time", async () => {
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  clock += OPEN_MS * 1.2 + 1;
  await run();
  const e = await refused();
  assert.ok(e!.retryAfter! >= 24);
});

test("a probe that never finishes does not wedge the breaker: Stop frees the permit and the next caller probes", async () => {
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  clock += OPEN_MS * 1.2 + 1;
  fake.play([{ hang: "never" }]);
  const stop = new AbortController();
  const probe = turn({ abortSignal: stop.signal }).then(drainAll);
  assert.equal((await refused())?.retryAfter, 5);
  stop.abort();
  await probe;
  fake.play([{ text: "<!--answer-->\nback" }]);
  await run();
  assert.equal(await refused(), undefined, "the abort counted as neither; the next probe succeeded and closed it");
});

test("slots are released on finish, model failure, a thrown postProcess, a failure before the stream, abort and a cancelled stream", async () => {
  fake.play([{ text: "<!--answer-->\nhi" }]);
  for (let i = 0; i < 4; i++) await run();
  assert.equal(slotsFree(), true, "finish");

  fake.play([{ status: 503 }]);
  for (let i = 0; i < 4; i++) await run();
  assert.equal(slotsFree(), true, "model failure");

  fake.play([{ fail: "x" }]);
  for (let i = 0; i < 4; i++) await run();
  assert.equal(slotsFree(), true, "unclassified error");

  breaker.reset();
  fake.play([{ text: "<!--answer-->\nhi" }]);
  for (let i = 0; i < 4; i++) await run({ postProcess: async () => { throw new Error("boom"); } });
  assert.equal(slotsFree(), true, "thrown postProcess");

  for (let i = 0; i < 4; i++) await createMessageStream({ audience: "human", messages: [user], selectedRepos: [], scope: scopeFor(["*"]), model: { ...model(), baseUrl: undefined }, permit: breaker.admit(model()) }).catch(() => undefined);
  assert.equal(slotsFree(), true, "model cannot be built");

  fake.play([{ hang: "slow" }]);
  for (let i = 0; i < 4; i++) {
    const stop = new AbortController();
    const done = turn({ abortSignal: stop.signal }).then(drainAll);
    await until(() => fake.requests.length > i);
    stop.abort();
    await done;
  }
  await until(slotsFree);

  fake.play([{ hang: "slow" }]);
  for (let i = 0; i < 4; i++) {
    const r = (await turn()).getReader();
    await r.read();
    await r.cancel();
  }
  await until(slotsFree);
});

test("a ninth concurrent turn is refused with retry-after 5 and a stopped turn frees its slot", async () => {
  fake.play([{ hang: "slow" }]);
  const stops = Array.from({ length: MAX_CONCURRENT }, () => new AbortController());
  const turns = await Promise.all(stops.map((s) => turn({ abortSignal: s.signal })));
  const e = await refused();
  assert.deepEqual([e?.errorCode, e?.retryAfter], ["MODEL_UNAVAILABLE", 5]);
  stops.forEach((s) => s.abort());
  await Promise.all(turns.map(drainAll));
  await until(slotsFree);
});

test("naming is skipped while the breaker is open (no model call, no error), and still runs at the cap, taking no slot", async () => {
  const before = fake.nameRequests;
  assert.equal(await chatName("q", model()), "A title");
  assert.equal(fake.nameRequests, before + 1);
  fake.play([{ status: 503 }]);
  for (let i = 0; i < 5; i++) await run();
  assert.equal(await chatName("q", model()), undefined);
  assert.equal(fake.nameRequests, before + 1);
  breaker.reset();
  const held = Array.from({ length: MAX_CONCURRENT }, () => breaker.admit(model()));
  assert.equal(await chatName("q", model()), "A title", "the eighth turn's own slot does not stop it naming");
  held.forEach((h) => h.release());
  assert.equal(slotsFree(), true, "naming held no slot");
});

test("naming failures count against the model; a client error does not", async () => {
  fake.setTitle(null);
  for (let i = 0; i < 6; i++) await chatName("q", model()).catch(() => undefined);
  assert.equal(await refused(), undefined, "400s do not count");
  fake.setTitle("A title");
});
