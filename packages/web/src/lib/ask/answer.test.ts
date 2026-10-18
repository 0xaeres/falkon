import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolSource } from "@sbc/shared";
import type { UIMessage } from "ai";
import { answerPart, sourcesOf, toPortableMarkdown } from "./answer";
import { fileReferenceToString } from "./prompt";

const REPO = "github.com/openmrs/openmrs-core";
const PATH = "api/src/main/java/org/openmrs/api/impl/PatientServiceImpl.java";
const BASE = "http://sb.test";
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

test("@file: references become browse links with the file name and highlight range", () => {
  const text = `<!--answer-->\nSee @file:{${REPO}::${PATH}:1-40} and @file:{${REPO}::${PATH}} and @file:{${REPO}::${PATH}:7}.`;
  const enc = encodeURIComponent(PATH);
  assert.equal(
    toPortableMarkdown(text, BASE, [source]),
    `See [PatientServiceImpl.java:1-40](${BASE}/browse/${REPO}@HEAD/-/blob/${enc}?highlightRange=1%2C40) and ` +
      `[PatientServiceImpl.java](${BASE}/browse/${REPO}@HEAD/-/blob/${enc}) and ` +
      `[PatientServiceImpl.java:7](${BASE}/browse/${REPO}@HEAD/-/blob/${enc}?highlightRange=7%2C7).`,
  );
});

test("a single-line range written as a-a is labelled with one line", () => {
  assert.match(toPortableMarkdown(`@file:{${REPO}::${PATH}:5-5}`, BASE, [source]), /^\[PatientServiceImpl\.java:5\]\(.*highlightRange=5%2C5\)$/);
});

test("references to files no tool returned become their bare path", () => {
  assert.equal(toPortableMarkdown(`@file:{${REPO}::does/not/exist.java:3}`, BASE, [source]), "does/not/exist.java");
});

test("sources match by suffix, so a short repo name or path still resolves", () => {
  assert.match(toPortableMarkdown(`@file:{openmrs-core::PatientServiceImpl.java}`, BASE, [source]), /^\[PatientServiceImpl\.java\]\(http:\/\/sb\.test\/browse\/openmrs-core@HEAD\//);
});

test("malformed references are left alone", () => {
  for (const bad of [`@file{${REPO}::a.ts}`, `@file:${REPO}::a.ts`, `@file:{a.ts}`]) assert.equal(toPortableMarkdown(bad, BASE, [source]), bad);
});

test("fileReferenceToString round-trips through the reference regex", () => {
  const s = fileReferenceToString({ repo: REPO, path: PATH, range: { startLine: 3, endLine: 9 } });
  assert.equal(s, `@file:{${REPO}::${PATH}:3-9}`);
  assert.equal(toPortableMarkdown(s, BASE, [source]), `[PatientServiceImpl.java:3-9](${BASE}/browse/${REPO}@HEAD/-/blob/${encodeURIComponent(PATH)}?highlightRange=3%2C9)`);
});

test("sourcesOf keeps file data-source parts only", () => {
  const messages = [
    { id: "a", role: "assistant", parts: [{ type: "data-source", data: source }, { type: "data-source", data: { type: "repo", repo: REPO } }, { type: "text", text: "x" }] },
  ] as unknown as UIMessage[];
  assert.deepEqual(sourcesOf(messages), [source]);
});
