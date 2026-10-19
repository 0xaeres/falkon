import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseConfig } from "./config";
import { runAgent, tool, TokenBudget, type LlmClient } from "./kb/llm";

test("invalid knowledgeBase config pins the Zod 4 error text", () => {
  assert.throws(() => parseConfig('{"knowledgeBase":{"enabled":"yes"}}'), {
    message: `[
  {
    "expected": "boolean",
    "code": "invalid_type",
    "path": [
      "enabled"
    ],
    "message": "Invalid input: expected boolean, received string"
  }
]`,
  });
});

test("KB invalid_input results pin the Zod 4 message sent back to the model", async () => {
  let calls = 0;
  let done = false;
  const llm: LlmClient = {
    async chat(req) {
      if (calls++ > 0) {
        assert.equal(req.messages.at(-1)?.content, '{"ok":false,"reason":"invalid_input","message":"enabled: Invalid input: expected boolean, received string"}');
        done = true;
      }
      return {
        message: { content: null, tool_calls: [{ id: "input", type: "function", function: { name: "submit", arguments: '{"enabled":"yes"}' } }] },
        finishReason: "tool_calls", promptTokens: 1, completionTokens: 1,
      };
    },
  };
  await runAgent({
    llm, model: "fixture", label: "validation", system: "Submit input.", user: "Submit input.",
    tools: [tool("submit", "Submit input", z.object({ enabled: z.boolean() }), () => assert.fail("Invalid input must not execute"))],
    finishTool: "submit", done: () => done, budget: new TokenBudget(100), maxSteps: 3,
  });
  assert.equal(calls, 2);
});
