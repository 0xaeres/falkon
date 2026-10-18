import { NextResponse, type NextRequest } from "next/server";
import { search } from "@sbc/shared";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const regex = req.nextUrl.searchParams.get("regex") === "1";
  const maxFiles = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500);
  try {
    const r = await search(q, { regex, maxFiles, filter: scope.zoektFilter ?? undefined });
    const files = r.files.filter((f) => scope.allows(f.repo));
    return NextResponse.json(files.length === r.files.length ? r : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.matches.length, 0) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
