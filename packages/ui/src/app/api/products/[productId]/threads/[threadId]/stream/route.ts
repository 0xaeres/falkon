import { apiError, type ThreadRoute } from "@/lib/api/server";
import { forward } from "@/lib/api/engine";

// Resumes the answer being written: the engine's stream is passed through unchanged; 204 means none is running.
export async function GET(request: Request, context: ThreadRoute) {
  try {
    const { productId, threadId } = await context.params;
    return await forward(
      `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}/stream`,
      { stream: request.signal },
    );
  } catch (error) {
    return apiError(error);
  }
}
