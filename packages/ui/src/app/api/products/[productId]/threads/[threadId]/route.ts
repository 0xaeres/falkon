import { endpoint, proxy, type ThreadRoute } from "@/lib/api/server";
import { useEngine } from "@/lib/api/engine";
import { MockError, findThread, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ThreadRoute) {
  const { productId, threadId } = await context.params;
  if (useEngine())
    return proxy(
      `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}`,
      "GET",
    );
  return endpoint(() => transact((db) => findThread(db, productId, threadId)));
}
/** Drops a thread that has no answer (the chat's cleanup after a failed first send); one with answers is kept. */
export async function DELETE(_request: Request, context: ThreadRoute) {
  const { productId, threadId } = await context.params;
  if (useEngine())
    return proxy(
      `/ui/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}`,
      "DELETE",
    );
  return endpoint(() =>
    transact((db) => {
      const thread = findThread(db, productId, threadId);
      if (thread.answers.length)
        throw new MockError("This thread has answers and was kept.", 409);
      db.threads = db.threads.filter((item) => item !== thread);
      return null;
    }, true),
  );
}
