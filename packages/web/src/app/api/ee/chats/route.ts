import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@sbc/db";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The caller's chats, newest first; `?id=` returns one chat with its messages (own or public). */
export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const c = await prisma.chat.findUnique({ where: { id } });
    if (!c || (c.visibility !== "PUBLIC" && c.createdBy !== scope.principal)) return NextResponse.json({ statusCode: 404, errorCode: "NOT_FOUND", message: "Chat not found." }, { status: 404 });
    return NextResponse.json(c);
  }
  const chats = await prisma.chat.findMany({
    where: { createdBy: scope.principal },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, visibility: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ chats });
}
