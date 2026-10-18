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
