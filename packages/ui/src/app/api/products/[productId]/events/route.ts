import { apiError, type ProductRoute } from "@/lib/api/server";
import { forward } from "@/lib/api/engine";

// The Product event stream, passed through unchanged (no timeout while the browser stays); the engine sends a comment every 25 s.
// Without ENGINE_URL (mock mode) the pages read the mock once and nothing changes, so the answer is an open, silent stream:
// the browser stays connected and neither retries nor logs errors.
export async function GET(request: Request, context: ProductRoute) {
  try {
    const { productId } = await context.params;
    if (!process.env.ENGINE_URL) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": no engine\n\n"));
          request.signal.addEventListener("abort", () => controller.close(), { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
    return await forward(`/ui/products/${encodeURIComponent(productId)}/events`, { stream: request.signal });
  } catch (error) {
    return apiError(error);
  }
}
