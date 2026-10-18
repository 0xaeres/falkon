import { NextResponse, type NextRequest } from "next/server";
import { toolNames } from "@sbc/shared";
import { runTool } from "@/lib/tools";

export const dynamic = "force-dynamic";

/** Used by the MCP server and any HTTP client: POST /api/tools/grep {pattern: ...} */
export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!(toolNames as string[]).includes(name)) return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  try {
    const args = await req.json().catch(() => ({}));
    return NextResponse.json({ output: await runTool(name, args) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
