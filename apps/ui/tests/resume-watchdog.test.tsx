import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, before, after, beforeEach, mock } from "node:test";
import { Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { Thread } from "@falkon/contracts";

const answer = {
  kind: "grounded",
  generation: "g-abc123",
  paragraphs: [{ text: "It lives here.", citations: [] }],
  gaps: [],
  partialReasons: [],
  abstention: null,
  suggestions: [],
};
const chunks = [
  { type: "start", messageId: "m1" },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "<!--answer-->\nIt lives here." },
  { type: "text-end", id: "t" },
  { type: "data-answer", data: answer },
  { type: "finish" },
];
const sse = (list: object[]) =>
  list.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

// What the fake engine does next: `post` (the first send) and `resume` (GET .../stream).
let post: "drop" | "refuse" | "unavailable";
let resume: "full" | "204" | "down";
let seen: { method?: string; url?: string }[];
const engine = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url });
  req.resume();
  const sseHead = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };
  if (req.method === "POST" && req.url?.endsWith("/stop")) return void res.writeHead(204).end();
  if (req.method === "POST") {
    if (post === "unavailable")
      return void res.writeHead(503, { "content-type": "application/json", "retry-after": "12" }).end(JSON.stringify({ statusCode: 503, errorCode: "MODEL_UNAVAILABLE", message: "The model is temporarily unavailable. Try again in 12 seconds." }));
    if (post === "refuse")
      return void res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ error: "An answer is still being written in this thread." }));
    res.writeHead(200, sseHead);
    res.write(sse(chunks.slice(0, 3)).replace("data: [DONE]\n\n", ""));
    return void setTimeout(() => res.destroy(), 20);
  }
  if (resume === "down") return void req.socket.destroy();
  if (resume === "204") return void res.writeHead(204).end();
  res.writeHead(200, sseHead).end(sse(chunks));
});

let chatTransport: typeof import("../src/lib/api/chat-transport").chatTransport;
let api: typeof import("../src/lib/api/client").api;
let ApiError: typeof import("../src/lib/api/client").ApiError;
let wd: typeof import("../src/features/chat/resume-watchdog");
before(async () => {
  await new Promise<void>((r) => engine.listen(0, "127.0.0.1", r));
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/api`;
  ({ chatTransport } = await import("../src/lib/api/chat-transport"));
  ({ api, ApiError } = await import("../src/lib/api/client"));
  wd = await import("../src/features/chat/resume-watchdog");
});
after(() => {
  engine.closeAllConnections();
  engine.close();
});
beforeEach(() => {
  post = "drop";
  resume = "full";
  seen = [];
});

const roles = (chat: Chat<UIMessage>) => chat.messages.map((m) => m.role);
const hasAnswer = (m?: UIMessage) => !!m?.parts.some((p) => p.type === "data-answer");
const dropIncomplete = (m: UIMessage[]) => (m.at(-1)?.role === "assistant" && !hasAnswer(m.at(-1)) ? m.slice(0, -1) : m);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ok(), "condition not reached");
};

/** The wiring chat-view does: the chat's callbacks feed the watchdog; a fake `online` source stands in for the window. */
function session(storedAnswers = 0) {
  const events = new EventTarget();
  const log = { changes: [] as boolean[], gaveUp: 0, shown: 0 };
  const chat: Chat<UIMessage> = new Chat({
    id: "t1",
    transport: chatTransport("p1"),
    onError: (e) => dog.error(e),
    onFinish: ({ isError, isAbort }) => {
      if (!isError && !isAbort) dog.finish();
    },
  });
  const dog = wd.createWatchdog({
    events,
    resume: () => chat.resumeStream({ body: { threadId: "t1" } }),
    drop: () => void (chat.messages = dropIncomplete(chat.messages)),
    answers: () => 0,
    settle: (n) =>
      wd.settleThread(
        async () => ({ answers: Array.from({ length: storedAnswers }, (_, i) => ({ id: `a${i}`, productId: "p1", question: "Where is it?", ...answer, evidence: [] })) }) as unknown as Thread,
        n,
        (messages) => {
          log.shown++;
          chat.messages = messages;
        },
      ),
    giveUp: () => void log.gaveUp++,
    onChange: (r) => void log.changes.push(r),
  });
  return { chat, dog, events, log };
}

test("retry delays are 1, 2, 4, 8, 15 and then 30 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(wd.retryDelay), [1000, 2000, 4000, 8000, 15000, 30000, 30000]);
});

test("a stream cut mid-answer keeps the working state; the online event resumes it from the start and the answer lands once", async () => {
  const { chat, events, log } = session();
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  assert.equal(chat.status, "error");
  assert.deepEqual(log.changes, [true], "working, not an error page");
  assert.deepEqual(roles(chat), ["user"], "the partial answer is dropped before the resume");
  events.dispatchEvent(new Event("online"));
  await until(() => log.changes.length === 2);
  assert.deepEqual(log.changes, [true, false]);
  assert.deepEqual(roles(chat), ["user", "assistant"]);
  assert.equal(chat.messages[1]!.parts.filter((p) => p.type === "data-answer").length, 1);
  assert.equal(chat.messages[1]!.parts.filter((p) => p.type === "text").length, 1, "no duplicated parts");
  assert.deepEqual(seen.filter((c) => c.method === "POST").length, 1, "the question was sent once");
  assert.deepEqual(seen.at(-1), { method: "GET", url: "/api/products/p1/threads/t1/stream" });
  assert.equal(log.gaveUp, 0);
});

test("the resume fails while the network is still down: the watchdog keeps going and succeeds later", async () => {
  const { chat, events, log } = session();
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  resume = "down";
  events.dispatchEvent(new Event("online"));
  await until(() => seen.filter((c) => c.method === "GET").length === 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(log.changes, [true], "still reconnecting");
  resume = "full";
  events.dispatchEvent(new Event("online"));
  await until(() => log.changes.length === 2);
  assert.deepEqual(roles(chat), ["user", "assistant"]);
});

test("a 204 with the answer stored: the thread is reloaded and shown", async () => {
  const { chat, events, log } = session(1);
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  resume = "204";
  events.dispatchEvent(new Event("online"));
  await until(() => log.changes.length === 2);
  assert.deepEqual([log.shown, log.gaveUp], [1, 0]);
  assert.ok(hasAnswer(chat.messages.at(-1)));
});

test("a 204 with nothing stored: the watchdog gives up once to the failure path", async () => {
  const { chat, events, log } = session(0);
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  resume = "204";
  events.dispatchEvent(new Event("online"));
  await until(() => log.changes.length === 2);
  assert.deepEqual([log.shown, log.gaveUp], [0, 1]);
  events.dispatchEvent(new Event("online"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.filter((c) => c.method === "GET").length, 1, "no more attempts");
});

test("Stop while reconnecting cancels the watchdog: no later attempt, no failure path", async () => {
  const { chat, dog, events, log } = session();
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  dog.cancel();
  assert.deepEqual(log.changes, [true, false]);
  events.dispatchEvent(new Event("online"));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([seen.filter((c) => c.method === "GET").length, log.gaveUp], [0, 0]);
});

test("a refusal from the server (ApiError) is not retried", async () => {
  post = "refuse";
  const { chat, log } = session();
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  assert.equal(chat.status, "error");
  assert.deepEqual(log.changes, []);
  assert.equal(seen.filter((c) => c.method === "GET").length, 0);
});

test("a 503 MODEL_UNAVAILABLE refusal shows its message and starts no watchdog", async () => {
  post = "unavailable";
  const { chat, dog, log } = session();
  await chat.sendMessage({ text: "Where is it?" }, { body: { threadId: "t1" } });
  assert.ok(chat.error instanceof ApiError);
  assert.equal(chat.error.message, "The model is temporarily unavailable. Try again in 12 seconds.");
  assert.deepEqual([log.changes, dog.active(), seen.filter((c) => c.method === "GET").length], [[], false, 0]);
});

test("without an online event the attempts follow the backoff, with no limit", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let attempts = 0;
    const events = new EventTarget();
    const dog = wd.createWatchdog({
      events,
      resume: async () => void (attempts++, dog.error(new TypeError("network error"))),
      drop() {},
      answers: () => 0,
      settle: async () => true,
      giveUp() {},
      onChange() {},
      random: () => 0.5,
    });
    dog.error(new TypeError("network error"));
    const waits = [1000, 2000, 4000, 8000, 15000, 30000, 30000];
    for (const [i, ms] of waits.entries()) {
      mock.timers.tick(ms - 1);
      await new Promise((r) => setImmediate(r));
      assert.equal(attempts, i, `not yet at ${ms}`);
      mock.timers.tick(1);
      await new Promise((r) => setImmediate(r));
      assert.equal(attempts, i + 1);
    }
    dog.cancel();
    mock.timers.tick(60_000);
    assert.equal(attempts, waits.length);
  } finally {
    mock.timers.reset();
  }
});

test("a resume names its thread: the chat id on a page opened on a thread, the body thread after a first send; Stop posts to the stop route", async () => {
  const chat = new Chat({ id: "t9", transport: chatTransport("p1") });
  await chat.resumeStream();
  await chat.resumeStream({ body: { threadId: "t5" } });
  await api.stopThread("p1", "t5");
  assert.deepEqual(seen, [
    { method: "GET", url: "/api/products/p1/threads/t9/stream" },
    { method: "GET", url: "/api/products/p1/threads/t5/stream" },
    { method: "POST", url: "/api/products/p1/threads/t5/stop" },
  ]);
});

// Loop tests: fake deps on mock timers. `resume` reports through `dog.error` like the chat does.
const flush = () => new Promise((r) => setImmediate(r));
const tick = async (ms: number) => (mock.timers.tick(ms), await flush());
async function withTimers(fn: () => Promise<void>) {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await fn();
  } finally {
    mock.timers.reset();
  }
}
const net = () => new TypeError("network error");
function rig(o: { resume?: (dog: ReturnType<typeof wd.createWatchdog>) => Promise<void>; settle?: () => Promise<boolean>; random?: () => number } = {}) {
  const events = new EventTarget();
  const log = { resumes: 0, changes: [] as boolean[], gaveUp: 0 };
  const dog: ReturnType<typeof wd.createWatchdog> = wd.createWatchdog({
    events,
    resume: async () => {
      log.resumes++;
      await (o.resume ? o.resume(dog) : Promise.resolve(dog.error(net())));
    },
    drop() {},
    answers: () => 0,
    settle: o.settle ?? (async () => true),
    giveUp: () => void log.gaveUp++,
    onChange: (r) => void log.changes.push(r),
    random: o.random ?? (() => 0.5),
  });
  return { dog, events, log };
}
const apiErr = (status: number) => new ApiError("x", status);

for (const status of [404, 401]) {
  test(`a ${status} from a resume inside the loop ends it after that attempt: give-up once, no further timers`, () =>
    withTimers(async () => {
      const { dog, log } = rig({ resume: async (d) => d.error(apiErr(status)) });
      dog.error(net());
      await tick(1000);
      assert.deepEqual([log.resumes, log.gaveUp, log.changes, dog.active()], [1, 1, [true, false], false]);
      await tick(120_000);
      assert.deepEqual([log.resumes, log.gaveUp], [1, 1]);
    }));

  test(`a ${status} thrown by the thread reload after a 204 ends it: give-up once (a thread deleted in another tab)`, () =>
    withTimers(async () => {
      const { dog, log } = rig({ resume: async () => {}, settle: async () => Promise.reject(apiErr(status)) });
      dog.error(net());
      await tick(1000);
      assert.deepEqual([log.resumes, log.gaveUp, log.changes], [1, 1, [true, false]]);
      await tick(120_000);
      assert.deepEqual([log.resumes, log.gaveUp], [1, 1]);
    }));
}

for (const [name, make] of [["500", () => apiErr(500)], ["408", () => apiErr(408)], ["429", () => apiErr(429)], ["network error", net]] as const) {
  test(`a ${name} from a resume keeps retrying`, () =>
    withTimers(async () => {
      const { dog, log } = rig({ resume: async (d) => d.error(make()) });
      dog.error(net());
      await tick(1000);
      await tick(2000);
      assert.deepEqual([log.resumes, log.gaveUp, dog.active()], [2, 0, true]);
      dog.cancel();
    }));
}

test("a 500 thrown by the thread reload keeps retrying", () =>
  withTimers(async () => {
    const { dog, log } = rig({ resume: async () => {}, settle: async () => Promise.reject(apiErr(500)) });
    dog.error(net());
    await tick(1000);
    await tick(2000);
    assert.deepEqual([log.resumes, log.gaveUp], [2, 0]);
    dog.cancel();
  }));

for (const [random, factor] of [[0, 0.5], [1, 1.5]] as const) {
  test(`with the random source at ${random} each delay is its base times ${factor}`, () =>
    withTimers(async () => {
      const { dog, log } = rig({ random: () => random });
      dog.error(net());
      for (const [i, base] of [1, 2, 4, 8, 15, 30, 30].entries()) {
        const ms = base * 1000 * factor;
        await tick(ms - 1);
        assert.equal(log.resumes, i, `not yet at ${ms}`);
        await tick(1);
        assert.equal(log.resumes, i + 1);
      }
      dog.cancel();
    }));
}

/** 500 clients dropped at the same instant, each with its own random source; returns how many have resumed after each tick. */
async function crowd(trigger: (c: ReturnType<typeof rig>) => void, marks: number[]) {
  const clients = Array.from({ length: 500 }, (_, i) => rig({ random: () => i / 500 }));
  for (const c of clients) {
    c.dog.error(net());
    trigger(c);
  }
  const counts: number[] = [];
  let at = 0;
  for (const m of marks) {
    await tick(m - at);
    at = m;
    counts.push(clients.filter((c) => c.log.resumes > 0).length);
  }
  for (const c of clients) c.dog.cancel();
  return counts;
}

test("500 clients dropped together no longer all resume in the same second", () =>
  withTimers(async () => {
    const [before, mid, after] = await crowd(() => {}, [499, 999, 1500]);
    assert.equal(before, 0, "none before 0.5 s");
    assert.ok(mid > 100 && mid < 400, `spread inside the first second, got ${mid}`);
    assert.equal(after, 500);
  }));

test("an online resume waits 0 to 1 s and is not at the same instant for all clients", () =>
  withTimers(async () => {
    const [early, mid, late] = await crowd((c) => c.events.dispatchEvent(new Event("online")), [1, 500, 1000]);
    assert.ok(early < 10, `almost none at once, got ${early}`);
    assert.ok(mid > 200 && mid < 300, `about half by 0.5 s, got ${mid}`);
    assert.equal(late, 500);
  }));

test("an online resume waits the random 0 to 1 s: 0.5 resumes at 500 ms, not before", () =>
  withTimers(async () => {
    const { dog, events, log } = rig();
    dog.error(net());
    events.dispatchEvent(new Event("online"));
    await tick(499);
    assert.equal(log.resumes, 0);
    await tick(1);
    assert.equal(log.resumes, 1);
    dog.cancel();
  }));

test("online during a jittered wait does not double-fire: one attempt, the old timer is gone", () =>
  withTimers(async () => {
    const { dog, events, log } = rig();
    dog.error(net());
    await tick(200);
    events.dispatchEvent(new Event("online"));
    await tick(500);
    assert.equal(log.resumes, 1);
    await tick(1000);
    assert.equal(log.resumes, 1, "the first timer (1 s) did not fire as well");
    await tick(1000);
    assert.equal(log.resumes, 2, "the next attempt follows the backoff");
    dog.cancel();
  }));

test("Stop during a jittered wait leaves no timer, for the retry wait and the online wait", () =>
  withTimers(async () => {
    const { dog, log } = rig();
    dog.error(net());
    dog.cancel();
    await tick(60_000);
    const b = rig();
    b.dog.error(net());
    b.events.dispatchEvent(new Event("online"));
    b.dog.cancel();
    await tick(60_000);
    assert.deepEqual([log.resumes, b.log.resumes, log.gaveUp, b.log.gaveUp], [0, 0, 0, 0]);
  }));

test("a 4xx arriving while an attempt is busy ends the watchdog once the attempt returns; online meanwhile adds no second timer", () =>
  withTimers(async () => {
    let release!: () => void;
    const { dog, events, log } = rig({ resume: () => new Promise<void>((r) => (release = r)) });
    dog.error(net());
    await tick(1000);
    assert.equal(log.resumes, 1);
    dog.error(apiErr(404));
    events.dispatchEvent(new Event("online"));
    release();
    await flush();
    assert.deepEqual([log.gaveUp, log.changes, dog.active()], [1, [true, false], false]);
    await tick(120_000);
    assert.deepEqual([log.resumes, log.gaveUp], [1, 1]);
  }));

test("online while an attempt is busy: the attempt's own retry replaces the online timer", () =>
  withTimers(async () => {
    let release!: () => void;
    const { dog, events, log } = rig({ resume: () => new Promise<void>((r) => (release = r)) });
    dog.error(net());
    await tick(1000);
    events.dispatchEvent(new Event("online"));
    dog.error(net());
    release();
    await flush();
    await tick(1999);
    assert.equal(log.resumes, 1);
    await tick(1);
    assert.equal(log.resumes, 2);
    dog.cancel();
  }));
