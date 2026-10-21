import { handleMcpDelete, handleMcpPost } from "@/lib/mcp";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** MCP over streamable HTTP, at /api/mcp. */
export async function POST(req: Request) {
  const scope = scopeOf(req);
  return scope ? handleMcpPost(req, scope) : unauthorized();
}

export async function DELETE(req: Request) {
  const scope = scopeOf(req);
  return scope ? handleMcpDelete(req, scope) : unauthorized();
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });
}
