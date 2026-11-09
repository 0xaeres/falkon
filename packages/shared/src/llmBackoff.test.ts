import { test } from "node:test";
import assert from "node:assert/strict";
import { openAiClient, type LlmConfig } from "./kb/llm";

const cfg: LlmConfig = { baseUrl: "http://llm.test", apiKey: "k", model: "m" };
const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

/** Replaces global fetch with one that answers `status` each call and counts calls. */
async function withFetch(status: number, run: (calls: { n: number }) => Promise<void>) {
  const real = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    calls.n++;
    return new Response(`body ${status}`, { status });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("backoff waits are scaled by the random factor: 0.5x at random 0", async () => {
  const waits: number[] = [];
  await withFetch(503, async (calls) => {
    const client = openAiClient(cfg, { random: () => 0, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(client.chat(req));
    assert.equal(calls.n, 5); // 1 try + 4 retries
  });
  assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
});

test("backoff waits are scaled by the random factor: 1.5x at random 1", async () => {
  const waits: number[] = [];
  await withFetch(503, async () => {
    const client = openAiClient(cfg, { random: () => 1, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(client.chat(req));
  });
  assert.deepEqual(waits, [3000, 6000, 12000, 24000]);
});

test("backoff cap: 30 s base times 1.5 at most, for a large attempt count", async () => {
  const waits: number[] = [];
  await withFetch(503, async () => {
    const client = openAiClient(cfg, { retries: 30, random: () => 1, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(client.chat(req));
  });
  assert.equal(waits.length, 30);
  assert.equal(waits.at(-1), 45_000);
  assert.ok(waits.every((ms) => ms <= 45_000));
});

test("a 400 throws on the first call with no wait", async () => {
  const waits: number[] = [];
  await withFetch(400, async (calls) => {
    const client = openAiClient(cfg, { random: () => 0.5, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(client.chat(req), /LLM 400/);
    assert.equal(calls.n, 1);
  });
  assert.deepEqual(waits, []);
});

test("an abort during the wait throws without another call", async () => {
  const controller = new AbortController();
  await withFetch(503, async (calls) => {
    const client = openAiClient(cfg, {
      random: () => 0.5,
      sleep: async () => controller.abort(),
    });
    await assert.rejects(client.chat(req, controller.signal));
    assert.equal(calls.n, 1);
  });
});
