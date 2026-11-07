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
let post: "drop" | "refuse";
let resume: "full" | "204" | "down";
let seen: { method?: string; url?: string }[];
const engine = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url });
  req.resume();
  const sseHead = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };
  if (req.method === "POST" && req.url?.endsWith("/stop")) return void res.writeHead(204).end();
  if (req.method === "POST") {
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
let wd: typeof import("../src/features/chat/resume-watchdog");
before(async () => {
  await new Promise<void>((r) => engine.listen(0, "127.0.0.1", r));
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/api`;
  ({ chatTransport } = await import("../src/lib/api/chat-transport"));
  ({ api } = await import("../src/lib/api/client"));
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
