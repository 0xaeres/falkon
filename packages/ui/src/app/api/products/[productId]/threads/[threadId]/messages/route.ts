import { chatMessageRequestSchema } from "@sbc/contracts";
import { apiError, body, type ThreadRoute } from "@/lib/api/server";
import { forward, useEngine } from "@/lib/api/engine";

// Chat needs the engine: the mock has no model. The engine's UI message stream is passed through unchanged.
export async function POST(request: Request, context: ThreadRoute) {
  if (!useEngine())
    return Response.json(
      { error: "Chat needs the Falkon engine." },
      { status: 503 },
    );
  try {
    const { productId, threadId } = await context.params;
    return await forward(
      `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}/messages`,
      {
        method: "POST",
        body: await body(request, chatMessageRequestSchema),
        stream: request.signal,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
