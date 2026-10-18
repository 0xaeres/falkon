import type { NextRequest } from "next/server";
import { QuerySyntaxError, parseQuery, qRepo, streamIR } from "@sbc/shared";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

const sse = (data: unknown) => new TextEncoder().encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);

/** Server-sent events: one `chunk` event per zoekt flush, then `final`, then `[DONE]`. */
export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const p = req.nextUrl.searchParams;
  let ir;
  try {
    ir = parseQuery(p.get("q") ?? "", { regex: p.get("regex") === "1", caseSensitive: p.get("case") === "1" });
  } catch (e) {
    const status = e instanceof QuerySyntaxError ? 400 : 500;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
  if ("const" in ir && ir.const === false) return Response.json({ error: "empty query" }, { status: 400 });

  const gen = streamIR(ir, { matches: Math.min(Math.max(Math.trunc(Number(p.get("limit") ?? 500)) || 500, 1), 5000) }, scope.repoFilter ? [qRepo(scope.repoFilter)] : []);
  const body = new ReadableStream({
    async start(controller) {
      let files = 0;
      let matches = 0;
      let exhaustive = true;
      try {
        for await (const chunk of gen) {
          const visible = chunk.files.filter((f) => scope.allows(f.repo));
          files += visible.length;
          matches += visible.reduce((n, f) => n + f.occurrences, 0);
          exhaustive = exhaustive && chunk.isSearchExhaustive;
          controller.enqueue(sse({ type: "chunk", files: visible }));
        }
        controller.enqueue(sse({ type: "final", fileCount: files, matchCount: matches, isSearchExhaustive: exhaustive }));
      } catch (e) {
        controller.enqueue(sse({ type: "error", error: e instanceof Error ? e.message : String(e) }));
      }
      controller.enqueue(sse("[DONE]"));
      controller.close();
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
