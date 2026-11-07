import { proxy, type ThreadRoute } from "@/lib/api/server";

/** Stops the answer being written (the question stays stored); 204 also when none is running. */
export async function POST(_request: Request, context: ThreadRoute) {
  const { productId, threadId } = await context.params;
  return proxy(
    `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}/stop`,
    "POST",
  );
}
