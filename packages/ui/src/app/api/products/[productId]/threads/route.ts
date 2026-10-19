import { endpoint, proxy, type ProductRoute } from "@/lib/api/server";
import { useEngine } from "@/lib/api/engine";
import { findProduct, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  if (useEngine())
    return proxy(
      `/ui/products/${encodeURIComponent(productId)}/threads`,
      "GET",
    );
  return endpoint(() =>
    transact((db) => {
      findProduct(db, productId);
      return db.threads
        .filter((thread) => thread.productId === productId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({
          id: thread.id,
          productId: thread.productId,
          title: thread.title,
          updatedAt: thread.updatedAt,
        }));
    }),
  );
}
export async function POST(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  if (useEngine())
    return proxy(
      `/ui/products/${encodeURIComponent(productId)}/threads`,
      "POST",
    );
  return endpoint(() =>
    transact((db) => {
      findProduct(db, productId);
      const thread = {
        id: crypto.randomUUID(),
        productId,
        title: "New thread",
        updatedAt: Date.now(),
        answers: [],
      };
      db.threads.push(thread);
      return thread;
    }, true),
  );
}
