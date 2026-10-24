import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolSource } from "@falkon/shared";
import type { UIMessage } from "ai";
import { answerPart, sourcesOf, toPortableMarkdown } from "./answer";
import { fileReferenceToString } from "./prompt";

const REPO = "github.com/openmrs/openmrs-core";
const PATH = "api/src/main/java/org/openmrs/api/impl/PatientServiceImpl.java";
const source: ToolSource = { type: "file", repo: REPO, path: PATH, name: "PatientServiceImpl.java", revision: "HEAD" };
const msg = (...texts: string[]): UIMessage => ({ id: "m", role: "assistant", parts: texts.map((text) => ({ type: "text", text })) });

test("the answer is the last text part after the answer tag", () => {
  const m = msg("thinking out loud", "Let me look.\n<!--answer-->\n**Answer** here");
  assert.equal(answerPart(m, false)?.text, "\n**Answer** here");
  assert.equal(answerPart(m, true)?.text, "\n**Answer** here");
});

test("without the tag the whole last text is the answer, unless the turn is still streaming", () => {
  const m = msg("first", "no tag here");
  assert.equal(answerPart(m, false)?.text, "no tag here");
  assert.equal(answerPart(m, true), undefined);
  assert.equal(answerPart({ id: "m", role: "assistant", parts: [] }, false), undefined);
});

test("@file: references become code spans naming repo, path and lines, with no link", () => {
  const text = `<!--answer-->\nSee @file:{${REPO}::${PATH}:1-40} and @file:{${REPO}::${PATH}} and @file:{${REPO}::${PATH}:7}.`;
  assert.equal(toPortableMarkdown(text, [source]), `See \`${REPO}/${PATH}:1-40\` and \`${REPO}/${PATH}\` and \`${REPO}/${PATH}:7\`.`);
});

test("a single-line range written as a-a is labelled with one line", () => {
  assert.equal(toPortableMarkdown(`@file:{${REPO}::${PATH}:5-5}`, [source]), `\`${REPO}/${PATH}:5\``);
});

test("references to files no tool returned become their bare path", () => {
  assert.equal(toPortableMarkdown(`@file:{${REPO}::does/not/exist.java:3}`, [source]), "does/not/exist.java");
});

test("sources match by suffix, so a short repo name or path still resolves to the full repo and path", () => {
  assert.equal(toPortableMarkdown(`@file:{openmrs-core::PatientServiceImpl.java}`, [source]), `\`${REPO}/${PATH}\``);
});

test("malformed references are left alone", () => {
  for (const bad of [`@file{${REPO}::a.ts}`, `@file:${REPO}::a.ts`, `@file:{a.ts}`]) assert.equal(toPortableMarkdown(bad, [source]), bad);
});

test("fileReferenceToString round-trips through the reference regex", () => {
  const s = fileReferenceToString({ repo: REPO, path: PATH, range: { startLine: 3, endLine: 9 } });
  assert.equal(s, `@file:{${REPO}::${PATH}:3-9}`);
  assert.equal(toPortableMarkdown(s, [source]), `\`${REPO}/${PATH}:3-9\``);
});

test("sourcesOf keeps file data-source parts only", () => {
  const messages = [
    { id: "a", role: "assistant", parts: [{ type: "data-source", data: source }, { type: "data-source", data: { type: "repo", repo: REPO } }, { type: "text", text: "x" }] },
  ] as unknown as UIMessage[];
  assert.deepEqual(sourcesOf(messages), [source]);
});
