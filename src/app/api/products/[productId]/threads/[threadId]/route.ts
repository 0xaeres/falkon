import { endpoint, type ThreadRoute } from "@/lib/api/server";
import { findThread, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ThreadRoute) {
  const { productId, threadId } = await context.params;
  return endpoint(() => transact((db) => findThread(db, productId, threadId)));
}
