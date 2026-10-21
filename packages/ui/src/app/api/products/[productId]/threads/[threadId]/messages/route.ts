import { chatMessageRequestSchema } from "@sbc/contracts";
import { apiError, body, type ThreadRoute } from "@/lib/api/server";
import { forward } from "@/lib/api/engine";

// The engine's UI message stream is passed through unchanged.
export async function POST(request: Request, context: ThreadRoute) {
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
