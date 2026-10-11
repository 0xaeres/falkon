import { endpoint, type ProductRoute } from "@/lib/api/server";
import { makeStatus } from "@/lib/mock/fixtures";
import { findProduct, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return endpoint(() =>
    transact((db) => makeStatus(findProduct(db, productId))),
  );
}
