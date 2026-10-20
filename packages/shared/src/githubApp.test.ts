import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { clearInstallationTokens, credentialToken, githubApiBase, GithubAppError, installationRepositories, installationToken, listInstallations, newCredentialId, seal, sealAppSecret } from "./index";

process.env.FALKON_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const secret = { appId: "12345", privateKey, installationId: "777" };

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const MIN = 60_000;
type Call = { url: string; method: string; auth: string };
/** A fetch stub: `mint` answers installation-token POSTs in order; everything else is routed by `routes`. */
function stub(mint: (Response | (() => Response))[], routes: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", auth: (init.headers as Record<string, string>).authorization });
    if (init.method === "POST") {
      const next = mint.shift();
      return typeof next === "function" ? next() : next!;
    }
    for (const [prefix, fn] of Object.entries(routes)) if (url.startsWith(prefix)) return fn();
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const minted = (token: string, expires: number) => () => Response.json({ token, expires_at: new Date(expires).toISOString() }, { status: 201 });
const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

test("githubApiBase: github.com and GHE", () => {
  assert.equal(githubApiBase("github.com"), "https://api.github.com");
  assert.equal(githubApiBase("ghe.example.com"), "https://ghe.example.com/api/v3");
});

test("mint signs an RS256 JWT with the App claims and posts to the installation endpoint", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_one", T0 + 60 * MIN)]);
  assert.equal(await installationToken({ id: "c1", host: "github.com", ...secret }, { fetch: f, now: () => T0 }), "ghs_one");
  assert.deepEqual([calls[0].url, calls[0].method], ["https://api.github.com/app/installations/777/access_tokens", "POST"]);
  const [h, p, sig] = calls[0].auth.replace("Bearer ", "").split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
  const claims = decode(p);
  assert.equal(claims.iss, "12345");
  assert.equal(claims.iat, T0 / 1000 - 60);
  assert.ok(claims.exp - claims.iat <= 10 * 60 && claims.exp > T0 / 1000);
  assert.ok(claims.exp - T0 / 1000 <= 9 * 60);
  assert.equal(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")), true);
});

test("GHE mint uses the /api/v3 base", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_ghe", T0 + 60 * MIN)]);
  await installationToken({ id: "c-ghe", host: "ghe.example.com", ...secret }, { fetch: f, now: () => T0 });
  assert.equal(calls[0].url, "https://ghe.example.com/api/v3/app/installations/777/access_tokens");
});

test("token is cached ~50 minutes, then refreshed", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_a", T0 + 60 * MIN), minted("ghs_b", T0 + 120 * MIN)]);
  const cred = { id: "c2", host: "github.com", ...secret };
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 }), "ghs_a");
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 49 * MIN }), "ghs_a");
  assert.equal(calls.length, 1);
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 51 * MIN }), "ghs_b");
  assert.equal(calls.length, 2);
});

test("cache honours a short expires_at minus margin", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_short", T0 + 10 * MIN), minted("ghs_next", T0 + 70 * MIN)]);
  const cred = { id: "c3", host: "github.com", ...secret };
  await installationToken(cred, { fetch: f, now: () => T0 });
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 6 * MIN }), "ghs_next");
  assert.equal(calls.length, 2);
});

test("a rejected token is dropped and the next call mints a new one", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_x", T0 + 60 * MIN), minted("ghs_y", T0 + 60 * MIN)]);
  const cred = { id: "c4", host: "github.com", ...secret };
  await installationToken(cred, { fetch: f, now: () => T0 });
  clearInstallationTokens("c4");
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + MIN }), "ghs_y");
  assert.equal(calls.length, 2);
});

test("mint failures: rejected App is invalid, outage is unavailable, malformed PEM is invalid; no secret in the message", async () => {
  clearInstallationTokens();
  const cred = { id: "c5", host: "github.com", ...secret };
  const kind = (e: unknown) => e instanceof GithubAppError && e.kind;
  for (const [res, k] of [[new Response("bad", { status: 401 }), "invalid"], [new Response("x", { status: 404 }), "invalid"], [new Response("x", { status: 500 }), "unavailable"]] as const) {
    const { f } = stub([res]);
    await assert.rejects(installationToken(cred, { fetch: f, now: () => T0 }), (e) => kind(e) === k);
  }
  await assert.rejects(installationToken(cred, { fetch: (async () => { throw new Error(`net ${privateKey}`); }) as never }), (e) => kind(e) === "unavailable" && !String((e as Error).message).includes("PRIVATE"));
  await assert.rejects(installationToken({ ...cred, privateKey: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----" }, { fetch: stub([]).f }), (e) => kind(e) === "invalid" && !String((e as Error).message).includes("not a key"));
});

test("listInstallations: GET /app/installations with the App JWT", async () => {
  const { f, calls } = stub([], { "https://ghe.example.com/api/v3/app/installations": () => Response.json([{ id: 9, account: { login: "acme" } }, { id: 10, account: { login: "bob" } }]) });
  assert.deepEqual(await listInstallations("ghe.example.com", "12345", privateKey, { fetch: f, now: () => T0 }), [{ id: "9", account: "acme" }, { id: "10", account: "bob" }]);
  const [h, p, sig] = calls[0].auth.replace("Bearer ", "").split(".");
  assert.equal(decode(p).iss, "12345");
  assert.equal(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")), true);
});

test("installationRepositories: /installation/repositories, .repositories, 100 per page, at most 3 pages", async () => {
  const seen: string[] = [];
  const page = (n: number) => ({ total_count: 999, repositories: Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${n}-${i}`, default_branch: "main", pushed_at: null })) });
  const f = (async (url: string, init: RequestInit) => {
    seen.push(url);
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer ghs_t");
    return Response.json(page(Number(new URL(url).searchParams.get("page"))));
  }) as unknown as typeof fetch;
  assert.equal((await installationRepositories("github.com", "ghs_t", { fetch: f })).length, 300);
  assert.deepEqual(seen, [1, 2, 3].map((n) => `https://api.github.com/installation/repositories?per_page=100&page=${n}`));
  const short = (async () => Response.json({ repositories: [{ full_name: "o/a", default_branch: "main", pushed_at: null }] })) as unknown as typeof fetch;
  assert.equal((await installationRepositories("github.com", "t", { fetch: short })).length, 1);
});

test("credentialToken: plain token for github-token rows, minted installation token for github-app rows", async () => {
  clearInstallationTokens();
  const plainId = newCredentialId();
  const plain = { id: plainId, host: "github.com", kind: "github-token", ...seal("ghp_plain", { id: plainId, host: "github.com" }) };
  assert.equal(await credentialToken(plain), "ghp_plain");
  const appId = newCredentialId();
  const row = { id: appId, host: "github.com", kind: "github-app", ...sealAppSecret(secret, { id: appId, host: "github.com" }) };
  const { f } = stub([minted("ghs_row", T0 + 60 * MIN)]);
  assert.equal(await credentialToken(row, { fetch: f, now: () => T0 }), "ghs_row");
  assert.equal(await credentialToken(row, { fetch: f, now: () => T0 + MIN }), "ghs_row"); // cached: stub has no second mint
});

test("maxAgeMs: a cached token older than it is re-minted, a younger one reused; no option keeps the 50 minute default", async () => {
  clearInstallationTokens();
  const { f, calls } = stub([minted("ghs_m1", T0 + 60 * MIN), minted("ghs_m2", T0 + 66 * MIN)]);
  const cred = { id: "c6", host: "github.com", ...secret };
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 }), "ghs_m1");
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 4 * MIN, maxAgeMs: 5 * MIN }), "ghs_m1");
  assert.equal(calls.length, 1);
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 6 * MIN, maxAgeMs: 5 * MIN }), "ghs_m2");
  assert.equal(calls.length, 2);
  assert.equal(await installationToken(cred, { fetch: f, now: () => T0 + 40 * MIN }), "ghs_m2"); // default: still cached
  assert.equal(calls.length, 2);
});

test("a malformed sealed secret is a fixed GithubAppError, not a SyntaxError", async () => {
  const id = newCredentialId();
  const row = { id, host: "github.com", kind: "github-app", ...seal("{not json PRIVATE", { id, host: "github.com" }) };
  await assert.rejects(credentialToken(row), (e) => e instanceof GithubAppError && e.kind === "invalid" && !e.message.includes("PRIVATE"));
});
