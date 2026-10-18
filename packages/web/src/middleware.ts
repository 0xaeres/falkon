import { NextResponse, type NextRequest } from "next/server";

/** If SOURCEBOT_API_KEY is set, /api/* requires `Authorization: Bearer <key>`. UI same-origin calls use the cookie set by /?key=. */
export function middleware(req: NextRequest) {
  const key = process.env.SOURCEBOT_API_KEY;
  if (!key) return NextResponse.next();
  const bearer = req.headers.get("authorization");
  const cookie = req.cookies.get("sbc_key")?.value;
  if (bearer === `Bearer ${key}` || cookie === key) return NextResponse.next();
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = { matcher: "/api/:path*" };
