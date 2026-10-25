import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, before, after } from "node:test";
import { Chat } from "@ai-sdk/react";
import { answerSchema, messagesToAnswers } from "@falkon/contracts";

const evidence = {
  id: 1,
  productId: "p1",
  generation: "g-abc123",
  repository: "github.com/acme/app",
  path: "src/a.ts",
  revision: "HEAD",
  startLine: 3,
  code: ["a", "b", "c"],
  highlightedLines: [4],
};
const answer = {
  kind: "grounded",
  generation: "g-abc123",
  paragraphs: [{ text: "It lives here [1].", citations: [1] }],
  gaps: [],
  partialReasons: [],
  abstention: null,
  suggestions: [],
};
// What the engine writes for one turn (see packages/api/src/threads.test.ts).
const stream =
  [
    { type: "start", messageId: "m1" },
    { type: "text-start", id: "t" },
    {
      type: "text-delta",
      id: "t",
      delta: "<!--answer-->\nIt lives @file:{x::y}",
    },
    { type: "text-end", id: "t" },
    {
      type: "data-source",
      data: {
        type: "file",
        repo: "github.com/acme/app",
        path: "src/a.ts",
        name: "a.ts",
        revision: "HEAD",
      },
    },
    { type: "data-evidence", data: evidence },
    { type: "data-answer", data: answer },
    { type: "finish" },
  ]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join("") + "data: [DONE]\n\n";

let seen: { url?: string; body: string } = { body: "" };
let fail = false;
const engine = http.createServer(async (req, res) => {
  seen = { url: req.url, body: "" };
  for await (const chunk of req) seen.body += chunk;
  if (fail)
    return void res.writeHead(409, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: "Chat opens when the first Evidence Generation publishes.",
      }),
    );
  res
    .writeHead(200, {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    })
    .end(stream);
});
let chatTransport: typeof import("../src/lib/api/chat-transport").chatTransport;
let ApiError: typeof import("../src/lib/api/client").ApiError;
before(async () => {
  await new Promise<void>((r) => engine.listen(0, "127.0.0.1", r));
  // The client reads its base URL when it loads.
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/api`;
  ({ chatTransport } = await import("../src/lib/api/chat-transport"));
  ({ ApiError } = await import("../src/lib/api/client"));
});
after(() => engine.close());

test("a turn posts only the new text to the thread's messages route and the data parts map to an Answer", async () => {
  const chat = new Chat({ id: "t1", transport: chatTransport("p1") });
  await chat.sendMessage(
    { text: "Where is it?" },
    { body: { threadId: "t1" } },
  );
  assert.equal(chat.error, undefined);
  assert.deepEqual(
    [seen.url, JSON.parse(seen.body)],
    ["/api/products/p1/threads/t1/messages", { text: "Where is it?" }],
  );
  assert.deepEqual(
    chat.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  const [a] = messagesToAnswers("p1", chat.messages);
  assert.equal(answerSchema.safeParse(a).success, true);
  assert.deepEqual(
    [a!.id, a!.question, a!.kind, a!.evidence],
    ["m1", "Where is it?", "grounded", [evidence]],
  );
  assert.equal(
    chat.messages[1]!.parts.filter((p) => p.type === "data-source").length,
    1,
  );

  // The next turn sends only its own text, never the earlier messages.
  await chat.sendMessage({ text: "And then?" }, { body: { threadId: "t1" } });
  assert.deepEqual(JSON.parse(seen.body), { text: "And then?" });
});

test("a pre-stream engine error becomes an ApiError with the engine's fixed message", async () => {
  fail = true;
  const chat = new Chat({ id: "t2", transport: chatTransport("p1") });
  await chat.sendMessage({ text: "hi" }, { body: { threadId: "t2" } });
  assert.ok(chat.error instanceof ApiError);
  assert.deepEqual(
    [chat.error.status, chat.error.message],
    [409, "Chat opens when the first Evidence Generation publishes."],
  );
});
