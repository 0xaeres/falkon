import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeEngineDb } from "./fakeEngineDb";
import { KEEP_DIAGRAM_THREADS, pruneDiagrams, withoutDiagrams } from "./diagramPrune";

const diagram = { type: "data-diagram", data: { type: "workflow", html: "<svg/>", source: "{}" } };
const messages = () => [{ id: "u", role: "user", parts: [{ type: "text", text: "q" }] }, { id: "a", role: "assistant", parts: [{ type: "text", text: "```archify\n{}\n```" }, diagram, { type: "data-answer", data: {} }] }];

test("withoutDiagrams drops only data-diagram parts and is null when there are none", () => {
  const out = withoutDiagrams(messages())!;
  assert.deepEqual(out[1]!.parts!.map((p) => p.type), ["text", "data-answer"]);
  assert.equal(withoutDiagrams(out), null);
  assert.equal(withoutDiagrams("x"), null);
});

test("only the newest threads of a Product keep diagrams; order and other Products are untouched", async () => {
  const { db, chats } = fakeEngineDb();
  const made: string[] = [];
  for (let i = 0; i < KEEP_DIAGRAM_THREADS + 2; i++) made.push((await db.chat.create({ data: { productId: "p", messages: messages(), updatedAt: new Date(1_000_000 + i * 1000) } })).id);
  const other = (await db.chat.create({ data: { productId: "q", messages: messages() } })).id;
  const before = new Map(chats.map((c) => [c.id, c.updatedAt]));
  // created oldest first, so the first two are the oldest
  await pruneDiagrams(db, "p");
  const has = (id: string) => JSON.stringify(chats.find((c) => c.id === id)!.messages).includes("data-diagram");
  assert.deepEqual(made.map(has), [false, false, true, true, true, true, true]);
  assert.equal(has(other), true);
  for (const c of chats) assert.equal(c.updatedAt.getTime(), before.get(c.id)!.getTime());
  const q = JSON.stringify(chats.find((c) => c.id === made[0])!.messages);
  assert.match(q, /archify/);
});
