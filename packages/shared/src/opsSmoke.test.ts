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
fs.appendFileSync(process.env.SMOKE_EVENTS, JSON.stringify({ command, args }) + '\\n');
if (command === 'date') {
  const tick = process.env.SMOKE_EVENTS + '.tick';
  const next = fs.existsSync(tick) ? Number(fs.readFileSync(tick, 'utf8')) + 1 : 0;
  fs.writeFileSync(tick, String(next));
  console.log(next);
} else if (command === 'docker') {
  if (args[0] === 'stats') {
    for (const [i, name] of ['backend', 'web', 'zoekt', 'postgres', 'redis'].entries()) {
      const usage = scenario === 'memory-fail' ? (i ? '100MB' : '254.01MB') :
        scenario === 'memory-edge' ? (i ? '100MB' : '254MB') :
        ['100MiB', '0.1GB', '100MB', '50000kB', '50000KiB'][i];
      console.log(JSON.stringify({ Name: name, MemUsage: usage + ' / 2GiB' }));
    }
  } else if (args.includes('ps')) console.log('backend\\nweb\\nzoekt\\npostgres\\nredis');
  else if (args.includes('logs')) console.log('fixture compose failure logs');
} else if (command === 'pnpm') {
  if (args.includes('exec')) process.exit(scenario === 'deps' ? 1 : 0);
  const record = args.indexOf('golden:record');
  if (record >= 0) fs.writeFileSync(args[record + 1], JSON.stringify({ capture: scenario === 'unstable' && args[record + 1].endsWith('after.json') ? 2 : 1 }));
  const diff = args.indexOf('golden:diff');
  if (diff >= 0) process.exit(fs.readFileSync(args[diff + 1], 'utf8') === fs.readFileSync(args[diff + 2], 'utf8') ? 0 : 1);
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
      events: fs.readFileSync(path.join(temp, "events"), "utf8").trim().split("\n").map(line => JSON.parse(line) as { command: string; args: string[] }),
    };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test("smoke compares two captures, warns without a baseline and records only when requested", () => {
  const missing = smoke();
  assert.equal(missing.status, 0, missing.output);
  assert.match(missing.output, /WARN no baseline exists/);
  assert.match(missing.output, /PASS golden-stability/);
  assert.match(missing.output, /PASS memory: whole clone stack 406\.06 MB/);
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

test("smoke enforces the 654 MB whole-stack ceiling, including postgres and redis", () => {
  const edge = smoke({ scenario: "memory-edge" });
  assert.equal(edge.status, 0, edge.output);
  assert.match(edge.output, /PASS memory: whole clone stack 654\.00 MB/);
  const over = smoke({ scenario: "memory-fail", record: true });
  assert.equal(over.status, 1, over.output);
  assert.match(over.output, /FAIL memory: whole clone stack 654\.01 MB/);
  assert.match(over.output, /fixture compose failure logs/);
  assert.equal(over.baseline, undefined);
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
