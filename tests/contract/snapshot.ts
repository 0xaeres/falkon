import assert from "node:assert/strict";
import fs from "node:fs";

export function snapshot(name: string, actual: unknown) {
  const file = new URL(`./${name}.json`, import.meta.url);
  const serialized = JSON.stringify(actual, null, 2) + "\n";
  if (process.env.UPDATE_SNAPSHOTS === "1") fs.writeFileSync(file, serialized);
  assert.ok(fs.existsSync(file), `Missing ${file.pathname}; run UPDATE_SNAPSHOTS=1 pnpm test`);
  assert.deepEqual(JSON.parse(serialized), JSON.parse(fs.readFileSync(file, "utf8")), `Contract drift: ${file.pathname}. Review the diff before updating.`);
}
