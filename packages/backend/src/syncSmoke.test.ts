import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, type RepoResult } from "./syncSmoke";

const ok: RepoResult = { repo: "a", access: "ok", status: "ok", prs: 3, rule: 2, api: 0 };

test("verdict: all good is undefined", () => assert.equal(verdict([ok, ok]), undefined));
test("verdict: the first failing reason, as a fixed message", () => {
  assert.match(verdict([{ ...ok, access: "no-access" }, { ...ok, status: "failed" }])!, /^no access: .*Pull requests: Read and Issues: Read/);
  assert.match(verdict([{ ...ok, status: "waiting" }])!, /^rate limited/);
  assert.match(verdict([{ ...ok, failed: true }])!, /^sync failed: GitHub request failed/);
});
test("verdict: nothing stored or nothing linked fails", () => {
  assert.equal(verdict([{ ...ok, prs: 0, rule: 0 }]), "no pull requests stored");
  assert.equal(verdict([{ ...ok, rule: 0 }]), "no commit links");
});
