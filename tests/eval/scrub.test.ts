import assert from "node:assert/strict";
import { test } from "node:test";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_DIR, REPO_ROOT } from "./data.js";

// The predecessor product's name and the old design's name stay out of every shipped file (spec D9).
const forbidden = new RegExp(["source" + "bot", "fal" + "con"].join("|"), "i");

test("tests/eval, its file names and the root package.json name neither the predecessor product nor the old design", () => {
  const files = globSync("**/*", { cwd: EVAL_DIR, exclude: (p) => p === "node_modules" || p === ".local" }).filter((f) => !f.startsWith("node_modules") && !f.startsWith(".local"));
  assert.ok(files.length > 20);
  for (const file of files) {
    assert.doesNotMatch(file, forbidden, file);
    try { assert.doesNotMatch(readFileSync(join(EVAL_DIR, file), "utf8"), forbidden, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EISDIR") throw e; }
  }
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, "package.json"), "utf8"), forbidden);
});
