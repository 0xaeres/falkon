import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goldPaths, preflight, readKey, type EvalClient } from "./preflight.js";
import { TOOLS } from "./harness.js";

const names = ["a", "b", "c"];
const fakeClient = (o: { tools?: string[]; repos?: string[]; unreadable?: string[]; instructions?: string; v6?: boolean } = {}): EvalClient => ({
  getInstructions: () => o.instructions,
  listTools: async () => ({ tools: (o.tools ?? [...TOOLS, "research_codebase"]).map((name) => ({ name })) }),
  callTool: async ({ name, arguments: args }) => {
    if (name === "list_repos") {
      const all = o.repos ?? names.map((n) => `github.com/openmrs/${n}`), perPage = args.perPage as number, page = args.page as number;
      return { content: [{ type: "text", text: JSON.stringify({ repos: all.slice((page - 1) * perPage, page * perPage).map((n) => ({ name: n })), totalCount: all.length }) }] };
    }
    const bad = (o.unreadable ?? []).includes(`${args.repo}:${args.path}`);
    // The reference instance reports a missing file as ordinary text and wraps content in a <content> block with numbered lines.
    if (o.v6) return { content: [{ type: "text", text: bad ? "File not found: x" : "<content>\n1| line\n</content>" }] };
    return { isError: bad, content: [{ type: "text", text: bad ? "File not found" : "line" }] };
  },
  close: async () => {},
});
const base = { expectedRepos: names, gold: ["a/x.ts", "b/y/z.md"] };

test("gold paths are the unique declaration paths of both datasets, 104 of them", () => assert.equal(goldPaths().length, 104));

test("preflight passes when the stack lists exactly the product and every gold path reads", async () => {
  assert.equal(await preflight({ ...base, createClient: async () => fakeClient() }), "3 of 3 repositories; 2 of 2 gold paths readable");
});

test("preflight fails on a missing tool, a repository mismatch or an unreadable gold path", async () => {
  await assert.rejects(preflight({ ...base, createClient: async () => fakeClient({ tools: TOOLS }) }), /research_codebase/);
  await assert.rejects(preflight({ ...base, createClient: async () => fakeClient({ repos: ["github.com/openmrs/a", "github.com/openmrs/b"] }) }), /3 repositories.*found 2/);
  await assert.rejects(preflight({ ...base, createClient: async () => fakeClient({ repos: ["github.com/openmrs/a", "github.com/openmrs/b", "github.com/openmrs/zzz"] }) }), /do not match/);
  await assert.rejects(preflight({ ...base, createClient: async () => fakeClient({ unreadable: ["github.com/openmrs/b:y/z.md"] }) }), /1 of 2 gold paths unreadable: b\/y\/z\.md/);
});

test("a key file must be a private regular file; no key file means no key", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-key-"));
  try {
    assert.equal(readKey(undefined), undefined);
    const f = join(dir, "key"); writeFileSync(f, "tok\n", { mode: 0o600 });
    assert.equal(readKey(f), "tok");
    chmodSync(f, 0o644);
    assert.throws(() => readKey(f), /no more permissive than 600/);
    assert.throws(() => readKey(join(dir, "missing")), /missing/);
    writeFileSync(f, "", { mode: 0o600 }); chmodSync(f, 0o600);
    assert.throws(() => readKey(f), /empty/);
    writeFileSync(f, " \n\n", { mode: 0o600 }); chmodSync(f, 0o600);
    assert.throws(() => readKey(f), /empty/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the v6 instance is checked for the seven tools only, and a file counts as read only when its content block comes back", async () => {
  const v6 = (o = {}) => fakeClient({ tools: TOOLS, v6: true, ...o });
  assert.equal(await preflight({ ...base, kind: "v6", createClient: async () => v6() }), "3 of 3 repositories; 2 of 2 gold paths readable");
  await assert.rejects(preflight({ ...base, kind: "v6", createClient: async () => v6({ tools: TOOLS.slice(1) }) }), /missing: grep/);
  await assert.rejects(preflight({ ...base, kind: "v6", createClient: async () => v6({ unreadable: ["github.com/openmrs/a:x.ts"] }) }), /1 of 2 gold paths unreadable: a\/x\.ts/);
});

test("the instructions setting of a stack is checked when the arm needs a known one", async () => {
  await assert.rejects(preflight({ ...base, instructions: false, createClient: async () => fakeClient({ instructions: "Falkon searches" }) }), /instructions are on/);
  await assert.rejects(preflight({ ...base, instructions: true, createClient: async () => fakeClient() }), /instructions are off/);
  assert.match(await preflight({ ...base, instructions: false, createClient: async () => fakeClient() }), /3 of 3 repositories/);
  assert.match(await preflight({ ...base, instructions: true, createClient: async () => fakeClient({ instructions: "x" }) }), /3 of 3 repositories/);
});

test("a v6 target that lists research_codebase is the wrong server and is rejected", async () => {
  await assert.rejects(preflight({ ...base, kind: "v6", createClient: async () => fakeClient({ tools: [...TOOLS, "research_codebase"], v6: true }) }), /research_codebase.*not the v6 instance/);
});
