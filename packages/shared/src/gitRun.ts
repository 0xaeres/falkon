/** The bounded git runner and the byte cut that the git tools and `get_diff` share. A leaf module: tools.ts imports it, so it imports nothing from there. */
import { spawn } from "node:child_process";

/** The limits every git tool works within, in one place. */
export const GIT_LIMITS = {
  /** Repositories read at the same time. */
  concurrency: 4,
  /** Time one repository may take. */
  repoMs: 15_000,
  /** Time the whole call may take; repositories not started by then are reported. */
  totalMs: 40_000,
  /** Repositories one call reads at most. */
  repos: 50,
  /** Bytes git may print for one repository before it is killed. */
  repoBytes: 4 * 1024 * 1024,
  /** About 24 KB of JSON per answer, as historyTools.ts. */
  answerBytes: 24_000,
} as const;

const STDERR_BYTES = 4096;

export interface GitRun {
  stdout: string;
  /** The first bytes git printed on stderr (its error text); empty when it printed none. */
  stderr: string;
  /** Which limit stopped git (it was killed and `stdout` is what was read up to then); undefined when git ended by itself. */
  limit?: "bytes" | "time";
  /** git's exit code; null when it was killed or could not start. */
  code: number | null;
}

/**
 * Runs `git` in `cwd` with `spawn` (never through simple-git) and kills it once it has printed `maxBytes` or has run for
 * `timeoutMs`. Returns at that moment with what was read, so a child of git (a hook, an alias) cannot hold the call open.
 * Arguments are not interpreted by a shell. The caller keeps every user-supplied value attached to its option (`--author=x`) or
 * after `--end-of-options` or `--`, so a leading dash cannot become an option.
 */
export function runGit(cwd: string, args: string[], o: { maxBytes: number; timeoutMs: number }): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat" } });
    const chunks: Buffer[] = [], errs: Buffer[] = [];
    let size = 0, settled = false;
    const finish = (code: number | null, limit?: GitRun["limit"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (limit) child.kill("SIGKILL");
      resolve({ stdout: Buffer.concat(chunks).subarray(0, o.maxBytes).toString("utf8"), stderr: Buffer.concat(errs).subarray(0, STDERR_BYTES).toString("utf8"), code, ...(limit ? { limit } : {}) });
    };
    const timer = setTimeout(() => finish(null, "time"), o.timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      if (settled) return;
      chunks.push(b);
      size += b.length;
      if (size >= o.maxBytes) finish(null, "bytes");
    });
    child.stderr.on("data", (b: Buffer) => { if (!settled && errs.length < 64) errs.push(b); });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Keeps the first 75% and the last 25% of `cap` bytes of `text` and puts a marker between them that states how many bytes were removed.
 * Text within the cap comes back as it is. Cuts fall on character boundaries; the marker says when a line is cut in two.
 */
export function cutMiddle(text: string, cap: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= cap) return text;
  let head = Math.floor(cap * 0.75), tail = buf.length - (cap - head);
  while (head > 0 && (buf[head]! & 0xc0) === 0x80) head--; // buf[head] would start the cut part: back up to the lead byte of a split character
  while (tail < buf.length && (buf[tail]! & 0xc0) === 0x80) tail++;
  const partial = (head > 0 && buf[head - 1] !== 0x0a) || (tail < buf.length && buf[tail - 1] !== 0x0a);
  const marker = `\n[... ${tail - head} bytes removed from the middle${partial ? "; the line before and the line after this marker may be partial" : ""} ...]\n`;
  return buf.subarray(0, head).toString("utf8") + marker + buf.subarray(tail).toString("utf8");
}
