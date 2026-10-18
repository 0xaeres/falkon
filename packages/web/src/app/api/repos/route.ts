import { NextResponse } from "next/server";
import { prisma } from "@sbc/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const repos = await prisma.repo.findMany({
    orderBy: { name: "asc" },
    select: { name: true, defaultBranch: true, branches: true, status: true, error: true, pushedAt: true, lastIndexedAt: true },
  });
  return NextResponse.json({ repos });
}
