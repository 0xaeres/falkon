import { endpoint, proxy, type ProductRoute } from "@/lib/api/server";
import { useEngine } from "@/lib/api/engine";
import { makeStatus } from "@/lib/mock/fixtures";
import { findProduct, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  if (useEngine()) return proxy(`/ui/products/${encodeURIComponent(productId)}/status`, "GET");
  return endpoint(() =>
    transact((db) => makeStatus(findProduct(db, productId))),
  );
}
