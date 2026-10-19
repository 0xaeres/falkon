import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { masterKey, newCredentialId, openCredential, seal } from "./credentialStore";

const key = (b = 32) => Buffer.alloc(b, 7).toString("base64");
const env = (extra: Record<string, string> = {}) => ({ FALKON_SECRET_KEY: key(), ...extra });
const ids = { id: "abc", host: "github.com" };
const row = (token = "ghp_secret", e = env()) => ({ ...ids, ...seal(token, ids, e) });

test("seal and openCredential round-trip; the ciphertext does not contain the token", () => {
  const r = row("ghp_secret");
  assert.equal(openCredential(r, env()), "ghp_secret");
  assert.ok(!Buffer.from(r.ciphertext).includes("ghp_secret"));
  assert.equal(r.nonce.length, 12);
  assert.match(r.keyId, /^[0-9a-f]{8}$/);
});

test("a tampered ciphertext, other id or host, or another key fails to open", () => {
  const r = row();
  const flipped = Buffer.from(r.ciphertext);
  flipped[0] ^= 1;
  assert.throws(() => openCredential({ ...r, ciphertext: flipped }, env()), /cannot be decrypted/);
  assert.throws(() => openCredential({ ...r, id: "other" }, env()), /cannot be decrypted/);
  assert.throws(() => openCredential({ ...r, host: "evil.example" }, env()), /cannot be decrypted/);
  assert.throws(() => openCredential(r, { FALKON_SECRET_KEY: Buffer.alloc(32, 9).toString("base64") }), /cannot be decrypted/);
});

test("ids are 16 random bytes in base64url", () => {
  const a = newCredentialId();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, newCredentialId());
});

test("a key of the wrong length throws without echoing it", () => {
  const bad = Buffer.alloc(16, 5).toString("base64");
  assert.throws(() => masterKey({ FALKON_SECRET_KEY: bad }), (e: Error) => /32 bytes/.test(e.message) && !e.message.includes(bad));
});

test("FALKON_SECRET_KEY_FILE is read; with no key the engine generates a 0600 file that is stable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-key-"));
  const file = path.join(dir, "k");
  fs.writeFileSync(file, `${key()}\n`);
  assert.deepEqual(masterKey({ FALKON_SECRET_KEY_FILE: file }), Buffer.alloc(32, 7));
  const data = path.join(dir, "data");
  const first = masterKey({ DATA_DIR: data });
  assert.equal(first.length, 32);
  assert.equal(fs.statSync(path.join(data, "secrets", "master.key")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(data, "secrets")).mode & 0o777, 0o700);
  assert.deepEqual(masterKey({ DATA_DIR: data }), first);
  assert.deepEqual(fs.readdirSync(path.join(data, "secrets")), ["master.key"], "no temp file left behind");
});
