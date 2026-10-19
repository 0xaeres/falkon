import { createHash } from "node:crypto";
import fs from "node:fs";
import { authenticate, loadAccessKeys, scopeFor, type AccessKey, type Scope } from "./access";

/** A caller's view of one Product: the repo names it may see and the Scope the tools enforce. */
export interface EffectiveScope {
  repos: string[];
  scope: Scope;
}

/**
 * Decides which of a Product's repositories a caller may see (ADR 0001, 4.5 and P2). It can narrow a Product, never widen it.
 * The boundary calls `authenticate` before it looks the Product up, so a caller without access learns nothing about Products.
 */
export interface AccessPolicy {
  /** The caller behind an `Authorization` header value, or null (401). */
  authenticate(authorization: string | undefined): Scope | null;
  /** The caller's part of a Product, or null when the caller may see none of it (answered like an unknown Product). */
  effectiveScope(caller: Scope, productRepos: string[]): EffectiveScope | null;
}

/**
 * Product ∩ caller, as explicit names. A name containing `*` is dropped, so a stored name can never act as a
 * prefix or wildcard pattern in `scopeFor`; real repository names never contain one.
 */
function effective(caller: Scope, productRepos: string[]): EffectiveScope {
  const repos = productRepos.filter((r) => !r.includes("*") && caller.allows(r));
  return { repos, scope: { ...scopeFor(repos), principal: caller.principal } };
}

/** `none`: no credential; every caller is one principal and sees the whole Product. */
export function noneAccessPolicy(): AccessPolicy {
  const anonymous: Scope = { ...scopeFor(["*"]), principal: "anonymous" };
  return { authenticate: () => anonymous, effectiveScope: effective };
}

/**
 * `apiKey`: `Authorization: Bearer <key>` against ACCESS_FILE, re-read when it changes. Fails closed: an unset,
 * missing, unreadable, malformed or empty access file lets nobody in. An empty intersection is a denial.
 */
export function apiKeyAccessPolicy(file: string | undefined): AccessPolicy {
  let cached: { mtimeMs: number; keys: AccessKey[] } | undefined;
  const keys = (): AccessKey[] => {
    if (!file) return [];
    try {
      const mtimeMs = fs.statSync(file).mtimeMs;
      if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, keys: loadAccessKeys(file) };
      return cached.keys;
    } catch (e) {
      cached = undefined;
      console.error(`ACCESS_FILE ${file} unusable, denying all requests:`, (e as Error).message);
      return [];
    }
  };
  if (!file) console.error("AUTH_MODE=apiKey without ACCESS_FILE: denying all requests");
  return {
    authenticate(authorization) {
      const presented = authorization?.match(/^Bearer (.+)$/)?.[1];
      // restricted: with no keys loaded nobody gets in (never the open "anonymous" scope)
      return presented === undefined ? null : authenticate(presented, keys(), undefined, true);
    },
    effectiveScope(caller, productRepos) {
      const e = effective(caller, productRepos);
      return e.repos.length ? e : null;
    },
  };
}

/** AUTH_MODE: `none` (default when unset) or `apiKey`. Anything else throws, so the service refuses to start. */
export function accessPolicyFromEnv(env: Record<string, string | undefined>): AccessPolicy {
  const mode = env.AUTH_MODE ?? "none";
  if (mode === "none") return noneAccessPolicy();
  if (mode === "apiKey") return apiKeyAccessPolicy(env.ACCESS_FILE || undefined);
  throw new Error(`AUTH_MODE must be "none" or "apiKey", got ${JSON.stringify(mode)}`);
}

/** sha256 over the sorted effective repo names: what an MCP session is bound to (P11). */
export const scopeFingerprint = (repos: string[]) => createHash("sha256").update(JSON.stringify([...repos].sort())).digest("hex");
