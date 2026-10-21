import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { answerPartSchema, answerSchema, evidencePartSchema, messagesToAnswers, paragraphSchema, type Evidence } from "@sbc/contracts";
import type { ToolSource } from "@sbc/shared";
import { buildEvidence } from "./evidence";
import { ANSWER_TAG, FILE_REFERENCE_REGEX, REPLY_TAG } from "./prompt";

const APP = "github.com/acme/app";
const LIB = "github.com/acme/lib";
const src = (repo: string, path: string, revision = "rev1234"): ToolSource => ({ type: "file", repo, path, name: path.split("/").pop()!, revision });
const ref = (repo: string, path: string, a?: number, b?: number) => `@file:{${repo}::${path}${a === undefined ? "" : `:${a}${b === undefined ? "" : `-${b}`}`}}`;
/** A file whose line n is "L<n>", so a window can be checked without recomputing the slicing. */
const file = (n: number) => Array.from({ length: n }, (_, i) => `L${i + 1}`).join("\n");

type Result = Awaited<ReturnType<typeof buildEvidence>>;
const run = (o: Partial<Parameters<typeof buildEvidence>[0]> & { text: string }, files: Record<string, string> = {}) =>
  buildEvidence({
    sources: [src(APP, "src/a.ts"), src(APP, "src/b.ts"), src(LIB, "lib/c.ts")],
    scopeAllows: (r) => r === APP || r === LIB,
    productId: "pay",
    generation: "g-abc123",
    stepCapHit: false,
    readFile: async (repo, path) => {
      const content = files[`${repo}::${path}`];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    ...o,
  });
const evidenceOf = (r: Result) => r.filter((p) => p.type === "data-evidence").map((p) => p.data as Evidence);
const answerOf = (r: Result) => r.find((p) => p.type === "data-answer")!.data as ReturnType<typeof answerPartSchema.parse>;
const FILES = { [`${APP}::src/a.ts`]: file(200), [`${APP}::src/b.ts`]: file(10), [`${LIB}::lib/c.ts`]: file(100) };

/** The properties every result must have, whatever the input. `files` maps repo::path to its line count. */
function assertProperties(r: Result, lineCounts: Record<string, number>) {
  const evidence = evidenceOf(r);
  const answer = answerOf(r);
  assert(answerPartSchema.safeParse(answer).success, "data-answer validates");
  assert.deepEqual(r.map((p) => p.type), [...evidence.map(() => "data-evidence"), "data-answer"]);
  assert(evidence.length <= 12);
  assert.deepEqual(evidence.map((e) => e.id), evidence.map((_, i) => i + 1), "ids by first appearance, dense");
  for (const e of evidence) {
    assert(evidencePartSchema.safeParse(e).success);
    const total = lineCounts[`${e.repository}::${e.path}`]!;
    assert(e.startLine >= 1 && e.code.length >= 1 && e.code.length <= 60 && e.startLine + e.code.length - 1 <= total, `span inside file: ${e.path}`);
    e.code.forEach((l, i) => assert.equal(l, `L${e.startLine + i}`));
    for (const h of e.highlightedLines) assert(h >= e.startLine && h < e.startLine + e.code.length);
  }
  const ids = new Set(evidence.map((e) => e.id));
  for (const p of answer.paragraphs) {
    assert(paragraphSchema.safeParse(p).success, "every marker is declared in its paragraph");
    for (const c of p.citations) assert(ids.has(c), `citation ${c} has evidence`);
    for (const m of p.text.matchAll(/\[(\d+)\]/g)) assert(ids.has(Number(m[1])));
    if (!/^```/.test(p.text)) assert(!p.text.includes("@file:"), "no raw reference survives outside fences");
  }
}
const COUNTS = { [`${APP}::src/a.ts`]: 200, [`${APP}::src/b.ts`]: 10, [`${LIB}::lib/c.ts`]: 100 };

test("resolves a reference to evidence: window of 3 lines around the cited range, marker in the paragraph", async () => {
  const r = await run({ text: `${ANSWER_TAG}\nIt starts here ${ref("acme/app", "a.ts", 20, 22)} and ends.` }, FILES);
  const [e] = evidenceOf(r);
  assert.deepEqual([e!.repository, e!.path, e!.revision, e!.productId, e!.generation, e!.startLine, e!.code.length], [APP, "src/a.ts", "rev1234", "pay", "g-abc123", 17, 9]);
  assert.deepEqual(e!.highlightedLines, [20, 21, 22]);
  const a = answerOf(r);
  assert.deepEqual([a.kind, a.paragraphs, a.abstention, a.partialReasons], ["grounded", [{ text: "It starts here [1] and ends.", citations: [1] }], null, []]);
  assertProperties(r, COUNTS);
});

test("the window clips to the file and caps at 60 lines with the cited range highlighted inside it", async () => {
  const top = evidenceOf(await run({ text: ref(APP, "src/a.ts", 1, 2) }, FILES))[0]!;
  assert.deepEqual([top.startLine, top.code.length, top.highlightedLines], [1, 5, [1, 2]]);
  const end = evidenceOf(await run({ text: ref(APP, "src/b.ts", 9, 10) }, FILES))[0]!;
  assert.deepEqual([end.startLine, end.code.length, end.highlightedLines], [6, 5, [9, 10]]);
  const long = evidenceOf(await run({ text: ref(APP, "src/a.ts", 10, 150) }, FILES))[0]!;
  assert.deepEqual([long.startLine, long.code.length, long.highlightedLines[0], long.highlightedLines.at(-1)], [7, 60, 10, 66]);
  const past = evidenceOf(await run({ text: ref(APP, "src/b.ts", 8, 99) }, FILES))[0]!;
  assert.deepEqual([past.startLine, past.code.length, past.highlightedLines.at(-1)], [5, 6, 10], "end past EOF is clipped");
});

test("a reference without a range shows the first 30 lines and highlights none", async () => {
  const [e] = evidenceOf(await run({ text: ref(APP, "src/a.ts") }, FILES));
  assert.deepEqual([e!.startLine, e!.code.length, e!.highlightedLines], [1, 30, []]);
  const [short] = evidenceOf(await run({ text: ref(APP, "src/b.ts") }, FILES));
  assert.equal(short!.code.length, 10);
});

test("resolution uses sources by repo suffix and path suffix, needs exactly one match, and respects scope", async () => {
  const ambiguous = [src(APP, "src/x/util.ts"), src(APP, "src/y/util.ts")];
  const files = { ...FILES, [`${APP}::src/x/util.ts`]: file(20), [`${APP}::src/y/util.ts`]: file(20) };
  assert.equal(evidenceOf(await run({ text: ref("app", "util.ts", 1, 2), sources: ambiguous }, files)).length, 0, "two matches: unresolved");
  assert.equal(evidenceOf(await run({ text: ref("app", "x/util.ts", 1, 2), sources: ambiguous }, files)).length, 1, "a longer suffix is unique");
  assert.equal(evidenceOf(await run({ text: ref("pp", "src/a.ts", 1, 2) }, FILES)).length, 0, "suffix must start at a segment boundary");
  assert.equal(evidenceOf(await run({ text: ref(APP, "a.ts", 1, 2), scopeAllows: () => false }, FILES)).length, 0, "out of scope");
  assert.equal(evidenceOf(await run({ text: ref(APP, "src/never-read.ts", 1, 2) }, FILES)).length, 0, "not among the sources");
  const twice = [src(APP, "src/a.ts"), src(APP, "src/a.ts")];
  assert.equal(evidenceOf(await run({ text: ref(APP, "a.ts", 1, 2), sources: twice }, FILES)).length, 1, "the same file read twice is one match");
});

test("identical references share one evidence id; ids follow first appearance", async () => {
  const text = `One ${ref(APP, "src/b.ts", 2, 3)}.\n\nTwo ${ref(APP, "src/a.ts", 5, 6)} then ${ref("app", "a.ts", 5, 6)} and ${ref(APP, "src/b.ts", 2, 3)}.`;
  const r = await run({ text }, FILES);
  assert.deepEqual(evidenceOf(r).map((e) => [e.id, e.path]), [[1, "src/b.ts"], [2, "src/a.ts"]]);
  assert.deepEqual(answerOf(r).paragraphs, [{ text: "One [1].", citations: [1] }, { text: "Two [2] then [2] and [1].", citations: [2, 1] }]);
  assertProperties(r, COUNTS);
});

test("kind: grounded, partial (dropped reference, step cap, evidence cap), abstention (no evidence)", async () => {
  const good = `A ${ref(APP, "src/a.ts", 1, 2)}.`;
  assert.equal(answerOf(await run({ text: good }, FILES)).kind, "grounded");

  const dropped = answerOf(await run({ text: `${good} B ${ref(APP, "src/gone.ts", 1, 2)}.` }, FILES));
  assert.deepEqual([dropped.kind, dropped.partialReasons, dropped.paragraphs[0]!.text], ["partial", ["1 reference could not be verified."], "A [1]. B src/gone.ts."]);

  const capped = answerOf(await run({ text: good, stepCapHit: true }, FILES));
  assert.deepEqual([capped.kind, capped.partialReasons], ["partial", ["The agent stopped at its step limit, so the answer may be incomplete."]]);

  const none = answerOf(await run({ text: `${ANSWER_TAG}\nNothing found for this question.`, stepCapHit: true }, FILES));
  assert.deepEqual([none.kind, none.paragraphs, none.abstention], ["abstention", [], "Nothing found for this question."]);
  const unresolvedOnly = answerOf(await run({ text: `See ${ref(APP, "src/gone.ts", 1, 2)}.` }, FILES));
  assert.deepEqual([unresolvedOnly.kind, unresolvedOnly.abstention], ["abstention", "See src/gone.ts."]);
});

test("a file that cannot be read or is empty drops the reference", async () => {
  const r = await run({ text: `${ref(APP, "src/a.ts", 1, 2)} ${ref(APP, "src/b.ts", 1, 2)}` }, { [`${APP}::src/b.ts`]: "" });
  assert.equal(evidenceOf(r).length, 0);
  assert.equal(answerOf(r).kind, "abstention");
});

test("evidence is capped at 12; later references keep their path without a marker", async () => {
  const paths = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
  const sources = paths.map((p) => src(APP, p));
  const files = Object.fromEntries(paths.map((p) => [`${APP}::${p}`, file(50)]));
  const r = await run({ text: paths.map((p) => `Uses ${ref(APP, p, 3, 4)}.`).join("\n\n"), sources }, files);
  assert.equal(evidenceOf(r).length, 12);
  const a = answerOf(r);
  assert.deepEqual([a.kind, a.partialReasons], ["partial", ["8 references were not shown (limit 12)."]]);
  assert.equal(a.paragraphs[12]!.text, "Uses f12.ts.");
  assertProperties(r, Object.fromEntries(paths.map((p) => [`${APP}::${p}`, 50])));
});

test("hostile references: parent paths, other repos, ranges past EOF, reversed ranges, huge numbers", async () => {
  const sources = [...[src(APP, "src/a.ts")], src("github.com/secret/vault", "keys.txt")];
  const text = [
    ref(APP, "../../etc/passwd", 1, 2),
    ref(APP, "src/../src/a.ts", 1, 2),
    ref("secret/vault", "keys.txt", 1, 2),
    ref(APP, "src/a.ts", 500, 600),
    ref(APP, "src/a.ts", 0, 0),
    ref(APP, "src/a.ts", 30, 10),
    ref(APP, "src/a.ts", 99999999999999999999, 99999999999999999999),
  ].join(" ");
  const files = { ...FILES, "github.com/secret/vault::keys.txt": file(10) };
  const r = await run({ text, sources, scopeAllows: (x) => x === APP }, files);
  const evidence = evidenceOf(r);
  assert(evidence.every((e) => e.repository === APP && e.path === "src/a.ts"));
  assert.equal(evidence.length, 2, "only the reversed range and the 0 start (clamped) resolve");
  assertProperties(r, COUNTS);
});

test("thousands of references finish with at most 12 evidence items", async () => {
  const text = Array.from({ length: 5000 }, (_, i) => `Claim ${i} ${ref(APP, "src/a.ts", i + 1, i + 2)}.`).join("\n\n");
  const r = await run({ text }, FILES);
  assertProperties(r, COUNTS);
  assert.equal(evidenceOf(r).length, 12);
  const none = await run({ text: Array.from({ length: 5000 }, (_, i) => ref("x/y", `p${i}.ts`, 1, 2)).join(" ") }, FILES);
  assert.equal(answerOf(none).kind, "abstention");
});

test("references inside code fences stay literal; fences are never split; blank lines split paragraphs", async () => {
  const text = [
    "Intro " + ref(APP, "src/a.ts", 1, 2),
    "",
    "```ts",
    `const x = "${ref(APP, "src/b.ts", 1, 2)}";`,
    "",
    "arr[0] = 1;",
    "```",
    "",
    "```mermaid",
    "graph TD",
    "",
    "  A --> B",
    "```",
    "",
    "After.",
  ].join("\n");
  const r = await run({ text }, FILES);
  const a = answerOf(r);
  assert.equal(a.paragraphs.length, 4);
  assert(a.paragraphs[1]!.text.startsWith("```ts") && a.paragraphs[1]!.text.endsWith("```") && a.paragraphs[1]!.text.includes("@file:{"), "literal reference kept inside the fence");
  assert(a.paragraphs[2]!.text.includes("graph TD\n\n  A --> B"));
  assert.deepEqual(evidenceOf(r).map((e) => e.path), ["src/a.ts"]);
  assert(!/\[0\]/.test(a.paragraphs[1]!.text) && a.paragraphs[1]!.text.includes("arr[​0]"), "a literal [0] cannot read as a citation marker");
  assert(answerPartSchema.safeParse(a).success);
});

test("literal [n] in prose is defused so only real markers remain; an unterminated fence runs to the end", async () => {
  const r = await run({ text: `Use items[1] and ${ref(APP, "src/a.ts", 1, 2)}.\n\n\`\`\`\nopen fence ${ref(APP, "src/b.ts", 1, 2)}\n\nstill code` }, FILES);
  const a = answerOf(r);
  assert.deepEqual(a.paragraphs.map((p) => p.citations), [[1], []]);
  assert.equal(a.paragraphs.length, 2);
  assertProperties(r, COUNTS);
});

test("text without the answer tag is used whole; with the tag, only what follows it", async () => {
  assert.equal(answerOf(await run({ text: `Plain ${ref(APP, "src/a.ts", 1, 2)}` }, FILES)).paragraphs[0]!.text, "Plain [1]");
  assert.equal(answerOf(await run({ text: `thinking...\n${ANSWER_TAG}\nFinal ${ref(APP, "src/a.ts", 1, 2)}` }, FILES)).paragraphs[0]!.text, "Final [1]");
  assert.equal(answerOf(await run({ text: "" }, FILES)).kind, "abstention");
});

test("stored parts map back through messagesToAnswers to a valid Answer", async () => {
  const parts = await run({ text: `Hello ${ref(APP, "src/a.ts", 4, 5)}.` }, FILES);
  const [a] = messagesToAnswers("pay", [{ id: "u", role: "user", parts: [{ type: "text", text: "q" }] }, { id: "m", role: "assistant", parts }]);
  assert(answerSchema.safeParse(a).success);
  assert.deepEqual([a!.kind, a!.evidence.length, a!.generation], ["grounded", 1, "g-abc123"]);
});

// Real answer texts from the cycle 4 Haiku eval runs (text and sources' repo/path only, no corpus content).
test("fixture: real answers resolve at least 95% of their references and satisfy the properties", async () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL("./evidence.fixture.json", import.meta.url), "utf8")) as { id: string; text: string; sources: { repo: string; path: string }[] }[];
  assert(fixtures.length >= 8);
  let total = 0; // occurrences
  let marked = 0; // occurrences shown with a marker
  let distinct = 0;
  let unverified = 0;
  let capped = 0;
  for (const f of fixtures) {
    const sources = f.sources.map((s) => src(s.repo, s.path));
    const r = await buildEvidence({ text: f.text, sources, scopeAllows: () => true, productId: "openmrs", generation: "g-000000", stepCapHit: false, readFile: async () => file(5000) });
    const refs = [...f.text.matchAll(new RegExp(FILE_REFERENCE_REGEX))];
    total += refs.length;
    distinct += new Set(refs.map((m) => m[0])).size;
    const a = answerOf(r);
    marked += a.paragraphs.reduce((n, p) => n + [...p.text.matchAll(/\[(\d+)\]/g)].length, 0);
    for (const reason of a.partialReasons) {
      unverified += Number(reason.match(/^(\d+) references? could not/)?.[1] ?? 0);
      capped += Number(reason.match(/^(\d+) references? (?:was|were) not shown/)?.[1] ?? 0);
    }
    const counts: Record<string, number> = {};
    for (const e of evidenceOf(r)) counts[`${e.repository}::${e.path}`] = 5000;
    assertProperties(r, counts);
  }
  const resolved = distinct - unverified;
  console.log(`evidence fixture: ${resolved}/${distinct} distinct references resolved (${((100 * resolved) / distinct).toFixed(1)}%), ${capped} of them over the 12-item cap; ${marked}/${total} occurrences carry a marker; ${fixtures.length} answers`);
  assert(resolved / distinct >= 0.95, `${resolved}/${distinct}`);
});

test("reply: no evidence plus the marker is a conversational reply, marker stripped, fixed suggestions, no abstention text", async () => {
  for (const text of ["Hey! I can search this Product's code.", "I can find code, trace callers and explain how things work."]) {
    const a = answerOf(await run({ text: `${ANSWER_TAG}\n${REPLY_TAG}\n${text}`, sources: [] }, FILES));
    assert.deepEqual([a.kind, a.paragraphs, a.abstention, a.partialReasons], ["reply", [{ text, citations: [] }], null, []]);
    assert(a.suggestions.length >= 2 && a.suggestions.length <= 3);
  }
  const r = await run({ text: `${ANSWER_TAG}\n${REPLY_TAG}\nThanks, glad to help.`, sources: [] }, FILES);
  assert.deepEqual(r.map((p) => p.type), ["data-answer"]);
  assert(answerPartSchema.safeParse(answerOf(r)).success);
  assert(!JSON.stringify(r).includes(REPLY_TAG));
});

test("reply: no marker stays an abstention with its text; a marker with an empty body falls back too", async () => {
  const unsupported = answerOf(await run({ text: `${ANSWER_TAG}\nI could not find the billing cron in this Product.` }, FILES));
  assert.deepEqual([unsupported.kind, unsupported.paragraphs, unsupported.abstention, unsupported.suggestions], ["abstention", [], "I could not find the billing cron in this Product.", []]);
  const hey = answerOf(await run({ text: `${ANSWER_TAG}\nHey there!`, sources: [] }, FILES));
  assert.equal(hey.kind, "abstention", "a model reply that omits the marker is the safe default");
  const empty = answerOf(await run({ text: `${ANSWER_TAG}\n${REPLY_TAG}`, sources: [] }, FILES));
  assert.deepEqual([empty.kind, empty.abstention], ["abstention", "No answer was produced."]);
});

test("reply: evidence wins over the marker (a greeting plus a code question is grounded or partial)", async () => {
  const text = `${ANSWER_TAG}\n${REPLY_TAG}\nHey! Auth starts here ${ref(APP, "src/a.ts", 1, 2)}.`;
  const a = answerOf(await run({ text }, FILES));
  assert.deepEqual([a.kind, a.paragraphs[0]!.text, a.suggestions], ["grounded", "Hey! Auth starts here [1].", []]);
  assert.equal(answerOf(await run({ text, stepCapHit: true }, FILES)).kind, "partial");
});

test("reply: the marker counts only as the first non-blank line after the answer tag; elsewhere it is left alone", async () => {
  const first = answerOf(await run({ text: `${ANSWER_TAG}\n\n  ${REPLY_TAG}  \nHello.`, sources: [] }, FILES));
  assert.deepEqual([first.kind, first.paragraphs[0]!.text], ["reply", "Hello."]);
  const fence = answerOf(await run({ text: `${ANSWER_TAG}\nNothing found.\n\n\`\`\`\n${REPLY_TAG}\n\`\`\`` }, FILES));
  assert.equal(fence.kind, "abstention");
  assert(fence.abstention!.includes(REPLY_TAG), "not stripped");
  const quoted = answerOf(await run({ text: `${ANSWER_TAG}\nNo such thing; I would tag a greeting with ${REPLY_TAG} here.` }, FILES));
  assert.deepEqual([quoted.kind, quoted.abstention], ["abstention", `No such thing; I would tag a greeting with ${REPLY_TAG} here.`]);
  const noTag = answerOf(await run({ text: `${REPLY_TAG}\nHi.`, sources: [] }, FILES));
  assert.equal(noTag.kind, "reply", "a missing answer tag does not matter");
});

test("reply: a turn that read files or hit the step cap abstains even when tagged", async () => {
  const text = `${ANSWER_TAG}\n${REPLY_TAG}\nI looked and found nothing.`;
  const searched = answerOf(await run({ text }, FILES));
  assert.equal(searched.kind, "abstention", "sources were read");
  const none = answerOf(await run({ text, sources: [] }, FILES));
  assert.equal(none.kind, "reply");
  const capped = answerOf(await run({ text, sources: [], stepCapHit: true }, FILES));
  assert.deepEqual([capped.kind, capped.partialReasons], ["abstention", ["The agent stopped at its step limit, so the answer may be incomplete."]]);
});

test("reply: a reply never carries partial reasons", async () => {
  const a = answerOf(await run({ text: `${ANSWER_TAG}\n${REPLY_TAG}\nHi, see src/x.ts ${ref(APP, "src/gone.ts", 1, 2)}.`, sources: [] }, FILES));
  assert.deepEqual([a.kind, a.partialReasons], ["reply", []]);
});
