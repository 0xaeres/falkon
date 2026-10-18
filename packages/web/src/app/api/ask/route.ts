import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ask } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({
  query: z.string().min(1),
  repos: z.array(z.string()).optional(),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json(await ask(parsed.data.query, parsed.data));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
