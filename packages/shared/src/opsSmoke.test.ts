import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Exercise a copy of the script with fake external commands. No Docker, network,
// production files or real golden baseline is touched by these checks.
function smoke(options: { baseline?: unknown; record?: boolean; scenario?: string } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-smoke-test-"));
  const root = path.join(temp, "root");
  const bin = path.join(temp, "bin");
  for (const dir of ["scripts", "tests/fixtures", "tests/golden"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.mkdirSync(bin);
  fs.copyFileSync(new URL("../../../scripts/ops-smoke.sh", import.meta.url), path.join(root, "scripts/ops-smoke.sh"));
  fs.writeFileSync(path.join(root, "tests/fixtures/build.sh"), `#!/bin/sh
mkdir -p "$1/repos/atlas"
printf '{}' > "$1/repos/atlas/README.md"
printf '{"connections":{"archive":{}}}' > "$1/config.json"
`);
  const mockFile = path.join(bin, "mock.cjs");
  fs.writeFileSync(mockFile, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const scenario = process.env.SMOKE_SCENARIO;
const auth = args.map((a, i) => args[i - 1] === '--header' ? (a.startsWith('@') ? fs.readFileSync(a.slice(1), 'utf8').trim() : a) : '').find((a) => a.startsWith('authorization:'));
fs.appendFileSync(process.env.SMOKE_EVENTS, JSON.stringify({ command, args, auth }) + '\\n');
if (command === 'date') {
  const tick = process.env.SMOKE_EVENTS + '.tick';
  const next = fs.existsSync(tick) ? Number(fs.readFileSync(tick, 'utf8')) + 1 : 0;
  fs.writeFileSync(tick, String(next));
  console.log(next);
} else if (command === 'docker') {
  if (args.includes('exec')) process.exit(scenario === 'seed-fail' ? 1 : 0);
  if (args[0] === 'stats') {
    const names = ['backend', 'zoekt', 'postgres', 'redis', 'api'].slice(0, scenario === 'memory-four' ? 4 : 5);
    for (const [i, name] of names.entries()) {
      const usage = scenario === 'memory-bad' && !i ? 'n/a' : scenario === 'memory-fail' ? (i ? '100MB' : '254.01MB') :
        scenario === 'memory-edge' ? (i ? '100MB' : '254MB') :
        ['100MiB', '100MB', '50000kB', '50000KiB', '100MB'][i];
      console.log(JSON.stringify({ Name: name, MemUsage: usage + ' / 2GiB' }));
    }
  } else if (args.includes('ps')) console.log(scenario === 'memory-four' ? 'backend\\nzoekt\\npostgres\\nredis' : 'backend\\nzoekt\\npostgres\\nredis\\napi');
  else if (args.includes('logs')) console.log('fixture compose failure logs');
} else if (command === 'pnpm') {
  if (args.includes('exec')) process.exit(scenario === 'deps' ? 1 : 0);
  const record = args.indexOf('golden:record');
  if (record >= 0) fs.writeFileSync(args[record + 1], JSON.stringify({ capture: scenario === 'unstable' && args[record + 1].endsWith('after.json') ? 2 : scenario === 'api-drift' && process.env.MCP_PATH ? 3 : 1 }));
  const diff = args.indexOf('golden:diff');
  if (diff >= 0) process.exit(fs.readFileSync(args[diff + 1], 'utf8') === fs.readFileSync(args[diff + 2], 'utf8') ? 0 : 1);
} else if (command === 'curl' && args.includes('--write-out')) {
  const url = args.at(-1);
  const method = args.includes('--request') ? args[args.indexOf('--request') + 1] : 'GET';
  let code = scenario === 'api-down' ? '000' : '200';
  const authed = scenario === 'admin-open' || /^authorization: Bearer [0-9a-f]{48}$/.test(auth || '');
  if (url.includes(':3302/') && !authed) code = '401';
  else if (url.endsWith('/mcp/no-such-product')) code = '404';
  else if (url.endsWith('/products') || url.endsWith('/connections')) code = scenario === 'admin-exposed' || (scenario === 'products-back' && url.endsWith('/products')) ? '200' : url.includes(':3301/') ? '404' : url.endsWith('/products') ? '404' : '200';
  process.stdout.write(code);
} else if (command === 'curl') {
  const out = args[args.indexOf('-o') + 1];
  const query = args.find(arg => arg.startsWith('q=')).slice(2);
  const match = /repo:\\^fixtures.test\\/(\\w+)/.exec(query);
  const name = match && match[1];
  const config = JSON.parse(fs.readFileSync(path.join(path.dirname(out), 'config.json'), 'utf8'));
  const present = name && (name !== 'archive' || config.connections.archive || scenario === 'delete-stuck');
  fs.writeFileSync(out, JSON.stringify({ files: present ? [{ repo: 'fixtures.test/' + name }] : [], isSearchExhaustive: true }));
}
`, { mode: 0o755 });
  for (const command of ["docker", "pnpm", "curl", "git", "date", "sleep"]) fs.symlinkSync(mockFile, path.join(bin, command));
  const baseline = path.join(root, "tests/golden/expected.json");
  if (options.baseline !== undefined) fs.writeFileSync(baseline, JSON.stringify(options.baseline));
  try {
    const result = spawnSync("sh", [path.join(root, "scripts/ops-smoke.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SMOKE_EVENTS: path.join(temp, "events"), SMOKE_SCENARIO: options.scenario ?? "", SMOKE_TIMEOUT: "3", GOLDEN_RECORD: options.record ? "1" : "0", GOLDEN_OUTPUT: "" },
      encoding: "utf8", timeout: 15_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr,
      baseline: fs.existsSync(baseline) ? JSON.parse(fs.readFileSync(baseline, "utf8")) : undefined,
      events: fs.readFileSync(path.join(temp, "events"), "utf8").trim().split("\n").map(line => JSON.parse(line) as { command: string; args: string[]; auth?: string }),
    };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test("smoke compares two captures, warns without a baseline and records only when requested", () => {
  const missing = smoke();
  assert.equal(missing.status, 0, missing.output);
  assert.match(missing.output, /WARN no baseline exists/);
  assert.match(missing.output, /PASS golden-stability/);
  assert.match(missing.output, /INFO memory: whole clone stack 406\.06 MB/);
  assert.equal(missing.baseline, undefined);
  assert.equal(missing.events.filter(event => event.args.includes("golden:record")).length, 2);
  const recorded = smoke({ record: true });
  assert.equal(recorded.status, 0, recorded.output);
  assert.deepEqual(recorded.baseline, { capture: 1 });
  assert.match(recorded.output, /PASS golden-record/);
  const existing = smoke({ baseline: { capture: 1 } });
  assert.equal(existing.status, 0, existing.output);
  assert.match(existing.output, /PASS golden-baseline/);
});

test("smoke fails baseline drift or unstable captures and dumps compose logs before teardown", () => {
  for (const options of [{ baseline: { capture: 0 }, record: true }, { scenario: "unstable" }]) {
    const result = smoke(options);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAIL golden-/);
    assert.match(result.output, /fixture compose failure logs/);
    const logs = result.events.findIndex(event => event.command === "docker" && event.args.includes("logs"));
    const down = result.events.findIndex(event => event.command === "docker" && event.args.includes("down"));
    assert.ok(logs >= 0 && down > logs);
    assert.ok(result.events[logs]!.args.includes("--tail=200"));
    assert.deepEqual(result.baseline, "baseline" in options ? options.baseline : undefined);
  }
});

test("smoke reports whole-stack memory as information at any size, including postgres and redis", () => {
  const edge = smoke({ scenario: "memory-edge" });
  assert.equal(edge.status, 0, edge.output);
  assert.match(edge.output, /INFO memory: whole clone stack 654\.00 MB \(reference ceiling 654 MB\)/);
  const over = smoke({ scenario: "memory-fail", record: true });
  assert.equal(over.status, 0, over.output);
  assert.match(over.output, /INFO memory: whole clone stack 654\.01 MB \(reference ceiling 654 MB\)/);
  assert.doesNotMatch(over.output, /FAIL/);
});

test("smoke still fails memory when the measurement itself is unreliable", () => {
  const bad = smoke({ scenario: "memory-bad" });
  assert.equal(bad.status, 1, bad.output);
  assert.match(bad.output, /unrecognized usage n\/a/);
  assert.doesNotMatch(bad.output, /INFO memory/);
  const four = smoke({ scenario: "memory-four" });
  assert.equal(four.status, 1, four.output);
  assert.match(four.output, /expected measurements for all five clone services/);
  assert.doesNotMatch(four.output, /INFO memory/);
});

test("smoke explains missing runner dependencies and bounds the config-reload deletion wait", () => {
  const deps = smoke({ scenario: "deps" });
  assert.equal(deps.status, 1, deps.output);
  assert.match(deps.output, /golden runner cannot start; run pnpm install/);
  assert.equal(deps.events.some(event => event.args.includes("up")), false);
  const deletion = smoke({ scenario: "delete-stuck" });
  assert.equal(deletion.status, 1, deletion.output);
  assert.match(deletion.output, /FAIL delete-repo: config reload\/index deletion did not complete within 3s/);
  assert.match(deletion.output, /fixture compose failure logs/);
});

test("smoke runs the whole stack as five services in a falkon-eval project and sends search and golden captures through the api", () => {
  const ok = smoke();
  assert.equal(ok.status, 0, ok.output);
  const compose = ok.events.find((event) => event.command === "docker" && event.args.includes("up"))!;
  assert.match(compose.args[compose.args.indexOf("-p") + 1]!, /^falkon-eval-/);
  const searches = ok.events.filter((event) => event.command === "curl" && event.args.includes("-o"));
  assert.ok(searches.length > 0);
  for (const event of searches) {
    assert.ok(event.args.includes("http://127.0.0.1:3302/ui/products/fixtures/search"));
    assert.match(event.auth ?? "", /^authorization: Bearer [0-9a-f]{48}$/);
  }
  const down = smoke({ scenario: "api-down" });
  assert.equal(down.status, 1, down.output);
  assert.match(down.output, /FAIL api: \/mcp\/fixtures did not answer within 3s/);
});

test("smoke seeds the fixtures Product from the backend container before it waits on /mcp/fixtures", () => {
  const ok = smoke();
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.output, /PASS seed/);
  const exec = ok.events.findIndex((event) => event.command === "docker" && event.args.includes("exec"));
  const first = ok.events.findIndex((event) => event.command === "curl" && event.args.at(-1)!.endsWith("/mcp/fixtures"));
  assert.ok(exec >= 0 && first > exec, "the seed runs before the first /mcp/fixtures call");
  assert.deepEqual(ok.events[exec]!.args.slice(-4), ["../../scripts/seed-product.ts", "fixtures", "Fixtures", "fixtures.test/*"]);
  assert.ok(ok.events[exec]!.args.includes("backend"));
  const seedFail = smoke({ scenario: "seed-fail" });
  assert.equal(seedFail.status, 1, seedFail.output);
  assert.match(seedFail.output, /FAIL seed: the fixtures Product was not written within 3s/);
});

test("smoke checks the admin listener's auth and that /products is gone, with no create or delete round trip", () => {
  const ok = smoke();
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.output, /PASS admin-auth/);
  const curls = ok.events.filter((event) => event.command === "curl").map((event) => `${event.args.includes("--request") ? event.args[event.args.indexOf("--request") + 1] : "GET"} ${event.args.at(-1)}`);
  for (const expected of ["GET http://127.0.0.1:3301/connections", "GET http://127.0.0.1:3302/connections", "GET http://127.0.0.1:3302/products"]) assert.ok(curls.includes(expected), expected);
  assert.equal(curls.some((c) => c.startsWith("POST http://127.0.0.1:3302") || c.startsWith("DELETE ")), false, "no create or delete on the admin port");
  const admin = ok.events.filter((event) => event.command === "curl" && event.args.at(-1)!.includes(":3302/"));
  const headers = admin.map((event) => event.auth);
  const tokens = new Set(headers.filter((h) => h?.startsWith("authorization: Bearer ") && h !== "authorization: Bearer wrong-token"));
  assert.equal(tokens.size, 1, "one random token is used for every authorised admin call");
  assert.match([...tokens][0]!, /^authorization: Bearer [0-9a-f]{48}$/);
  assert.ok(headers.includes(undefined), "a tokenless admin call is made");
  assert.ok(headers.includes("authorization: Bearer wrong-token"), "a wrong-token admin call is made");
  const token = [...tokens][0]!.slice(22);
  assert.equal(JSON.stringify(ok.events.map((event) => event.args)).includes(token), false, "the token never reaches any command line, only a header file");
  assert.ok(admin.some((event) => event.args.some((arg) => /^@.*admin\.header$/.test(arg))), "curl reads the token from a header file");
  for (const [scenario, message] of [["admin-open", /FAIL admin-auth: a tokenless admin call is not 401/], ["admin-exposed", /FAIL admin-auth: admin routes answer on the product port/], ["products-back", /FAIL admin-auth: \/products still answers with the token/]] as const) {
    const result = smoke({ scenario });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
  }
});
