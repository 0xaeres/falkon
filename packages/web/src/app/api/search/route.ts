import { NextResponse, type NextRequest } from "next/server";
import { QuerySyntaxError, qRepo, search } from "@sbc/shared";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const p = req.nextUrl.searchParams;
  const q = p.get("q") ?? "";
  const matches = Math.min(Math.max(Math.trunc(Number(p.get("limit") ?? 500)) || 500, 1), 5000);
  try {
    const r = await search(q, {
      regex: p.get("regex") === "1",
      caseSensitive: p.get("case") === "1",
      matches,
      scope: scope.repoFilter ? [qRepo(scope.repoFilter)] : [],
    });
    // The scope node narrows the query; filtering the hits is the guarantee.
    const files = r.files.filter((f) => scope.allows(f.repo));
    return NextResponse.json(
      files.length === r.files.length
        ? r
        : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) },
    );
  } catch (e) {
    const status = e instanceof QuerySyntaxError || (e as Error).message === "empty query" ? 400 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
