import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

/** What one API key may see: a set of repo names, each exact or a trailing-`*` prefix. */
export interface Scope {
  allows(repo: string): boolean;
  /** RE2 regexp over repo names restricting a search to the scope; null when unrestricted. */
  repoFilter: string | null;
}

export const accessKeySchema = z.object({
  name: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  repos: z.array(z.string()),
});
export type AccessKey = z.infer<typeof accessKeySchema>;

const meta = /[.+?^${}()|[\]\\]/g;
const hex = (s: string) => s.replace(meta, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));

export function scopeFor(patterns: string[]): Scope {
  if (patterns.includes("*")) return { allows: () => true, repoFilter: null };
  const exact = new Set(patterns.filter((p) => !p.endsWith("*")));
  const prefixes = patterns.filter((p) => p.endsWith("*")).map((p) => p.slice(0, -1));
  const alts = [...exact].map(hex).concat(prefixes.map((p) => hex(p) + ".*"));
  return {
    allows: (repo) => exact.has(repo) || prefixes.some((p) => repo.startsWith(p)),
    // an empty allowlist matches nothing: `$^` cannot match any repo name
    repoFilter: `^(?:${alts.length ? alts.join("|") : "$^"})$`,
  };
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: Buffer, b: Buffer) => timingSafeEqual(a, b);

/**
 * Resolve a presented key to a scope, or null for no access.
 * With no keys and no legacy key configured, access is open (local development), unless
 * `restricted` says an access file was configured: then an empty or missing list denies everyone.
 */
export function authenticate(presented: string | undefined, keys: AccessKey[], legacyKey?: string, restricted = false): Scope | null {
  if (!keys.length && !legacyKey && !restricted) return scopeFor(["*"]);
  if (!presented) return null;
  const d = digest(presented);
  if (legacyKey && same(d, digest(legacyKey))) return scopeFor(["*"]);
  const key = keys.find((k) => same(d, Buffer.from(k.sha256, "hex")));
  return key ? scopeFor(key.repos) : null;
}

/** Throws when `file` is set but unreadable or malformed: a broken access file must not mean open access. */
export function loadAccessKeys(file: string | undefined): AccessKey[] {
  if (!file) return [];
  return z.object({ keys: z.array(accessKeySchema) }).parse(JSON.parse(fs.readFileSync(file, "utf8"))).keys;
}
