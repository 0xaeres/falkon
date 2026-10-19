import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeFor } from "@sbc/shared";
import { createMessageStream } from "./agent";
import { fakeOpenAi } from "./fakeOpenAi";

const user = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What does it do?" }] };
const model = (url: string) => ({ provider: "openai-compatible", model: "m", baseUrl: url });

async function chunks(stream: ReadableStream<{ type: string; data?: unknown }>) {
  const out = [];
  const r = stream.getReader();
  for (let c = await r.read(); !c.done; c = await r.read()) out.push(c.value);
  return out;
}

test("without postProcess the stream carries no extra parts", async () => {
  const fake = await fakeOpenAi([{ text: "<!--answer-->\nhello" }]);
  try {
    let saved: unknown[] = [];
    const out = await chunks(await createMessageStream({ messages: [user], selectedRepos: [], scope: scopeFor(["*"]), model: model(fake.url), onFinish: (m) => void (saved = m) }));
    assert.deepEqual(out.filter((c) => c.type.startsWith("data-")), []);
    assert.equal(out.at(-1)!.type, "finish");
    assert.equal((saved.at(-1) as { parts: { type: string }[] }).parts.some((p) => p.type.startsWith("data-")), false);
  } finally { fake.close(); }
});

test("postProcess gets the final text, sources and step-cap flag, and its parts are written before finish and persisted", async () => {
  const fake = await fakeOpenAi([{ tool: "read_file", args: { repo: "not-in-scope", path: "a.ts" } }, { text: "<!--answer-->\nfinal words" }]);
  try {
    let saved: { parts: { type: string; data?: unknown }[] }[] = [];
    let seen: unknown;
    const out = await chunks(
      await createMessageStream({
        messages: [user], selectedRepos: [], scope: scopeFor([]), model: model(fake.url),
        onFinish: (m) => void (saved = m as never),
        postProcess: async (ctx) => ((seen = ctx), [{ type: "data-evidence", data: { n: 1 } }, { type: "data-answer", data: { ok: true } }]),
      }),
    );
    assert.deepEqual(seen, { text: "<!--answer-->\nfinal words", sources: [], stepCapHit: false });
    const types = out.map((c) => c.type);
    const finish = types.indexOf("finish");
    assert(types.indexOf("data-evidence") < types.indexOf("data-answer") && types.indexOf("data-answer") < types.indexOf("message-metadata") && types.indexOf("message-metadata") < finish);
    assert.deepEqual(saved.at(-1)!.parts.filter((p) => p.type.startsWith("data-")).map((p) => [p.type, p.data]), [["data-evidence", { n: 1 }], ["data-answer", { ok: true }]]);
  } finally { fake.close(); }
});

test("stepCapHit is true when the run used all its steps (a model that never stops calling tools)", async () => {
  const fake = await fakeOpenAi([{ tool: "read_file", args: { repo: "x", path: "a.ts" } }]);
  try {
    let seen: { stepCapHit?: boolean } = {};
    await chunks(await createMessageStream({ messages: [user], selectedRepos: [], scope: scopeFor([]), model: model(fake.url), postProcess: async (ctx) => ((seen = ctx), []) }));
    assert.equal(seen.stepCapHit, true);
  } finally { fake.close(); }
});
