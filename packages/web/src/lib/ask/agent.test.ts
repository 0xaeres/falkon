import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { asSchema, generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { scopeFor } from "@falkon/shared";
import { agentTools } from "./agent";

const tools = () => agentTools(scopeFor(["*"]), [], () => {});

test("every Ask agent tool sends byte-identical Zod 3 schema JSON to the model", async () => {
  const previous = JSON.parse(fs.readFileSync(new URL("../../../../shared/src/toolSchemas.v3.json", import.meta.url), "utf8")).ask;
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "done" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  await generateText({ model, prompt: "Inspect the tool schemas.", tools: tools() });
  const sent = model.doGenerateCalls[0]!.tools!;
  assert.deepEqual(sent.map((t) => t.name).sort(), Object.keys(previous).sort());
  for (const t of sent) {
    assert.equal(t.type, "function");
    if (t.type === "function") assert.equal(JSON.stringify(t.inputSchema), JSON.stringify(previous[t.name]), t.name);
  }
});

test("Ask agent JSON schemas retain Zod validation without coercing arguments", async () => {
  const validate = asSchema(tools().read_file!.inputSchema).validate!;
  const valid = { repo: "fixtures.test/atlas", path: "src/hello.ts", offset: 2, limit: 10 };
  assert.deepEqual(await validate(valid), { success: true, value: { ...valid, ref: "HEAD" } });
  for (const bad of [{ ...valid, path: 42 }, { ...valid, offset: "2" }, { ...valid, limit: "10" }, { ...valid, limit: 0 }]) {
    const result = await validate(bad);
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.error instanceof Error);
  }
});
