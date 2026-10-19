import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function seedContractRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-contract-"));
  const work = path.join(dir, "work");
  const bare = path.join(dir, "repos", "atlas.git");
  fs.mkdirSync(path.join(work, "src", "nested"), { recursive: true });
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: work, env: gitEnv, stdio: "pipe" });
  git("init", "-q", "--object-format=sha1", "-b", "main");
  fs.writeFileSync(path.join(work, "src", "hello.ts"), 'export function greet() { return "hello world"; }\ngreet();\n');
  fs.writeFileSync(path.join(work, "src", "nested", "a.ts"), "// nested\n");
  fs.writeFileSync(path.join(work, "long.txt"), "x".repeat(2100) + "\n");
  fs.writeFileSync(path.join(work, "bytes.txt"), ("y".repeat(1900) + "\n").repeat(4));
  fs.writeFileSync(path.join(work, "lines.txt"), "short\n".repeat(510));
  fs.writeFileSync(path.join(work, "empty.txt"), "");
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "initial fixture");
  git("tag", "v1"); git("branch", "feature");
  fs.appendFileSync(path.join(work, "src", "hello.ts"), "// second commit\n");
  gitEnv.GIT_AUTHOR_DATE = gitEnv.GIT_COMMITTER_DATE = "2026-01-02T00:00:00Z";
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "extend greeting");
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  git("clone", "-q", "--bare", work, bare);
  return { dir, bare };
}
