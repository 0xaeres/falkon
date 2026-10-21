import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@falkon/db";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const repos = await prisma.repo.findMany({
    orderBy: { name: "asc" },
    select: { name: true, defaultBranch: true, branches: true, status: true, error: true, pushedAt: true, lastIndexedAt: true },
  });
  return NextResponse.json({ repos: repos.filter((r) => scope.allows(r.name)) });
}
