import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { authenticate, loadAccessKeys, type AccessKey, type Scope } from "@sbc/shared";

let cached: { mtimeMs: number; keys: AccessKey[] } | undefined;

/** Keys come from ACCESS_FILE (hashed, per-key repo scopes); re-read when the file changes. */
function keys(): AccessKey[] {
  const file = process.env.ACCESS_FILE;
  if (!file || !fs.existsSync(file)) return [];
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, keys: loadAccessKeys(file) };
  return cached.keys;
}

/** Bearer token, or the `sbc_key` cookie the UI sets. Returns the caller's scope, or null (401). */
export function scopeOf(req: NextRequest | Request): Scope | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const cookie = "cookies" in req ? req.cookies.get("sbc_key")?.value : undefined;
  return authenticate(bearer ?? cookie, keys(), process.env.SOURCEBOT_API_KEY || undefined);
}

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
