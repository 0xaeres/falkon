import { NextResponse, type NextRequest } from "next/server";
import { search } from "@sbc/shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const regex = req.nextUrl.searchParams.get("regex") === "1";
  const maxFiles = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500);
  try {
    return NextResponse.json(await search(q, { regex, maxFiles }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
