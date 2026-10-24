import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { generateText } from "ai";
import { aiModel } from "./models";

test("listing tools and models does not load the ai SDK; the first ask_codebase call does", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", new URL("./lazy.child.ts", import.meta.url).pathname], { encoding: "utf8", cwd: new URL("../../..", import.meta.url).pathname });
  const r = JSON.parse(out.trim().split("\n").pop()!);
  assert.ok(r.tools.includes("ask_codebase") && r.tools.includes("list_language_models"));
  assert.deepEqual(r.afterList, []);
  assert.ok(r.afterAsk.includes("ai"), `ai not loaded by ask_codebase: ${r.afterAsk}`);
  assert.deepEqual(r.ask.content, [{ type: "text", text: "Failed to ask codebase: Language model 'anthropic/other' is not configured." }]);
});

test("aiModel builds each provider's model through the lazy import", async () => {
  for (const provider of ["openai", "anthropic"]) {
    const { model } = await aiModel({ provider, model: "m", token: { env: "PATH" } });
    assert.equal(typeof model !== "string" && model.modelId, "m");
  }
  await assert.rejects(aiModel({ provider: "nope", model: "m" }), /not supported here/);
  await assert.rejects(aiModel({ provider: "openai-compatible", model: "m" }), /needs a baseUrl/);
});

test("an openai-compatible model still splits <think> blocks out of the answer", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "c", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "<think>hmm</think>forty-two" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { model } = await aiModel({ provider: "openai-compatible", model: "m", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    const r = await generateText({ model, prompt: "q" });
    assert.equal(r.text, "forty-two");
    assert.equal(r.reasoningText, "hmm");
  } finally { server.close(); }
});
