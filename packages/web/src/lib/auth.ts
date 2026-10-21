import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { authenticate, loadAccessKeys, type AccessKey, type Scope } from "@falkon/shared";

let cached: { mtimeMs: number; keys: AccessKey[] } | undefined;

/**
 * Keys come from ACCESS_FILE (hashed, per-key repo scopes); re-read when the file changes.
 * Fails closed: if ACCESS_FILE is set but missing or invalid, nobody is let in.
 */
function keys(): AccessKey[] | null {
  const file = process.env.ACCESS_FILE;
  if (!file) return [];
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, keys: loadAccessKeys(file) };
    return cached.keys;
  } catch (e) {
    console.error(`ACCESS_FILE ${file} unusable, denying all requests:`, (e as Error).message);
    return null;
  }
}

/** Bearer token or the `falkon_key` cookie the UI sets. Returns the caller's scope, or null (401). */
export function scopeOf(req: NextRequest | Request): Scope | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const cookie = "cookies" in req ? req.cookies.get("falkon_key")?.value : undefined;
  const k = keys();
  if (k === null) return null;
  return authenticate(bearer ?? cookie, k, process.env.FALKON_API_KEY || undefined, !!process.env.ACCESS_FILE);
}

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
