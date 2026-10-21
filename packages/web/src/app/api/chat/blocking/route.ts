import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { scopeOf, unauthorized } from "@/lib/auth";
import { askCodebase } from "@/lib/ask/chat";
import { askErrorResponse, languageModelInfo, schemaError } from "@/lib/ask/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const body = z.object({
  query: z.string().describe("The query to ask about the codebase."),
  repos: z.array(z.string()).optional(),
  languageModel: languageModelInfo.optional(),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
});

/** The blocking Ask: `{ answer, chatId, chatUrl, languageModel }`. */
export async function POST(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  const parsed = await body.safeParseAsync(await req.json().catch(() => undefined));
  if (!parsed.success) return schemaError(parsed.error);
  try {
    return NextResponse.json(await askCodebase({ ...parsed.data, scope }));
  } catch (e) {
    return askErrorResponse(e);
  }
}
