import { NextResponse, type NextRequest } from "next/server";
import { MAX_MATCHES, qRepo, search } from "@falkon/shared";
import { searchError, serviceError } from "@/lib/serviceError";
import { scopeOf, unauthorized } from "@/lib/auth";
import { loadContexts } from "@/lib/repos";

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
      contexts: await loadContexts(),
    });
    // The scope node narrows the query; filtering the hits is the guarantee.
    const files = r.files.filter((f) => scope.allows(f.repo));
    return NextResponse.json(
      files.length === r.files.length
        ? r
        : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) },
    );
  } catch (e) {
    return searchError(e);
  }
}

/** The public request shape: `{ query, matches, contextLines?, whole?, isRegexEnabled?, isCaseSensitivityEnabled? }`. */
export async function POST(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return serviceError(400, "INVALID_REQUEST_BODY", "invalid JSON body");
  }
  if (typeof body.query !== "string" || typeof body.matches !== "number") {
    return serviceError(400, "INVALID_REQUEST_BODY", "`query` (string) and `matches` (number) are required");
  }
  const matches = Math.min(Math.max(Math.trunc(body.matches) || 500, 1), MAX_MATCHES);
  try {
    const r = await search(body.query, {
      regex: body.isRegexEnabled === true,
      caseSensitive: body.isCaseSensitivityEnabled === true,
      matches,
      contextLines: typeof body.contextLines === "number" ? body.contextLines : undefined,
      scope: scope.repoFilter ? [qRepo(scope.repoFilter)] : [],
      contexts: await loadContexts(),
    });
    const files = r.files.filter((f) => scope.allows(f.repo));
    return NextResponse.json(
      files.length === r.files.length
        ? r
        : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) },
    );
  } catch (e) {
    return searchError(e);
  }
}
