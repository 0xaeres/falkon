import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  ABSTENTION_INCOMPLETE,
  answerSchema,
  answersToMessages,
  chatMessageRequestSchema,
  FILE_REFERENCE_REGEX,
  messagesToAnswers,
  rewriteFileRefs,
  type Answer,
  type ChatMessageLike,
} from "./index";

// The regex is copied from packages/api/src/engine/ask/prompt.ts (contracts must not import api); this keeps the copies in step.
const promptSource = readFileSync(new URL("../../api/src/engine/ask/prompt.ts", import.meta.url), "utf8");
const promptRegex = new RegExp(new Function("FILE_REFERENCE_PREFIX", `return ${promptSource.match(/FILE_REFERENCE_REGEX = new RegExp\((`.*`), "g"\)/)![1]}`)("@file:"), "g");

const SAMPLES = [
  "@file:{github.com/acme/app::src/a.ts:1-5}",
  "@file:{github.com/acme/app::src/a.ts:7}",
  "@file:{github.com/acme/app::src/a.ts}",
  "@file:{ghe.example.com:8443/team/svc::lib/x.go:10-20}",
  "@file:{repo::path with space.ts:3-4}",
  "text @file:{a::b:1-2} and @file:{c::d} twice @file:{a::b:1-2}",
  "@file:{broken::}",
  "@file:{::nope}",
  "@file{a::b}",
  "@file:{a::b:x-y}",
  "@file:{a::b:1-2",
];

test("the contracts file-reference regex matches exactly what the Ask prompt's does", () => {
  for (const s of SAMPLES) assert.deepEqual([...s.matchAll(new RegExp(FILE_REFERENCE_REGEX))].map((m) => [...m]), [...s.matchAll(promptRegex)].map((m) => [...m]), s);
});

test("rewriteFileRefs numbers distinct references by first appearance", () => {
  const out = rewriteFileRefs("A @file:{r::a.ts:1-2} B @file:{r::b.ts} C @file:{r::a.ts:1-2} D @file:{r::a.ts:3-4}.");
  assert.equal(out, "A [1] B [2] C [1] D [3].");
  assert.equal(rewriteFileRefs("no refs"), "no refs");
});

test("chatMessageRequestSchema is strict: trimmed text of 1..4000 and an optional model; a history is an unknown key", () => {
  assert.equal(chatMessageRequestSchema.parse({ text: "  hi " }).text, "hi");
  assert(chatMessageRequestSchema.safeParse({ text: "x", languageModel: { provider: "anthropic", model: "m" } }).success);
  for (const bad of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(4001) }, { text: "x", messages: [] }, { text: "x", extra: 1 }, { text: "x", languageModel: { provider: "p" } }, { text: "x", languageModel: { provider: "p", model: "m", token: "t" } }])
    assert(!chatMessageRequestSchema.safeParse(bad).success, JSON.stringify(bad));
  assert(chatMessageRequestSchema.safeParse({ text: "x".repeat(4000) }).success);
});

const evidence = (id: number) => ({ id, productId: "pay", generation: "g-1", repository: "github.com/o/r", path: `f${id}.ts`, revision: "abc1234", startLine: 3, code: ["a", "b"], highlightedLines: [3] });
const answerData = { kind: "grounded", generation: "g-1", paragraphs: [{ text: "Uses it [1].", citations: [1] }], gaps: [], partialReasons: [], abstention: null, suggestions: [] };
const user = (id: string, text: string): ChatMessageLike => ({ id, role: "user", parts: [{ type: "text", text }] });
const assistant = (id: string, parts: ChatMessageLike["parts"]): ChatMessageLike => ({ id, role: "assistant", parts });
const full = (id: string): ChatMessageLike => assistant(id, [{ type: "text", text: "raw" }, { type: "data-source", data: {} }, { type: "data-evidence", data: evidence(1) }, { type: "data-answer", data: answerData }]);

test("messagesToAnswers pairs each user message with its assistant reply", () => {
  const [a, b, ...rest] = messagesToAnswers("pay", [user("u1", "How?"), full("a1"), user("u2", "Why?"), full("a2")]);
  assert.equal(rest.length, 0);
  assert.deepEqual([a!.id, a!.question, a!.kind, a!.generation, a!.evidence.map((e) => e.id), a!.paragraphs[0]!.citations, a!.productId], ["a1", "How?", "grounded", "g-1", [1], [1], "pay"]);
  assert.deepEqual([b!.id, b!.question], ["a2", "Why?"]);
  assert(messagesToAnswers("pay", [user("u1", "x"), full("a1")]).every((x) => answerSchema.safeParse(x).success));
});

test("a user message with no reply is omitted; an orphan user before a retry does not shift the pairing", () => {
  assert.deepEqual(messagesToAnswers("pay", [user("u1", "pending")]), []);
  const answers = messagesToAnswers("pay", [user("u1", "stopped"), user("u2", "retry"), full("a2")]);
  assert.deepEqual(answers.map((a) => [a.id, a.question]), [["a2", "retry"]]);
});

test("an assistant message with no data-answer part becomes the fixed abstention", () => {
  const [a] = messagesToAnswers("pay", [user("u1", "q"), assistant("a1", [{ type: "text", text: "partial" }])]);
  assert.deepEqual([a!.id, a!.question, a!.kind, a!.abstention, a!.paragraphs, a!.evidence], ["a1", "q", "abstention", ABSTENTION_INCOMPLETE, [], []]);
  assert(answerSchema.safeParse(a).success);
});

test("a corrupt data-answer or data-evidence part falls back to the fixed abstention instead of throwing", () => {
  const bad = [
    full("a1").parts.map((p) => (p.type === "data-answer" ? { type: p.type, data: { ...answerData, paragraphs: [{ text: "x [9]", citations: [1] }] } } : p)),
    full("a1").parts.map((p) => (p.type === "data-evidence" ? { type: p.type, data: { id: 0 } } : p)),
    [{ type: "data-answer", data: "nope" }],
    [{ type: "data-answer" }],
  ];
  for (const parts of bad) {
    const [a] = messagesToAnswers("pay", [user("u1", "q"), assistant("a1", parts)]);
    assert.deepEqual([a!.kind, a!.abstention], ["abstention", ABSTENTION_INCOMPLETE]);
  }
});

test("answersToMessages and messagesToAnswers round-trip", () => {
  const answers: Answer[] = [
    { id: "a1", productId: "pay", question: "How?", generation: "g-1", kind: "grounded", paragraphs: [{ text: "Uses it [1].", citations: [1] }], evidence: [evidence(1)], gaps: [], partialReasons: [], abstention: null, suggestions: [] },
    { id: "a2", productId: "pay", question: "Other?", generation: "g-1", kind: "abstention", paragraphs: [], evidence: [], gaps: ["g"], partialReasons: [], abstention: "No evidence.", suggestions: ["try"] },
  ];
  const messages = answersToMessages(answers);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual(messagesToAnswers("pay", messages), answers);
});

test("a reply answer (no citations, no evidence) round-trips through the stored messages", () => {
  const reply: Answer = { id: "a1", productId: "pay", question: "hey", generation: "g-1", kind: "reply", paragraphs: [{ text: "Hi! Ask me about the code.", citations: [] }], evidence: [], gaps: [], partialReasons: [], abstention: null, suggestions: ["What does this Product do?"] };
  const messages = answersToMessages([reply]);
  assert.deepEqual(messagesToAnswers("pay", messages), [reply]);
  assert(answerSchema.safeParse(reply).success);
});

test("data-diagram parts round trip through answers and messages; a corrupt one is dropped alone", () => {
  const diagram = { type: "workflow" as const, html: "<!doctype html><svg></svg>", source: '{"diagram_type":"workflow"}' };
  const msg = (parts: ChatMessageLike["parts"]) => [user("u1", "draw it"), assistant("a1", [{ type: "data-answer", data: answerData }, ...parts])];
  const [a] = messagesToAnswers("pay", msg([{ type: "data-diagram", data: diagram }]));
  assert.deepEqual(a!.diagrams, [diagram]);
  assert(answerSchema.safeParse(a).success);
  const back = answersToMessages([a!]);
  assert.deepEqual(back[1]!.parts.filter((p) => p.type === "data-diagram"), [{ type: "data-diagram", data: diagram }]);
  assert.deepEqual(messagesToAnswers("pay", back)[0], a);
  const [dropped] = messagesToAnswers("pay", msg([{ type: "data-diagram", data: { ...diagram, type: "pie" } }]));
  assert.equal(dropped!.kind, "grounded");
  assert.equal(dropped!.diagrams, undefined);
});
