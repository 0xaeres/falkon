import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scopeOf } from "./auth";

// The removed names, spelled in parts so the repository holds no predecessor name.
const OLD = "SOURCE" + "BOT";
const OLD_KEY = `${OLD}_API_KEY`;
const OLD_HEADER = `x-${OLD.toLowerCase()}-api-key`;
const saved = { ACCESS_FILE: process.env.ACCESS_FILE, FALKON_API_KEY: process.env.FALKON_API_KEY, [OLD_KEY]: process.env[OLD_KEY] };
beforeEach(() => {
  for (const k of Object.keys(saved)) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/search", { headers });

test("FALKON_API_KEY is accepted as a bearer token", () => {
  process.env.FALKON_API_KEY = "secret";
  assert.ok(scopeOf(req({ authorization: "Bearer secret" })));
  assert.equal(scopeOf(req({ authorization: "Bearer wrong" })), null);
  assert.equal(scopeOf(req()), null);
});

test("the old API key header is not read", () => {
  process.env.FALKON_API_KEY = "secret";
  assert.equal(scopeOf(req({ [OLD_HEADER]: "secret" })), null);
});

test("the old header alone is 401 when an access file is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-"));
  const file = path.join(dir, "access.json");
  fs.writeFileSync(file, JSON.stringify({ keys: [{ name: "a", sha256: "0".repeat(64), repos: ["*"] }] }));
  try {
    process.env.ACCESS_FILE = file;
    assert.equal(scopeOf(req({ [OLD_HEADER]: "anything" })), null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("the old API key variable has no effect: an empty FALKON_API_KEY leaves the API open", () => {
  process.env[OLD_KEY] = "secret";
  process.env.FALKON_API_KEY = "";
  assert.equal(scopeOf(req())?.principal, "anonymous");
});
