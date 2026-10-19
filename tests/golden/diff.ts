import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function compareOutputs(before: unknown, after: unknown): string {
  try { assert.deepEqual(after, before, "Golden output drift"); return ""; }
  catch (e) { return (e as Error).message; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [a, b] = process.argv.slice(2);
    if (!a || !b) throw new Error("Usage: pnpm golden:diff BEFORE.json AFTER.json");
    const diff = compareOutputs(JSON.parse(fs.readFileSync(a, "utf8")), JSON.parse(fs.readFileSync(b, "utf8")));
    if (diff) { console.error(diff); process.exitCode = 1; }
  } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
