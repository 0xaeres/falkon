import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import type { Answer } from "@falkon/contracts";
import {
  ReplyBody,
  answerLabel,
  answerText,
  discardable,
  isCapNote,
} from "../src/features/chat/chat-view";

const reply: Answer = {
  id: "a1",
  productId: "p",
  question: "hey",
  generation: "g-1",
  kind: "reply",
  paragraphs: [{ text: "Hi! I can **search** this Product.", citations: [] }],
  evidence: [],
  gaps: [],
  partialReasons: [],
  abstention: null,
  suggestions: ["What does this Product do?", "Where is auth?"],
};

test("a reply renders as prose with a Try asking list, never the abstain card", () => {
  const html = renderToStaticMarkup(<ReplyBody answer={reply} />);
  assert.match(html, /<strong>search<\/strong>/);
  assert.match(html, /Try asking/);
  assert.match(html, /<li>What does this Product do\?<\/li>/);
  assert.doesNotMatch(html, /Not enough evidence|abstention/);
});

test("labels and copy text per kind", () => {
  assert.deepEqual(
    (["grounded", "partial", "abstention", "reply"] as const).map(answerLabel),
    ["Grounded answer", "Partial answer", "Abstained", "Reply"],
  );
  assert.equal(answerText(reply), "Hi! I can **search** this Product.");
  assert.equal(
    answerText({
      ...reply,
      kind: "abstention",
      paragraphs: [],
      abstention: "None.",
    }),
    "None.",
  );
});

test("a thread made for a first message that failed is discarded; one with an answer or an older thread is not", () => {
  const user: UIMessage = {
    id: "u",
    role: "user",
    parts: [{ type: "text", text: "q" }],
  };
  const answered: UIMessage = {
    id: "a",
    role: "assistant",
    parts: [{ type: "data-answer", data: {} }],
  };
  assert.equal(discardable(true, [user]), true);
  assert.equal(discardable(true, []), true);
  assert.equal(discardable(true, [user, answered]), false);
  assert.equal(discardable(false, [user]), false);
  const partial: UIMessage = {
    id: "p",
    role: "assistant",
    parts: [{ type: "text", text: "half" }],
  };
  assert.equal(
    discardable(true, [user, partial]),
    false,
    "the server accepted the question: the thread holds it",
  );
});

test("the evidence display cap is a note; unverified references and the step cap stay warnings", () => {
  assert.equal(isCapNote("1 reference was not shown (limit 12)."), true);
  assert.equal(isCapNote("8 references were not shown (limit 12)."), true);
  assert.equal(isCapNote("2 references could not be verified."), false);
  assert.equal(
    isCapNote(
      "The agent stopped at its step limit, so the answer may be incomplete.",
    ),
    false,
  );
});
