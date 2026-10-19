import { endpoint, proxy, type ThreadRoute } from "@/lib/api/server";
import { useEngine } from "@/lib/api/engine";
import { findThread, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ThreadRoute) {
  const { productId, threadId } = await context.params;
  if (useEngine())
    return proxy(
      `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}`,
      "GET",
    );
  return endpoint(() => transact((db) => findThread(db, productId, threadId)));
}
