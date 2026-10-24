import { test } from "node:test";
import assert from "node:assert/strict";
import { createUIMessageStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { AskError, drain } from "./chat";

/** A UI message stream shaped like createMessageStream's, over a model whose provider call fails. */
const failingTurn = () =>
  createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const result = streamText({
        model: new MockLanguageModelV3({ doStream: async () => { throw new Error("Invalid API key"); } }),
        prompt: "q",
        onError: () => {},
      });
      await new Promise<void>((resolve) => writer.merge(result.toUIMessageStream({ sendStart: false, sendFinish: false, onFinish: () => resolve() })));
      writer.write({ type: "finish" });
    },
  });

test("a provider failure fails the blocking ask as a 500 UNEXPECTED_ERROR", async () => {
  await assert.rejects(drain(failingTurn()), (e: unknown) => {
    assert.ok(e instanceof AskError);
    assert.equal(e.statusCode, 500);
    assert.equal(e.errorCode, "UNEXPECTED_ERROR");
    assert.equal(e.message, "Invalid API key");
    return true;
  });
});

test("a stream without errors drains", async () => {
  const s = createUIMessageStream({ execute: ({ writer }) => { writer.write({ type: "start" }); writer.write({ type: "finish" }); } });
  await drain(s);
});

test("threadUrl: UI base (default, trailing slash trimmed) + encoded Product slug + thread id", async () => {
  const { threadUrl } = await import("./chat");
  const was = process.env.FALKON_UI_URL;
  try {
    delete process.env.FALKON_UI_URL;
    assert.equal(threadUrl("alpha", "abc"), "http://127.0.0.1:3100/alpha/chat/abc");
    process.env.FALKON_UI_URL = "https://falkon.example.com/";
    assert.equal(threadUrl("alpha", "abc"), "https://falkon.example.com/alpha/chat/abc");
    process.env.FALKON_UI_URL = "";
    assert.equal(threadUrl("alpha", "abc"), "http://127.0.0.1:3100/alpha/chat/abc", "empty counts as unset (compose passes empty)");
    assert.equal(threadUrl("a/b c", "x y"), "http://127.0.0.1:3100/a%2Fb%20c/chat/x%20y");
  } finally {
    if (was === undefined) delete process.env.FALKON_UI_URL; else process.env.FALKON_UI_URL = was;
  }
});

test("newChatData: an MCP chat carries the Product; PUBLIC survives for signed-in callers; anonymous is PUBLIC", async () => {
  const { newChatData } = await import("./chat");
  const { scopeFor } = await import("@falkon/shared");
  const key = { ...scopeFor(["*"]), principal: "key:x" };
  assert.deepEqual(newChatData(key, "PUBLIC", "alpha"), { visibility: "PUBLIC", createdBy: "key:x", productId: "alpha", messages: [] });
  assert.equal(newChatData(key, undefined, "alpha").visibility, "PRIVATE");
  assert.equal(newChatData(scopeFor(["*"]), "PRIVATE", "alpha").visibility, "PUBLIC");
  assert.equal(newChatData(key, undefined, undefined).productId, undefined, "the legacy blocking Ask saves no Product");
});
