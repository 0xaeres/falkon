import { proxy, type ThreadRoute } from "@/lib/api/server";
const path = async (context: ThreadRoute) => {
  const { productId, threadId } = await context.params;
  return `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}`;
};
export async function GET(_request: Request, context: ThreadRoute) {
  return proxy(await path(context), "GET");
}
/** Drops a thread that has no answer (the chat's cleanup after a failed first send); the engine keeps one with answers. */
export async function DELETE(_request: Request, context: ThreadRoute) {
  return proxy(await path(context), "DELETE");
}
