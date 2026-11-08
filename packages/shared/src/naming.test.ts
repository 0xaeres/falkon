import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The predecessor product's name and the misspelling of Falkon stay out of every tracked file outside .scratch/
// (AGENTS.md "Naming"). Patterns are built from fragments so this file never contains a name and cannot match itself.
const forbidden = new RegExp(["source" + "bot", "fal" + "con"].join("|"), "i");
const MAX_BYTES = 2 * 1024 * 1024; // larger files are assets or generated output, not prose worth scanning

function isBinary(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(8192);
    return buf.subarray(0, readSync(fd, buf, 0, 8192, 0)).includes(0);
  } finally {
    closeSync(fd);
  }
}

// Returns "path" for a name hit and "path:line" for a content hit; never the matched text.
function scan(root: string, files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (file.startsWith(".scratch/")) continue;
    if (forbidden.test(file)) hits.push(file);
    const abs = join(root, file);
    let st;
    try { st = statSync(abs); } catch { continue; } // tracked but deleted in the working tree
    if (!st.isFile() || st.size > MAX_BYTES || isBinary(abs)) continue;
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => { if (forbidden.test(line)) hits.push(`${file}:${i + 1}`); });
  }
  return hits;
}

const here = fileURLToPath(import.meta.url);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(here), encoding: "utf8" }).trim();

test("no tracked file outside .scratch/ names the predecessor product or the misspelling, in path or contents", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  assert.ok(files.length > 100);
  const hits = scan(root, files);
  assert.deepEqual(hits, [], `forbidden name at: ${hits.join(", ")}`);
});

test("this test file does not contain a forbidden name", () => {
  assert.deepEqual(scan(dirname(here), [here.split("/").pop()!]), []);
});

test("scan: reports path and line, matches any case, skips .scratch, binary and large files, flags names in file names", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-"));
  const pre = "source" + "bot", mis = "fal" + "con";
  mkdirSync(join(dir, ".scratch"));
  writeFileSync(join(dir, "a.txt"), `ok\nline ${pre.toUpperCase()}\n`);
  writeFileSync(join(dir, "b.txt"), `${mis[0].toUpperCase()}${mis.slice(1)}\n`);
  writeFileSync(join(dir, ".scratch", "c.txt"), pre);
  writeFileSync(join(dir, "bin.dat"), Buffer.concat([Buffer.from([0]), Buffer.from(pre)]));
  writeFileSync(join(dir, "big.txt"), Buffer.alloc(MAX_BYTES + 1, "x").fill(pre, 0, pre.length));
  writeFileSync(join(dir, `${mis}.md`), "clean\n");
  const files = [".scratch/c.txt", "a.txt", "b.txt", "bin.dat", "big.txt", `${mis}.md`];
  assert.deepEqual(scan(dir, files), ["a.txt:2", "b.txt:1", `${mis}.md`]);
});
